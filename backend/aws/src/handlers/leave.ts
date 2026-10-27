/**
 * Leave management — 4-tier sequential approval chain.
 * Tier order: reportingManager → companyAdmin → executive → teamLeader,
 * with optional master-admin gate for team-leader/executive self-applications.
 * (Port of leaveFunctions.ts + mobileApi leave endpoints.)
 */

import type { Route } from '../lib/http.js';
import { must, equalityFilters, parseOrderBy } from '../lib/http.js';
import { assertCompanyScope, hasPermission, isSuperAdmin, readPartitions } from '../lib/auth.js';
import { putEntity, getEntity, patchEntity, queryEntities, queryEntitiesAcross, locateEntityAcross, allPartitions } from '../lib/db.js';
import { resolveStakeholders } from '../lib/stakeholders.js';
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { ApiError, newId, isoNow, TIER_ORDER, type LeaveRequestDoc, type LeaveTier, type UserRole } from '../lib/types.js';

const MANAGEMENT_SELF_SERVICE: UserRole[] = ['team-leader', 'executive'];

interface LeaveInput {
  companyId: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  departmentId?: string | null;
}

/**
 * Compute the initial approvalStatus + approverIds for a new leave request,
 * applying the per-role auto-skip rules. Exported so the approval-chain test
 * suite can assert every requester role's exact default chain.
 */
export async function computeInitialApproval(
  input: LeaveInput,
  applicantRole: UserRole,
  stakeholders: Awaited<ReturnType<typeof resolveStakeholders>>,
): Promise<Pick<LeaveRequestDoc, 'approvalStatus' | 'approverIds' | 'masterAdminRequired' | 'masterAdminApproveStatus' | 'masterAdminApproverId' | 'applicantRole'>> {
  const status: Record<LeaveTier, 'Pending' | 'Approved' | 'Rejected' | 'Skipped'> = {
    reportingManager: 'Pending',
    hr: 'Pending',
    companyAdmin: 'Pending',
    executive: 'Pending',
    teamLeader: 'Pending',
  };
  const approverIds: Partial<Record<LeaveTier, string | null>> = {
    reportingManager: stakeholders.reportingManagerId,
    hr: stakeholders.hrIds?.[0] ?? null,
    companyAdmin: stakeholders.companyAdminIds[0] ?? null,
    executive: stakeholders.executiveIds[0] ?? null,
    teamLeader: stakeholders.teamLeaderIds[0] ?? null,
  };

  // Auto-skip unassigned tiers
  if (!approverIds.reportingManager) status.reportingManager = 'Skipped';
  if (!approverIds.hr) status.hr = 'Skipped';
  if (!approverIds.companyAdmin) status.companyAdmin = 'Skipped';
  if (!approverIds.executive) status.executive = 'Skipped';
  if (!approverIds.teamLeader) status.teamLeader = 'Skipped';

  let masterAdminRequired = MANAGEMENT_SELF_SERVICE.includes(applicantRole);
  let masterAdminApproveStatus: 'Pending' | 'Approved' | 'Rejected' | undefined = masterAdminRequired ? 'Pending' : undefined;
  let masterAdminApproverId: string | null = masterAdminRequired ? stakeholders.masterAdminIds[0] ?? null : null;

  // ── Chain truncation per applicant role (the product's approval rules):
  //    employee          -> reporting manager -> HR -> company admin
  //    reporting manager -> HR -> company admin
  //    HR                -> company admin
  //    executive         -> team leader  -> master admin gate
  //    team leader       -> master admin gate
  // Tiers beyond the last required approver are Skipped, so the x/N progress
  // and the "who approves next" logic both see exactly the live chain.
  if (applicantRole === 'employee') {
    status.executive = 'Skipped';
    status.teamLeader = 'Skipped';
  } else if (applicantRole === 'reporting-manager') {
    // Spec: a reporting manager's own leave goes HR -> company admin (no
    // self-tier, no manager-of-manager step).
    status.reportingManager = 'Skipped';
    status.executive = 'Skipped';
    status.teamLeader = 'Skipped';
  } else if (applicantRole === 'hr') {
    status.reportingManager = 'Skipped';
    status.hr = 'Skipped';
    status.executive = 'Skipped';
    status.teamLeader = 'Skipped';
  } else if (applicantRole === 'team-leader') {
    // TL self-app: all tiers auto-approved → single MA gate
    status.reportingManager = 'Approved';
    status.hr = 'Approved';
    status.companyAdmin = 'Approved';
    status.executive = 'Approved';
    status.teamLeader = 'Approved';
  } else if (applicantRole === 'executive') {
    // Executive self-app: RM+HR+CA+Exec auto-approved, TL tier stays live
    status.reportingManager = 'Approved';
    status.hr = 'Approved';
    status.companyAdmin = 'Approved';
    status.executive = 'Approved';
  }

  return {
    approvalStatus: status as LeaveRequestDoc['approvalStatus'],
    approverIds,
    masterAdminRequired,
    masterAdminApproveStatus,
    masterAdminApproverId,
    applicantRole,
  };
}

/** Parse a date as clients send it (YYYY-MM-DD or a full ISO string) → UTC midnight. */
export function parseLeaveDay(value: unknown): Date | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive calendar-day count — the same contract the web's calcLeaveDays uses. */
export function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * An existing request that overlaps [start, end] and still blocks a new one.
 * Only Pending/Approved count — Rejected/Cancelled history never blocks.
 */
export function findOverlappingLeave(
  rows: LeaveRequestDoc[],
  start: Date,
  end: Date,
): LeaveRequestDoc | undefined {
  return rows.find((l) => {
    if (l.status !== 'Pending' && l.status !== 'Approved') return false;
    const s = parseLeaveDay(l.startDate);
    const e = parseLeaveDay(l.endDate);
    if (!s || !e) return false;
    return s <= end && e >= start;
  });
}

function deriveStatus(doc_: LeaveRequestDoc): Pick<LeaveRequestDoc, 'status' | 'approvalCount'> {
  const values = Object.values(doc_.approvalStatus ?? {});
  const decided = values.filter((v) => v === 'Approved' || v === 'Rejected').length;
  if (values.includes('Rejected')) return { status: 'Rejected', approvalCount: decided };
  const allApproved = values.every((v) => v === 'Approved' || v === 'Skipped');
  if (allApproved) {
    if (doc_.masterAdminRequired && doc_.masterAdminApproveStatus !== 'Approved') {
      return { status: 'Pending', approvalCount: decided };
    }
    return { status: 'Approved', approvalCount: decided };
  }
  return { status: 'Pending', approvalCount: decided };
}

/** Only the current pending tier's approver (or fallback natural role holder) may act. */
async function assertTierApprover(caller: { uid: string; role: UserRole; companyId: string }, doc_: LeaveRequestDoc, tier: LeaveTier): Promise<void> {
  const stamped = doc_.approverIds?.[tier];
  if (stamped === caller.uid) return;
  // Fallback: natural role holder in the same company
  const roleForTier: Record<LeaveTier, UserRole[]> = {
    reportingManager: ['reporting-manager'],
    hr: ['hr'],
    companyAdmin: ['company-admin'],
    executive: ['executive'],
    teamLeader: ['team-leader'],
  };
  if (roleForTier[tier].includes(caller.role)) {
    if (tier === 'executive' || caller.companyId === doc_.companyId) return;
  }
  if (caller.role === 'master-admin') return;
  throw new ApiError('permission-denied', 'You are not the approver for this tier');
}

export const leaveRoutes: Route[] = [
  // ------------------------------------------------------------------ create
  {
    method: 'POST',
    path: '/api/leave-requests',
    handler: async (req) => {
      const caller = must(req);
      const rawBody = req.body as Record<string, unknown>;
      // The mobile client nests the payload under `leaveData`; accept flat too.
      const input = ((rawBody?.leaveData as LeaveInput | undefined) ?? rawBody) as unknown as LeaveInput;
      if (!input.companyId || !input.userId || !input.startDate || !input.endDate) {
        throw new ApiError('bad-request', 'companyId, userId, startDate, endDate required');
      }
      assertCompanyScope(caller, input.companyId);
      if (caller.uid !== input.userId && !hasPermission(caller, 'leave.approve') && caller.role !== 'master-admin') {
        throw new ApiError('permission-denied', 'Cannot apply leave for another user');
      }
      // Company Admin and Master Admin have NO personal leave/attendance —
      // they administer the modules, they never appear in them as subjects.
      const targetRole = caller.uid === input.userId
        ? caller.role
        : String((await (await import('../lib/db.js')).getUserDoc(input.userId))?.role ?? '');
      if (targetRole === 'company-admin' || targetRole === 'master-admin') {
        throw new ApiError('permission-denied', 'Company Admin and Master Admin do not have personal leave records.');
      }

      // ── Server-side validation (the handler previously trusted the client
      // completely: no date order, no overlap, and `totalDays` verbatim).
      const start = parseLeaveDay(input.startDate);
      const end = parseLeaveDay(input.endDate);
      if (!start || !end) throw new ApiError('bad-request', 'startDate and endDate must be valid dates');
      if (end.getTime() < start.getTime()) {
        throw new ApiError('bad-request', 'endDate cannot be before startDate');
      }
      const computedDays = inclusiveDays(start, end);
      if (computedDays < 1 || computedDays > 366) {
        throw new ApiError('bad-request', 'Leave range must be between 1 and 366 days');
      }
      // Integer ranges are recomputed by the server; a fractional client value
      // is a half-day request and is the only duration field still trusted.
      const totalDays =
        typeof input.totalDays === 'number' && !Number.isInteger(input.totalDays) && input.totalDays > 0
          ? input.totalDays
          : computedDays;

      const existingForUser = await queryEntities<LeaveRequestDoc>({
        entity: 'leaveRequest', companyId: input.companyId, userId: input.userId,
      });
      const clash = findOverlappingLeave(existingForUser, start, end);
      if (clash) {
        throw new ApiError(
          'already-exists',
          `Leave already ${String(clash.status).toLowerCase()} for ${clash.startDate} → ${clash.endDate}`,
        );
      }

      const stakeholders = await resolveStakeholders(input.companyId, input.userId);
      const approval = await computeInitialApproval(input, caller.role, stakeholders);

      const id = newId();
      const doc_: LeaveRequestDoc = {
        id,
        companyId: input.companyId,
        userId: input.userId,
        employeeName: caller.name,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        totalDays,
        reason: input.reason,
        departmentId: input.departmentId ?? null,
        appliedOn: isoNow(),
        createdAt: isoNow(),
        updatedAt: isoNow(),
        status: 'Pending',
        ...approval,
        notifiedFinalStatus: false,
      };
      const derived = deriveStatus(doc_);
      Object.assign(doc_, derived);

      await putEntity<LeaveRequestDoc>(doc_, { entity: 'leaveRequest', userIdField: 'userId' });

      // Notifications: employee confirmation + per-stakeholder pending review
      await createNotification({
        userId: input.userId, companyId: input.companyId, type: 'leave_applied',
        title: 'Leave application submitted',
        message: `Your ${input.type} leave (${input.startDate} → ${input.endDate}) has been submitted.`,
        link: '/my-leaves',
      });
      const pendingApprovers = TIER_ORDER.filter((t) => doc_.approvalStatus[t] === 'Pending')
        .map((t) => doc_.approverIds[t])
        .filter((v): v is string => Boolean(v));
      await fanOutNotifications(pendingApprovers, {
        companyId: input.companyId, type: 'leave_pending_review',
        title: 'Leave pending your review',
        message: `${input.userId === caller.uid ? 'A team member' : caller.name} applied for ${input.type} leave.`,
        link: '/leaves', priority: 'normal',
      }, input.userId);

      return { id, leaveRequest: doc_ };
    },
  },

  // ------------------------------------------------------------------- list
  {
    method: 'GET',
    path: '/api/leave-requests',
    handler: async (req) => {
      const caller = must(req);
      const orderBy = parseOrderBy(req.query, 'appliedOn');
      const filters = equalityFilters(req.query);
      const base: Omit<Parameters<typeof queryEntities>[0], 'companyId'> = {
        entity: 'leaveRequest',
        orderBy,
        ...(filters ? { filters } : {}),
      };
      if (req.query.userId) base.userId = req.query.userId;

      let docs: LeaveRequestDoc[];
      if (base.userId) {
        docs = await queryEntities<LeaveRequestDoc>(base as Parameters<typeof queryEntities>[0]);
      } else if (req.query.companyId) {
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, req.query.companyId);
        docs = await queryEntities<LeaveRequestDoc>({ ...base, companyId: req.query.companyId });
      } else if (isSuperAdmin(caller)) {
        // Master-admin previously defaulted to COMPANY#master-admin (empty);
        // the requests live under the real companies → union them all.
        docs = await queryEntitiesAcross<LeaveRequestDoc>(base, await allPartitions());
      } else {
        const partitions = await readPartitions(caller);
        docs = partitions.length === 1
          ? await queryEntities<LeaveRequestDoc>({ ...base, companyId: partitions[0] })
          : await queryEntitiesAcross<LeaveRequestDoc>(base, partitions);
      }

      // Scope enforcement: employee/RM see only their own
      if (['employee', 'reporting-manager'].includes(caller.role)) {
        docs = docs.filter((d) => d.userId === caller.uid || (caller.role === 'reporting-manager' && hasPermission(caller, 'leave.approve')));
      }
      return { leaveRequests: docs };
    },
  },

  {
    method: 'GET',
    path: '/api/leave-requests/:id',
    handler: async (req) => {
      const caller = must(req);
      // ?companyId carries the doc id on flat paths — locate within scope.
      const found = await locateEntityAcross<LeaveRequestDoc>('leaveRequest', req.params.id, await readPartitions(caller));
      if (!found) throw new ApiError('not-found', 'Leave request not found');
      return { leaveRequest: found.doc };
    },
  },

  // -------------------------------------------- direct update (Firestore shim)
  {
    method: 'PATCH',
    path: '/api/leave-requests/:id',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<LeaveRequestDoc>('leaveRequest', req.params.id, await readPartitions(caller));
      if (!found) throw new ApiError('not-found', 'Leave request not found');
      const doc_ = found.doc;
      if (!isSuperAdmin(caller)) {
        // Firestore update rule (leaveRequests, camelCase): owner, approver
        // permission, or a stamped tier approver — inside company scope.
        const isStampedApprover = Object.values(doc_.approverIds ?? {}).includes(caller.uid);
        if (doc_.userId !== caller.uid && !hasPermission(caller, 'leave.approve') && !isStampedApprover) {
          throw new ApiError('permission-denied', 'Cannot update this leave request');
        }
        assertCompanyScope(caller, String(doc_.companyId ?? ''));
      }
      const patch = { ...req.body } as Record<string, unknown>;
      delete patch.id;
      delete patch.companyId;
      // Identity and the approval chain are server-side facts — a body must
      // never rewrite who applied or who may approve.
      delete patch.userId;
      delete patch.approverIds;

      // Review outcomes may only be written by an actual approver. The owner
      // passes the permission check above, so without this guard anyone could
      // PATCH their own request to status 'Approved' (or edit approvalStatus)
      // and skip the whole tier chain. Cancelling your own request stays legal.
      const decisionFields = [
        'status', 'approvalStatus', 'approvalLog', 'approvalCount',
        'masterAdminApproveStatus', 'masterAdminApprovedBy', 'masterAdminNote',
        'rejectedAt', 'reviewedBy', 'reviewedByName', 'reviewNote', 'reviewedOn',
      ];
      const changedDecisionFields = decisionFields.filter((f) => f in patch);
      const ownerCancel =
        changedDecisionFields.length === 1 &&
        changedDecisionFields[0] === 'status' &&
        String(patch.status) === 'Cancelled';
      if (changedDecisionFields.length > 0 && !ownerCancel) {
        const isApprover =
          hasPermission(caller, 'leave.approve') ||
          isSuperAdmin(caller) ||
          Object.values(doc_.approverIds ?? {}).includes(caller.uid);
        if (!isApprover) {
          throw new ApiError(
            'permission-denied',
            'Only an approver can change a leave decision — use the review endpoints',
          );
        }
      }

      const updated = await patchEntity<LeaveRequestDoc>('leaveRequest', found.companyId, doc_.id, patch, {
        entity: 'leaveRequest', userIdField: 'userId',
      });
      if (!updated) throw new ApiError('not-found', 'Leave request not found');
      return { leaveRequest: updated };
    },
  },

  // ------------------------------------------------------------- tier review
  {
    method: 'POST',
    path: '/api/leave-requests/:id/review-tier',
    handler: async (req) => {
      const caller = must(req);
      const { tier, decision, note } = req.body as { tier: LeaveTier; decision: 'Approved' | 'Rejected'; note?: string };
      if (!TIER_ORDER.includes(tier)) throw new ApiError('bad-request', 'Invalid tier');
      if (!['Approved', 'Rejected'].includes(decision)) throw new ApiError('bad-request', 'decision must be Approved or Rejected');
      if (decision === 'Rejected' && !note?.trim()) throw new ApiError('bad-request', 'A review note is required for rejection');

      const found = await locateEntityAcross<LeaveRequestDoc>('leaveRequest', req.params.id, await readPartitions(caller));
      const doc_ = found?.doc;
      if (!doc_) throw new ApiError('not-found', 'Leave request not found');
      if (doc_.status !== 'Pending') throw new ApiError('failed-precondition', `Request already ${doc_.status}`);

      // Sequential gate: every earlier tier must be decided
      const idx = TIER_ORDER.indexOf(tier);
      for (let i = 0; i < idx; i++) {
        const prev = doc_.approvalStatus[TIER_ORDER[i]];
        if (prev !== 'Approved' && prev !== 'Skipped') {
          throw new ApiError('failed-precondition', `Earlier tier (${TIER_ORDER[i]}) has not approved yet`);
        }
      }
      if (doc_.approvalStatus[tier] !== 'Pending') {
        throw new ApiError('failed-precondition', 'This tier has already been decided');
      }
      await assertTierApprover(caller, doc_, tier);

      const patch: Record<string, unknown> = {
        [`approvalStatus.${tier}`]: decision,
      };
      if (note) patch[`${tier}Note`] = note;
      const updated = await patchEntity<LeaveRequestDoc>('leaveRequest', doc_.companyId, doc_.id, patch, {
        entity: 'leaveRequest', userIdField: 'userId',
      });
      if (!updated) throw new ApiError('internal', 'Failed to update');

      const derived = deriveStatus(updated);
      const finalPatch: Record<string, unknown> = { ...derived };

      // Notify the next tier's approver
      const nextTier = TIER_ORDER.slice(idx + 1).find((t) => updated.approvalStatus[t] === 'Pending');
      if (nextTier && updated.approverIds?.[nextTier]) {
        await createNotification({
          userId: updated.approverIds[nextTier]!, companyId: updated.companyId,
          type: 'leave_tier_approved',
          title: 'Leave awaiting your review',
          message: `The ${tier} tier approved a leave request; it now needs your review.`,
          link: '/leaves',
        });
      }

      // Final outcome fan-out
      if (derived.status !== 'Pending' && !updated.notifiedFinalStatus) {
        finalPatch.notifiedFinalStatus = true;
        const targets = [
          updated.userId,
          ...Object.values(updated.approverIds ?? {}).filter((v): v is string => Boolean(v)),
        ];
        await fanOutNotifications(targets, {
          companyId: updated.companyId,
          type: derived.status === 'Approved' ? 'leave_approved' : 'leave_rejected',
          title: `Leave ${derived.status.toLowerCase()}`,
          message: `Your ${updated.type} leave (${updated.startDate} → ${updated.endDate}) was ${derived.status.toLowerCase()}.`,
          link: '/my-leaves', priority: 'high',
        }, undefined);
      }

      const final = await patchEntity<LeaveRequestDoc>('leaveRequest', doc_.companyId, doc_.id, finalPatch, {
        entity: 'leaveRequest', userIdField: 'userId',
      });
      return { leaveRequest: final };
    },
  },

  // ------------------------------------------------------ master-admin gate
  {
    method: 'POST',
    path: '/api/leave-requests/:id/master-admin-review',
    handler: async (req) => {
      const caller = must(req);
      if (caller.role !== 'master-admin') throw new ApiError('permission-denied', 'Master admin only');
      const { decision, note } = req.body as { decision: 'Approved' | 'Rejected'; note?: string };
      const found = await locateEntityAcross<LeaveRequestDoc>('leaveRequest', req.params.id, await readPartitions(caller));
      const doc_ = found?.doc;
      if (!doc_) throw new ApiError('not-found', 'Leave request not found');
      if (!doc_.masterAdminRequired) throw new ApiError('failed-precondition', 'This request does not require master-admin review');
      if (doc_.masterAdminApproveStatus !== 'Pending') throw new ApiError('failed-precondition', 'Already decided');

      const updated = await patchEntity<LeaveRequestDoc>('leaveRequest', doc_.companyId, doc_.id, {
        masterAdminApproveStatus: decision,
        masterAdminApprovedBy: caller.uid,
        masterAdminApprovedOn: isoNow(),
        ...(note ? { masterAdminNote: note } : {}),
      }, { entity: 'leaveRequest', userIdField: 'userId' });
      if (!updated) throw new ApiError('internal', 'Update failed');

      const derived = deriveStatus(updated);
      const final = await patchEntity<LeaveRequestDoc>('leaveRequest', doc_.companyId, doc_.id, derived, {
        entity: 'leaveRequest', userIdField: 'userId',
      });

      if (derived.status !== 'Pending' && !updated.notifiedFinalStatus) {
        await patchEntity('leaveRequest', doc_.companyId, doc_.id, { notifiedFinalStatus: true }, { entity: 'leaveRequest', userIdField: 'userId' });
        const targets = [updated.userId, ...Object.values(updated.approverIds ?? {}).filter((v): v is string => Boolean(v))];
        await fanOutNotifications(targets, {
          companyId: updated.companyId,
          type: derived.status === 'Approved' ? 'leave_approved' : 'leave_rejected',
          title: `Leave ${derived.status.toLowerCase()}`,
          message: `Your ${updated.type} leave (${updated.startDate} → ${updated.endDate}) was ${derived.status.toLowerCase()}.`,
          link: '/my-leaves', priority: 'high',
        });
      }
      return { leaveRequest: final };
    },
  },

  // ------------------------------------------------------------------ delete
  {
    method: 'DELETE',
    path: '/api/leave-requests/:id',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<LeaveRequestDoc>('leaveRequest', req.params.id, await readPartitions(caller));
      const doc_ = found?.doc;
      if (!doc_) throw new ApiError('not-found', 'Leave request not found');
      if (doc_.userId !== caller.uid && caller.role !== 'master-admin' && !hasPermission(caller, 'leave.cancel')) {
        throw new ApiError('permission-denied', 'Cannot delete this request');
      }
      const { deleteEntity } = await import('../lib/db.js');
      await deleteEntity('leaveRequest', found!.companyId, doc_.id);
      return { success: true };
    },
  },
];
