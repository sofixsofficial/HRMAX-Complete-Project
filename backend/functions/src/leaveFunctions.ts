import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { notifyLeaveToStakeholders, resolveLeaveStakeholders } from './leaveNotifications';

const db = admin.firestore();

const finalStatuses = ['Approved', 'Rejected'];

/** Format a Firestore Timestamp / Date / string into a short date label. */
function toDateLabel(value: unknown): string {
  if (!value) return '';
  try {
    const d = typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Derive the flat per-tier approval booleans from `approvalStatus` so they can
 * be stored on the leave document itself and queried across web + mobile
 * without reading the nested map. Reconciliation happens server-side on both
 * create and update so the flags stay authoritative even when a client (or
 * older app version) bypasses the service layer.
 */
function computeApprovalFlags(approvalStatus: Record<string, unknown> | undefined) {
  const s = approvalStatus || {};
  return {
    reportingManagerApproved: s.reportingManager === 'Approved',
    companyAdminApproved: s.companyAdmin === 'Approved',
    executiveApproved: s.executive === 'Approved',
    teamLeaderApproved: s.teamLeader === 'Approved',
  };
}

// Number of 4-leave-approval tiers resolved (Approved or Rejected). Stored as
// `approvalCount` so progress (0/4 → 4/4) is queryable/real-time without
// recompute on every client.
function computeApprovalCount(approvalStatus: Record<string, unknown> | undefined) {
  const s = approvalStatus || {};
  return ['reportingManager', 'companyAdmin', 'executive', 'teamLeader']
    .filter((t) => s[t] === 'Approved' || s[t] === 'Rejected').length;
}

/**
 * When a Reporting Manager applies for their OWN leave and has no manager above
 * them (self-managed / top-of-chain), auto-skip (approve) the Reporting Manager
 * tier so the chain flows straight to Company Admin -> Executive -> Team Leader
 * instead of stalling on an empty Tier 1. Returns true if it applied a skip.
 */
async function autoSkipSelfReportingManagerTier(
  companyId: string,
  employeeUserId: string,
  approvalStatus: Record<string, unknown>,
  resolvedReportingManagerId: string | null,
): Promise<void> {
  if (approvalStatus.reportingManager !== 'Pending') return;
  if (resolvedReportingManagerId && resolvedReportingManagerId !== employeeUserId) return;
  let isRm = false;
  try {
    const userDoc = await db.collection('users').doc(employeeUserId).get();
    if (userDoc.exists) {
      const u = userDoc.data() || {};
      isRm = u.role === 'reporting-manager' || u.isReportingManager === true;
    }
  } catch { /* best-effort */ }
  if (isRm) approvalStatus.reportingManager = 'Approved';
}

/**
 * Roles whose personal leave/attendance self-service requests route to a
 * Master Admin for final oversight (they are themselves registered employees).
 */
const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

/** Resolve the applicant's role authoritatively from the users doc. */
async function resolveApplicantRoleServer(userId: string): Promise<string> {
  try {
    const d = await db.collection('users').doc(userId).get();
    if (d.exists) {
      const u = d.data() || {};
      if (u.role === 'team-leader' || u.role === 'executive') return String(u.role);
    }
  } catch { /* best-effort */ }
  return 'employee';
}

/**
 * Overall leave status with the Master Admin final gate applied. Mirrors the
 * web service `computeOverallLeaveStatus`: a rejected tier OR rejected Master
 * Admin => Rejected; otherwise it stays Pending until all 4 tiers AND (if
 * required) the Master Admin approve.
 */
function computeOverallStatusServer(
  approvalStatus: Record<string, unknown>,
  masterAdminRequired: boolean,
  masterAdminApproveStatus: string | undefined,
): string {
  const tiers = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
  for (const t of tiers) {
    if (approvalStatus[t] === 'Rejected') return 'Rejected';
  }
  if (masterAdminRequired && masterAdminApproveStatus === 'Rejected') return 'Rejected';
  const allApproved = tiers.every((t) => approvalStatus[t] === 'Approved');
  if (!allApproved) return 'Pending';
  if (masterAdminRequired) {
    return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
  }
  return 'Approved';
}

/**
 * Server-side reconciliation of the self-management tier skips, so the chain
 * holds even when a stale/older client writes only the applicant's tier.
 * - Team Leader self-app: every tier auto-approved → single-step Master Admin.
 * - Executive self-app: RM + Admin + Executive tiers auto-approved, but the
 *   teamLeader tier is LEFT LIVE so the assigned Team Leader reviews Tier 1
 *   (3-tier: Executive → Team Leader → Master Admin).
 */
function autoSkipSelfManagementTier(role: string, approvalStatus: Record<string, unknown>): void {
  if (role === 'team-leader') {
    for (const t of ['reportingManager', 'companyAdmin', 'executive', 'teamLeader']) {
      if (approvalStatus[t] === 'Pending') approvalStatus[t] = 'Approved';
    }
  } else if (role === 'executive') {
    for (const t of ['reportingManager', 'companyAdmin', 'executive']) {
      if (approvalStatus[t] === 'Pending') approvalStatus[t] = 'Approved';
    }
  }
}

/**
 * Firestore trigger: the moment a leave request is created, fan out an
 * instantaneous notification to the employee + Reporting Manager, Executive,
 * Team Leader, Company Admin and Master Admin. This covers every client path
 * (web `createLeaveRequest`, mobile `createLeaveRequest`, and the employee's
 * direct mobile apply flow) because it runs server-side on any document write.
 */
export const onLeaveRequestCreated = functions.firestore
  .document('leaveRequests/{leaveId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    if (!data || !data.userId || !data.companyId) return;

    // Resolve the employee's full company-scoped approval chain ONCE first so
    // the Reporting-Manager tier can be authoritatively auto-skipped for a
    // Reporting Manager applying for their own leave (no manager above).
    const s = await resolveLeaveStakeholders(
      String(data.companyId),
      String(data.userId),
      String(data.employeeName || 'An employee'),
    ).catch(() => null);
    const approvalStatus: Record<string, unknown> = (data.approvalStatus as Record<string, unknown> | undefined) || {};
    await autoSkipSelfReportingManagerTier(
      String(data.companyId), String(data.userId), approvalStatus, s ? s.reportingManagerId : null,
    );

    // Master Admin final-gate init: Team Leaders & Executives are registered
    // employees, so their personal leave routes to a Master Admin for final
    // oversight. Stamp this authoritatively on create (matching the client
    // service) so it holds even when an older client writes stale values.
    const applicantRole = await resolveApplicantRoleServer(String(data.userId));
    const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
    await autoSkipSelfManagementTier(applicantRole, approvalStatus);
    const masterAdminApproverId = masterAdminRequired
      ? (s && s.masterAdminIds[0]) || ''
      : '';
    const status = computeOverallStatusServer(approvalStatus, masterAdminRequired, 'Pending');

    // Server-side flag reconciliation on create so the flat per-tier booleans
    // + approvalCount + MA gate are stored even when a client writes stale values.
    await db.collection('leaveRequests').doc(snap.id).update({
      approvalStatus,
      ...computeApprovalFlags(approvalStatus),
      approvalCount: computeApprovalCount(approvalStatus),
      status,
      applicantRole,
      masterAdminRequired,
      masterAdminApproverId,
      // CRITICAL: Firestore rejects `undefined` ("Cannot use undefined as a
      // Firestore value"). The previous ternary made this ENTIRE reconciliation
      // (flags + approvalCount + status + applicantRole + MA gate + appliedOn
      // backfill) throw for every regular-employee leave, silently swallowed by
      // a bare .catch — so server-side tier state was never persisted for the
      // common case. Only stamp the MA status when the gate actually applies.
      ...(masterAdminRequired ? { masterAdminApproveStatus: 'Pending' } : {}),
      // Safety net: an older/other client may omit `appliedOn`. Stamp it here so
      // orderBy('appliedOn') queries (web approvals panel, mobile leave list)
      // never drop the document from results.
      ...(data.appliedOn ? {} : { appliedOn: admin.firestore.FieldValue.serverTimestamp() }),
      // Same safety net for `createdAt` (legacy orderBy('createdAt') consumers).
      ...(data.createdAt ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    }).catch((e) => console.error('[leave] create reconciliation failed', snap.id, e));

    // Stamp authoritative approverIds (single source of truth for the chain).
    //   - approverIds.reportingManager is the RM's auth uid (the client can
    //     only see the RM's employee-document-id, so the RM dashboard card
    //     query `where('approverIds.reportingManager','==', user.id)` and the
    //     review gating depend on this overwrite);
    //   - approverIds.executive / teamLeader / companyAdmin mirror the exact
    //     chain notified, so review flows and next-tier prompts match the
    //     recipients even when the client wrote nothing / stale values.
    const clientApproverIds: Record<string, unknown> = data.approverIds || {};
    const approverPatch: Record<string, unknown> = {
      'approverIds.reportingManager': (s && s.reportingManagerId) || String(clientApproverIds.reportingManager || ''),
      'approverIds.companyAdmin': (s && s.companyAdminIds[0]) || String(clientApproverIds.companyAdmin || ''),
      'approverIds.executive': (s && s.executiveIds[0]) || String(clientApproverIds.executive || ''),
      'approverIds.teamLeader': String(clientApproverIds.teamLeader || (s && s.teamLeaderIds[0]) || ''),
    };
    // CRITICAL: never include an `undefined` value — Firestore rejects it and
    // the previous `'approverIds.masterAdmin': ... : undefined` line threw for
    // EVERY non-MA leave, so NONE of the authoritative stamps above persisted.
    // `approverIds.reportingManager` stayed at the client's employee-doc-id and
    // mobileReviewLeaveTier denied the real RM ("Not authorized") while web's
    // permission-based rules still allowed it — the root cause of "multi-tier
    // verification works on web but not on Android/iOS".
    if (masterAdminRequired) approverPatch['approverIds.masterAdmin'] = masterAdminApproverId;
    await db.collection('leaveRequests').doc(snap.id).update(approverPatch)
      .catch((e) => console.error('[leave] approverIds stamp failed', snap.id, e));

    const startDateLabel = toDateLabel(data.startDate);
    const endDateLabel = toDateLabel(data.endDate);

    let sForNotify = s;
    if (!sForNotify) {
      sForNotify = await resolveLeaveStakeholders(
        String(data.companyId),
        String(data.userId),
        String(data.employeeName || 'An employee'),
      ).catch(() => null);
    }
    await notifyLeaveToStakeholders({
      companyId: String(data.companyId),
      employeeUserId: String(data.userId),
      employeeName: String(data.employeeName || 'An employee'),
      kind: 'applied',
      link: '/leaves',
      leave: {
        companyId: String(data.companyId),
        leaveType: String(data.leaveType || 'Leave'),
        totalDays: data.totalDays ?? 1,
        startDateLabel,
        endDateLabel,
      },
    }, sForNotify || undefined).catch((err) => {
      functions.logger.error('Leave applied fan-out failed', { leaveId: snap.id, error: err });
    });
  });

/**
 * Firestore trigger: when a leave request reaches a final status
 * (Approved / Rejected), notify the employee and all management stakeholders
 * once. Idempotent via the `notifiedFinalStatus` marker so later writes to the
 * same document do not re-notify.
 */
export const onLeaveRequestUpdated = functions.firestore
  .document('leaveRequests/{leaveId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after || !after.userId || !after.companyId) return;

    // Server-side flag reconciliation: whenever approvalStatus changes, keep the
    // flat per-tier booleans in sync (authoritative regardless of client),
    // including auto-skipping the Reporting Manager tier when a Reporting
    // Manager self-applies with no manager above them.
    const approvalStatus: Record<string, unknown> = (after.approvalStatus as Record<string, unknown> | undefined) || {};
    const s = await resolveLeaveStakeholders(
      String(after.companyId),
      String(after.userId),
      String(after.employeeName || 'An employee'),
    ).catch(() => null);
    await autoSkipSelfReportingManagerTier(
      String(after.companyId), String(after.userId), approvalStatus, s ? s.reportingManagerId : null,
    );

    // Master Admin gate reconcile: Team Leaders / Executives are registered
    // employees, so their personal leave keeps a Master Admin as the final
    // tier. Mirror the client by auto-skipping the applicant's own tier and
    // reconciling the MA fields + overall status so the gate holds even on
    // direct/stale writes.
    const applicantRole = await resolveApplicantRoleServer(String(after.userId));
    const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
    await autoSkipSelfManagementTier(applicantRole, approvalStatus);
    const masterAdminApproverId = masterAdminRequired ? (s && s.masterAdminIds[0]) || '' : '';

    const flags = computeApprovalFlags(approvalStatus);
    const afterAny = after as Record<string, unknown>;
    const needsFlags = !['reportingManagerApproved', 'companyAdminApproved', 'executiveApproved', 'teamLeaderApproved']
      .every((k) => afterAny[k] === (flags as Record<string, unknown>)[k]);
    const needsCount = afterAny.approvalCount !== computeApprovalCount(approvalStatus);
    const maChanged =
      Boolean(afterAny.masterAdminRequired) !== masterAdminRequired ||
      afterAny.masterAdminApproverId !== masterAdminApproverId;

    // Reconcile the Master Admin gate status, but never resurrect a Cancelled
    // leave and only steer status for MA-required requests (the existing
    // 4-tier flow for regular employees manages its own status in the client).
    const isCancelled = afterAny.status === 'Cancelled';
    const computedStatus = masterAdminRequired
      ? computeOverallStatusServer(approvalStatus, true, String(afterAny.masterAdminApproveStatus || ''))
      : String(afterAny.status || 'Pending');
    const needsStatus = !isCancelled && masterAdminRequired && computedStatus !== String(afterAny.status);

    if (needsFlags || needsCount || maChanged || needsStatus) {
      const update: Record<string, unknown> = {
        approvalStatus,
        ...flags,
        approvalCount: computeApprovalCount(approvalStatus),
        applicantRole,
        masterAdminRequired,
        masterAdminApproverId,
      };
      if (masterAdminRequired && afterAny.masterAdminApproveStatus === undefined) {
        update.masterAdminApproveStatus = 'Pending';
      }
      if (needsStatus) update.status = computedStatus;
      await db.collection('leaveRequests').doc(change.after.id).update(update).catch(() => {});
    }

    const status = after.status;
    if (!finalStatuses.includes(status)) return;
    if (before.status === after.status) return;
    if (after.notifiedFinalStatus === after.status) return;

    const kind = status === 'Approved' ? 'approved' : 'rejected';

    await notifyLeaveToStakeholders({
      companyId: String(after.companyId),
      employeeUserId: String(after.userId),
      employeeName: String(after.employeeName || 'An employee'),
      kind,
      link: '/leaves',
      leave: {
        companyId: String(after.companyId),
        leaveType: String(after.leaveType || 'Leave'),
        totalDays: after.totalDays ?? 1,
        startDateLabel: toDateLabel(after.startDate),
        endDateLabel: toDateLabel(after.endDate),
        reviewNote: after.reviewNote ? String(after.reviewNote) : undefined,
      },
    }).catch((err) => {
      functions.logger.error('Leave final fan-out failed', { leaveId: change.after.id, error: err });
    });

    await db.collection('leaveRequests').doc(change.after.id).update({
      notifiedFinalStatus: status,
    }).catch(() => {});
  });
