export type CompanyAdminStatus = 'Pending' | 'Approved' | 'Rejected' | 'Suspended'

export type UserRole = 'master-admin' | 'company-admin' | 'team-leader' | 'executive' | 'reporting-manager' | 'employee'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  companyId: string | null
  departmentId: string | null
  department?: string | null
  avatar: string
  permissions: string[]
  /**
   * Per-module data-visibility scope overrides for team-leaders/executives
   * ('all' default, 'assigned' = only companies the user belongs to).
   * See permissionConfig.ts scopeOrDefault().
   */
  permissionScopes?: Record<string, 'all' | 'assigned'>
  /**
   * True once the master admin saves the core CRUD matrix for a
   * team-leader/executive via Access Management. Absent = role default
   * (full CRUD on the core modules) via isCoreCrudGranted().
   */
  permissionsConfigured?: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  // Executive fields
  assignedCompanyIds?: string[]
  // Team Leader fields
  contingencyAccess?: boolean
  reportingExecutiveId?: string | null
  reportingExecutiveName?: string | null
  linkedExecutiveIds?: string[]
  phone?: string
  // Company Admin approval fields
  status?: CompanyAdminStatus
  isApproved?: boolean
  approvedBy?: string | null
  approvedAt?: Date | null
  rejectionReason?: string | null
  suspendedAt?: Date | null
  requirePasswordChange?: boolean
  // Parent company tagging (set at account creation)
  parentCompanyId?: string
  parentCompanyName?: string
}

export interface Company {
  id: string
  name: string
  domain: string
  code: string
  adminId: string
  adminName: string
  adminEmail: string
  adminAvatar: string
  employees: number
  status: 'Active' | 'Inactive'
  operationalMode?: 'Continuous' | 'Discontinuous'
  createdOn: Date
  logoColor: string
  address?: string
  phone?: string
  website?: string
  description?: string
  country?: string
  state?: string
  city?: string
  zipCode?: string
  timezone?: string
  currency?: string
  dateFormat?: string
  language?: string
  adminPhone?: string
  employeeLimit?: number
  logoUrl?: string
  averageSalary?: number
  mandatoryAttendanceDays?: number
  parentCompanyId?: string
  parentCompanyName?: string
  attendanceSettings?: CompanyAttendanceSettings
  payrollSettings?: CompanyPayrollSettings
  /** Profile page display preferences (working days/hours, time zone, currency) */
  settings?: {
    workingDays: string
    workHours: string
    timeZone: string
    currency: string
  }
  /** Annual leave allowance (in days) per leave type, e.g. { Casual: 12, Sick: 6, Earned: 15 } */
  leaveAllowances?: Record<string, number>
  createdBy?: string
  createdByName?: string
  createdByRole?: string
}

export interface CompanyAttendanceSettings {
  officeAddress: string
  latitude: number
  longitude: number
  radiusInMeters: number
  allowMobileData: boolean
  requireWifi: boolean
  wifiSSID: string
  requireSelfie: boolean
}

export interface CompanyPayrollSettings {
  salaryCycle: 'Monthly' | 'Bi-weekly'
  workingDaysPerMonth: number
  weekends: string[]
  overtimeRatePerHour: number
}

/** Per leave-type configuration inside a Leave Policy. */
export interface LeaveTypePolicy {
  /** Yearly entitlement in days (0 = not offered). */
  days: number
  /** Paid leave (true) vs unpaid (false). */
  paid: boolean
  /** Remaining days of this type may be encashed at year-end (enter as ₹). */
  encashable: boolean
}

/** Named leave policy owned by a company; employees are assigned one at create time. */
export interface LeavePolicy {
  id: string
  companyId: string
  name: string
  description?: string
  /** The default policy applied when an employee is created without an explicit assignment. */
  isDefault?: boolean
  /** Per-type configuration: keyed by leave type (Casual/Sick/Earned/Unpaid/Maternity/Paternity). */
  types: Record<string, LeaveTypePolicy>
  createdBy?: string
  createdByName?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface Employee {
  id: string
  slug: string
  userId: string
  name: string
  email: string
  avatar: string
  employeeId: string
  username?: string
  password?: string
  department: string
  departmentId: string
  departmentColor: string
  designation: string
  phone: string
  status: 'Active' | 'Inactive' | 'On Leave'
  joinDate: Date
  companyId: string
  salary?: number
  monthlyGrossSalary?: number
  salaryEffectiveDate?: string | Date
  salaryStructureId?: string
  employmentType: 'Full-time' | 'Part-time' | 'Contract' | 'Intern'
  address?: string
  emergencyContact?: string
  birthDate?: string | Date
  shiftId?: string
  shiftStart?: string
  shiftEnd?: string
  shiftType?: 'Morning' | 'Afternoon' | 'Night' | 'Custom'
  reportingManagerId?: string
  reportingManagerName?: string
  isReportingManager?: boolean
  role?: string
  /** Leave Policy assigned at employee create time (company-level named policy). */
  leavePolicyId?: string
  /** Per-employee monthly leave entitlements (Employee Create → Leave Entitlements). Yearly = Monthly × 12. */
  monthlyLeaveEntitlements?: Record<string, number>
  /** Year the monthlyLeaveEntitlements were defined for. */
  leaveEntitlementYear?: number
  salaryCycle?: 'Monthly' | 'Bi-weekly'
  workingDaysPerMonth?: number
  overtimeRatePerHour?: number
  weekendDays?: number[]
  createdBy?: string
  createdByName?: string
  createdByRole?: string
}

export interface AttendanceRecord {
  id: string
  userId: string
  name: string
  email: string
  avatar: string
  employeeId: string
  department: string
  departmentColor: string
  checkIn: Date | null
  checkOut: Date | null
  status: 'Present' | 'Absent' | 'Late' | 'On Leave' | 'Approved' | 'Miss Punch'
  workHours: number
  date: Date
  companyId: string
  departmentId?: string
  notes?: string
  approved?: boolean
  approvedBy?: string
  approvedByName?: string
  approvedOn?: Date | null
  rejectedBy?: string
  rejectedByName?: string
  rejectedOn?: Date | null
  rejectionReason?: string
  overtimeHours?: number
  shiftId?: string
  shiftStart?: string
  shiftEnd?: string
  shiftType?: string
  isAutoApproved?: boolean
  lateMinutes?: number
  missedPunchRectification?: {
    requested: boolean
    requestedAt: Date | null
    correctedCheckOut: Date | null
    employeeRemark?: string
    // Sequential verification (Reporting Manager tier retired by policy):
    //   Tier 1 Company Admin -> Tier 2 HR / Executive
    //   -> Tier 3 Team Leader (same company context)
    approvalStatus?: Record<ApprovalTier, ApprovalLevel>
    approvalLog?: Array<{
      tier: ApprovalTier
      status: 'Approved' | 'Rejected'
      approvedBy: string
      approvedByName: string
      approvedOn: Date
      note?: string
    }>
    approverIds?: Record<ApprovalTier, string>
    // Verified-tiers counter (0..3). Persistent + reconciled server-side so the
    // "X/3" progress reflects real-time cross-client state.
    approvalCount?: number
    // Flat per-tier flags (derived from approvalStatus, synced by backend).
    reportingManagerApproved?: boolean
    companyAdminApproved?: boolean
    executiveApproved?: boolean
    teamLeaderApproved?: boolean
    // Verification outcome ('Pending' until all active tiers resolve).
    status?: 'Pending' | 'Approved' | 'Rejected'
    // Backward-compatible single-step resolution (true once fully approved).
    resolved: boolean
    resolvedAt: Date | null
    resolvedBy: string | null
    resolvedByName: string | null
    remark?: string
    // ── Master Admin final-verification (activated for Team Leader / Executive
    //    self-applications, mirroring the leave oversight layer).
    applicantRole?: string
    masterAdminRequired?: boolean
    masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected'
    masterAdminApproverId?: string
    masterAdminApprovedBy?: string
    masterAdminApprovedByName?: string
    masterAdminApprovedOn?: Date | null
    masterAdminNote?: string
  }
}

export type SlipEmailStatus = 'not-sent' | 'sending' | 'sent' | 'failed' | 'retrying'

/** Payroll info snapshot shown on the slip (HR MAX payslip body). */
export interface SlipPayrollInfo {
  workingDays?: number
  presentDays?: number
  paidLeaveDays?: number
  unpaidLeaveDays?: number
  /** Half-day leave days (0.5 each) applied in the month */
  halfDays?: number
  holidayDays?: number
  absentDays?: number
  overtimeHours?: number
  totalPayableDays?: number
  unresolvedMissPunchDays?: number
  grossSalary?: number
  overtimePay?: number
  /** Year-end encashment of unused encashable leave, applied on the Dec slip */
  leaveEncashment?: number
  leaveEncashmentDays?: number
  absentDeduction?: number
}

/** Audit trail of a corrected (regenerated) salary slip. */
export interface SlipCorrection {
  reason: string
  correctedBy: string
  correctedByName: string
  correctedAt: Date
  previous: { basicSalary: number; allowances: number; deductions: number; netSalary: number }
  current: { basicSalary: number; allowances: number; deductions: number; netSalary: number }
  /** Set when a Master Admin corrects/locks past the 5-working-day window. */
  overrideReason?: string
  /** Generated payroll reference on the corrected slip. */
  payrollRef?: string
}

export interface SalarySlip {
  id: string
  userId: string
  employeeName: string
  employeeEmail: string
  avatar: string
  employeeId: string
  department: string
  departmentColor: string
  designation?: string
  month: string
  year: number
  basicSalary: number
  allowances: number
  deductions: number
  netSalary: number
  status: 'Paid' | 'Pending' | 'Processing' | 'Emailed'
  paidOn: Date | null
  companyId: string
  breakdown?: {
    hra: number
    da: number
    pf: number
    tax: number
    otherDeductions: number
    /** Absent days × daily rate (HR MAX) */
    absentDeduction?: number
    /** Year-end encashment of unused Earned leave, applied on the Dec slip */
    leaveEncashment?: number
  }
  createdAt?: Date
  /** Payroll info snapshot body (attendance/leave summary on the slip). */
  payroll?: SlipPayrollInfo
  /** Unique payroll reference COMPANY+EMPLOYEE+YEAR+MONTH (e.g. GFX-EMP01-2025-FEB). */
  payrollRef?: string
  /** Parent payroll run the slip was created from. */
  payrollRunId?: string
  /** Slip version; 1 = original, >1 each correction creates a new version. */
  version?: number
  /** Previous slip version superseded by this corrected slip. */
  supersedesId?: string
  /** New slip id that superseded this one (kept on the old version for audit). */
  supersededBy?: string
  superseded?: boolean
  supersededAt?: Date
  emailStatus?: SlipEmailStatus
  emailError?: string
  emailSentAt?: Date
  payslipEmailStatus?: 'sent' | 'failed'
  payslipEmailAt?: Date
  regeneratedAt?: Date
  regeneratedBy?: string
  /** Correction audit stored on the corrected slip. */
  correction?: SlipCorrection
  raw?: any
}

export interface Task {
  id: string
  title: string
  description: string
  assignedTo: string
  assignedToId: string
  avatar: string
  priority: 'High' | 'Medium' | 'Low'
  status: 'Completed' | 'In Progress' | 'Pending'
  dueDate: Date
  progress: number
  companyId: string
  departmentId?: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface Holiday {
  id: string
  name: string
  date: Date
  type: 'Public' | 'Company' | 'Optional'
  description?: string
  companyId?: string
}

export interface TicketMessage {
  id: string
  userId: string
  userName: string
  message: string
  timestamp: Date
  attachments?: string[]
}

export interface SupportTicket {
  id: string
  title: string
  description: string
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed'
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  createdBy: string
  createdById: string
  assignedTo?: string
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  category: string
  companyId: string
  companyName?: string
  executiveId?: string
  executiveName?: string
  tlId?: string
  tlName?: string
  conversation?: TicketMessage[]
}

export interface AuditLog {
  id: string
  userId: string
  userName: string
  userRole: UserRole
  action: string
  entity: string
  entityId: string
  details: string
  timestamp: Date
  companyId?: string
  ipAddress?: string
}


export interface RolePermission {
  id: string
  roleId: string
  roleName: string
  permissions: string[]
  module: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canApprove: boolean
  canExport: boolean
  createdAt?: Date
}

export interface Department {
  id: string
  name: string
  code: string
  color: string
  companyId: string
  managerId?: string
  managerName?: string
  description?: string
  employeeCount?: number
  createdAt?: Date
  createdBy?: string
  createdByName?: string
  createdByRole?: string
  teamLeaderName?: string
  executiveName?: string
}

// ============================================
// SALARY STRUCTURE
// ============================================
export interface SalaryStructure {
  id: string
  name: string
  companyId: string
  basicSalary: number
  // Allowances
  hra: number          // House Rent Allowance
  da: number           // Dearness Allowance
  conveyance: number   // Conveyance/Transport
  medical: number      // Medical Allowance
  specialAllowance: number
  // Deductions
  pf: number           // Provident Fund (employee)
  professionalTax: number
  // Overtime
  overtimeRate: number // per hour
  // Meta
  grossSalary: number  // computed: basic + all allowances
  description?: string
  createdAt?: Date
  updatedAt?: Date
}

// ============================================
// LEAVE / VACATION
// ============================================
export type LeaveType = 'Casual' | 'Sick' | 'Earned' | 'Unpaid' | 'Maternity' | 'Paternity'
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
export type ApprovalLevel = 'Pending' | 'Approved' | 'Rejected'
export type ApprovalTier = 'reportingManager' | 'companyAdmin' | 'teamLeader' | 'executive'

/**
 * Individual per-tier approval flags stored on the leave document so that
 * Reporting Manager, Company Admin, Executive and Team Leader approvals can be
 * queried/synced independently and shown as checkmarks across web + mobile.
 */
export type ApprovalFlags = {
  reportingManagerApproved: boolean
  companyAdminApproved: boolean
  executiveApproved: boolean
  teamLeaderApproved: boolean
}

export interface LeaveRequest {
  id: string
  userId: string
  employeeName: string
  employeeId: string
  employeeEmail: string
  avatar: string
  department: string
  departmentId: string
  companyId: string
  leaveType: LeaveType
  startDate: Date
  endDate: Date
  totalDays: number
  reason: string
  status: LeaveStatus
  isPaid: boolean
  appliedOn: Date
  // 4-tier approval
  approvalStatus: Record<ApprovalTier, ApprovalLevel>
  approvalLog: Array<{
    tier: ApprovalTier
    status: 'Approved' | 'Rejected'
    approvedBy: string
    approvedByName: string
    approvedOn: Date
    note?: string
  }>
  approverIds: Record<ApprovalTier, string>
  // Persistent 4-tier progress counter (0..4). Resolved tiers = Approved or
  // Rejected. Kept in sync on the server doc each time a tier is acted on so
  // the "X/4" progress reflects real-time cross-client state without recompute.
  approvalCount?: number
  // Individual per-tier approval flags (derived from approvalStatus, kept in
  // sync by the leave service and backend trigger for cross-platform queries).
  reportingManagerApproved?: boolean
  companyAdminApproved?: boolean
  executiveApproved?: boolean
  teamLeaderApproved?: boolean
  // Kept for backward compatibility
  reviewedBy?: string
  reviewedByName?: string
  reviewedOn?: Date
  rejectedAt?: Date
  reviewNote?: string
  // ── Master Admin final-verification (activated for Team Leader / Executive
  //    self-applications). Keeps the strict 4-tier model intact for regular
  //    employees while giving top-tier account oversight on management self-apps.
  applicantRole?: string
  masterAdminRequired?: boolean
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected'
  masterAdminApproverId?: string
  masterAdminApprovedBy?: string
  masterAdminApprovedByName?: string
  masterAdminApprovedOn?: Date
  masterAdminNote?: string
}

// ============================================
// PAYROLL RUN
// ============================================
export type PayrollStatus =
  | 'Draft'
  | 'Calculated'
  | 'Reviewed'
  | 'Submitted'
  | 'Approved'
  | 'Generated'
  | 'Emailed'
  | 'Corrected'
  | 'Disbursed'
  | 'Locked'

export interface PayrollItem {
  userId: string
  employeeId: string
  employeeName: string
  employeeEmail: string
  avatar: string
  department: string
  departmentColor: string
  departmentId: string
  // Inputs
  workingDays: number
  presentDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  /** Half-day leave days (0.5 each) applied in the month — part of the attendance summary */
  halfDays?: number
  holidayDays: number
  absentDays: number
  overtimeHours: number
  totalPayableDays: number
  unresolvedMissPunchDays: number
  // Structure snapshot
  basicSalary: number
  hra: number
  da: number
  conveyance: number
  medical: number
  specialAllowance: number
  grossSalary: number
  // Computed
  earnedGross: number       // full monthly gross (HR MAX: Basic + Allowances)
  overtimePay: number
  leaveEncashment?: number  // Dec-only: encashable days × daily rate
  leaveEncashmentDays?: number
  absentDeduction?: number  // absent days × daily rate
  pf: number
  professionalTax: number
  otherDeductions: number
  totalEarnings: number
  totalDeductions: number
  netSalary: number
  payslipId?: string
}

export interface PayrollRun {
  id: string
  companyId: string
  month: string  // e.g. "January"
  year: number
  monthIndex: number // 0-11
  status: PayrollStatus
  workingDays: number
  totalEmployees: number
  totalNet: number
  items: PayrollItem[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
  disbursedOn?: Date
  /** Unique payroll reference (company + period). */
  payrollRef?: string
  /** True once the correction window closes (5 working days) — locks the run. */
  locked?: boolean
  lockedAt?: Date
  lockReason?: string
  submittedAt?: Date
  submittedBy?: string
  submittedByName?: string
  reviewedAt?: Date
  reviewedBy?: string
  reviewedByName?: string
  generatedAt?: Date
  generatedBy?: string
  payslipEmailsDispatched?: boolean
  payslipEmailCount?: number
  payslipEmailFailed?: number
  payslipEmailsAt?: Date
}

// ============================================
// MESSAGING TYPES
// ============================================

export interface Conversation {
  id: string
  participants: string[]
  participantNames: Record<string, string>
  participantAvatars: Record<string, string>
  lastMessage: string
  lastMessageTime: Date
  lastMessageBy: string
  lastSender?: string
  unreadCount: Record<string, number>
  companyId: string
  type?: 'direct' | 'department' | 'broadcast'
  name?: string
  starredBy?: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  senderId: string
  senderName: string
  senderAvatar: string
  content: string
  type: 'text' | 'attachment' | 'system'
  attachmentUrl?: string
  attachmentName?: string
  attachmentSize?: number
  readBy: string[]
  replyTo?: {
    messageId: string
    senderName: string
    content: string
  }
  createdAt: Date
}

export type NotificationType =
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_requested'
  | 'task_assigned'
  | 'task_completed'
  | 'attendance_marked'
  | 'attendance_late'
  | 'missed_punch'
  | 'punch_rectification_requested'
  | 'punch_rectification_resolved'
  | 'leave_tier_approved'
  | 'leave_rejected_by_tier'
  | 'leave_fully_approved'
  | 'message_received'
  | 'general'
  | 'company_broadcast'

export interface AppNotification {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string
  read: boolean
  link: string
  companyId: string
  createdAt: Date
}

// ============================================
// SHIFT CONFIG
// ============================================
export interface ShiftConfig {
  id: string
  companyId: string
  name: string
  type: 'Morning' | 'Afternoon' | 'Night' | 'Custom'
  startTime: string
  endTime: string
  description?: string
  createdAt?: Date
  updatedAt?: Date
}

// ============================================
// COMPANY SETTINGS
// ============================================
export interface CompanySettings {
  id?: string
  companyId: string
  gracePeriodMinutes: number
  missedPunchThresholdMinutes: number
  autoApprovalEnabled: boolean
  createdAt?: Date
  updatedAt?: Date
}