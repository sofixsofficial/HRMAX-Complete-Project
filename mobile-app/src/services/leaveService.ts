import {
  collection, getDocs, doc, getDoc,
  query, where
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';
import { createNotification } from './notificationService';
import type { LeaveRequest, LeaveType, LeaveStatus, ApprovalTier, ApprovalLevel, ApprovalFlags } from '../types/user';

const COLLECTION_NAME = 'leaveRequests';

const PAID_LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'];
export const isLeaveTypePaid = (type: LeaveType): boolean => PAID_LEAVE_TYPES.includes(type);

export const calcLeaveDays = (start: Date, end: Date): number => {
  const s = new Date(start);
  const e = new Date(end);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 0;
};

export const TIER_LABELS: Record<ApprovalTier, string> = {
  reportingManager: 'Reporting Manager',
  companyAdmin: 'Company Admin',
  teamLeader: 'Team Leader',
  executive: 'Executive',
};

export const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];

const INITIAL_APPROVAL_STATUS: Record<ApprovalTier, ApprovalLevel> = {
  reportingManager: 'Pending',
  companyAdmin: 'Pending',
  teamLeader: 'Pending',
  executive: 'Pending',
};

/**
 * The 2-tier-leadership roles whose own personal leave / attendance self-service
 * requests route to a Master Admin for final oversight after the 4-tier chain.
 */
const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

/** Resolve the applicant's role (users doc first, employee flags fallback). */
export const resolveApplicantRole = async (userId: string): Promise<string> => {
  try {
    const uSnap = await getDoc(doc(db, 'users', userId));
    if (uSnap.exists()) {
      const u = uSnap.data();
      return u?.role === 'team-leader' || u?.role === 'executive' ? String(u.role) : u?.role || 'employee';
    }
  } catch {}
  try {
    const eSnap = await getDocs(query(collection(db, 'employees'), where('userId', '==', userId)));
    if (!eSnap.empty) {
      const e = eSnap.docs[0].data();
      if (e.isTeamLeader) return 'team-leader';
      if (e.isExecutive) return 'executive';
    }
  } catch {}
  return 'employee';
};

/** Resolve the platform Master Admin approver id (first master-admin user). */
export const resolveMasterAdminApproverId = async (): Promise<string> => {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'master-admin')));
    if (!snap.empty) return snap.docs[0].id;
  } catch {}
  return '';
};

/**
 * Find the Team Leader who manages a specific Executive. Looks up TLs whose
 * `linkedExecutiveIds` includes the executive's userId, falling back to any TL
 * assigned to the company.
 */
export const findManagingTeamLeaderForExec = async (execUserId: string, companyId: string): Promise<string> => {
  try {
    const tlSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'team-leader')));
    for (const d of tlSnap.docs) {
      const data = d.data();
      const linkedIds: string[] = data.linkedExecutiveIds || (data.reportingExecutiveId ? [data.reportingExecutiveId] : []);
      if (linkedIds.includes(execUserId)) return d.id;
    }
    for (const d of tlSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(companyId)) return d.id;
    }
    if (!tlSnap.empty) return tlSnap.docs[0].id;
  } catch {}
  return '';
};

/** Overall leave status with the Master Admin final gate applied. */
export const computeOverallLeaveStatus = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): LeaveStatus => {
  for (const tier of TIER_ORDER) {
    if (approvalStatus[tier] === 'Rejected') return 'Rejected';
  }
  if (masterAdminRequired && masterAdminApproveStatus === 'Rejected') return 'Rejected';
  if (!TIER_ORDER.every((t) => approvalStatus[t] === 'Approved')) return 'Pending';
  if (masterAdminRequired) {
    return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
  }
  return 'Approved';
};

/**
 * Derive the individual per-tier boolean approval flags from the
 * `approvalStatus` map. Stored flat on the leave document under the exact names
 * specified in the requirement (reportingManagerApproved / companyAdminApproved /
 * executiveApproved / teamLeaderApproved) and synced across web + mobile.
 */
export const computeApprovalFlags = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>
): ApprovalFlags => ({
  reportingManagerApproved: approvalStatus.reportingManager === 'Approved',
  companyAdminApproved: approvalStatus.companyAdmin === 'Approved',
  executiveApproved: approvalStatus.executive === 'Approved',
  teamLeaderApproved: approvalStatus.teamLeader === 'Approved',
});

/**
 * Number of leave-approval tiers that have been resolved (Approved or
 * Rejected). Mirrors the web `computeApprovalCount` and drives the stored
 * `approvalCount` progress counter (0..4).
 */
export const computeApprovalCount = (approvalStatus: Record<ApprovalTier, ApprovalLevel>): number =>
  TIER_ORDER.filter((t) => approvalStatus[t] === 'Approved' || approvalStatus[t] === 'Rejected').length;

const resolveApproverIds = async (companyId: string, employeeUserId: string): Promise<Record<ApprovalTier, string>> => {
  const ids: Record<ApprovalTier, string> = { reportingManager: '', companyAdmin: '', teamLeader: '', executive: '' };

  // 1. Reporting Manager — from employee doc
  try {
    const empQuery = query(collection(db, 'employees'), where('userId', '==', employeeUserId));
    const empSnap = await getDocs(empQuery);
    if (!empSnap.empty && empSnap.docs[0].data().reportingManagerId) {
      ids.reportingManager = empSnap.docs[0].data().reportingManagerId;
    }
  } catch {}

  // 2. Company Admin — match web's resolveApproverIds exactly
  if (companyId) {
    try {
      const adminSnap = await getDocs(query(
        collection(db, 'users'),
        where('role', '==', 'company-admin'),
        where('companyId', '==', companyId)
      ));
      if (!adminSnap.empty) {
        ids.companyAdmin = adminSnap.docs[0].id;
      }
    } catch {}
  }

  // 3. Team Leader — authoritative exec-linked resolution (no arbitrary
  // "first TL in DB" fallback). The TL is the one linked to this company's
  // Executive(s). This mirrors the missed-punch chain so a matching submission
  // always lands in the *assigned* TL's pending queue.
  try {
    const tlSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'team-leader')));
    const tls = tlSnap.docs;
    for (const d of tls) {
      if (d.data().assignedCompanyIds?.includes(companyId)) { ids.teamLeader = d.id; break; }
    }
    if (!ids.teamLeader) {
      const execSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'executive')));
      for (const d of execSnap.docs) {
        if (d.data().assignedCompanyIds?.includes(companyId)) {
          const assigned = d.data().assignedTeamLeaderIds;
          if (Array.isArray(assigned) && assigned.length > 0) { ids.teamLeader = String(assigned[0]); break; }
        }
      }
    }
  } catch {}

  // 4. Executive — from company scope
  try {
    const execSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'executive')));
    for (const d of execSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(companyId)) {
        ids.executive = d.id;
        break;
      }
    }
  } catch {}

  return ids;
};

export const createLeaveRequest = async (
  leave: Omit<LeaveRequest, 'id' | 'appliedOn' | 'status' | 'approvalStatus' | 'approvalLog' | 'approverIds'>,
  tierOverrides?: Partial<Record<ApprovalTier, ApprovalLevel>>
): Promise<LeaveRequest> => {
  const approverIds = await resolveApproverIds(leave.companyId, leave.userId);

  // Master Admin final-verification layer: Team Leaders & Executives are also
  // registered employees, so their personal leave routes to the top-tier Master
  // Admin for oversight after the 4-tier chain.
  const applicantRole = await resolveApplicantRole(leave.userId);
  const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
  const masterAdminApproverId = masterAdminRequired ? await resolveMasterAdminApproverId() : '';

  // For Executive self-apps: resolve the specific managing TL who will be Tier 1.
  const isExecSelfApp = masterAdminRequired && applicantRole === 'executive';
  if (isExecSelfApp) {
    const managingTL = await findManagingTeamLeaderForExec(leave.userId, leave.companyId);
    if (managingTL) approverIds.teamLeader = managingTL;
  }

  const approvalStatus: Record<ApprovalTier, ApprovalLevel> = { ...INITIAL_APPROVAL_STATUS };
  for (const tier of TIER_ORDER) {
    // Auto-skip any tier whose approver is the applicant, and auto-skip the
    // Reporting Manager tier when the applicant has no manager above them
    // (self-managed / top-of-chain, e.g. an RM applying for their own leave).
    const isSelfApprover = approverIds[tier] === leave.userId;
    const isUnassignedRmTier = tier === 'reportingManager' && !approverIds[tier];
    const isSelfReportingManager = tier === 'reportingManager' && applicantRole === 'reporting-manager';

    if (isExecSelfApp) {
      // Executive 2-tier: auto-skip RM + Admin + Executive, keep TL active
      // so the assigned Team Leader must review before Master Admin final gate.
      if (tier !== 'teamLeader') approvalStatus[tier] = 'Approved';
    } else if (masterAdminRequired) {
      // Team Leader self-app: auto-skip ALL tiers (routes directly to Master Admin)
      approvalStatus[tier] = 'Approved';
    } else {
      // Normal employee: standard self-approver / unassigned-RM skip.
      // Reporting Manager self-app: their own tier always auto-completes
      // (regardless of how reportingManagerId is stored), matching the web
      // service so the chain becomes Company Admin → Executive → Team Leader.
      if (isSelfApprover || isUnassignedRmTier || isSelfReportingManager) approvalStatus[tier] = 'Approved';
    }
  }

  if (tierOverrides) {
    for (const [tier, status] of Object.entries(tierOverrides)) {
      if (status && TIER_ORDER.includes(tier as ApprovalTier)) {
        approvalStatus[tier as ApprovalTier] = status;
      }
    }
  }

  const callableFn = httpsCallable(functions, 'mobileCreateLeaveRequest');
  // The callable expects the payload nested under `leaveData` (it validates
  // `data.leaveData.userId/companyId`); a flat payload was rejected with
  // INVALID_ARGUMENT (HTTP 400), so every mobile-applied leave failed to save.
  const result = await callableFn({
    leaveData: {
      ...leave,
      applicantRole,
      masterAdminRequired,
      masterAdminApproverId,
      masterAdminApproveStatus: masterAdminRequired ? 'Pending' : undefined,
      status: computeOverallLeaveStatus(approvalStatus, masterAdminRequired, 'Pending'),
      approvalStatus,
      approvalLog: [],
      approverIds,
      approvalCount: computeApprovalCount(approvalStatus),
      ...computeApprovalFlags(approvalStatus),
      tierOverrides: tierOverrides || null,
    },
  });

  const created = result.data as { id?: string };
  return {
    ...leave,
    id: created?.id || '',
    applicantRole,
    masterAdminRequired,
    masterAdminApproverId,
    masterAdminApproveStatus: masterAdminRequired ? 'Pending' : undefined,
    status: computeOverallLeaveStatus(approvalStatus, masterAdminRequired, 'Pending'),
    appliedOn: new Date(),
    approvalStatus,
    approvalLog: [],
    approverIds,
    approvalCount: computeApprovalCount(approvalStatus),
    ...computeApprovalFlags(approvalStatus),
  } as LeaveRequest;
};

// Web sorts client-side by appliedOn; Firestore's orderBy EXCLUDES documents
// missing the field, and web's createLeaveRequest never writes `createdAt` — so
// `orderBy('createdAt')` silently dropped every web-created leave from the
// mobile management queue. Never orderBy a nullable field here.
const byAppliedOnDesc = (a: LeaveRequest, b: LeaveRequest): number => {
  const toMs = (v: any): number =>
    v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() || 0 : 0;
  return toMs((b as any).appliedOn) - toMs((a as any).appliedOn);
};

export const getAllLeaveRequests = async (): Promise<LeaveRequest[]> => {
  const snap = await getDocs(collection(db, COLLECTION_NAME));
  return (snap.docs.map(d => ({ id: d.id, ...d.data() })) as LeaveRequest[]).sort(byAppliedOnDesc);
};

export const getLeaveRequestsByCompany = async (companyId: string): Promise<LeaveRequest[]> => {
  const snap = await getDocs(query(collection(db, COLLECTION_NAME), where('companyId', '==', companyId)));
  return (snap.docs.map(d => ({ id: d.id, ...d.data() })) as LeaveRequest[]).sort(byAppliedOnDesc);
};

export const getLeaveStats = async (companyId?: string) => {
  let leaves: LeaveRequest[];
  if (companyId) leaves = await getLeaveRequestsByCompany(companyId);
  else leaves = await getAllLeaveRequests();
  return {
    total: leaves.length,
    pending: leaves.filter(l => l.status === 'Pending').length,
    approved: leaves.filter(l => l.status === 'Approved').length,
    rejected: leaves.filter(l => l.status === 'Rejected').length,
    cancelled: leaves.filter(l => l.status === 'Cancelled').length,
  };
};

// ── 4-Tier Sequential Approval ──

const areAllPreviousTiersApproved = (approvalStatus: Record<ApprovalTier, ApprovalLevel>, tier: ApprovalTier): boolean => {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx <= 0) return true;
  return TIER_ORDER.slice(0, idx).every(t => approvalStatus[t] === 'Approved');
};

export const getNextPendingTier = (approvalStatus: Record<ApprovalTier, ApprovalLevel>): ApprovalTier | null => {
  for (const tier of TIER_ORDER) {
    if (approvalStatus[tier] === 'Pending') return tier;
  }
  return null;
};

/**
 * The tier (if any) that `uid` may act on for this leave right now. Mirrors the
 * web's `getActionableLeaveTier` exactly: the stamped approver of the next
 * pending tier may act; when no approver is stamped yet, the natural role
 * holder of that tier (scoped to the given companies, when provided) may act
 * instead. Returns null when the leave is routed to someone else.
 */
export const getActionableLeaveTier = (
  l: { companyId?: string; approvalStatus?: Record<ApprovalTier, ApprovalLevel>; approverIds?: Partial<Record<ApprovalTier, string>> },
  uid: string,
  role?: string,
  scopeCompanyIds?: string[],
): ApprovalTier | null => {
  const nextTier = getNextPendingTier(l.approvalStatus || ({} as Record<ApprovalTier, ApprovalLevel>));
  if (!nextTier) return null;
  // Web parity (LeaveManagement.getActionableTier): a master-admin may act on
  // ANY pending tier — mobile previously showed MA zero Approve/Reject buttons
  // on 4-tier leaves because the stamp belonged to the natural approver.
  if (role === 'master-admin') return nextTier;
  const approverId = l.approverIds?.[nextTier];
  if (approverId === uid) return nextTier;
  if (approverId) return null;
  const inScope = !scopeCompanyIds || scopeCompanyIds.length === 0 || scopeCompanyIds.includes(l.companyId || '');
  if (role === 'reporting-manager' && nextTier === 'reportingManager' && inScope) return nextTier;
  if (role === 'hr-manager' && nextTier === 'reportingManager' && inScope) return nextTier;
  if (role === 'company-admin' && nextTier === 'companyAdmin' && inScope) return nextTier;
  if (role === 'executive' && nextTier === 'executive' && inScope) return nextTier;
  if (role === 'team-leader' && nextTier === 'teamLeader' && inScope) return nextTier;
  return null;
};

export const reviewTierLeaveRequest = async (
  id: string,
  tier: ApprovalTier,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error('Leave request not found');

  const leaveData = docSnap.data();
  const currentApprovalStatus: Record<ApprovalTier, ApprovalLevel> = leaveData.approvalStatus || { ...INITIAL_APPROVAL_STATUS };
  const currentApprovalLog: Array<{ tier: ApprovalTier; status: 'Approved' | 'Rejected'; approvedBy: string; approvedByName: string; approvedOn: Date; note?: string }> = leaveData.approvalLog || [];

  if (currentApprovalStatus[tier] !== 'Pending') {
    throw new Error(`This tier has already been ${currentApprovalStatus[tier]}`);
  }
  if (!areAllPreviousTiersApproved(currentApprovalStatus, tier)) {
    throw new Error('Previous approval tiers must be completed before acting on this tier');
  }

  const newApprovalStatus = { ...currentApprovalStatus, [tier]: action };
  const newEntry = {
    tier,
    status: action,
    approvedBy: reviewedBy,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...currentApprovalLog, newEntry];
  const overallStatus = computeOverallLeaveStatus(
    newApprovalStatus,
    !!leaveData.masterAdminRequired,
    leaveData.masterAdminApproveStatus || 'Pending',
  );

  const callableFn = httpsCallable(functions, 'mobileReviewLeaveTier');
  await callableFn({
    leaveId: id,
    tier,
    action,
    reviewedBy,
    reviewedByName,
    reviewNote: reviewNote || '',
  });

  // Notifications
  try {
    if (leaveData.userId) {
      const notifType = action === 'Rejected' ? 'leave_rejected' : overallStatus === 'Approved' ? 'leave_approved' : 'leave_approved';
      const notifTitle = action === 'Rejected'
        ? `Leave Rejected by ${TIER_LABELS[tier]}`
        : overallStatus === 'Approved' ? 'Leave Fully Approved' : `Leave Approved by ${TIER_LABELS[tier]}`;
      const notifBody = action === 'Rejected'
        ? `Your ${leaveData.leaveType || 'leave'} request was rejected by ${reviewedByName}. ${reviewNote || ''}`
        : overallStatus === 'Approved'
          ? `All 4 approvers have approved your ${leaveData.leaveType || 'leave'} request!`
          : `Your ${leaveData.leaveType || 'leave'} was approved by ${TIER_LABELS[tier]}. Waiting for next approval.`;
      await createNotification(leaveData.userId, notifType, notifTitle, notifBody, '/leaves', leaveData.companyId);
    }
  } catch {}
};

/**
 * Master Admin final review: the top-tier gate for Team Leader / Executive
 * self-applications. Requires the full 4-tier chain to be approved and a
 * mandatory remark, then finalizes the overall status and appends the MA
 * decision to the approval log.
 */
export const reviewMasterAdminLeaveRequest = async (
  id: string,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error('Leave request not found');

  const leaveData = docSnap.data();
  if (!leaveData.masterAdminRequired) {
    throw new Error('This request does not require Master Admin verification.');
  }
  // Web parity: ANY Master Admin may take the gate decision (role check). The
  // old stamp check (`masterAdminApproverId !== reviewedBy`) blocked every MA
  // except the "first master-admin found" stamped at creation time — a
  // mobile-only failure; web checks the reviewer's ROLE instead.
  const reviewerSnap = await getDoc(doc(db, 'users', reviewedBy));
  if (reviewerSnap.data()?.role !== 'master-admin') {
    throw new Error('Only a Master Admin can review this request.');
  }
  if (leaveData.masterAdminApproveStatus && leaveData.masterAdminApproveStatus !== 'Pending') {
    throw new Error(`Master Admin verification has already been ${leaveData.masterAdminApproveStatus}.`);
  }
  if (!reviewNote || !reviewNote.trim()) {
    throw new Error('A mandatory remark is required for Master Admin review.');
  }

  const currentApprovalStatus: Record<ApprovalTier, ApprovalLevel> = leaveData.approvalStatus || { ...INITIAL_APPROVAL_STATUS };
  // For Executive self-apps only the Team Leader tier needs approval; for Team
  // Leader self-apps all tiers are auto-completed. Validate only the tiers that
  // actually required action.
  const effectiveTiers: ApprovalTier[] = leaveData.applicantRole === 'executive'
    ? ['teamLeader']
    : leaveData.applicantRole === 'team-leader'
      ? []
      : [...TIER_ORDER];
  if (effectiveTiers.length > 0 && !effectiveTiers.every((t) => currentApprovalStatus[t] === 'Approved')) {
    throw new Error('The required approval tiers must be fully approved before Master Admin review.');
  }

  const newEntry = {
    tier: 'masterAdmin' as unknown as ApprovalTier,
    status: action,
    approvedBy: reviewedBy,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...(leaveData.approvalLog || []), newEntry];
  const overallStatus = computeOverallLeaveStatus(currentApprovalStatus, true, action);

  const callableFn = httpsCallable(functions, 'mobileReviewMasterAdminLeave');
  await callableFn({
    leaveId: id,
    action,
    reviewedBy,
    reviewedByName,
    reviewNote: reviewNote || '',
  });

  try {
    if (leaveData.userId) {
      const notifType = action === 'Rejected' ? 'leave_rejected' : 'leave_approved';
      const notifTitle = action === 'Rejected'
        ? `Leave Rejected by Master Admin`
        : `Leave Fully Approved by Master Admin`;
      const notifBody = action === 'Rejected'
        ? `Your ${leaveData.leaveType || 'leave'} request was rejected by Master Admin. ${reviewNote || ''}`
        : `All 4 approvers and the Master Admin have approved your ${leaveData.leaveType || 'leave'} request!`;
      await createNotification(leaveData.userId, notifType, notifTitle, notifBody, '/leaves', leaveData.companyId);
    }
  } catch {}
};

/**
 * Return the approval tiers that actually require manual action for this
 * applicant's role, matching the web's `getEffectiveTiers`:
 * - Employee: all 4 tiers
 * - Reporting Manager: 3 tiers (own tier auto-completes)
 * - Executive: only Team Leader
 * - Team Leader: none (direct to Master Admin)
 */
export const getEffectiveTiers = (applicantRole?: string): ApprovalTier[] => {
  if (applicantRole === 'reporting-manager' || applicantRole === 'hr-manager') return ['companyAdmin', 'executive', 'teamLeader'];
  if (applicantRole === 'executive') return ['teamLeader'];
  if (applicantRole === 'team-leader') return [];
  return [...TIER_ORDER];
};

/**
 * True when this applicant's role routes the request through the Master Admin
 * final-verification gate after the tier chain (TL & Exec self-apps).
 * Single source of truth for the apply-form tiers preview.
 */
export const requiresMasterAdminGate = (applicantRole?: string): boolean =>
  MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole || '');

/**
 * Resolve the employee's leave entitlements from their monthlyLeaveEntitlements
 * field, returning yearly totals per leave type.
 */
export const resolveEmployeeLeaveEntitlements = (
  employee?: { monthlyLeaveEntitlements?: Record<string, number> } | null
): { monthly: Record<string, number>; yearly: Record<string, number> } | null => {
  const monthlyRaw = employee?.monthlyLeaveEntitlements;
  if (!monthlyRaw || typeof monthlyRaw !== 'object') return null;
  const cleaned: Record<string, number> = {};
  for (const t of ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'] as LeaveType[]) {
    const v = Number(monthlyRaw[t]);
    if (!isNaN(v) && v > 0) cleaned[t] = Math.round(v * 100) / 100;
  }
  if (Object.keys(cleaned).length === 0) return null;
  const yearly: Record<string, number> = {};
  for (const t of ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'] as LeaveType[]) {
    yearly[t] = Math.round((cleaned[t] || 0) * 12 * 100) / 100;
  }
  return { monthly: cleaned, yearly };
};

/** True when a TL/Exec leave still awaits a Master Admin decision. */
export const isAwaitingMasterAdmin = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): boolean => {
  if (!masterAdminRequired) return false;
  if (masterAdminApproveStatus === 'Approved' || masterAdminApproveStatus === 'Rejected') return false;
  return TIER_ORDER.every((t) => approvalStatus[t] === 'Approved');
};

// ── Payroll helper: approved leave days for a given month ──

/**
 * Count approved paid/unpaid leave days (and half-days) for an employee
 * in a given month. Matches the web's getApprovedLeaveDaysForMonth.
 * Half-day leaves (totalDays = 0.5) count as 0.5 days.
 */
export const getApprovedLeaveDaysForMonth = (
  leaves: LeaveRequest[],
  userId: string,
  monthIndex: number,
  year: number
): { paidDays: number; unpaidDays: number; halfDays: number } => {
  let paidDays = 0;
  let unpaidDays = 0;
  let halfDays = 0;
  leaves
    .filter((l) => l.userId === userId && l.status === 'Approved')
    .forEach((l) => {
      const s = l.startDate instanceof Date ? l.startDate : new Date(l.startDate as any);
      const e = l.endDate instanceof Date ? l.endDate : new Date(l.endDate as any);
      const total = Number(l.totalDays) || 0;
      // Half-day leave (totalDays = 0.5 over a single date)
      if (total % 1 !== 0) {
        if (s.getMonth() === monthIndex && s.getFullYear() === year) {
          if (l.isPaid) paidDays += 0.5;
          else unpaidDays += 0.5;
          halfDays += 0.5;
        }
        return;
      }
      const cursor = new Date(s);
      while (cursor <= e) {
        if (cursor.getMonth() === monthIndex && cursor.getFullYear() === year) {
          if (l.isPaid) paidDays++;
          else unpaidDays++;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
  return { paidDays, unpaidDays, halfDays };
};

const ENCASHABLE_LEAVE_TYPES: LeaveType[] = ['Earned'];

/**
 * Encashable remaining days at year-end = unused balance of encashable types
 * (per the applied Leave Policy, defaulting to Earned only), floored so payroll
 * never pays fractional days. Uses centralized computeLeaveBalance.
 */
export const computeLeaveEncashmentDays = (
  allowances: Record<string, number> | undefined,
  leaves: LeaveRequest[],
  userId: string,
  year: number = new Date().getFullYear(),
  joinDate?: string | Date | null,
  config?: { encashable?: LeaveType[]; paid?: LeaveType[] }
): number => {
  const bal = computeLeaveBalance(allowances, leaves, userId, year, joinDate, config);
  const encashable = config?.encashable || ENCASHABLE_LEAVE_TYPES;
  return encashable.reduce(
    (sum, t) => sum + Math.floor(Math.max(0, bal[t]?.available || 0)),
    0
  );
};

// ============================================
// CENTRALIZED LEAVE BALANCE COMPUTATION
// (Must match web's computeLeaveBalance exactly)
// ============================================

export const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

export interface LeaveBalanceEntry {
  allowance: number;
  used: number;
  available: number;
  /** Approved-independent: pending requests this year (not deducted) */
  pending: number;
  /** Per-month equivalent of the yearly allowance (yearly ÷ 12). */
  monthly?: number;
  /** Whether this type's remaining balance is encashable under the applied policy. */
  encashable?: boolean;
  /** Whether this type is paid under the applied policy. */
  paid?: boolean;
}

export interface LeaveBalanceConfig {
  monthly: number;
  yearly: number;
  encashable?: boolean;
  paid?: boolean;
}

export interface LeaveBalanceResult {
  type: string;
  monthly: number;
  yearly: number;
  used: number;
  pending: number;
  available: number;
  encashable: boolean;
  paid: boolean;
}

/**
 * Prorate an annual leave allowance by joining date.
 * The guide treats the join month as 1 month's entitlement — months remaining
 * in the year (join month onward) ÷ 12. Joined in a previous year ⇒ full.
 */
export const prorateAnnualAllowance = (
  annual: number,
  joinDate?: string | Date | null | any,
  year: number = new Date().getFullYear(),
): number => {
  if (!annual || annual <= 0) return 0;
  let join: Date | null = null;
  if (joinDate) {
    if (joinDate instanceof Date) join = joinDate;
    else if (typeof joinDate === 'string') join = new Date(joinDate);
    else if (joinDate?.toDate) join = joinDate.toDate();
    else join = new Date(joinDate);
  }
  if (!join || isNaN(join.getTime())) return annual;
  if (join.getFullYear() < year) return annual;
  if (join.getFullYear() > year) return 0;
  const monthsRemaining = 12 - join.getMonth();
  return Math.round((annual * monthsRemaining) / 12 * 100) / 100;
};

/**
 * Compute an employee's annual leave balance per leave type.
 * allowance comes from the employee's own monthly entitlements (× 12) or the
 * resolved company config; used = approved leave days of that type within the
 * given calendar year; pending = submitted but not yet fully approved requests
 * (never deducted). `skipJoinProration` is used when the allowance already is
 * the employee's full yearly entitlement (Monthly × 12) — no join-date cut.
 * Returns entries for every leave type. MUST match web's computeLeaveBalance.
 */
export function computeLeaveBalance(
  allowances: Record<string, number> | undefined,
  leaves: LeaveRequest[],
  userId: string,
  year: number = new Date().getFullYear(),
  joinDate?: string | Date | null | any,
  config?: { encashable?: LeaveType[]; paid?: LeaveType[] },
  skipJoinProration?: boolean
): Record<string, LeaveBalanceEntry> {
  const ENCASHABLE = config?.encashable || (['Earned'] as LeaveType[]);
  const PAID = config?.paid || (['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'] as LeaveType[]);
  const configByType: Record<string, number> = { ...(allowances || {}) };
  const used: Record<string, number> = {};
  const pending: Record<string, number> = {};
  LEAVE_TYPES.forEach(t => { used[t] = 0; pending[t] = 0; });

  for (const l of leaves) {
    if (l.userId !== userId) continue;
    const start = l.startDate instanceof Date ? l.startDate : new Date(l.startDate as any);
    if (isNaN(start.getTime()) || start.getFullYear() !== year) continue;
    const type = l.leaveType as LeaveType;
    if (!(type in used)) continue;
    if (l.status === 'Approved') {
      used[type] += l.totalDays || calcLeaveDays(start, l.endDate instanceof Date ? l.endDate : new Date(l.endDate as any)) || 0;
    } else if (l.status === 'Pending') {
      pending[type] += l.totalDays || calcLeaveDays(start, l.endDate instanceof Date ? l.endDate : new Date(l.endDate as any)) || 0;
    }
  }

  const result: Record<string, LeaveBalanceEntry> = {};
  LEAVE_TYPES.forEach(t => {
    const allowance = skipJoinProration
      ? (configByType[t] || 0)
      : prorateAnnualAllowance(configByType[t] || 0, joinDate, year);
    const u = Math.round(used[t] || 0);
    result[t] = {
      allowance,
      used: u,
      available: Math.max(0, allowance - u),
      pending: Math.round(pending[t] || 0),
      monthly: Math.round((allowance / 12) * 100) / 100,
      encashable: ENCASHABLE.includes(t as LeaveType),
      paid: PAID.includes(t as LeaveType),
    };
  });
  return result;
}

/**
 * Resolve employee leave entitlements with policy fallback.
 * MUST match web's resolveEmployeeLeaveEntitlementsFull exactly.
 * Returns config with capitalized leave type keys matching LeaveType format.
 */
export async function resolveEmployeeLeaveEntitlementsFull(
  employee: any,
  companyId: string
): Promise<Record<string, LeaveBalanceConfig>> {
  const TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];
  const DEFAULTS: Record<string, LeaveBalanceConfig> = {
    Casual: { monthly: 1, yearly: 12, paid: true },
    Sick: { monthly: 1, yearly: 12, paid: true },
    Earned: { monthly: 1, yearly: 15, paid: true, encashable: true },
    Unpaid: { monthly: 0, yearly: 0, paid: false },
    Maternity: { monthly: 0, yearly: 180, paid: true },
    Paternity: { monthly: 0, yearly: 5, paid: true },
  };

  // Try employee doc first (monthlyLeaveEntitlements)
  const raw = employee?.monthlyLeaveEntitlements || employee?.leaveMonthlyEntitlements || employee?.monthlyEntitlements;
  if (raw && typeof raw === 'object') {
    const result: Record<string, LeaveBalanceConfig> = {};
    for (const t of TYPES) {
      const val = Number(raw[t]) || 0;
      if (val > 0) {
        result[t] = {
          monthly: val,
          yearly: Math.round(val * 12 * 100) / 100,
          paid: t !== 'Unpaid',
          encashable: t === 'Earned',
        };
      }
    }
    if (Object.keys(result).length > 0) return result;
  }

  // Fallback: try leaveAllowances (yearly)
  const allowances = employee?.leaveAllowances || employee?.yearlyEntitlements || employee?.leaveYearlyEntitlements;
  if (allowances && typeof allowances === 'object') {
    const result: Record<string, LeaveBalanceConfig> = {};
    for (const t of TYPES) {
      const val = Number(allowances[t]) || 0;
      if (val > 0) {
        result[t] = {
          monthly: Math.round(val / 12),
          yearly: val,
          paid: t !== 'Unpaid',
          encashable: t === 'Earned',
        };
      }
    }
    if (Object.keys(result).length > 0) return result;
  }

  // Fallback: try resolveEmployeeLeavePolicy from Firestore
  try {
    const policySnap = await getDocs(query(
      collection(db, 'leavePolicies'),
      where('companyId', '==', companyId)
    ));
    if (!policySnap.empty) {
      const policy = policySnap.docs[0].data();
      if (policy.types) {
        const result: Record<string, LeaveBalanceConfig> = {};
        for (const t of TYPES) {
          const pt = policy.types[t];
          if (pt) {
            result[t] = {
              monthly: pt.monthly ?? Math.round((pt.yearly ?? 0) / 12),
              yearly: pt.yearly ?? 0,
              paid: pt.paid !== false,
              encashable: pt.encashable || false,
            };
          } else {
            result[t] = DEFAULTS[t];
          }
        }
        return result;
      }
    }
  } catch {
    // Fall through to defaults
  }

  return DEFAULTS;
}
