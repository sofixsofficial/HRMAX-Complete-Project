/**
 * HR MAX — AWS backend shared types
 * Mirrors the domain model of the original Firebase implementation.
 */

export type UserRole =
  | 'master-admin'
  | 'company-admin'
  | 'team-leader'
  | 'executive'
  | 'reporting-manager'
  /** HR — leave & attendance approvals, employee administration (company-scoped). */
  | 'hr'
  | 'employee'
  /**
   * Transient bootstrap role: a valid Cognito session whose users-table row
   * does not exist yet (signUpCompany writes company + user docs right after
   * sign-up). Grants nothing — every gate denies — it only lets the two
   * bootstrap routes run. Deliberately NOT in VALID_ROLES.
   */
  | 'unprovisioned';

export const VALID_ROLES: UserRole[] = [
  'master-admin',
  'company-admin',
  'team-leader',
  'executive',
  'reporting-manager',
  'hr',
  'employee',
];

/** Authenticated caller context resolved from the Cognito JWT + users table. */
export interface Caller {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  assignedCompanyIds: string[];
  linkedExecutiveIds: string[];
  reportingExecutiveId: string | null;
  isReportingManager: boolean;
  permissions: string[];
  permissionsConfigured: boolean;
  ip: string;
  userAgent: string;
}

/** Base shape every stored entity carries. */
export interface BaseEntity {
  id: string;
  companyId: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface UserDoc extends BaseEntity {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  departmentId?: string | null;
  avatar?: string;
  phone?: string;
  permissions: string[];
  permissionsConfigured?: boolean;
  assignedCompanyIds?: string[];
  linkedExecutiveIds?: string[];
  reportingExecutiveId?: string | null;
  reportingManagerId?: string | null;
  isReportingManager?: boolean;
  isActive?: boolean;
  status?: 'Active' | 'Pending' | 'Rejected' | 'Suspended';
  pushToken?: string | null;
  requirePasswordChange?: boolean;
  lastLoginAt?: string;
  dateOfJoining?: string;
  designation?: string;
}

export interface CompanyDoc extends BaseEntity {
  id: string;
  name: string;
  code: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Suspended' | 'Active';
  adminId?: string;
  email?: string;
  employees?: number;
  createdOn?: string;
}

export interface LeaveTierStatus {
  reportingManager: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  hr: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  companyAdmin: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  executive: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  teamLeader: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
}

export type LeaveTier = keyof LeaveTierStatus;

/**
 * Sequential approval order (single source of truth for leave AND missed-punch
 * rectification): reporting manager -> HR -> company admin -> executive ->
 * team leader. Which tiers are actually live for a request depends on the
 * applicant's role (see computeInitialApproval); tiers above are either
 * Approved (auto) or Skipped, never silently reordered.
 */
export const TIER_ORDER: LeaveTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];

/**
 * Configurable approval chains (company policy).
 *
 * The product's DEFAULT chain is per-requester-role (employee → RM → HR → CA
 * → Exec → TL, RM → HR → CA → Exec → TL, HR → CA → Exec → TL, exec → TL →
 * MA gate, TL → MA gate). A company may
 * override WHICH approver stages are active for each of its roles via
 * `company.approvalChains`; the stages always execute in TIER_ORDER (the
 * canonical sequential order), so a config is a per-role set of live tiers.
 *
 * Company Admin and Master Admin are intentionally absent: they have no
 * personal leave/attendance (the create routes 403 them), so there is nothing
 * to configure. Safety rules (unassigned-tier skip, self-approver skip) always
 * apply on top of any configuration.
 */
export type RequesterRole = 'employee' | 'reporting-manager' | 'hr' | 'executive' | 'team-leader';

export const REQUESTER_ROLES: RequesterRole[] = ['employee', 'reporting-manager', 'hr', 'executive', 'team-leader'];

/** Per-requester-role override of the live approver stages. */
export type ApprovalChainConfig = Partial<Record<RequesterRole, LeaveTier[]>>;

/**
 * The shipped defaults — the full multi-tier matrix (per the approval spec):
 *   employee          -> RM -> HR -> CA -> Executive -> Team Leader   (5 tiers)
 *   reporting-manager -> HR -> CA -> Executive -> Team Leader         (4 tiers)
 *   HR                -> CA -> Executive -> Team Leader               (3 tiers)
 *   executive         -> Team Leader -> master-admin gate             (2 tiers)
 *   team-leader       -> master-admin gate                            (1 tier)
 * Executives and Team Leaders are system-level (Master Admin created), so
 * every company chain climbs to them; only the two self-service roles end
 * with the explicit master-admin gate.
 */
export const DEFAULT_APPROVAL_CHAINS: Record<RequesterRole, LeaveTier[]> = {
  employee: ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'],
  'reporting-manager': ['hr', 'companyAdmin', 'executive', 'teamLeader'],
  hr: ['companyAdmin', 'executive', 'teamLeader'],
  executive: ['teamLeader'],
  'team-leader': [],
};

/**
 * Resolve the live, ordered tier list for a requester role: the company's
 * configured stages when present (sanitised + canonically ordered), otherwise
 * the default chain. Roles outside REQUESTER_ROLES (company-admin /
 * master-admin) always resolve to [] because they cannot file leave.
 */
export function resolveApprovalChain(role: UserRole, configured?: ApprovalChainConfig | null): LeaveTier[] {
  const key = role as RequesterRole;
  if (!REQUESTER_ROLES.includes(key)) return [];
  const raw = configured?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_APPROVAL_CHAINS[key]];
  const valid = raw.filter((t): t is LeaveTier => TIER_ORDER.includes(t));
  // De-dupe and force canonical execution order regardless of how the config
  // was authored, so the sequential approve-next guard stays correct.
  return TIER_ORDER.filter((t) => valid.includes(t));
}

export interface LeaveRequestDoc extends BaseEntity {
  id: string;
  companyId: string;
  userId: string;
  employeeName?: string;
  type: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvalStatus: LeaveTierStatus;
  approverIds: Partial<Record<LeaveTier, string | null>>;
  applicantRole?: UserRole;
  masterAdminRequired?: boolean;
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected';
  masterAdminApproverId?: string | null;
  approvalCount?: number;
  appliedOn?: string;
  departmentId?: string | null;
  notifiedFinalStatus?: boolean;
  /** Display name of `companyId`, stamped at read time so scoped viewers
   *  (e.g. a transferred employee who cannot read the other company's doc)
   *  never see a raw company id in the UI. */
  companyName?: string;
}

export type AttendanceStatus =
  | 'Present'
  | 'Late'
  | 'Absent'
  | 'On Leave'
  | 'Miss Punch'
  | 'Early Checkout'
  | 'Approved'
  | 'Half Day';

export interface AttendanceDoc extends BaseEntity {
  id: string;
  companyId: string;
  userId: string;
  employeeName?: string;
  date: string; // YYYY-MM-DD
  /** Branch the punch was made at (when the company uses branches). */
  branchId?: string;
  branchName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status: AttendanceStatus;
  workHours?: number;
  overtimeHours?: number;
  lateMinutes?: number;
  isAutoApproved?: boolean;
  approved?: boolean;
  approvedByName?: string;
  missedPunchNotified?: boolean;
  missedPunchRectification?: {
    requested?: boolean;
    requestedAt?: string;
    correctedCheckOut?: string | null;
    resolved?: boolean;
    resolution?: string;
    kind?: 'checkin' | 'checkout';
    currentTier?: LeaveTier | 'masterAdmin';
    masterAdminRequired?: boolean;
    masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected';
    approvalStatus?: LeaveTierStatus;
    approverIds?: Partial<Record<LeaveTier, string | null>>;
    resolvedAt?: string;
    resolvedByName?: string;
    masterAdminApprovedOn?: string;
  };
}

export interface NotificationDoc extends BaseEntity {
  id: string;
  userId: string;
  type: string;
  title: string;
  message?: string;
  body?: string;
  link?: string;
  read: boolean;
  priority?: 'low' | 'normal' | 'high';
  createdAt?: string;
}

export type ApiErrorCode =
  | 'bad-request'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'internal';

/** Application-level error carrying an HTTP status + stable code, mirroring Firebase HttpsError. */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public httpStatus = ApiError.defaultStatus(code),
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static defaultStatus(code: ApiErrorCode): number {
    switch (code) {
      case 'bad-request': return 400;
      case 'unauthenticated': return 401;
      case 'permission-denied': return 403;
      case 'not-found': return 404;
      case 'already-exists': return 409;
      case 'failed-precondition': return 412;
      case 'resource-exhausted': return 429;
      default: return 500;
    }
  }
}

/** Default permission catalog (dot-notation), aligned with the original 53-permission catalog. */
export const FULL_PERMISSIONS: string[] = [
  'employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.approve', 'employees.manage',
  'departments.view', 'departments.create', 'departments.edit', 'departments.delete', 'departments.approve', 'departments.manage',
  'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.delete', 'attendance.approve', 'attendance.reject', 'attendance.manage',
  'leave.view', 'leave.apply', 'leave.create', 'leave.approve', 'leave.reject', 'leave.cancel', 'leave.manage',
  'payroll.view', 'payroll.edit', 'payroll.delete', 'payroll.approve', 'payroll.calculate', 'payroll.disburse', 'payroll.manage',
  'salary.view', 'salary.edit', 'salary.create', 'salary.delete', 'salary.approve', 'salary.export', 'salary.manage',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.approve', 'tasks.manage',
  'support.view', 'support.create', 'support.edit', 'support.delete', 'support.approve', 'support.manage',
  'holidays.view', 'holidays.create', 'holidays.edit', 'holidays.delete', 'holidays.approve', 'holidays.export', 'holidays.manage',
  'announcements.view', 'announcements.create', 'announcements.edit', 'announcements.delete', 'announcements.approve', 'announcements.manage',
  'reports.view', 'reports.create', 'reports.edit', 'reports.delete', 'reports.export', 'reports.download', 'reports.manage',
  'settings.view', 'settings.edit', 'settings.create', 'settings.delete', 'settings.approve', 'settings.manage',
  'companies.view', 'companies.create', 'companies.edit', 'companies.delete', 'companies.approve', 'companies.manage',
  // Executives pages gate on executives.* (previously virtual — grantable only
  // via the '*' wildcard roles, never toggeable in the role manager).
  'executives.view', 'executives.create', 'executives.edit', 'executives.delete', 'executives.approve', 'executives.manage',
  'assets.view', 'assets.create', 'assets.edit', 'assets.delete', 'assets.approve', 'assets.manage',
];

export const REPORTING_MANAGER_PERMISSIONS: string[] = [
  'leave.view', 'leave.apply', 'leave.create', 'leave.manage', 'leave.approve',
  'employees.view',
  'attendance.view', 'attendance.edit', 'attendance.approve',
  'departments.view',
  'reports.view',
  'company.view', 'companies.view',
  // RM views their OWN salary slip + their assigned employees' slips/tasks
  // (client scopes rows to self + team; without these the pages returned
  // "Access denied" / "Failed to load" straight from assertPermission).
  'payroll.view',
  'tasks.view', 'tasks.create', 'tasks.edit',
];

/**
 * HR — company-scoped people & time administration: can see the whole
 * workforce, run leave/attendance approvals and manage employee records,
 * but never payroll config or platform settings.
 */
export const HR_PERMISSIONS: string[] = [
  'employees.view', 'employees.create', 'employees.edit', 'employees.export',
  'departments.view',
  'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.approve', 'attendance.manage',
  'leave.view', 'leave.create', 'leave.approve', 'leave.manage',
  'holidays.view', 'announcements.view',
  'tasks.view', 'tasks.create', 'tasks.edit',
  // HR reviews company salary slips (own company only — the page scopes rows
  // to their companyId; without this the sidebar's Salary Slips entry 403'd).
  'payroll.view',
  'reports.view', 'reports.export',
  'company.view', 'companies.view',
  'dashboard.view',
];

export const EMPLOYEE_PERMISSIONS: string[] = [
  'employees.view',
  'departments.view',
  'attendance.view', 'attendance.create',
  'payroll.view',
  'leave.view', 'leave.apply', 'leave.create',
  'company.view', 'companies.view',
  'tasks.view',
  'settings.view',
  // Read-only company holiday calendar. Employees need this to render the
  // dashboard hero's HOLIDAY character mode (and the Holidays page) from the
  // real calendar rather than inferring a holiday from the weekday.
  'holidays.view',
];

/** Role → default permission set (applied when permissionsConfigured is false). */
export function defaultPermissionsForRole(role: UserRole): string[] {
  switch (role) {
    case 'master-admin':
    case 'team-leader':
    case 'executive':
    case 'company-admin':
      return ['*'];
    case 'reporting-manager':
      return REPORTING_MANAGER_PERMISSIONS;
    case 'hr':
      return HR_PERMISSIONS;
    case 'employee':
      return EMPLOYEE_PERMISSIONS;
    default:
      return [];
  }
}

/** Company-admin is view-only for operational modules (parity with original AuthContext). */
export const COMPANY_ADMIN_VIEW_ONLY_MODULES = ['employees', 'departments', 'payroll', 'salary', 'attendance', 'tasks', 'support', 'holidays', 'announcements', 'reports', 'settings', 'companies', 'assets'];

export function isoNow(): string {
  return new Date().toISOString();
}

export function newId(): string {
  // Firestore-style 20-char random id
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 20; i++) out += chars[buf[i] % chars.length];
  return out;
}
