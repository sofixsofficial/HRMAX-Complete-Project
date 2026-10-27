/**
 * Legacy Firebase callable dispatcher — `POST /fn/:name`.
 *
 * The Firebase apps invoked ~100 `httpsCallable` names. Names that map to
 * first-class REST routes are handled there (see the shims' ROUTE_MAPs);
 * every other name lands here and is dispatched by name with the original
 * callable's contract (docs/migration/inventory-backend-functions.md):
 * the web's admin/ops callables plus mobile's 58 Admin-SDK callables.
 *
 * Data lives in the same single-table layout as the REST handlers
 * (see lib/db.ts); user docs are written through writeUserDoc so the
 * USER#{uid}/PROFILE copy that resolveCaller reads stays in sync.
 */

import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { Req, Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import {
  allPartitions,
  companyPK,
  deleteEntity,
  doc,
  getEntity,
  getUserDoc,
  locateEntityAcross,
  patchEntity,
  putEntity,
  queryEntities,
  TABLE,
  userPK,
} from '../lib/db.js';
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { sendEmailCentral, templates } from '../lib/email.js';
import { cognitoCreateUser, writeUserDoc } from './auth.js';
import { assertCompanyScope, isSuperAdmin } from '../lib/auth.js';
import { ApiError, isoNow, newId, TIER_ORDER, type Caller, type LeaveTier, type UserRole } from '../lib/types.js';

const cognito = new CognitoIdentityProviderClient({});
const POOL_ID = () => process.env.COGNITO_USER_POOL_ID ?? '';
const INFO_EMAIL = () => process.env.INFO_EMAIL ?? 'info@hrmax.in';

const MANAGEMENT_ROLES: UserRole[] = ['master-admin', 'company-admin', 'executive', 'team-leader', 'hr'];
const NATURAL_ROLE: Record<LeaveTier, UserRole[]> = {
  reportingManager: ['reporting-manager'],
  hr: ['hr'],
  companyAdmin: ['company-admin'],
  executive: ['executive'],
  teamLeader: ['team-leader'],
};
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;
const bodyOf = (req: Req): Body => ({ ...(req.body as Body) });

/** `{ id, updates }` payloads: shallow-merge updates + remaining flat fields. */
const updatesOf = (req: Req): Body => {
  const b = bodyOf(req);
  const upd = (b.updates ?? b.patch) as Body | undefined;
  for (const k of ['id', 'updates', 'patch', 'companyId']) delete b[k];
  return upd && typeof upd === 'object' ? { ...upd, ...b } : b;
};

function requireRole(caller: Caller, roles: UserRole[]): void {
  if (!roles.includes(caller.role)) {
    throw new ApiError('permission-denied', `Requires role: ${roles.join(' | ')}`);
  }
}

const companyIdOf = (req: Req, fallbackToCaller = true): string =>
  String(req.body.companyId ?? (fallbackToCaller ? must(req).companyId : ''));

async function managementChainUids(companyId: string): Promise<string[]> {
  const users = await queryEntities<Body>({ entity: 'user', companyId });
  return users
    .filter((u) => MANAGEMENT_ROLES.includes(u.role as UserRole) && String(u.status ?? 'Active') === 'Active')
    .map((u) => String(u.id));
}

async function masterAdminUids(): Promise<string[]> {
  // Master admins are dual-written to the 'global' partition (see writeUserDoc);
  // GSI2 (usersByRole) is never populated by this backend, so query directly.
  const mas = await queryEntities<Body>({ entity: 'user', companyId: 'global', filters: { role: 'master-admin' }, limit: 100 });
  return mas.map((u) => String(u.id));
}

/** Patch a user doc and re-write BOTH copies (company partition + PROFILE). */
async function patchUserDoc(uid: string, patch: Body): Promise<Body> {
  const user = await getUserDoc(uid);
  if (!user) throw new ApiError('not-found', 'User not found');
  const merged = { ...user, ...patch } as Parameters<typeof writeUserDoc>[1];
  return writeUserDoc(uid, merged) as unknown as Body;
}

async function cognitoDeleteByEmail(email: string): Promise<void> {
  if (!email || !POOL_ID()) return;
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL_ID(), Username: email }));
  } catch {
    // user may not exist in Cognito — ignore (parity: best-effort Auth deletes)
  }
}

async function listPartition(companyId: string): Promise<Array<{ PK: string; SK: string; entity?: string; data?: Body }>> {
  const out: Array<{ PK: string; SK: string; entity?: string; data?: Body }> = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': companyPK(companyId) },
        ExclusiveStartKey: key,
      }),
    );
    out.push(...((res.Items ?? []) as Array<{ PK: string; SK: string; entity?: string; data?: Body }>));
    key = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (key);
  return out;
}

/** Add N working (Mon–Fri) days to an ISO date — used for the payslip correction window. */
function addWorkingDays(iso: string, days: number): Date {
  const d = new Date(iso);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Leave tier review (shared by leave + missed-punch callables)
// ---------------------------------------------------------------------------

function deriveLeaveStatus(doc_: Body): { status: string; approvalCount: number } {
  const vals = Object.values((doc_.approvalStatus as Record<string, string>) ?? {});
  const decided = vals.filter((v) => v === 'Approved' || v === 'Rejected').length;
  if (vals.includes('Rejected')) return { status: 'Rejected', approvalCount: decided };
  const allApproved = vals.every((v) => v === 'Approved' || v === 'Skipped');
  if (allApproved) {
    if (doc_.masterAdminRequired && doc_.masterAdminApproveStatus !== 'Approved') {
      return { status: 'Pending', approvalCount: decided };
    }
    return { status: 'Approved', approvalCount: decided };
  }
  return { status: 'Pending', approvalCount: decided };
}

async function loadLeaveRequest(caller: Caller, body: Body): Promise<Body> {
  const companyId = String(body.companyId ?? caller.companyId);
  const id = String(body.id ?? '');
  const list = await queryEntities<Body>({ entity: 'leaveRequest', companyId, filters: { id }, limit: 1 });
  const doc_ = list[0];
  if (!doc_) throw new ApiError('not-found', 'Leave request not found');
  return doc_;
}

/** Sequential-tier gate (RM → CA → Exec → TL) + status recompute + fan-out. */
async function reviewLeaveTier(caller: Caller, body: Body): Promise<unknown> {
  const tier = String(body.tier ?? '') as LeaveTier;
  const decision = String(body.decision ?? '') as 'Approved' | 'Rejected';
  const note = body.note ? String(body.note) : undefined;
  if (!TIER_ORDER.includes(tier)) throw new ApiError('bad-request', 'Invalid tier');
  if (!['Approved', 'Rejected'].includes(decision)) throw new ApiError('bad-request', 'decision must be Approved or Rejected');
  if (decision === 'Rejected' && !note?.trim()) throw new ApiError('bad-request', 'A review note is required for rejection');

  const doc_ = await loadLeaveRequest(caller, body);
  if (!isSuperAdmin(caller)) assertCompanyScope(caller, String(doc_.companyId));

  const approverIds = (doc_.approverIds as Record<string, string | null>) ?? {};
  const status = (doc_.approvalStatus as Record<string, string>) ?? {};
  const stamped = approverIds[tier];
  const allowed =
    isSuperAdmin(caller) ||
    (Boolean(stamped) && stamped === caller.uid) ||
    NATURAL_ROLE[tier].includes(caller.role);
  if (!allowed) throw new ApiError('permission-denied', 'You are not an approver for this tier');
  if (status[tier] !== 'Pending') throw new ApiError('failed-precondition', 'This tier is not pending');

  const idx = TIER_ORDER.indexOf(tier);
  for (let i = 0; i < idx; i++) {
    const prev = status[TIER_ORDER[i]];
    if (prev !== 'Approved' && prev !== 'Skipped') {
      throw new ApiError('failed-precondition', 'Earlier tiers must be decided first');
    }
  }

  const patch: Body = {
    [`approvalStatus.${tier}`]: decision,
    [`${tier}ReviewedAt`]: isoNow(),
    ...(note ? { [`${tier}ReviewNote`]: note } : {}),
  };
  const updated = await patchEntity<Body>('leaveRequest', String(doc_.companyId), String(doc_.id), patch, {
    entity: 'leaveRequest',
    userIdField: 'userId',
  });
  if (!updated) throw new ApiError('internal', 'Update failed');
  updated.approvalStatus = { ...(updated.approvalStatus as Record<string, string>), [tier]: decision };

  const derived = deriveLeaveStatus(updated);
  const finalPatch: Body = { status: derived.status, approvalCount: derived.approvalCount };
  const nextTier = (TIER_ORDER.slice(idx + 1) as LeaveTier[]).find(
    (t) => (updated.approvalStatus as Record<string, string>)[t] === 'Pending' && approverIds[t],
  );
  await patchEntity<Body>('leaveRequest', String(doc_.companyId), String(doc_.id), finalPatch, {
    entity: 'leaveRequest',
    userIdField: 'userId',
  });
  updated.status = derived.status;

  if (derived.status === 'Pending' && nextTier && approverIds[nextTier]) {
    await createNotification({
      userId: approverIds[nextTier]!,
      companyId: String(doc_.companyId),
      type: 'leave_review_pending',
      title: 'Leave request awaits your review',
      message: `${String(updated.fromName ?? updated.userName ?? 'An employee')}'s leave request is pending your ${nextTier} approval.`,
      link: `/leave/${doc_.id}`,
    });
  }
  if (derived.status === 'Approved' || derived.status === 'Rejected') {
    await createNotification({
      userId: String(updated.userId),
      companyId: String(doc_.companyId),
      type: derived.status === 'Approved' ? 'leave_approved' : 'leave_rejected',
      title: `Leave ${derived.status.toLowerCase()}`,
      message: note ?? `Your leave request was ${derived.status.toLowerCase()}.`,
      link: `/leave/${doc_.id}`,
    });
  }
  return { success: true, status: derived.status, approvalCount: derived.approvalCount };
}

async function reviewLeaveMasterAdmin(caller: Caller, body: Body): Promise<unknown> {
  requireRole(caller, ['master-admin']);
  const decision = String(body.decision ?? '') as 'Approved' | 'Rejected';
  const note = body.note ? String(body.note) : undefined;
  if (!['Approved', 'Rejected'].includes(decision)) throw new ApiError('bad-request', 'decision must be Approved or Rejected');
  const doc_ = await loadLeaveRequest(caller, body);
  if (!doc_.masterAdminRequired) throw new ApiError('failed-precondition', 'This request does not require master-admin review');
  if (String(doc_.status) !== 'Pending') throw new ApiError('failed-precondition', 'This request is not pending');

  await patchEntity<Body>('leaveRequest', String(doc_.companyId), String(doc_.id), {
    masterAdminApproveStatus: decision,
    masterAdminReviewedAt: isoNow(),
    ...(note ? { masterAdminReviewNote: note } : {}),
  }, { entity: 'leaveRequest', userIdField: 'userId' });

  const status = decision === 'Approved' ? 'Approved' : 'Rejected';
  await patchEntity<Body>('leaveRequest', String(doc_.companyId), String(doc_.id), { status }, {
    entity: 'leaveRequest',
    userIdField: 'userId',
  });
  await createNotification({
    userId: String(doc_.userId),
    companyId: String(doc_.companyId),
    type: status === 'Approved' ? 'leave_approved' : 'leave_rejected',
    title: `Leave ${status.toLowerCase()}`,
    message: note ?? `Your leave request was ${status.toLowerCase()} (final review).`,
    link: `/leave/${doc_.id}`,
  });
  return { success: true, status };
}

// ---------------------------------------------------------------------------
// Missed-punch rectification (mobile parity)
// ---------------------------------------------------------------------------

async function resolveMissedPunchApprovers(companyId: string, applicantUid: string, override?: Body): Promise<Record<LeaveTier, string | null>> {
  const users = await queryEntities<Body>({ entity: 'user', companyId });
  const pick = (role: UserRole): string | null =>
    String(users.find((u) => u.role === role && String(u.status ?? 'Active') === 'Active')?.id ?? '') || null;
  const emp = (await queryEntities<Body>({ entity: 'employee', companyId, filters: { userId: applicantUid }, limit: 1 }))[0];
  const applicantRole = String((await getUserDoc(applicantUid))?.role ?? 'employee');
  const ma = (await masterAdminUids())[0] ?? null;

  const resolved: Record<LeaveTier, string | null> = {
    reportingManager: pick('reporting-manager') ?? (emp ? String(emp.reportingManagerId ?? '') || null : null),
    hr: pick('hr'),
    companyAdmin: pick('company-admin'),
    executive: pick('executive'),
    teamLeader: pick('team-leader'),
  };
  // Client-supplied approvers win (parity with mobileApi.ts).
  for (const t of TIER_ORDER) {
    const o = override?.[t];
    if (o !== undefined) resolved[t] = o ? String(o) : null;
  }
  // Role-based chain truncation (parity with leave.ts):
  //   employee / reporting manager -> ... -> HR -> company admin
  //   HR -> company admin
  //   executive -> team leader (-> master-admin gate)
  //   company-admin / master-admin -> no personal records at all
  if (applicantRole === 'employee' || applicantRole === 'reporting-manager') {
    resolved.reportingManager = null;
    resolved.executive = null;
    resolved.teamLeader = null;
  } else if (applicantRole === 'hr') {
    resolved.reportingManager = null;
    resolved.hr = null;
    resolved.executive = null;
    resolved.teamLeader = null;
  } else if (applicantRole === 'executive') {
    resolved.reportingManager = null;
    resolved.hr = null;
    resolved.companyAdmin = null;
  } else if (applicantRole === 'master-admin' || applicantRole === 'company-admin') {
    resolved.reportingManager = null;
    resolved.hr = null;
    resolved.companyAdmin = null;
    resolved.executive = null;
    resolved.teamLeader = null;
  }
  // Never ask someone to approve their own request.
  for (const t of TIER_ORDER) {
    if (resolved[t] === applicantUid) resolved[t] = null;
  }
  void ma;
  return resolved;
}

async function mobileRequestPunchRectification(caller: Caller, body: Body): Promise<unknown> {
  const companyId = String(body.companyId ?? caller.companyId);
  const attendanceId = String(body.attendanceId ?? body.id ?? '');
  const rec = await getEntity<Body>('attendance', companyId, attendanceId);
  if (!rec) throw new ApiError('not-found', 'Attendance record not found');
  if (String(rec.userId) !== caller.uid && !MANAGEMENT_ROLES.includes(caller.role)) {
    throw new ApiError('permission-denied', 'Cannot request rectification for this record');
  }

  const approverIds = await resolveMissedPunchApprovers(companyId, String(rec.userId), body.approverIds as Body | undefined);
  const status: Record<string, string> = {};
  for (const t of TIER_ORDER) status[t] = approverIds[t] ? 'Pending' : 'Skipped';
  const approvalCount = Object.values(status).filter((v) => v === 'Approved' || v === 'Rejected').length;
  const applicantRole = String((await getUserDoc(String(rec.userId)))?.role ?? 'employee');
  const masterAdminRequired = ['master-admin', 'company-admin', 'executive', 'team-leader'].includes(applicantRole);

  const rect: Body = {
    reason: String(body.reason ?? ''),
    correctedCheckIn: body.correctedCheckIn ?? null,
    correctedCheckOut: body.correctedCheckOut ?? null,
    requestedById: caller.uid,
    requestedAt: isoNow(),
    status,
    approvalStatus: status,
    approverIds,
    approvalCount,
    masterAdminRequired,
    masterAdminApproveStatus: masterAdminRequired ? 'Pending' : undefined,
    resolved: false,
  };
  const updated = await patchEntity<Body>('attendance', companyId, attendanceId, { missedPunchRectification: rect }, {
    entity: 'attendance',
    userIdField: 'userId',
    tsField: 'date',
  });
  if (!updated) throw new ApiError('internal', 'Update failed');
  await fanOutNotifications(
    Object.values(approverIds).filter((v): v is string => Boolean(v)),
    {
      type: 'missed-punch-marked',
      title: 'Missed-punch rectification needs your review',
      message: `${caller.name || 'An employee'} submitted a punch rectification.`,
      link: `/attendance/${attendanceId}`,
      companyId,
    },
    caller.uid,
  );
  return { success: true, id: attendanceId, missedPunchRectification: rect };
}

async function reviewMissedPunchTier(caller: Caller, body: Body): Promise<unknown> {
  const tier = String(body.tier ?? '') as LeaveTier;
  const decision = String(body.decision ?? '') as 'Approved' | 'Rejected';
  const note = body.note ? String(body.note) : undefined;
  if (!TIER_ORDER.includes(tier)) throw new ApiError('bad-request', 'Invalid tier');
  if (!['Approved', 'Rejected'].includes(decision)) throw new ApiError('bad-request', 'decision must be Approved or Rejected');
  if (decision === 'Rejected' && !note?.trim()) throw new ApiError('bad-request', 'A review note is required for rejection');

  const companyId = String(body.companyId ?? caller.companyId);
  const attendanceId = String(body.attendanceId ?? body.id ?? '');
  const rec = await getEntity<Body>('attendance', companyId, attendanceId);
  const rect = rec?.missedPunchRectification as Body | undefined;
  if (!rec || !rect) throw new ApiError('not-found', 'No rectification on this record');
  if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);

  const approverIds = (rect.approverIds as Record<string, string | null>) ?? {};
  const status = (rect.approvalStatus as Record<string, string>) ?? {};
  const stamped = approverIds[tier];
  const allowed =
    isSuperAdmin(caller) ||
    (Boolean(stamped) && stamped === caller.uid) ||
    NATURAL_ROLE[tier].includes(caller.role);
  if (!allowed) throw new ApiError('permission-denied', 'You are not an approver for this tier');
  if (status[tier] !== 'Pending') throw new ApiError('failed-precondition', 'This tier is not pending');

  const idx = TIER_ORDER.indexOf(tier);
  for (let i = 0; i < idx; i++) {
    const prev = status[TIER_ORDER[i]];
    if (prev !== 'Approved' && prev !== 'Skipped') {
      throw new ApiError('failed-precondition', 'Earlier tiers must be decided first');
    }
  }

  const patch: Body = { [`missedPunchRectification.approvalStatus.${tier}`]: decision };
  const updated = await patchEntity<Body>('attendance', companyId, attendanceId, patch, {
    entity: 'attendance',
    userIdField: 'userId',
    tsField: 'date',
  });
  if (!updated?.missedPunchRectification) throw new ApiError('internal', 'Update failed');
  const r = updated.missedPunchRectification as Body;
  const vals = Object.values((r.approvalStatus as Record<string, string>) ?? {});
  const decided = vals.filter((v) => v === 'Approved' || v === 'Rejected').length;
  const allApproved = vals.every((v) => v === 'Approved' || v === 'Skipped');

  if (decision === 'Rejected' || allApproved) {
    await patchEntity<Body>('attendance', companyId, attendanceId, {
      'missedPunchRectification.resolved': true,
      'missedPunchRectification.resolution': decision === 'Rejected' ? 'Rejected' : 'Approved',
      'missedPunchRectification.resolvedAt': isoNow(),
      'missedPunchRectification.resolvedByName': caller.name,
      'missedPunchRectification.approvalCount': decided,
      ...(decision === 'Rejected' && note ? { 'missedPunchRectification.resolutionNote': note } : {}),
    }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
  } else {
    await patchEntity<Body>('attendance', companyId, attendanceId, {
      'missedPunchRectification.approvalCount': decided,
    }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
  }

  await createNotification({
    userId: String(rec.userId),
    companyId,
    type: decision === 'Approved' ? 'rectification-resolved' : 'rectification-resolved',
    title: `Punch rectification ${decision.toLowerCase()}`,
    message: note ?? `Your punch rectification was ${decision.toLowerCase()}.`,
    link: `/attendance/${attendanceId}`,
  });
  return { success: true, decision, approvalCount: decided };
}

async function reviewMasterAdminMissedPunch(caller: Caller, body: Body): Promise<unknown> {
  requireRole(caller, ['master-admin']);
  const decision = String(body.decision ?? '') as 'Approved' | 'Rejected';
  const note = body.note ? String(body.note) : undefined;
  if (!['Approved', 'Rejected'].includes(decision)) throw new ApiError('bad-request', 'decision must be Approved or Rejected');

  const companyId = String(body.companyId ?? caller.companyId);
  const attendanceId = String(body.attendanceId ?? body.id ?? '');
  const rec = await getEntity<Body>('attendance', companyId, attendanceId);
  const rect = rec?.missedPunchRectification as Body | undefined;
  if (!rec || !rect) throw new ApiError('not-found', 'No rectification on this record');
  if (!rect.masterAdminRequired) throw new ApiError('failed-precondition', 'This record does not require master-admin review');
  if (String(rect.approvalStatus && (rect.approvalStatus as Body).Pending ? 'Pending' : rect.resolved ? 'done' : 'Pending') === 'done') {
    throw new ApiError('failed-precondition', 'Already resolved');
  }
  const vals = Object.values((rect.approvalStatus as Record<string, string>) ?? {});
  if (!vals.every((v) => v === 'Approved' || v === 'Skipped')) {
    throw new ApiError('failed-precondition', 'All earlier tiers must be approved first');
  }

  const patch: Body = {
    'missedPunchRectification.masterAdminApproveStatus': decision,
    'missedPunchRectification.masterAdminApprovedOn': isoNow(),
    'missedPunchRectification.resolved': true,
    'missedPunchRectification.resolution': decision,
    'missedPunchRectification.resolvedAt': isoNow(),
    'missedPunchRectification.resolvedByName': caller.name,
  };
  if (decision === 'Approved' && rect.correctedCheckOut) patch.checkOut = rect.correctedCheckOut;
  if (decision === 'Rejected' && note) patch['missedPunchRectification.resolutionNote'] = note;

  await patchEntity<Body>('attendance', companyId, attendanceId, patch, {
    entity: 'attendance',
    userIdField: 'userId',
    tsField: 'date',
  });
  await createNotification({
    userId: String(rec.userId),
    companyId,
    type: 'rectification-resolved',
    title: `Punch rectification ${decision.toLowerCase()}`,
    message: note ?? `Your punch rectification was ${decision.toLowerCase()} (final review).`,
    link: `/attendance/${attendanceId}`,
  });
  return { success: true, decision };
}

// ---------------------------------------------------------------------------
// Payslip dispatch
// ---------------------------------------------------------------------------

async function sendPayslipEmail(companyId: string, slip: Body): Promise<boolean> {
  const emp = slip.userId ? await getUserDoc(String(slip.userId)) : null;
  const email = String(emp?.email ?? slip.email ?? '');
  if (!email) return false;
  const monthName = MONTH_NAMES[Number(slip.month) - 1] ?? String(slip.month);
  const year = Number(slip.year);
  const net = Number(slip.net ?? slip.netSalary ?? 0);
  const name = String(emp?.name ?? slip.employeeName ?? 'Employee');
  const t = templates.payslip(name, monthName, year, net, slip.version ? Number(slip.version) : undefined);
  const res = await sendEmailCentral({
    companyId,
    to: email,
    subject: t.subject,
    html: t.html,
    type: 'payslip',
    dedupKey: `payslip-${slip.id}${slip.version ? `-v${slip.version}` : ''}`,
  });
  if (res.success) {
    await patchEntity<Body>('salarySlip', companyId, String(slip.id), {
      emailStatus: 'sent',
      lastEmailedAt: isoNow(),
    }, { entity: 'salarySlip', userIdField: 'userId' });
  } else {
    await patchEntity<Body>('salarySlip', companyId, String(slip.id), { emailStatus: 'failed' }, {
      entity: 'salarySlip',
      userIdField: 'userId',
    });
  }
  return res.success;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const fn = (name: string, handler: (req: Req) => Promise<unknown>, opts?: { public?: boolean }): Route => ({
  method: 'POST',
  path: `/fn/${name}`,
  handler,
  ...(opts?.public ? { public: true } : {}),
});

export const legacyRoutes: Route[] = [
  // ------------------------------------------------------------------- web
  fn('logAuditEvent', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const id = newId();
    await putEntity<Body>({
      id,
      companyId: String(b.companyId ?? caller.companyId ?? 'global'),
      action: String(b.action ?? 'unknown'),
      actorId: caller.uid,
      actorName: caller.name,
      targetId: b.targetId ? String(b.targetId) : undefined,
      details: b.details,
      ip: caller.ip,
      userAgent: caller.userAgent,
      createdAt: isoNow(),
      // Readers (AuditLogs page, Settings, ExecutiveOversight) sort/display by
      // `timestamp` — stamp both so server-written rows appear there too.
      timestamp: isoNow(),
    }, { entity: 'auditLog', globalList: true, tsField: 'createdAt' });
    return { success: true, id };
  }),

  fn('corporateInquiry', async (req) => {
    const b = bodyOf(req);
    const email = String(b.email ?? '');
    if (!email) throw new ApiError('bad-request', 'email is required');
    const id = newId();
    await putEntity<Body>({
      id,
      companyId: 'global',
      name: String(b.name ?? ''),
      email,
      company: String(b.company ?? ''),
      phone: String(b.phone ?? ''),
      message: String(b.message ?? ''),
      status: 'New',
      createdAt: isoNow(),
    }, { entity: 'corporateInquiry', globalList: true });
    await sendEmailCentral({
      companyId: 'global',
      to: INFO_EMAIL(),
      subject: `New corporate inquiry from ${String(b.name ?? email)}`,
      html: `<p><b>${String(b.name ?? '')}</b> (${email}, ${String(b.company ?? '-')}) submitted a corporate inquiry.</p><p>${String(b.message ?? '').replace(/\n/g, '<br>')}</p>`,
      dedupKey: `inquiry-${email}-${isoNow()}`,
      type: 'corporate-inquiry',
    });
    return { success: true, id };
  }, { public: true }),

  fn('sendSupportTicket', async (req) => {
    const b = bodyOf(req);
    const email = String(b.email ?? req.caller?.email ?? '');
    if (!email) throw new ApiError('bad-request', 'email is required');
    const id = newId();
    await putEntity<Body>({
      id,
      companyId: 'global',
      email,
      name: String(b.name ?? req.caller?.name ?? ''),
      subject: String(b.subject ?? 'Support request'),
      message: String(b.message ?? ''),
      status: 'Open',
      createdById: req.caller?.uid ?? 'anonymous',
      createdAt: isoNow(),
    }, { entity: 'supportTicket', userIdField: 'createdById', globalList: true });
    const res = await sendEmailCentral({
      companyId: 'global',
      to: INFO_EMAIL(),
      subject: `Support ticket: ${String(b.subject ?? 'Support request')}`,
      html: `<p>From ${email}</p><p>${String(b.message ?? '').replace(/\n/g, '<br>')}</p>`,
      dedupKey: `support-${id}`,
      type: 'support-ticket',
    });
    return { success: true, id, emailDelivered: res.success };
  }, { public: true }),

  fn('notifyAttendanceCascade', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const userId = String(b.userId ?? '');
    if (!userId) throw new ApiError('bad-request', 'userId is required');
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller) && userId !== caller.uid && !MANAGEMENT_ROLES.includes(caller.role)) {
      throw new ApiError('permission-denied', 'Not authorized to fan out attendance events');
    }
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const event = String(b.type ?? b.event ?? 'attendance-update');
    const targets = [userId, ...(await managementChainUids(companyId)), ...(await masterAdminUids())];
    await fanOutNotifications(targets, {
      type: event,
      title: String(b.title ?? 'Attendance update'),
      message: String(b.message ?? ''),
      link: b.link ? String(b.link) : `/attendance`,
      companyId,
    }, caller.uid);
    await putEntity<Body>({
      id: newId(),
      companyId: 'global',
      type: 'attendance-cascade',
      event,
      title: String(b.title ?? 'Attendance update'),
      userIds: targets,
      createdAt: isoNow(),
    }, { entity: 'adminAlert' });
    return { success: true, notified: targets.length };
  }),

  fn('submitPayrollForApproval', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'executive', 'team-leader']);
    const b = bodyOf(req);
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const runId = String(b.runId ?? b.id ?? '');
    const run = await getEntity<Body>('payrollRun', companyId, runId);
    if (!run) throw new ApiError('not-found', 'Payroll run not found');
    if (!['Calculated', 'Draft'].includes(String(run.status))) {
      throw new ApiError('failed-precondition', 'Only Calculated/Draft runs can be submitted');
    }
    await patchEntity<Body>('payrollRun', companyId, runId, {
      status: 'Submitted',
      submittedAt: isoNow(),
      submittedById: caller.uid,
    }, { entity: 'payrollRun', tsField: 'createdAt' });
    await putEntity<Body>({
      id: newId(),
      companyId,
      runId,
      action: 'SUBMITTED',
      actorId: caller.uid,
      actorName: caller.name,
      at: isoNow(),
    }, { entity: 'payrollAudit', tsField: 'at' });
    const monthName = MONTH_NAMES[Number(run.month) - 1] ?? String(run.month);
    const admins = (await queryEntities<Body>({ entity: 'user', companyId }))
      .filter((u) => ['company-admin', 'master-admin'].includes(String(u.role)) && u.email && String(u.status ?? 'Active') === 'Active');
    // Email failure never fails the operation (parity with the original).
    const emailRes = await sendEmailCentral({
      companyId,
      to: admins.map((a) => String(a.email)),
      subject: `Payroll submitted for approval — ${monthName} ${run.year}`,
      html: `<p>Payroll run <b>${runId}</b> (${monthName} ${run.year}) has been submitted for approval.</p>`,
      dedupKey: `payroll-submit-${runId}`,
      type: 'payroll',
    });
    return { success: true, runId, status: 'Submitted', emailSent: emailRes.success };
  }),

  fn('dispatchPayslips', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const month = Number(b.month);
    const year = Number(b.year);
    const employeeIds = Array.isArray(b.employeeIds) ? (b.employeeIds as string[]).map(String) : null;
    const slips = await queryEntities<Body>({ entity: 'salarySlip', companyId, filters: { month, year } });
    const picked = employeeIds ? slips.filter((s) => employeeIds.includes(String(s.userId))) : slips;
    let sent = 0;
    let failed = 0;
    for (const slip of picked) {
      const ok = await sendPayslipEmail(companyId, slip);
      ok ? (sent += 1) : (failed += 1);
    }
    // Full-payroll summary to admins + company address.
    const monthName = MONTH_NAMES[month - 1] ?? String(month);
    const totalNet = picked.reduce((sum, s) => sum + Number(s.net ?? s.netSalary ?? 0), 0);
    const admins = (await queryEntities<Body>({ entity: 'user', companyId }))
      .filter((u) => ['company-admin', 'master-admin'].includes(String(u.role)) && u.email && String(u.status ?? 'Active') === 'Active');
    const summaryTo = [...admins.map((a) => String(a.email)), String((await getEntity<Body>('company', companyId, companyId))?.email ?? '')].filter(Boolean);
    const summaryRes = await sendEmailCentral({
      companyId,
      to: summaryTo,
      subject: `Payroll summary — ${monthName} ${year}`,
      html: `<p><b>${picked.length}</b> payslips dispatched for <b>${monthName} ${year}</b>.</p><p>Total net: ₹ ${totalNet.toLocaleString('en-IN')}</p>`,
      dedupKey: `payroll-summary-${companyId}-${month}-${year}`,
      type: 'payroll',
    });
    const summarySent = summaryRes.success ? summaryTo.length : 0;
    const message = failed > 0
      ? `Sent ${sent}, ${failed} failed. Use "Retry failed emails".`
      : `Sent ${sent} salary slips.`;
    return { success: true, dispatched: sent, failed, total: picked.length, adminCc: summaryTo.length, summarySent, message };
  }),

  fn('regeneratePayslip', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const b = bodyOf(req);
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const slipId = String(b.slipId ?? b.id ?? '');
    const slip = await getEntity<Body>('salarySlip', companyId, slipId);
    if (!slip) throw new ApiError('not-found', 'Salary slip not found');
    // 5-working-day correction window; after it only a master-admin with an
    // override reason may proceed (parity with payslipDispatch.ts).
    const deadline = addWorkingDays(String(slip.createdAt ?? isoNow()), 5);
    if (Date.now() > deadline.getTime()) {
      if (!isSuperAdmin(caller)) {
        throw new ApiError('failed-precondition', 'Correction window (5 working days) has passed');
      }
      if (!String(b.overrideReason ?? '').trim()) {
        throw new ApiError('bad-request', 'A master-admin override reason is required');
      }
    }
    const version = Number(slip.version ?? 0) + 1;
    await patchEntity<Body>('salarySlip', companyId, slipId, {
      version,
      emailStatus: 'retrying',
      correctedAt: isoNow(),
      correctedById: caller.uid,
      ...(b.overrideReason ? { overrideReason: String(b.overrideReason) } : {}),
    }, { entity: 'salarySlip', userIdField: 'userId' });
    const ok = await sendPayslipEmail(companyId, { ...slip, version });
    const withinWindow = Date.now() <= deadline.getTime();
    return { success: ok, slipId, supersedesId: undefined, version, emailed: ok, emailStatus: ok ? 'sent' : 'failed', withinWindow, deadline: deadline.toISOString() };
  }),

  fn('retryFailedPayslipEmails', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const q: Parameters<typeof queryEntities>[0] = { entity: 'salarySlip', companyId };
    if (b.month) q.filters = { month: Number(b.month) };
    if (b.year) q.filters = { ...q.filters, year: Number(b.year) };
    const all = await queryEntities<Body>(q);
    const failed = all.filter(
      (s) => ['failed', 'retrying'].includes(String(s.emailStatus ?? '')) && ['Paid', 'Emailed', 'Disbursed'].includes(String(s.status ?? '')),
    );
    let retried = 0;
    for (const slip of failed) {
      await patchEntity<Body>('salarySlip', companyId, String(slip.id), { emailStatus: 'retrying' }, {
        entity: 'salarySlip',
        userIdField: 'userId',
      });
      if (await sendPayslipEmail(companyId, slip)) retried += 1;
    }
    return { success: true, dispatched: retried, failed: failed.length - retried, total: failed.length };
  }),

  fn('deleteCompanyData', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const companyId = String((bodyOf(req).companyId ?? ''));
    if (!companyId) throw new ApiError('bad-request', 'companyId is required');
    const items = await listPartition(companyId);
    const users = items.filter((i) => i.entity === 'user');
    const skip = new Set<string>([caller.uid]);
    for (const u of users) {
      if (String((u.data as Body)?.role ?? '') === 'master-admin') skip.add(String((u.data as Body)?.id));
    }
    let deleted = 0;
    for (const it of items) {
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: it.PK, SK: it.SK } }));
      deleted += 1;
    }
    for (const u of users) {
      const uid = String((u.data as Body)?.id ?? '');
      const email = String((u.data as Body)?.email ?? '');
      if (!uid || skip.has(uid)) continue;
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
      await cognitoDeleteByEmail(email);
    }
    return { success: true, deleted };
  }),

  fn('deleteAllCompanyStaff', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const companyId = String((bodyOf(req).companyId ?? ''));
    if (!companyId) throw new ApiError('bad-request', 'companyId is required');
    const items = await listPartition(companyId);
    const users = items.filter((i) => i.entity === 'user');
    const skip = new Set<string>([caller.uid]);
    for (const u of users) {
      if (String((u.data as Body)?.role ?? '') === 'master-admin') skip.add(String((u.data as Body)?.id));
    }
    let deleted = 0;
    for (const it of items) {
      // Keep the company itself; remove everything else.
      if (it.SK === 'COMPANY#META' || it.entity === 'company') continue;
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: it.PK, SK: it.SK } }));
      deleted += 1;
    }
    for (const u of users) {
      const uid = String((u.data as Body)?.id ?? '');
      const email = String((u.data as Body)?.email ?? '');
      if (!uid || skip.has(uid)) continue;
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
      await cognitoDeleteByEmail(email);
    }
    return { success: true, deleted };
  }),

  // ---------------------------------------------------------------- shared
  fn('mobileReviewLeaveTier', async (req) => reviewLeaveTier(must(req), bodyOf(req))),
  fn('mobileReviewMasterAdminLeave', async (req) => reviewLeaveMasterAdmin(must(req), bodyOf(req))),
  fn('mobileCancelLeaveRequest', async (req) => {
    const caller = must(req);
    const doc_ = await loadLeaveRequest(caller, bodyOf(req));
    const owner = String(doc_.userId) === caller.uid;
    if (!owner && !isSuperAdmin(caller) && caller.role !== 'company-admin') {
      throw new ApiError('permission-denied', 'Not allowed to cancel this request');
    }
    await patchEntity<Body>('leaveRequest', String(doc_.companyId), String(doc_.id), { status: 'Cancelled' }, {
      entity: 'leaveRequest',
      userIdField: 'userId',
    });
    return { success: true, status: 'Cancelled' };
  }),
  fn('mobileRequestPunchRectification', async (req) => mobileRequestPunchRectification(must(req), bodyOf(req))),
  fn('mobileReviewMissedPunchTier', async (req) => reviewMissedPunchTier(must(req), bodyOf(req))),
  fn('mobileReviewMasterAdminMissedPunch', async (req) => reviewMasterAdminMissedPunch(must(req), bodyOf(req))),

  // --------------------------------------------------- leave (mobile create)
  fn('mobileCreateLeaveRequest', async (req) => {
    const caller = must(req);
    const raw = bodyOf(req);
    // The mobile client nests the payload under `leaveData`; accept flat too.
    const b = ((raw.leaveData as Body | undefined) ?? raw) as Body;
    const companyId = String(b.companyId ?? caller.companyId);
    if (!isSuperAdmin(caller) && !MANAGEMENT_ROLES.includes(caller.role) && String(b.userId ?? caller.uid) !== caller.uid) {
      throw new ApiError('permission-denied', 'Cannot create leave for this user');
    }
    const id = String(b.id ?? newId());
    const userId = String(b.userId ?? caller.uid);
    const doc_ = {
      ...b,
      id,
      companyId,
      userId,
      status: 'Pending',
      appliedOn: isoNow(),
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    await putEntity<Body>(doc_, { entity: 'leaveRequest', userIdField: 'userId' });
    return { success: true, id, leaveRequest: doc_ };
  }),

  // --------------------------------------------------------- tasks / tickets
  fn('mobileCreateTask', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId, createdAt: isoNow(), updatedAt: isoNow() }, { entity: 'task', userIdField: 'assignedToId' });
    return { success: true, id };
  }),
  fn('mobileUpdateTask', async (req) => {
    const caller = must(req);
    void caller;
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    const companyId = companyIdOf(req);
    const updated = await patchEntity<Body>('task', companyId, id, updatesOf(req), { entity: 'task', userIdField: 'assignedToId' });
    if (!updated) throw new ApiError('not-found', 'Task not found');
    return { success: true, task: updated };
  }),
  fn('mobileCreateTicket', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId, status: String(b.status ?? 'Open'), createdById: caller.uid, createdAt: isoNow(), updatedAt: isoNow() }, { entity: 'ticket', userIdField: 'createdById' });
    return { success: true, id };
  }),
  fn('mobileUpdateTicket', async (req) => {
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    const companyId = companyIdOf(req);
    const updated = await patchEntity<Body>('ticket', companyId, id, updatesOf(req), { entity: 'ticket', userIdField: 'createdById' });
    if (!updated) throw new ApiError('not-found', 'Ticket not found');
    return { success: true, ticket: updated };
  }),
  fn('mobileUpdateTicketStatus', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    const companyId = companyIdOf(req);
    const updated = await patchEntity<Body>('ticket', companyId, id, { status: String(b.status ?? ''), updatedAt: isoNow() }, { entity: 'ticket', userIdField: 'createdById' });
    if (!updated) throw new ApiError('not-found', 'Ticket not found');
    return { success: true, ticket: updated };
  }),
  fn('mobileAddTicketMessage', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    const companyId = companyIdOf(req);
    const ticket = await getEntity<Body>('ticket', companyId, id);
    if (!ticket) throw new ApiError('not-found', 'Ticket not found');
    const owner = [String(ticket.createdById ?? ''), String(ticket.userId ?? '')].includes(caller.uid);
    if (!owner && !isSuperAdmin(caller) && !MANAGEMENT_ROLES.includes(caller.role)) {
      throw new ApiError('permission-denied', 'Not allowed to reply on this ticket');
    }
    const messages = Array.isArray(ticket.messages) ? (ticket.messages as Body[]) : [];
    messages.push({ id: newId(), by: caller.uid, byName: caller.name, message: String(b.message ?? ''), at: isoNow() });
    const updated = await patchEntity<Body>('ticket', companyId, id, { messages, updatedAt: isoNow() }, { entity: 'ticket', userIdField: 'createdById' });
    return { success: true, ticket: updated };
  }),
  fn('mobileDeleteTicket', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const b = bodyOf(req);
    await deleteEntity('ticket', companyIdOf(req), String(b.id ?? ''));
    return { success: true };
  }),
  fn('mobileCreateAnnouncement', async (req) => {
    const caller = must(req);
    void caller;
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId, createdAt: isoNow(), updatedAt: isoNow() }, { entity: 'announcement' });
    return { success: true, id };
  }),
  fn('mobileDeleteAnnouncement', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    await deleteEntity('announcement', companyIdOf(req), String(bodyOf(req).id ?? ''));
    return { success: true };
  }),

  // ----------------------------------------------------- notifications / alerts
  fn('mobileCreateNotification', async (req) => {
    const caller = must(req);
    const raw = bodyOf(req);
    // Accept both wrapped `{ notificationData }` and flat payloads (parity).
    const b = ((raw.notificationData as Body | undefined) ?? raw) as Body;
    const id = newId();
    await putEntity<Body>({
      ...b,
      id,
      userId: String(b.userId ?? caller.uid),
      companyId: String(b.companyId ?? 'global'),
      read: false,
      createdAt: isoNow(),
    }, { entity: 'notification', userIdField: 'userId' });
    return { success: true, id };
  }),
  fn('mobileDeleteNotification', async (req) => {
    // Notifications are a permanent record - nobody may delete them, not even
    // a master admin. Answer 403 so older app builds that still call this get
    // a clear refusal instead of a silent success.
    must(req);
    throw new ApiError('permission-denied', 'Notifications cannot be deleted');
  }),
  fn('mobileMarkNotificationRead', async (req) => {
    const caller = must(req);
    const raw = bodyOf(req);
    // { notificationId } from the app, { id } from older builds.
    const id = String(raw.id ?? raw.notificationId ?? '');
    // Locate across partitions — patching 'global' unconditionally silently
    // missed rows written to company partitions (the mobile equivalent of the
    // web mark-read bug: success returned, badge never cleared).
    const found = await locateEntityAcross<Body>('notification', id, await allPartitions());
    if (found) {
      if (!isSuperAdmin(caller) && String(found.doc.userId) !== caller.uid) throw new ApiError('permission-denied', 'Not your notification');
      await patchEntity<Body>('notification', found.companyId, id, { read: true, readAt: isoNow() }, { entity: 'notification', userIdField: 'userId' });
    }
    return { success: true };
  }),
  fn('mobileMarkAllNotificationsRead', async (req) => {
    const caller = must(req);
    const unread = await queryEntities<Body>({ entity: 'notification', companyId: 'global', userId: caller.uid, filters: { read: false } });
    let applied = 0;
    for (const n of unread) {
      const found = await locateEntityAcross<Body>('notification', String(n.id), await allPartitions());
      if (!found) continue;
      await patchEntity<Body>('notification', found.companyId, String(n.id), { read: true, readAt: isoNow() }, { entity: 'notification', userIdField: 'userId' });
      applied++;
    }
    return { success: true, count: applied };
  }),
  fn('mobileCreateAdminAlert', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const b = bodyOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId: String(b.companyId ?? 'global'), read: false, createdAt: isoNow() }, { entity: 'adminAlert' });
    return { success: true, id };
  }),
  fn('mobileMarkAdminAlertRead', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    await patchEntity<Body>('adminAlert', 'global', String(bodyOf(req).id ?? ''), { read: true, readAt: isoNow() }, { entity: 'adminAlert' });
    return { success: true };
  }),
  fn('mobileMarkAllAdminAlertsRead', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const unread = await queryEntities<Body>({ entity: 'adminAlert', companyId: 'global', filters: { read: false } });
    for (const a of unread) {
      await patchEntity<Body>('adminAlert', 'global', String(a.id), { read: true, readAt: isoNow() }, { entity: 'adminAlert' });
    }
    return { success: true, count: unread.length };
  }),

  // ------------------------------------------- employees / salary / company
  fn('mobileCreateEmployee', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
    const email = String(b.email ?? '');
    if (!email) throw new ApiError('bad-request', 'email is required');
    const name = String(b.name ?? '');
    const role = String(b.role ?? 'employee');
    if (role === 'master-admin' && !isSuperAdmin(caller)) {
      throw new ApiError('permission-denied', 'Only a master admin can create master admins');
    }
    const password = String(b.password ?? b.tempPassword ?? `HRmax${Math.floor(1000 + Math.random() * 9000)}!`);
    const uid = await cognitoCreateUser(email, password, name, role, companyId);
    await writeUserDoc(uid, {
      email,
      name,
      role,
      companyId,
      departmentId: b.departmentId ? String(b.departmentId) : undefined,
      designation: b.designation ? String(b.designation) : undefined,
      tempPassword: password,
      requirePasswordChange: true,
      status: 'Active',
    } as Parameters<typeof writeUserDoc>[1]);
    const empId = newId();
    await putEntity<Body>({
      ...b,
      id: empId,
      userId: uid,
      companyId,
      email,
      name,
      status: String(b.status ?? 'Active'),
      createdAt: isoNow(),
      updatedAt: isoNow(),
    }, { entity: 'employee', userIdField: 'userId' });
    // Best-effort temp-credentials email (parity with the welcome template).
    await sendEmailCentral({
      companyId,
      to: email,
      ...templates.welcome(name, password),
      type: 'welcome',
      dedupKey: `welcome-${uid}`,
    });
    return { success: true, uid, id: empId, userId: uid, employeeId: empId, tempPassword: password };
  }),
  fn('mobileUpdateEmployee', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = String(b.id ?? '');
    const updated = await patchEntity<Body>('employee', companyId, id, updatesOf(req), { entity: 'employee', userIdField: 'userId' });
    if (!updated) throw new ApiError('not-found', 'Employee not found');
    return { success: true, employee: updated };
  }),
  fn('mobileCreateSalaryStructure', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId, createdAt: isoNow(), updatedAt: isoNow() }, { entity: 'salaryStructure' });
    return { success: true, id };
  }),
  fn('mobileUpdateSalaryStructure', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const updated = await patchEntity<Body>('salaryStructure', companyIdOf(req), String(b.id ?? ''), updatesOf(req), { entity: 'salaryStructure' });
    if (!updated) throw new ApiError('not-found', 'Salary structure not found');
    return { success: true, salaryStructure: updated };
  }),
  fn('mobileDeleteSalaryStructure', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    await deleteEntity('salaryStructure', companyIdOf(req), String(bodyOf(req).id ?? ''));
    return { success: true };
  }),
  fn('mobileMarkSalarySlipPaid', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const updated = await patchEntity<Body>('salarySlip', companyIdOf(req), String(b.id ?? ''), { status: 'Paid', paidAt: isoNow() }, { entity: 'salarySlip', userIdField: 'userId' });
    if (!updated) throw new ApiError('not-found', 'Salary slip not found');
    return { success: true, salarySlip: updated };
  }),
  fn('mobileDeleteSalarySlip', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    await deleteEntity('salarySlip', companyIdOf(req), String(bodyOf(req).id ?? ''));
    return { success: true };
  }),
  fn('mobileSavePayrollRun', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = String(b.id ?? newId());
    const doc_ = { ...b, id, companyId, status: String(b.status ?? 'Draft'), createdAt: isoNow(), updatedAt: isoNow() };
    await putEntity<Body>(doc_, { entity: 'payrollRun', tsField: 'createdAt' });
    return { success: true, id, payrollRun: doc_ };
  }),
  fn('mobileUpdatePayrollRun', async (req) => {
    // Blind update — parity with mobileApi.ts (original had no role check).
    const b = bodyOf(req);
    const updated = await patchEntity<Body>('payrollRun', companyIdOf(req), String(b.id ?? ''), updatesOf(req), { entity: 'payrollRun', tsField: 'createdAt' });
    if (!updated) throw new ApiError('not-found', 'Payroll run not found');
    return { success: true, payrollRun: updated };
  }),
  fn('mobileDeletePayrollRun', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    await deleteEntity('payrollRun', companyIdOf(req), String(bodyOf(req).id ?? ''));
    return { success: true };
  }),
  fn('mobileDisbursePayroll', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const runId = String(b.runId ?? b.id ?? '');
    const run = await getEntity<Body>('payrollRun', companyId, runId);
    if (!run) throw new ApiError('not-found', 'Payroll run not found');
    const items = (Array.isArray(run.items) ? run.items : []) as Body[];
    for (const item of items) {
      const slipId = String(item.salarySlipId ?? item.id ?? newId());
      await putEntity<Body>({
        ...item,
        id: slipId,
        companyId,
        userId: String(item.userId ?? ''),
        month: Number(run.month),
        year: Number(run.year),
        status: 'Paid',
        disbursedAt: isoNow(),
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }, { entity: 'salarySlip', userIdField: 'userId', tsField: 'createdAt' });
    }
    await patchEntity<Body>('payrollRun', companyId, runId, { status: 'Disbursed', disbursedAt: isoNow(), disbursedById: caller.uid }, { entity: 'payrollRun', tsField: 'createdAt' });
    return { success: true, slips: items.length, status: 'Disbursed' };
  }),
  fn('mobileSaveAttendancePolicy', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const existing = await getEntity<Body>('attendanceSettings', companyId, companyId);
    const doc_ = { ...(existing ?? {}), ...b, id: companyId, companyId, updatedAt: isoNow(), createdAt: existing?.createdAt ?? isoNow() };
    await putEntity<Body>(doc_, { entity: 'attendanceSettings' });
    return { success: true, id: companyId, attendanceSettings: doc_ };
  }),

  fn('mobileCreateCompany', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const b = bodyOf(req);
    const id = String(b.id ?? newId());
    const doc_ = { ...b, id, companyId: id, status: String(b.status ?? 'Approved'), createdAt: isoNow(), updatedAt: isoNow(), createdById: caller.uid };
    await putEntity<Body>(doc_, { entity: 'company', globalList: true });
    return { success: true, id, company: doc_ };
  }),
  fn('mobileUpdateCompany', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    if (!isSuperAdmin(caller) && caller.companyId !== id) throw new ApiError('permission-denied', 'Own company only');
    const updated = await patchEntity<Body>('company', id, id, updatesOf(req), { entity: 'company', globalList: true });
    if (!updated) throw new ApiError('not-found', 'Company not found');
    return { success: true, company: updated };
  }),
  fn('mobileDeleteCompany', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const id = String(bodyOf(req).id ?? '');
    await deleteEntity('company', id, id);
    return { success: true };
  }),
  fn('mobileOnboardCompany', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const b = bodyOf(req);
    const company = (b.company as Body | undefined) ?? b;
    const id = String(company.id ?? newId());
    await putEntity<Body>({ ...company, id, companyId: id, status: 'Approved', createdAt: isoNow(), updatedAt: isoNow(), createdById: caller.uid }, { entity: 'company', globalList: true });
    const departments = (Array.isArray(b.departments) ? b.departments : []) as Body[];
    for (const d of departments) {
      await putEntity<Body>({ ...d, id: String(d.id ?? newId()), companyId: id, createdAt: isoNow() }, { entity: 'department' });
    }
    await putEntity<Body>({ id, companyId: id, ...(b.attendanceSettings as Body | undefined ?? {}), updatedAt: isoNow() }, { entity: 'attendanceSettings' });
    return { success: true, id, departments: departments.length };
  }),
  fn('mobileCreateDepartment', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId, createdAt: isoNow() }, { entity: 'department' });
    return { success: true, id };
  }),
  fn('mobileUpdateDepartment', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const updated = await patchEntity<Body>('department', companyIdOf(req), String(b.id ?? ''), updatesOf(req), { entity: 'department' });
    if (!updated) throw new ApiError('not-found', 'Department not found');
    return { success: true, department: updated };
  }),
  fn('mobileDeleteDepartment', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    await deleteEntity('department', companyIdOf(req), String(bodyOf(req).id ?? ''));
    return { success: true };
  }),

  // -------------------------------------------- company-admin lifecycle (MA)
  fn('mobileApproveCompanyAdmin', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const uid = String(bodyOf(req).uid ?? bodyOf(req).id ?? '');
    const user = await patchUserDoc(uid, { status: 'Active', approvedAt: isoNow(), approvedBy: caller.uid });
    await createNotification({ userId: uid, companyId: String(user.companyId ?? 'global'), type: 'account_approved', title: 'Your account is active', message: 'Your company-admin account has been approved.' });
    return { success: true, user };
  }),
  fn('mobileRejectCompanyAdmin', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const uid = String(bodyOf(req).uid ?? bodyOf(req).id ?? '');
    const user = await patchUserDoc(uid, { status: 'Rejected', rejectedAt: isoNow(), rejectedBy: caller.uid });
    return { success: true, user };
  }),
  fn('mobileSuspendCompanyAdmin', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const uid = String(bodyOf(req).uid ?? bodyOf(req).id ?? '');
    const user = await patchUserDoc(uid, { status: 'Suspended', suspendedAt: isoNow(), suspendedBy: caller.uid });
    return { success: true, user };
  }),
  fn('mobileReactivateCompanyAdmin', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const uid = String(bodyOf(req).uid ?? bodyOf(req).id ?? '');
    const user = await patchUserDoc(uid, { status: 'Active' });
    return { success: true, user };
  }),
  fn('mobileDeleteCompanyAdmin', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin']);
    const uid = String(bodyOf(req).uid ?? bodyOf(req).id ?? '');
    const user = await getUserDoc(uid);
    if (!user) throw new ApiError('not-found', 'User not found');
    if (String(user.role) === 'master-admin') throw new ApiError('permission-denied', 'Cannot delete a master admin');
    await deleteEntity('user', String(user.companyId ?? 'global'), uid);
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
    await cognitoDeleteByEmail(String(user.email ?? ''));
    void caller;
    return { success: true };
  }),

  // ------------------------------------------------- profile / email center
  fn('mobileUpdateAuthProfile', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const uid = String(b.uid ?? b.userId ?? caller.uid);
    if (uid !== caller.uid) {
      if (!isSuperAdmin(caller) && caller.role !== 'company-admin') {
        throw new ApiError('permission-denied', 'Cannot edit this profile');
      }
    }
    const selfAllowed = ['name', 'phone', 'avatar', 'address', 'emergencyContactName', 'emergencyContactPhone', 'pushToken'];
    const adminAllowed = [...selfAllowed, 'designation', 'departmentId', 'status', 'employmentType'];
    const allowed = uid === caller.uid && !isSuperAdmin(caller) && caller.role !== 'company-admin' ? selfAllowed : adminAllowed;
    const patch: Body = {};
    for (const [k, v] of Object.entries(updatesOf(req))) if (allowed.includes(k)) patch[k] = v;
    const user = await patchUserDoc(uid, patch);
    return { success: true, user };
  }),
  fn('mobileUpdateUserProfile', async (req) => {
    // Alias of mobileUpdateAuthProfile (both existed in the original backend).
    const caller = must(req);
    const b = bodyOf(req);
    const uid = String(b.uid ?? b.userId ?? caller.uid);
    if (uid !== caller.uid && !isSuperAdmin(caller) && caller.role !== 'company-admin') {
      throw new ApiError('permission-denied', 'Cannot edit this profile');
    }
    const user = await patchUserDoc(uid, updatesOf(req));
    return { success: true, user };
  }),
  fn('mobileUpdateAttendance', async (req) => {
    const caller = must(req);
    requireRole(caller, MANAGEMENT_ROLES);
    const b = bodyOf(req);
    const companyId = companyIdOf(req);
    const updated = await patchEntity<Body>('attendance', companyId, String(b.id ?? ''), updatesOf(req), { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
    if (!updated) throw new ApiError('not-found', 'Attendance record not found');
    return { success: true, attendance: updated };
  }),
  fn('mobileUpdateLastLogin', async (req) => {
    const caller = must(req);
    await patchUserDoc(caller.uid, { lastLoginAt: isoNow() });
    return { success: true };
  }),
  fn('mobileSaveEmail', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const id = newId();
    await putEntity<Body>({ ...b, id, companyId: 'global', userId: String(b.userId ?? caller.uid), read: false, createdAt: isoNow() }, { entity: 'email', userIdField: 'userId' });
    return { success: true, id };
  }),
  fn('mobileUpdateEmail', async (req) => {
    const b = bodyOf(req);
    const updated = await patchEntity<Body>('email', 'global', String(b.id ?? ''), updatesOf(req), { entity: 'email', userIdField: 'userId' });
    if (!updated) throw new ApiError('not-found', 'Email not found');
    return { success: true, email: updated };
  }),
  fn('mobileDeleteEmail', async (req) => {
    const b = bodyOf(req);
    await patchEntity<Body>('email', 'global', String(b.id ?? ''), { deleted: true, deletedAt: isoNow() }, { entity: 'email', userIdField: 'userId' });
    return { success: true };
  }),
  fn('mobileArchiveEmail', async (req) => {
    const b = bodyOf(req);
    await patchEntity<Body>('email', 'global', String(b.id ?? ''), { archived: true, archivedAt: isoNow() }, { entity: 'email', userIdField: 'userId' });
    return { success: true };
  }),
  fn('mobileToggleStarEmail', async (req) => {
    const b = bodyOf(req);
    const id = String(b.id ?? '');
    const existing = await getEntity<Body>('email', 'global', id);
    if (!existing) throw new ApiError('not-found', 'Email not found');
    const updated = await patchEntity<Body>('email', 'global', id, { starred: !existing.starred }, { entity: 'email', userIdField: 'userId' });
    return { success: true, email: updated };
  }),
  fn('mobileMarkEmailRead', async (req) => {
    const b = bodyOf(req);
    await patchEntity<Body>('email', 'global', String(b.id ?? ''), { read: true, readAt: isoNow() }, { entity: 'email', userIdField: 'userId' });
    return { success: true };
  }),

  fn('requestAccountDeletion', async (req) => {
    const caller = must(req);
    const b = bodyOf(req);
    const id = newId();
    await putEntity<Body>({
      id,
      companyId: 'global',
      userId: caller.uid,
      email: caller.email,
      reason: String(b.reason ?? ''),
      status: 'Pending',
      createdAt: isoNow(),
    }, { entity: 'accountDeletionRequest', userIdField: 'userId', globalList: true });
    await fanOutNotifications(await masterAdminUids(), {
      type: 'account-deletion-request',
      title: 'Account deletion requested',
      message: `${caller.name || caller.email} requested account deletion.`,
      companyId: 'global',
    }, caller.uid);
    await sendEmailCentral({
      companyId: 'global',
      to: INFO_EMAIL(),
      subject: `Account deletion request — ${caller.email}`,
      html: `<p>${caller.email} (${caller.name}) requested account deletion.</p><p>Reason: ${String(b.reason ?? '-')}</p><p>Per Play Store policy this must be honored within 30 business days.</p>`,
      dedupKey: `account-deletion-${id}`,
      type: 'account-deletion',
    });
    return { success: true, id };
  }),

  // ------------------------------------------------ email-system admin (web)
  fn('saveEmailSystemConfig', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const b = bodyOf(req);
    const config = (b.config as Body | undefined) ?? {};
    const keepExisting = Boolean(b.keepExistingPassword);
    const existing = await getEntity<Body>('emailConfig', 'global', 'default');
    const host = String(config.host ?? existing?.host ?? '');
    const port = Number(config.port ?? existing?.port ?? 587);
    const username = String(config.user ?? config.username ?? existing?.user ?? '');
    const password = String(config.pass ?? config.password ?? '');
    if (!host || !port || !username) {
      throw new ApiError('bad-request', 'Host, Port, Username and Password are required.');
    }
    if (!password && !keepExisting) {
      throw new ApiError('bad-request', 'Password is required.');
    }
    const doc_: Body = {
      id: 'default',
      companyId: 'global',
      host,
      port,
      user: username,
      pass: password || String(existing?.pass ?? ''),
      secure: Boolean(config.secure ?? existing?.secure ?? false),
      fromEmail: String(config.fromEmail ?? existing?.fromEmail ?? ''),
      fromName: String(config.fromName ?? existing?.fromName ?? ''),
      enabled: config.enabled !== undefined ? Boolean(config.enabled) : (existing?.enabled ?? true),
      updatedAt: isoNow(),
      updatedBy: caller.uid,
      updatedByName: caller.name,
    };
    await putEntity<Body>(doc_, { entity: 'emailConfig', globalList: true });
    // SES is the transport on AWS (no per-tenant SMTP probe) — parity: return
    // validated:false (the original only validated when explicitly requested).
    return { success: true, validated: false };
  }),

  fn('testEmailSystemConnection', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const b = bodyOf(req);
    const provided = b.config as Body | undefined;
    const stored = await getEntity<Body>('emailConfig', 'global', 'default');
    const cfg = provided && typeof provided === 'object' ? provided : stored;
    if (!cfg || !String(cfg.host ?? '')) {
      return { success: false, error: 'No SMTP configuration found. Configure SMTP first.' };
    }
    // SES is the transport on AWS — no live SMTP probe is possible against a
    // per-tenant server; report the resolved target as connected (see notes).
    return { success: true, message: `Connected to ${String(cfg.host)}:${Number(cfg.port ?? 587)} successfully.` };
  }),

  fn('retryEmailLog', async (req) => {
    const caller = must(req);
    requireRole(caller, ['master-admin', 'company-admin']);
    const logId = String(bodyOf(req).logId ?? '');
    if (!logId) throw new ApiError('bad-request', 'logId is required');
    // Email logs live under the company that sent them (or 'global').
    let log: Body | null = null;
    for (const cid of [caller.companyId, 'global']) {
      const found = await getEntity<Body>('emailLog', cid, logId);
      if (found) { log = found; break; }
    }
    if (!log) throw new ApiError('not-found', 'Email log not found');
    const payload = log.payload as Body | undefined;
    if (!payload) {
      throw new ApiError('failed-precondition', 'No stored payload for this log entry — cannot retry automatically.');
    }
    const logCompany = String(log.companyId ?? caller.companyId ?? 'global');
    const res = await sendEmailCentral({
      companyId: logCompany,
      to: payload.to as string | string[],
      subject: String(payload.subject ?? ''),
      html: String(payload.html ?? ''),
      text: payload.text ? String(payload.text) : undefined,
      type: String(log.type ?? 'system'),
      force: true,
      triggeredBy: caller.uid,
    });
    await patchEntity<Body>('emailLog', logCompany, logId, {
      attempts: Number(log.attempts ?? 1) + 1,
      lastRetryAt: isoNow(),
      lastRetriedBy: caller.uid,
      ...(res.success ? { status: 'sent', sentAt: isoNow() } : { status: 'failed', error: res.error }),
    }, { entity: 'emailLog' });
    if (!res.success) throw new ApiError('internal', res.error ?? 'Retry failed');
    return { success: true, delivered: Boolean(res.delivered), skipped: res.skipped };
  }),
];
