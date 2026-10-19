export type UserRole = 'master-admin' | 'company-admin' | 'team-leader' | 'executive' | 'reporting-manager' | 'employee';
export type CompanyAdminStatus = 'Pending' | 'Approved' | 'Suspended' | 'Rejected';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string | null;
  departmentId: string | null;
  avatar: string;
  permissions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  assignedCompanyIds?: string[];
  contingencyAccess?: boolean;
  reportingExecutiveId?: string | null;
  reportingExecutiveName?: string | null;
  linkedExecutiveIds?: string[];
  reportingEmployeeIds?: string[];
  phone?: string;
  status?: CompanyAdminStatus;
  isApproved?: boolean;
  requirePasswordChange?: boolean;
  approvedBy?: string;
  approvedAt?: Date | null;
  suspendedAt?: Date | null;
  rejectionReason?: string;
  companyName?: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  code: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  adminAvatar: string;
  employees: number;
  status: 'Active' | 'Inactive';
  operationalMode?: 'Continuous' | 'Discontinuous';
  createdOn: Date;
  logoColor: string;
  address?: string;
  phone?: string;
  website?: string;
  description?: string;
  country?: string;
  state?: string;
  city?: string;
  zipCode?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  language?: string;
  adminPhone?: string;
  employeeLimit?: number;
  logoUrl?: string;
  averageSalary?: number;
  mandatoryAttendanceDays?: number;
  attendanceSettings?: CompanyAttendanceSettings;
  payrollSettings?: CompanyPayrollSettings;
}

export interface CompanyAttendanceSettings {
  officeAddress: string;
  latitude: number;
  longitude: number;
  radiusInMeters: number;
  allowMobileData: boolean;
  requireWifi: boolean;
  wifiSSID: string;
  requireSelfie: boolean;
}

export interface CompanyPayrollSettings {
  salaryCycle: 'Monthly' | 'Bi-weekly';
  workingDaysPerMonth: number;
  weekends: string[];
  overtimeRatePerHour: number;
}

export interface Employee {
  id: string;
  slug: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  employeeId: string;
  username?: string;
  password?: string;
  department: string;
  departmentId: string;
  departmentColor: string;
  designation: string;
  phone: string;
  status: 'Active' | 'Inactive' | 'On Leave';
  joinDate: Date;
  companyId: string;
  salary?: number;
  monthlyGrossSalary?: number;
  salaryEffectiveDate?: string | Date;
  salaryStructureId?: string;
  employmentType: 'Full-time' | 'Part-time' | 'Contract' | 'Intern';
  address?: string;
  emergencyContact?: string;
  birthDate?: string | Date;
  shiftId?: string;
  shiftStart?: string;
  shiftEnd?: string;
  shiftType?: 'Morning' | 'Afternoon' | 'Night' | 'Custom';
  reportingManagerId?: string;
  reportingManagerName?: string;
  isReportingManager?: boolean;
  salaryCycle?: 'Monthly' | 'Bi-weekly';
  workingDaysPerMonth?: number;
  overtimeRatePerHour?: number;
  weekendDays?: number[];
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'On Leave' | 'Approved' | 'Miss Punch' | 'Early Checkout';

export interface AttendanceRecord {
  id: string;
  userId: string;
  name: string;
  email?: string;
  avatar?: string;
  employeeId?: string;
  department?: string;
  departmentColor?: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: AttendanceStatus;
  workHours: number;
  date: Date;
  companyId: string;
  departmentId?: string;
  notes?: string;
  approved?: boolean;
  approvedBy?: string;
  approvedByName?: string;
  approvedOn?: Date | null;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedOn?: Date | null;
  rejectionReason?: string;
  overtimeHours?: number;
  lateMinutes?: number;
  missedPunchRectification?: {
    requested: boolean;
    requestedAt: Date | null;
    correctedCheckOut: Date | null;
    employeeRemark?: string;
    approvalStatus?: Record<ApprovalTier, ApprovalLevel>;
    approvalLog?: Array<{
      tier: ApprovalTier;
      status: 'Approved' | 'Rejected';
      approvedBy: string;
      approvedByName: string;
      approvedOn: Date;
      note?: string;
    }>;
    approverIds?: Record<ApprovalTier, string>;
    approvalCount?: number;
    reportingManagerApproved?: boolean;
    companyAdminApproved?: boolean;
    executiveApproved?: boolean;
    teamLeaderApproved?: boolean;
    status?: 'Pending' | 'Approved' | 'Rejected';
    resolved: boolean;
    resolvedAt: Date | null;
    resolvedBy: string | null;
    resolvedByName: string | null;
    remark?: string;
    // ── Master Admin final-verification (activated for Team Leader / Executive
    //    self-applications, mirroring the leave oversight layer).
    applicantRole?: string;
    masterAdminRequired?: boolean;
    masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected';
    masterAdminApproverId?: string;
    masterAdminApprovedBy?: string;
    masterAdminApprovedByName?: string;
    masterAdminApprovedOn?: Date | null;
    masterAdminNote?: string;
  };
}

export type LeaveType = 'Casual' | 'Sick' | 'Earned' | 'Unpaid' | 'Maternity' | 'Paternity';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type ApprovalLevel = 'Pending' | 'Approved' | 'Rejected';
export type ApprovalTier = 'reportingManager' | 'companyAdmin' | 'teamLeader' | 'executive';

/**
 * Individual per-tier approval flags stored on the leave document so that
 * Reporting Manager, Company Admin, Executive and Team Leader approvals can be
 * queried/synced independently and shown as checkmarks across web + mobile.
 */
export type ApprovalFlags = {
  reportingManagerApproved: boolean;
  companyAdminApproved: boolean;
  executiveApproved: boolean;
  teamLeaderApproved: boolean;
};

export interface LeaveRequest {
  id: string;
  userId: string;
  employeeName: string;
  employeeId?: string;
  employeeEmail?: string;
  avatar?: string;
  department?: string;
  departmentId?: string;
  companyId: string;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  isPaid?: boolean;
  appliedOn?: Date;
  approvalStatus?: Record<ApprovalTier, ApprovalLevel>;
  approvalLog?: Array<{
    tier: ApprovalTier;
    status: 'Approved' | 'Rejected';
    approvedBy: string;
    approvedByName: string;
    approvedOn: Date;
    note?: string;
  }>;
  approverIds?: Record<ApprovalTier, string>;
  // Individual per-tier approval flags (derived from approvalStatus, kept in
  // sync by the leave service and backend trigger for cross-platform queries).
  reportingManagerApproved?: boolean;
  companyAdminApproved?: boolean;
  executiveApproved?: boolean;
  teamLeaderApproved?: boolean;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedOn?: Date;
  reviewNote?: string;
  // ── Master Admin final-verification (activated for Team Leader / Executive
  //    self-applications). Keeps the strict 4-tier model intact for regular
  //    employees while giving top-tier account oversight on management self-apps.
  applicantRole?: string;
  masterAdminRequired?: boolean;
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected';
  masterAdminApproverId?: string;
  masterAdminApprovedBy?: string;
  masterAdminApprovedByName?: string;
  masterAdminApprovedOn?: Date;
  masterAdminNote?: string;
  rejectedAt?: Date;
  updatedAt?: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedToId?: string;
  assignedToName?: string;
  avatar?: string;
  priority: 'High' | 'Medium' | 'Low';
  status: 'Completed' | 'In Progress' | 'Pending';
  dueDate: Date;
  progress: number;
  companyId: string;
  departmentId?: string;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Holiday {
  id: string;
  name: string;
  date: Date;
  type: 'Public' | 'Company' | 'Optional';
  description?: string;
  companyId?: string;
}

export interface Asset {
  id: string;
  name: string;
  category: string;
  serial?: string;
  assetTag?: string;
  status: 'Assigned' | 'Available' | 'Maintenance' | 'Damaged' | 'Retired';
  assignedTo?: string;
  assignedToName?: string;
  assignedToId?: string;
  purchaseDate?: Date;
  purchaseCost?: number;
  vendor?: string;
  warrantyExpiry?: Date;
  notes?: string;
  companyId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuditLogEntry {
  id?: string;
  timestamp: Date | null;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  actionType: 'read' | 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'resolve' | 'assign' | 'transfer' | 'login' | 'logout' | 'export';
  module: string;
  targetEntity: string;
  targetId?: string;
  companyId?: string;
  companyName?: string;
  details?: string;
  status: 'success' | 'failure' | 'warning';
  ipAddress?: string;
}

export type SlipEmailStatus = 'not-sent' | 'sending' | 'sent' | 'failed' | 'retrying';

export interface SlipPayrollInfo {
  workingDays?: number;
  presentDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  holidayDays?: number;
  overtimeHours?: number;
}

export interface SlipCorrection {
  reason: string;
  correctedBy: string;
  correctedByName: string;
  correctedAt: Date;
  previous: { basicSalary: number; allowances: number; deductions: number; netSalary: number };
  current: { basicSalary: number; allowances: number; deductions: number; netSalary: number };
  overrideReason?: string;
}

export interface SalarySlip {
  id: string;
  userId: string;
  employeeName: string;
  employeeEmail: string;
  avatar: string;
  employeeId: string;
  department: string;
  departmentColor: string;
  month: string;
  year: number;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: 'Paid' | 'Pending' | 'Processing' | 'Emailed';
  paidOn: Date | null;
  companyId: string;
  breakdown?: {
    hra: number;
    da: number;
    pf: number;
    tax: number;
    otherDeductions: number;
    absentDeduction?: number;
    leaveEncashment?: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
  payroll?: SlipPayrollInfo;
  payrollRef?: string;
  payrollRunId?: string;
  version?: number;
  supersedesId?: string;
  supersededBy?: string;
  superseded?: boolean;
  supersededAt?: Date;
  emailStatus?: SlipEmailStatus;
  emailError?: string;
  emailSentAt?: Date;
  payslipEmailStatus?: 'sent' | 'failed';
  payslipEmailAt?: Date;
  correction?: SlipCorrection;
}

export type PayrollStatus = 'Draft' | 'Calculated' | 'Approved' | 'Disbursed';

export interface PayrollItem {
  userId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  avatar: string;
  department: string;
  departmentColor: string;
  departmentId: string;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  halfDays?: number;
  holidayDays: number;
  absentDays: number;
  overtimeHours: number;
  totalPayableDays: number;
  unresolvedMissPunchDays: number;
  basicSalary: number;
  hra: number;
  da: number;
  conveyance: number;
  medical: number;
  specialAllowance: number;
  grossSalary: number;
  earnedGross: number;
  overtimePay: number;
  pf: number;
  professionalTax: number;
  otherDeductions: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  absentDeduction?: number;
  leaveEncashment?: number;
  leaveEncashmentDays?: number;
  payslipId?: string;
}

export interface PayrollRun {
  id: string;
  companyId: string;
  month: string;
  year: number;
  monthIndex: number;
  status: PayrollStatus;
  workingDays: number;
  totalEmployees: number;
  totalNet: number;
  items: PayrollItem[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  disbursedOn?: Date;
}

export interface SalaryStructure {
  id: string;
  name: string;
  companyId: string;
  basicSalary: number;
  hra: number;
  da: number;
  conveyance: number;
  medical: number;
  specialAllowance: number;
  pf: number;
  professionalTax: number;
  overtimeRate: number;
  grossSalary: number;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupportTicket {
  id: string;
  title: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  createdBy: string;
  createdById: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  category: string;
  companyId: string;
  companyName?: string;
  conversation?: TicketMessage[];
}

export interface TicketMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: Date;
  attachments?: string[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
  color: string;
  companyId: string;
  managerId?: string;
  managerName?: string;
  description?: string;
  employeeCount?: number;
  createdAt?: Date;
}
