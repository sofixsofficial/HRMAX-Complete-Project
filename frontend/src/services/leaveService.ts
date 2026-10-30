import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDoc,
  serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { LeaveRequest, LeaveStatus, LeaveType, ApprovalTier, ApprovalLevel, ApprovalFlags } from '../types/user';
import { REQUESTER_ROLES, resolveApprovalChain, type RequesterRole, type ApprovalChainConfig } from '../utils/approvalChains';
// Re-exported so consumers (LeaveBalanceCard, leavePolicyService) can import the type from here.
export type { LeaveType } from '../types/user';
import { notifyLeaveEvent, notifyLeaveTierApproved, notifyLeaveRejectedByTier, notifyLeaveFullyApproved, notifyMasterAdmins, notifyLeaveSubmittedToTier } from './notificationService';

const COLLECTION_NAME = 'leaveRequests';
const leaveRef = collection(db, COLLECTION_NAME);

export const PAID_LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'];
export const isLeaveTypePaid = (type: LeaveType): boolean => PAID_LEAVE_TYPES.includes(type);

export const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

/**
 * Leave types whose remaining balance is encashable at year-end ($ amount is
 * computed in the December payroll as days × gross-per-working-day).
 * When a Leave Policy is assigned, its per-type encashable flags override this.
 */
export const ENCASHABLE_LEAVE_TYPES: LeaveType[] = ['Earned'];

/** Per-type paid/encashable overrides resolved from an employee's Leave Policy. */
export interface LeaveBalanceConfig {
  /** Types whose remaining balance is encashable at year-end. */
  encashable: LeaveType[];
  /** Types treated as paid leave (affects encashment eligibility only). */
  paid: LeaveType[];
}

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

export const DEFAULT_LEAVE_ALLOWANCES: Record<string, number> = {
  Casual: 12,
  Sick: 12,
  Earned: 15,
  Unpaid: 0,
  Maternity: 180,
  Paternity: 5,
};

export interface EmployeeMonthlyEntitlements {
  /** Monthly entitlement per leave type (only types set to > 0). */
  monthly: Record<string, number>;
  /** Yearly entitlement per type = Monthly × 12. */
  yearly: Record<string, number>;
  config: LeaveBalanceConfig;
}

/**
 * Resolve per-employee monthly leave entitlements (Employee Create → Leave
 * Entitlements). Yearly = Monthly × 12 — no company defaults and no hardcoded
 * values are applied here. Returns null when the employee document carries no
 * monthly entitlements (legacy employee), so callers fall back to their policy.
 */
export const resolveEmployeeLeaveEntitlements = (
  employee?: { monthlyLeaveEntitlements?: Record<string, number> } | null
): EmployeeMonthlyEntitlements | null => {
  const monthlyRaw = employee?.monthlyLeaveEntitlements;
  if (!monthlyRaw || typeof monthlyRaw !== 'object') return null;
  const cleaned: Record<string, number> = {};
  for (const t of LEAVE_TYPES) {
    const v = Number(monthlyRaw[t]);
    if (!isNaN(v) && v > 0) cleaned[t] = Math.round(v * 100) / 100;
  }
  if (Object.keys(cleaned).length === 0) return null;
  const yearly: Record<string, number> = {};
  for (const t of LEAVE_TYPES) {
    yearly[t] = Math.round((cleaned[t] || 0) * 12 * 100) / 100;
  }
  const encashable: LeaveType[] = Number(cleaned.Earned || 0) > 0 ? ['Earned'] : [];
  return { monthly: cleaned, yearly, config: { encashable, paid: PAID_LEAVE_TYPES } };
};

const asDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.toDate) return v.toDate();
  if (typeof v === 'string') return new Date(v);
  return null;
};

/**
 * Prorate an annual leave allowance by joining date.
 * The guide treats the join month as 1 month's entitlement — months remaining
 * in the year (join month onward) ÷ 12. Joined in a previous year ⇒ full.
 */
export const prorateAnnualAllowance = (
  annual: number,
  joinDate?: string | Date | null,
  year: number = new Date().getFullYear()
): number => {
  if (!annual || annual <= 0) return 0;
  const join = asDate(joinDate);
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
 * Returns entries for every leave type.
 */
export const computeLeaveBalance = (
  allowances: Record<string, number> | undefined,
  leaves: LeaveRequest[],
  userId: string,
  year: number = new Date().getFullYear(),
  joinDate?: string | Date | null,
  config?: LeaveBalanceConfig,
  skipJoinProration?: boolean
): Record<LeaveType, LeaveBalanceEntry> => {
  const encashable = config?.encashable || ENCASHABLE_LEAVE_TYPES;
  const paid = config?.paid || PAID_LEAVE_TYPES;
  const configByType: Record<string, number> = { ...(allowances || {}) };
  const used: Record<string, number> = {};
  const pending: Record<string, number> = {};
  LEAVE_TYPES.forEach(t => { used[t] = 0; pending[t] = 0; });

  for (const l of leaves) {
    if (l.userId !== userId) continue;
    const start = new Date(l.startDate);
    if (isNaN(start.getTime()) || start.getFullYear() !== year) continue;
    const type = l.leaveType as LeaveType;
    if (!(type in used)) continue;
    if (l.status === 'Approved') {
      used[type] += l.totalDays || calcLeaveDays(start, new Date(l.endDate)) || 0;
    } else if (l.status === 'Pending') {
      pending[type] += l.totalDays || calcLeaveDays(start, new Date(l.endDate)) || 0;
    }
  }

  const result = {} as Record<LeaveType, LeaveBalanceEntry>;
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
      encashable: encashable.includes(t as LeaveType),
      paid: paid.includes(t as LeaveType),
    };
  });
  return result;
};

/**
 * Encashable remaining days at year-end = unused balance of encashable types
 * (per the applied Leave Policy, defaulting to Earned only), floored so payroll
 * never pays fractional days.
 */
export const computeLeaveEncashmentDays = (
  allowances: Record<string, number> | undefined,
  leaves: LeaveRequest[],
  userId: string,
  year: number = new Date().getFullYear(),
  joinDate?: string | Date | null,
  config?: LeaveBalanceConfig
): number => {
  const bal = computeLeaveBalance(allowances, leaves, userId, year, joinDate, config);
  const encashable = config?.encashable || ENCASHABLE_LEAVE_TYPES;
  return encashable.reduce(
    (sum, t) => sum + Math.floor(Math.max(0, bal[t]?.available || 0)),
    0
  );
};

export const calcLeaveDays = (start: Date, end: Date): number => {
  const s = new Date(start);
  const e = new Date(end);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 0;
};

// ── 4-tier approval helpers ──

export const TIER_LABELS: Record<ApprovalTier, string> = {
  reportingManager: 'Reporting Manager',
  hr: 'HR',
  companyAdmin: 'Company Admin',
  teamLeader: 'Team Leader',
  executive: 'Executive',
};

// Strict sequential approval chain (same company context):
//   Tier 1: Reporting Manager
//   Tier 2: HR
//   Tier 3: Company Admin
//   Tier 4: Executive (assigned to the company portfolio)
//   Tier 5: Team Leader (managing that executive)
// Which tiers are LIVE for a request depends on the applicant's role (see
// getEffectiveTiers) — the rest are Approved/Skipped. TIER_ORDER drives gating
// (areAllPreviousTiersApproved), the next-pending tier, status computation and
// the displayed sequence — single source of truth, matching backend TIER_ORDER.
export const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];

const INITIAL_APPROVAL_STATUS: Record<ApprovalTier, ApprovalLevel> = {
  reportingManager: 'Pending',
  hr: 'Pending',
  companyAdmin: 'Pending',
  teamLeader: 'Pending',
  executive: 'Pending',
};

/** A tier that needs no further decision: approved, or skipped for this role. */
const tierSettled = (level?: ApprovalLevel | string): boolean =>
  level === 'Approved' || level === 'Skipped';

export const computeLeaveStatus = (approvalStatus: Record<ApprovalTier, ApprovalLevel>): LeaveStatus => {
  for (const tier of TIER_ORDER) {
    if (approvalStatus[tier] === 'Rejected') return 'Rejected';
  }
  const allApproved = TIER_ORDER.every(t => tierSettled(approvalStatus[t]));
  if (allApproved) return 'Approved';
  return 'Pending';
};

/**
 * Derive the individual per-tier boolean approval flags from the
 * `approvalStatus` map. These flags are stored flat on the leave document
 * (reportingManagerApproved / companyAdminApproved / executiveApproved /
 * teamLeaderApproved) under the exact names specified in the requirement.
 */
export const computeApprovalFlags = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>
): ApprovalFlags => ({
  reportingManagerApproved: approvalStatus.reportingManager === 'Approved',
  hrApproved: approvalStatus.hr === 'Approved',
  companyAdminApproved: approvalStatus.companyAdmin === 'Approved',
  executiveApproved: approvalStatus.executive === 'Approved',
  teamLeaderApproved: approvalStatus.teamLeader === 'Approved',
});

export const getNextPendingTier = (approvalStatus: Record<ApprovalTier, ApprovalLevel>): ApprovalTier | null => {
  for (const tier of TIER_ORDER) {
    if (approvalStatus[tier] === 'Pending') return tier;
  }
  return null;
};

/**
 * The leave-approval tier (if any) that currently awaits THIS user's
 * decision: the next Pending tier for which the user is the stamped approver.
 * Exactly matches the Leave Approvals Panel queue so dashboard counters equal
 * the actionable rows awaiting the user's verification.
 *
 * Legacy requests created before approverIds were resolved may carry an empty
 * map. In that case the natural role holder of the pending tier retains the
 * action (mirroring the Leave Management table's fallback), but only when the
 * request's company falls inside `scopeCompanyIds` (the active top-nav scope).
 */
export const getActionableLeaveTier = (
  l: { companyId?: string; approvalStatus?: Record<ApprovalTier, ApprovalLevel>; approverIds?: Partial<Record<ApprovalTier, string>> },
  uid: string,
  role?: string,
  scopeCompanyIds?: string[],
): ApprovalTier | null => {
  const nextTier = getNextPendingTier(l.approvalStatus || ({} as Record<ApprovalTier, ApprovalLevel>));
  if (!nextTier) return null;
  const approverId = l.approverIds?.[nextTier];
  if (approverId === uid) return nextTier;
  if (approverId) return null;
  const inScope = !scopeCompanyIds || scopeCompanyIds.length === 0 || scopeCompanyIds.includes(l.companyId || '');
  if (role === 'reporting-manager' && nextTier === 'reportingManager' && inScope) return nextTier;
  if (role === 'hr' && nextTier === 'hr' && inScope) return nextTier;
  if (role === 'hr-manager' && nextTier === 'hr' && inScope) return nextTier;
  if (role === 'company-admin' && nextTier === 'companyAdmin' && inScope) return nextTier;
  if (role === 'executive' && nextTier === 'executive' && inScope) return nextTier;
  if (role === 'team-leader' && nextTier === 'teamLeader' && inScope) return nextTier;
  return null;
};

/**
 * Number of leave-approval tiers that have been resolved (Approved or
 * Rejected). Drives the stored `approvalCount` progress counter (0..4).
 */
export const computeApprovalCount = (approvalStatus: Record<ApprovalTier, ApprovalLevel>): number =>
  TIER_ORDER.filter(t => approvalStatus[t] === 'Approved' || approvalStatus[t] === 'Rejected').length;

// ============================================
// MASTER ADMIN FINAL-VERIFICATION (TL / EXEC self-applications)
// ============================================

/** Roles whose personal leave/attendance submissions route to the Master Admin
 *  for top-tier oversight (the final gate after the 4-tier chain). */
const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

/**
 * Resolve the applicant's role (team-leader / executive / etc.) from their
 * user document. Used to decide whether Master Admin oversight applies.
 */
export const resolveApplicantRole = async (userId: string): Promise<string> => {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) {
      const u = snap.data();
      return String(u.role || 'employee');
    }
  } catch {}
  try {
    const q = query(collection(db, 'employees'), where('userId', '==', userId));
    const s = await getDocs(q);
    if (!s.empty) {
      const e = s.docs[0].data();
      if (e.isTeamLeader === true) return 'team-leader';
      if (e.isExecutive === true) return 'executive';
      if (e.isReportingManager === true) return 'reporting-manager';
    }
  } catch {}
  return 'employee';
};

/**
 * Resolve the first Master Admin (platform-wide top-tier account) as the
 * final verifier for TL/Exec self-applications.
 */
export const resolveMasterAdminApproverId = async (): Promise<string> => {
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const s = await getDocs(q);
    if (!s.empty) return s.docs[0].id;
  } catch {}
  return '';
};

/**
 * Resolve the role of the user identified by a Firestore users-doc id.
 * Used to authorise Master Admin final reviews by role (any master-admin),
 * rather than trusting the stale assigned-id stamp on older documents.
 */
export const getReviewerRole = async (uid: string): Promise<string | null> => {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (!s.exists()) return null;
    return s.data().role || null;
  } catch {
    return null;
  }
};

/**
 * Find the Team Leader who manages a specific Executive. Looks up TLs whose
 * `linkedExecutiveIds` includes the executive's userId, falling back to any TL
 * assigned to the company.
 */
export const findManagingTeamLeaderForExec = async (execUserId: string, companyId: string): Promise<string> => {
  try {
    const tlQuery = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const tlSnap = await getDocs(tlQuery);
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

/**
 * Returns the effective approval tiers for a given applicant role — the tiers
 * that actually have to decide for THIS requester (all other tiers are
 * Approved/Skipped server-side):
 * - Employee:             Reporting Manager -> HR -> Company Admin -> Executive -> Team Leader
 * - Reporting Manager:    HR -> Company Admin -> Executive -> Team Leader
 * - HR:                   Company Admin -> Executive -> Team Leader
 * - Executive self-app:   Team Leader -> Master Admin gate
 * - Team Leader self-app: Master Admin gate only
 */
export const getEffectiveTiers = (applicantRole?: string, chains?: ApprovalChainConfig | null): ApprovalTier[] => {
  // hr-manager is a legacy alias for the HR role — same chain (company config included).
  const role = applicantRole === 'hr-manager' ? 'hr' : applicantRole;
  if (role && REQUESTER_ROLES.includes(role as RequesterRole)) {
    // Company-configured stages (falls back to the shipped per-role default).
    return resolveApprovalChain(role, chains);
  }
  // Unknown / legacy role — show the full chain rather than an empty one.
  return [...TIER_ORDER];
};

/**
 * Tiers that still have to decide: the applicant's effective tiers minus the
 * ones the company SKIPPED (no approver assigned).
 *
 * Counting skipped tiers in an "x/y" progress left the counter permanently
 * stuck — e.g. an employee request where only a reporting manager and a
 * company admin exist showed 2/4 forever, even after the request reached
 * Approved. Denominator = live tiers (+ the Master Admin gate when present).
 */
export const getLiveTiers = (leave: {
  applicantRole?: string;
  approvalStatus?: Partial<Record<string, string>> | Record<string, unknown> | null;
}): ApprovalTier[] => {
  const status = (leave.approvalStatus ?? {}) as Record<string, unknown>;
  return getEffectiveTiers(leave.applicantRole).filter((t) => {
    const v = String(status[t] ?? '');
    // Skipped tiers never decide; tiers written before a tier existed (legacy
    // rows with no `hr` key at all) must not inflate the denominator either.
    return v !== 'Skipped' && v !== '' && v !== 'undefined';
  });
};

/**
 * True when this applicant's role routes the request through the Master Admin
 * final-verification gate after the tier chain (TL & Exec self-apps).
 * Single source of truth for the apply-form tiers preview.
 */
export const requiresMasterAdminGate = (applicantRole?: string): boolean =>
  MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole || '');

/**
 * True when the TLS/Exec self-application still needs a Master Admin decision
 * (i.e. all 4 lower tiers are Approved but the Master Admin hasn't ruled yet).
 */
export const isAwaitingMasterAdmin = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): boolean => {
  if (!masterAdminRequired) return false;
  if (masterAdminApproveStatus === 'Approved' || masterAdminApproveStatus === 'Rejected') return false;
  return TIER_ORDER.every(t => tierSettled(approvalStatus[t]));
};

/**
 * Compute the final overall status with the Master Admin gate applied. Without
 * a required Master Admin step this exactly matches `computeLeaveStatus` (the
 * strict 4-tier model). With one, the request stays Pending until the Master
 * Admin approves (final gate), and rejects on either a tier or MA rejection.
 */
export const computeOverallLeaveStatus = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): LeaveStatus => {
  for (const tier of TIER_ORDER) {
    if (approvalStatus[tier] === 'Rejected') return 'Rejected';
  }
  if (masterAdminRequired && masterAdminApproveStatus === 'Rejected') return 'Rejected';
  const allTiersApproved = TIER_ORDER.every(t => tierSettled(approvalStatus[t]));
  if (!allTiersApproved) return 'Pending';
  if (masterAdminRequired) {
    return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
  }
  return 'Approved';
};

const areAllPreviousTiersApproved = (approvalStatus: Record<ApprovalTier, ApprovalLevel>, targetTier: ApprovalTier): boolean => {
  const targetIndex = TIER_ORDER.indexOf(targetTier);
  if (targetIndex <= 0) return true;
  for (let i = 0; i < targetIndex; i++) {
    const level = approvalStatus[TIER_ORDER[i]];
    // Skipped tiers (not part of this requester's chain) block nobody.
    if (level !== 'Approved' && level !== 'Skipped') return false;
  }
  return true;
};

// Resolve approver IDs for every tier in the chain
const resolveApproverIds = async (companyId: string, employeeUserId: string): Promise<Record<ApprovalTier, string>> => {
  const ids: Record<ApprovalTier, string> = { reportingManager: '', hr: '', companyAdmin: '', teamLeader: '', executive: '' };

  // 1. Reporting Manager: from employee doc
  // NOTE: reportingManagerId here is the manager's employee-document-id. It is
  // stored as-is because the client cannot read another employee's document
  // (permission denied). The backend onLeaveRequestCreated trigger later
  // resolves the employee-document-id to the manager's auth uid and writes the
  // corrected approverIds.reportingManager, which the RM dashboard card queries.
  const empQuery = query(collection(db, 'employees'), where('userId', '==', employeeUserId));
  const empSnap = await getDocs(empQuery);
  if (!empSnap.empty) {
    const empData = empSnap.docs[0].data();
    if (empData.reportingManagerId) {
      ids.reportingManager = empData.reportingManagerId;
    }
  }

  // 2. Company Admin
  const adminQuery = query(collection(db, 'users'), where('role', '==', 'company-admin'), where('companyId', '==', companyId));
  const adminSnap = await getDocs(adminQuery);
  if (!adminSnap.empty) {
    ids.companyAdmin = adminSnap.docs[0].id;
  }

  // 2b. HR — the tier between the reporting manager and the company admin.
  // The server re-resolves this on create (single source of truth), but the
  // client stamps it too so the first notification reaches the right queue.
  try {
    const hrQuery = query(collection(db, 'users'), where('role', '==', 'hr'), where('companyId', '==', companyId));
    const hrSnap = await getDocs(hrQuery);
    if (!hrSnap.empty) ids.hr = hrSnap.docs[0].id;
  } catch { /* users read unavailable — server resolves it anyway */ }

  // 3. Team Leader — find TL linked to this company through exec assignments
  const tlQuery = query(collection(db, 'users'), where('role', '==', 'team-leader'));
  const tlSnap = await getDocs(tlQuery);
  for (const d of tlSnap.docs) {
    const data = d.data();
    if (data.assignedCompanyIds?.includes(companyId)) {
      ids.teamLeader = d.id;
      break;
    }
  }
  // Authoritative Team Leader for leave, mirroring the missed-punch chain: the
  // assigned TL is the one linked to this company's Executive(s), not an
  // arbitrary "first TL in the database". Without this a leave request stamped
  // at submission time could land in the wrong Team Leader's pending queue and
  // the chain would stall on the *assigned* TL tier.
  if (!ids.teamLeader) {
    const execQuery = query(collection(db, 'users'), where('role', '==', 'executive'));
    const execSnap = await getDocs(execQuery);
    for (const d of execSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(companyId)) {
        const tlLinked = d.data().assignedTeamLeaderIds?.[0];
        if (tlLinked) { ids.teamLeader = tlLinked; break; }
      }
    }
  }

  // 4. Executive
  const execQuery = query(collection(db, 'users'), where('role', '==', 'executive'));
  const execSnap = await getDocs(execQuery);
  for (const d of execSnap.docs) {
    const data = d.data();
    if (data.assignedCompanyIds?.includes(companyId)) {
      ids.executive = d.id;
      break;
    }
  }

  return ids;
};

// ── Data mapping ──

const mapLeave = (d: any): LeaveRequest => {
  const data = d.data();
  return {
    id: d.id,
    userId: data.userId,
    employeeName: data.employeeName,
    employeeId: data.employeeId,
    employeeEmail: data.employeeEmail,
    avatar: data.avatar,
    department: data.department,
    departmentId: data.departmentId,
    companyId: data.companyId,
    // Server-stamped display name (list endpoint) — needed when the viewer
    // cannot read the other company's document (post-transfer scope).
    companyName: data.companyName,
    // `leaveType` is the model field, `type` the API field; legacy rows may
    // carry neither (older client) — the default matches the apply form.
    leaveType: data.leaveType ?? data.type ?? 'Casual',
    startDate: data.startDate?.toDate() || new Date(),
    endDate: data.endDate?.toDate() || new Date(),
    totalDays: data.totalDays || 0,
    reason: data.reason || '',
    status: data.status || 'Pending',
    isPaid: !!data.isPaid,
    appliedOn: data.appliedOn?.toDate() || new Date(),
    reviewedBy: data.reviewedBy,
    reviewedByName: data.reviewedByName,
    reviewedOn: data.reviewedOn?.toDate(),
    rejectedAt: data.rejectedAt?.toDate ? data.rejectedAt.toDate() : data.rejectedAt || undefined,
    reviewNote: data.reviewNote,
    approvalStatus: data.approvalStatus || { ...INITIAL_APPROVAL_STATUS },
    approvalLog: data.approvalLog || [],
    approverIds: data.approverIds || { reportingManager: '', companyAdmin: '', teamLeader: '', executive: '' },
    approvalCount: data.approvalCount ?? computeApprovalCount(data.approvalStatus || { ...INITIAL_APPROVAL_STATUS }),
    applicantRole: data.applicantRole,
    masterAdminRequired: !!data.masterAdminRequired,
    masterAdminApproveStatus: data.masterAdminApproveStatus,
    masterAdminApproverId: data.masterAdminApproverId,
    masterAdminApprovedBy: data.masterAdminApprovedBy,
    masterAdminApprovedByName: data.masterAdminApprovedByName,
    masterAdminApprovedOn: data.masterAdminApprovedOn?.toDate ? data.masterAdminApprovedOn.toDate() : data.masterAdminApprovedOn,
    masterAdminNote: data.masterAdminNote,
  };
};

// ── CRUD operations ──

export const getAllLeaveRequests = async (): Promise<LeaveRequest[]> => {
  const snapshot = await getDocs(leaveRef);
  return snapshot.docs.map(mapLeave);
};

export const getLeaveRequestsByCompany = async (companyId: string): Promise<LeaveRequest[]> => {
  const q = query(leaveRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapLeave);
};

export const getLeaveRequestsByDepartment = async (departmentId: string): Promise<LeaveRequest[]> => {
  const q = query(leaveRef, where('departmentId', '==', departmentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapLeave);
};

export const getLeaveRequestsByReportingManager = async (companyId: string, reportingManagerUserId: string): Promise<LeaveRequest[]> => {
  const q = query(
    leaveRef,
    where('companyId', '==', companyId),
    where('approverIds.reportingManager', '==', reportingManagerUserId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapLeave);
};

export const getLeaveRequestsByUser = async (userId: string): Promise<LeaveRequest[]> => {
  const q = query(leaveRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapLeave);
};

export const createLeaveRequest = async (
  leave: Omit<LeaveRequest, 'id' | 'appliedOn' | 'status' | 'approvalStatus' | 'approvalLog' | 'approverIds'>,
  tierOverrides?: Partial<Record<ApprovalTier, ApprovalLevel>>
): Promise<LeaveRequest> => {
  // Master Admin final-verification layer: Team Leaders & Executives are also
  // registered employees, so their personal leave routes DIRECTLY to the top-tier
  // Master Admin for oversight (approve/reject/modify) — single-step, no chain.
  const applicantRole = await resolveApplicantRole(leave.userId);
  const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
  const masterAdminApproverId = masterAdminRequired ? await resolveMasterAdminApproverId() : '';

  // For Executive self-apps, keep the managing TL recorded for reference (the
  // tier itself is auto-completed — only the Master Admin final gate applies).
  const approverIds = await resolveApproverIds(leave.companyId, leave.userId);
  if (applicantRole === 'executive') {
    const managingTL = await findManagingTeamLeaderForExec(leave.userId, leave.companyId);
    if (managingTL) approverIds.teamLeader = managingTL;
  }

  const approvalStatus: Record<ApprovalTier, ApprovalLevel> = { ...INITIAL_APPROVAL_STATUS };
  const liveTiers = getEffectiveTiers(applicantRole);
  for (const tier of TIER_ORDER) {
    // Auto-skip any tier whose approver is the applicant themselves, and
    // auto-skip the Reporting Manager tier when the applicant has no manager
    // above them (self-managed / top-of-chain, e.g. a Reporting Manager applying
    // for their own leave). Otherwise the chain would stall on an empty tier.
    const isSelfApprover = approverIds[tier] === leave.userId;
    const isUnassignedRmTier = tier === 'reportingManager' && !approverIds[tier];
    const isSelfReportingManager = tier === 'reportingManager' && applicantRole === 'reporting-manager';

    if (masterAdminRequired && applicantRole === 'executive') {
      // Executive: Executive → Team Leader → Master Admin. Keep only the
      // teamLeader tier live; every other tier is already decided.
      approvalStatus[tier] = tier === 'teamLeader' ? 'Pending' : 'Approved';
    } else if (masterAdminRequired) {
      // Team Leader self-app: every tier auto-completes — routes directly to
      // the Master Admin final gate (single-step).
      approvalStatus[tier] = 'Approved';
    } else if (isSelfApprover || isUnassignedRmTier || isSelfReportingManager) {
      // Skipped (NOT Approved): nobody decided anything, and counting it as an
      // approval would inflate the x/N progress above the live-tier denominator.
      approvalStatus[tier] = 'Skipped';
    } else if (!liveTiers.includes(tier)) {
      // Chain truncation per requester role (mirrors the server exactly):
      // employee -> RM/HR/CA, reporting manager -> HR/CA, HR -> CA. Tiers
      // below the last required approver never participate.
      approvalStatus[tier] = 'Skipped';
    }
  }

  // Apply tier overrides (e.g., manager bypasses reportingManager tier)
  if (tierOverrides) {
    for (const [tier, status] of Object.entries(tierOverrides)) {
      if (status && TIER_ORDER.includes(tier as ApprovalTier)) {
        approvalStatus[tier as ApprovalTier] = status;
      }
    }
  }

  const status = computeOverallLeaveStatus(approvalStatus, masterAdminRequired, 'Pending');

  const docRef = await addDoc(leaveRef, {
    ...leave,
    applicantRole,
    masterAdminRequired,
    masterAdminApproverId,
    ...(masterAdminRequired ? { masterAdminApproveStatus: 'Pending' } : {}),
    status,
    appliedOn: serverTimestamp(),
    approvalStatus,
    approvalLog: [],
    approverIds,
    approvalCount: computeApprovalCount(approvalStatus),
    ...computeApprovalFlags(approvalStatus),
  });

  // Notify the first pending approver about the new request.
  // Management self-apps (executive / team-leader) auto-complete every standard
  // tier, so nothing is fanned out here — the Master Admin is reached via the
  // server-side fan-out and realtime queue. For normal employees it's their
  // Reporting Manager.
  try {
    const firstPendingTier = getNextPendingTier(approvalStatus);
    if (firstPendingTier && approverIds[firstPendingTier]) {
      await notifyLeaveSubmittedToTier(approverIds[firstPendingTier], leave.employeeName, firstPendingTier, leave.companyId);
    }
  } catch {}

  return {
    ...leave,
    id: docRef.id,
    applicantRole,
    masterAdminRequired,
    masterAdminApproverId,
    ...(masterAdminRequired ? { masterAdminApproveStatus: 'Pending' } : {}),
    status,
    appliedOn: new Date(),
    approvalStatus,
    approvalLog: [],
    approverIds,
    approvalCount: computeApprovalCount(approvalStatus),
    ...computeApprovalFlags(approvalStatus),
  } as LeaveRequest;
};

// Backward-compatible single-step review
export const reviewLeaveRequest = async (
  id: string,
  status: Extract<LeaveStatus, 'Approved' | 'Rejected'>,
  reviewedBy: string,
  reviewedByName: string,
  reviewNote?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const docSnap = await getDoc(docRef);

  await updateDoc(docRef, {
    status,
    reviewedBy,
    reviewedByName,
    reviewNote: reviewNote || '',
    reviewedOn: serverTimestamp(),
  });

  if (docSnap.exists()) {
    const leaveData = docSnap.data();
    const notifType = status === 'Approved' ? 'approved' : 'rejected';
    await notifyLeaveEvent(
      leaveData.userId,
      reviewedByName,
      notifType as 'approved' | 'rejected',
      leaveData.companyId
    ).catch(() => {});
  }
};

// 4-tier sequential review
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
    (leaveData.masterAdminApproveStatus as 'Pending' | 'Approved' | 'Rejected' | undefined) || 'Pending',
  );

  await updateDoc(docRef, {
    approvalStatus: newApprovalStatus,
    approvalLog: newApprovalLog,
    status: overallStatus,
    reviewedBy,
    reviewedByName,
    reviewNote: reviewNote || '',
    reviewedOn: serverTimestamp(),
    approvalCount: computeApprovalCount(newApprovalStatus),
    ...(overallStatus === 'Rejected' ? { rejectedAt: serverTimestamp() } : {}),
    ...computeApprovalFlags(newApprovalStatus),
  });

  try {
    if (action === 'Rejected') {
      await notifyLeaveRejectedByTier(leaveData.userId, reviewedByName, tier, leaveData.companyId, reviewNote);
    } else {
      if (overallStatus === 'Approved') {
        await notifyLeaveFullyApproved(leaveData.userId, leaveData.companyId);
      } else if (isAwaitingMasterAdmin(newApprovalStatus, !!leaveData.masterAdminRequired, leaveData.masterAdminApproveStatus)) {
        // The active chain is complete — the request now awaits the Master Admin
        // final gate (Executive self-app: after the Team Leader's sign-off).
        await notifyMasterAdmins(
          leaveData.companyId,
          'leave_tier_approved',
          'Leave Awaiting Master Admin',
          `${leaveData.employeeName || leaveData.userName || 'An employee'}'s leave request has cleared ${TIER_LABELS[tier]} review and requires your final verification as Master Admin.`,
          '/leave'
        ).catch(() => {});
      } else {
        const nextTier = getNextPendingTier(newApprovalStatus);
        if (nextTier && leaveData.approverIds?.[nextTier]) {
          await notifyLeaveTierApproved(leaveData.approverIds[nextTier], reviewedByName, nextTier, leaveData.companyId);
        }
      }
    }
    await notifyMasterAdmins(
      leaveData.companyId,
      'leave_tier_approved',
      'Leave Reviewed',
      `${reviewedByName} (${tier}) ${action === 'Approved' ? 'approved' : 'rejected'} a leave request at the ${tier} level.`,
      '/leave'
    ).catch(() => {});
  } catch (e) {
    // Notification failures should not block the approval
  }
};

export const cancelLeaveRequest = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, { status: 'Cancelled' });
};

/**
 * Master Admin final-verification for a Team Leader / Executive's personal
 * leave. Requires every preceding 4-tier approval to be complete, a mandatory
 * remark, and routes the request to Approved / Rejected at the top-tier level.
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
  if (!leaveData.masterAdminRequired) throw new Error('This request does not require Master Admin verification.');
  const reviewerRole = await getReviewerRole(reviewedBy);
  if (reviewerRole !== 'master-admin') {
    throw new Error('Only a Master Admin can review this request.');
  }
  if (leaveData.masterAdminApproveStatus && leaveData.masterAdminApproveStatus !== 'Pending') {
    throw new Error(`Master Admin verification has already been ${leaveData.masterAdminApproveStatus}.`);
  }

  const currentApprovalStatus: Record<ApprovalTier, ApprovalLevel> = leaveData.approvalStatus || { ...INITIAL_APPROVAL_STATUS };
  // For Executive self-apps, only the Team Leader tier needs approval (others
  // are auto-skipped). For TL self-apps, all tiers are auto-skipped. Use the
  // effective tiers list to validate only the tiers that actually required action.
  const effectiveTiers = getEffectiveTiers(leaveData.applicantRole as string | undefined);
  if (effectiveTiers.length > 0 && !effectiveTiers.every(t => currentApprovalStatus[t] === 'Approved')) {
    throw new Error('The required approval tiers must be fully approved before Master Admin review.');
  }
  if (!reviewNote || !reviewNote.trim()) {
    throw new Error('A mandatory remark is required for Master Admin review.');
  }

  const overallStatus = computeOverallLeaveStatus(currentApprovalStatus, true, action);

  const newEntry = {
    tier: 'masterAdmin' as unknown as ApprovalTier,
    status: action,
    approvedBy: reviewedBy,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...(leaveData.approvalLog || []), newEntry];

  await updateDoc(docRef, {
    masterAdminApproveStatus: action,
    masterAdminApprovedBy: reviewedBy,
    masterAdminApprovedByName: reviewedByName,
    masterAdminApprovedOn: serverTimestamp(),
    masterAdminNote: reviewNote || '',
    approvalLog: newApprovalLog,
    status: overallStatus,
    reviewedBy,
    reviewedByName,
    reviewNote: reviewNote || '',
    reviewedOn: serverTimestamp(),
    ...(overallStatus === 'Rejected' ? { rejectedAt: serverTimestamp() } : {}),
  });

  try {
    if (action === 'Approved') {
      await notifyLeaveFullyApproved(leaveData.userId, leaveData.companyId);
    } else {
      await notifyLeaveRejectedByTier(leaveData.userId, reviewedByName, 'masterAdmin', leaveData.companyId, reviewNote);
    }
    await notifyMasterAdmins(
      leaveData.companyId,
      'leave_tier_approved',
      'Leave Reviewed',
      `${reviewedByName} (Master Admin) ${action === 'Approved' ? 'approved' : 'rejected'} a Team Leader / Executive leave request.`,
      '/leave'
    ).catch(() => {});
  } catch (e) {
    // Notification failures should not block the review
  }
};

export const deleteLeaveRequest = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Get approved paid-leave days for an employee in a given month (for payroll)
// Half-day leaves (totalDays = 0.5) count as 0.5 paid/unpaid days and are
// also returned in `halfDays` for the payslip attendance summary.
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
    .filter(l => l.userId === userId && l.status === 'Approved')
    .forEach(l => {
      const s = new Date(l.startDate);
      const e = new Date(l.endDate);
      const total = Number(l.totalDays) || 0;
      // Half-day leave (e.g. totalDays = 0.5 over a single date) is attributed
      // as 0.5 days to the month containing the start date, not a full day.
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

export const getLeaveStats = async (companyId?: string) => {
  if (!companyId) return { total: 0, pending: 0, approved: 0, rejected: 0 };
  const leaves = await getLeaveRequestsByCompany(companyId);
  return {
    total: leaves.length,
    pending: leaves.filter(l => l.status === 'Pending').length,
    approved: leaves.filter(l => l.status === 'Approved').length,
    rejected: leaves.filter(l => l.status === 'Rejected').length
  };
};
