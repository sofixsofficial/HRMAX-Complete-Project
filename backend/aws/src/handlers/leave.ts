/**
 * Leave management — 4-tier sequential approval chain.
 * Tier order: reportingManager → companyAdmin → executive → teamLeader,
 * with optional master-admin gate for team-leader/executive self-applications.
 * (Port of leaveFunctions.ts + mobileApi leave endpoints.)
 */

import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { assertCompanyScope, hasPermission } from '../lib/auth.js';
import { putEntity, getEntity, patchEntity, queryEntities } from '../lib/db.js';
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
 * applying the per-role auto-skip rules.
 */
async function computeInitialApproval(
  input: LeaveInput,
  applicantRole: UserRole,
  stakeholders: Awaited<ReturnType<typeof resolveStakeholders>>,
): Promise<Pick<LeaveRequestDoc, 'approvalStatus' | 'approverIds' | 'masterAdminRequired' | 'masterAdminApproveStatus' | 'masterAdminApproverId' | 'applicantRole'>> {
  const status: Record<LeaveTier, 'Pending' | 'Approved' | 'Rejected' | 'Skipped'> = {
    reportingManager: 'Pending',
    companyAdmin: 'Pending',
    executive: 'Pending',
    teamLeader: 'Pending',
  };
  const approverIds: Partial<Record<LeaveTier, string | null>> = {
    reportingManager: stakeholders.reportingManagerId,
    companyAdmin: stakeholders.companyAdminIds[0] ?? null,
    executive: stakeholders.executiveIds[0] ?? null,
    teamLeader: stakeholders.teamLeaderIds[0] ?? null,
  };

  // Auto-skip unassigned tiers
  if (!approverIds.reportingManager) status.reportingManager = 'Skipped';
  if (!approverIds.companyAdmin) status.companyAdmin = 'Skipped';
  if (!approverIds.executive) status.executive = 'Skipped';
  if (!approverIds.teamLeader) status.teamLeader = 'Skipped';

  let masterAdminRequired = MANAGEMENT_SELF_SERVICE.includes(applicantRole);
  let masterAdminApproveStatus: 'Pending' | 'Approved' | 'Rejected' | undefined = masterAdminRequired ? 'Pending' : undefined;
  let masterAdminApproverId: string | null = masterAdminRequired ? stakeholders.masterAdminIds[0] ?? null : null;

  if (applicantRole === 'team-leader') {
    // TL self-app: all four tiers auto-approved → single MA gate
    status.reportingManager = 'Approved';
    status.companyAdmin = 'Approved';
    status.executive = 'Approved';
    status.teamLeader = 'Approved';
  } else if (applicantRole === 'executive') {
    // Executive self-app: RM+CA+Exec auto-approved, TL tier stays live
    status.reportingManager = 'Approved';
    status.companyAdmin = 'Approved';
    status.executive = 'Approved';
  } else if (applicantRole === 'reporting-manager') {
    // RM with no manager above → own tier skipped
    if (!approverIds.reportingManager) status.reportingManager = 'Skipped';
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
      const input = req.body as unknown as LeaveInput;
      if (!input.companyId || !input.userId || !input.startDate || !input.endDate) {
        throw new ApiError('bad-request', 'companyId, userId, startDate, endDate required');
      }
      assertCompanyScope(caller, input.companyId);
      if (caller.uid !== input.userId && !hasPermission(caller, 'leave.approve') && caller.role !== 'master-admin') {
        throw new ApiError('permission-denied', 'Cannot apply leave for another user');
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
        totalDays: input.totalDays,
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
      const companyId = req.query.companyId ?? caller.companyId;
      const userId = req.query.userId;

      const q: Parameters<typeof queryEntities>[0] = { entity: 'leaveRequest', companyId };
      if (userId) q.userId = userId;
      if (req.query.departmentId) q.filters = { ...q.filters, departmentId: req.query.departmentId };
      if (req.query.status) q.filters = { ...q.filters, status: req.query.status };

      let docs = await queryEntities<LeaveRequestDoc>({ ...q, orderBy: { field: 'appliedOn', desc: true } });

      // Scope enforcement: employee/RM see only their own
      if (['employee', 'reporting-manager'].includes(caller.role)) {
        docs = docs.filter((d) => d.userId === caller.uid || (caller.role === 'reporting-manager' && hasPermission(caller, 'leave.approve')));
      } else if (caller.role !== 'master-admin') {
        assertCompanyScope(caller, companyId);
      }
      return { leaveRequests: docs };
    },
  },

  {
    method: 'GET',
    path: '/api/leave-requests/:id',
    handler: async (req) => {
      const caller = must(req);
      const list = await queryEntities<LeaveRequestDoc>({ entity: 'leaveRequest', companyId: caller.companyId, filters: { id: req.params.id }, limit: 1 });
      const doc_ = list[0] ?? null;
      if (!doc_) throw new ApiError('not-found', 'Leave request not found');
      return { leaveRequest: doc_ };
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

      const list = await queryEntities<LeaveRequestDoc>({ entity: 'leaveRequest', companyId: caller.companyId, filters: { id: req.params.id }, limit: 1 });
      const doc_ = list[0];
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
      const list = await queryEntities<LeaveRequestDoc>({ entity: 'leaveRequest', companyId: req.query.companyId ?? caller.companyId, filters: { id: req.params.id }, limit: 1 });
      const doc_ = list[0];
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
      const list = await queryEntities<LeaveRequestDoc>({ entity: 'leaveRequest', companyId: caller.companyId, filters: { id: req.params.id }, limit: 1 });
      const doc_ = list[0];
      if (!doc_) throw new ApiError('not-found', 'Leave request not found');
      if (doc_.userId !== caller.uid && caller.role !== 'master-admin' && !hasPermission(caller, 'leave.cancel')) {
        throw new ApiError('permission-denied', 'Cannot delete this request');
      }
      const { deleteEntity } = await import('../lib/db.js');
      await deleteEntity('leaveRequest', doc_.companyId, doc_.id);
      return { success: true };
    },
  },
];
