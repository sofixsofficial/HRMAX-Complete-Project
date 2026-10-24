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
  companyAdmin: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  executive: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  teamLeader: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
}

export type LeaveTier = keyof LeaveTierStatus;

export const TIER_ORDER: LeaveTier[] = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];

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
