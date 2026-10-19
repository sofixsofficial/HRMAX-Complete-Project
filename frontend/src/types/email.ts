export type MailType = 'All' | 'Employee' | 'Department' | 'Company' | 'Candidate'

export type DeliveryStatus = 'Sent' | 'Delivered' | 'Opened' | 'Clicked' | 'Failed' | 'Scheduled' | 'Draft' | 'Deleted' | 'Archived'

export type EmailTab = 'inbox' | 'sent' | 'drafts' | 'scheduled' | 'trash'

export interface Email {
  id: string
  from: string
  fromEmail: string
  to: string
  toEmail: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  date: string
  type: MailType
  status: DeliveryStatus
  read: boolean
  starred: boolean
  attachments?: string[]
  templateId?: string
  scheduledFor?: string
  recipientGroup?: string
  companyId: string
  replyToId?: string
  forwardOfId?: string
  threadId?: string
  sentAt?: string
  deliveredAt?: string
  openedAt?: string
  clickedAt?: string
}

export interface EmailTemplate {
  id: string
  name: string
  category: string
  subject: string
  body: string
  variables: string[]
  isActive: boolean
}

export const RECIPIENT_GROUPS = [
  'Individual Employee',
  'Multiple Employees',
  'Department',
  'Team',
  'Executive',
  'Team Leader',
  'Company',
  'All Employees',
  'Job Applicants',
] as const

export const INITIAL_COMPOSE: Omit<Email, 'id' | 'date' | 'status' | 'read' | 'starred' | 'companyId'> = {
  from: '',
  fromEmail: '',
  to: '',
  toEmail: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  type: 'Employee',
  attachments: [],
  templateId: '',
  scheduledFor: '',
  recipientGroup: 'Individual Employee',
}

export const TEMPLATES: EmailTemplate[] = [
  { id: 't1', name: 'Welcome Employee', category: 'HR', subject: 'Welcome to {company}!', body: 'Dear {name},\n\nWelcome to {company}! We are thrilled to have you join our team.\n\nYour employee ID is {employeeId}.\n\nBest regards,\nHR Team', variables: ['name', 'company', 'employeeId'], isActive: true },
  { id: 't2', name: 'Offer Letter', category: 'HR', subject: 'Job Offer - {position} at {company}', body: 'Dear {name},\n\nWe are pleased to offer you the position of {position} at {company}.\n\nStart Date: {startDate}\nSalary: {salary}\n\nBest regards,\nHR Team', variables: ['name', 'position', 'company', 'startDate', 'salary'], isActive: true },
  { id: 't3', name: 'Leave Approved', category: 'Leave', subject: 'Leave Request Approved', body: 'Dear {name},\n\nYour leave request from {startDate} to {endDate} has been approved.\n\nEnjoy your time off!\n\nBest regards,\nHR Team', variables: ['name', 'startDate', 'endDate'], isActive: true },
  { id: 't4', name: 'Leave Rejected', category: 'Leave', subject: 'Leave Request Update', body: 'Dear {name},\n\nYour leave request from {startDate} to {endDate} has been rejected.\n\nReason: {reason}\n\nBest regards,\nHR Team', variables: ['name', 'startDate', 'endDate', 'reason'], isActive: true },
  { id: 't5', name: 'Payslip Sent', category: 'Payroll', subject: 'Payslip for {month} {year}', body: 'Dear {name},\n\nYour payslip for {month} {year} is now available.\n\nNet Salary: {netSalary}\n\nBest regards,\nFinance Team', variables: ['name', 'month', 'year', 'netSalary'], isActive: true },
  { id: 't6', name: 'Interview Invitation', category: 'HR', subject: 'Interview Invitation - {position}', body: 'Dear {name},\n\nYou are invited for an interview for the position of {position}.\n\nDate: {interviewDate}\nTime: {interviewTime}\nLocation: {location}\n\nBest regards,\nHR Team', variables: ['name', 'position', 'interviewDate', 'interviewTime', 'location'], isActive: true },
  { id: 't7', name: 'Holiday Notice', category: 'Company', subject: 'Holiday Notice - {holidayName}', body: 'Dear All,\n\nPlease be informed that the office will remain closed on {holidayDate} on account of {holidayName}.\n\nBest regards,\nAdmin Team', variables: ['holidayName', 'holidayDate'], isActive: true },
  { id: 't8', name: 'Birthday Wishes', category: 'Company', subject: 'Happy Birthday, {name}!', body: 'Dear {name},\n\nWishing you a very Happy Birthday! May this year bring you success and happiness.\n\nBest regards,\nHR Team', variables: ['name'], isActive: true },
  { id: 't9', name: 'Absent Notice', category: 'Attendance', subject: 'Absence Notice - {date}', body: 'Dear {name},\n\nYou were marked absent on {date}. Please provide justification if applicable.\n\nBest regards,\nHR Team', variables: ['name', 'date'], isActive: true },
  { id: 't10', name: 'Policy Update', category: 'Company', subject: 'Policy Update - {policyName}', body: 'Dear All,\n\nPlease note the following policy update: {policyName}\n\nEffective Date: {effectiveDate}\n\nBest regards,\nAdmin Team', variables: ['policyName', 'effectiveDate'], isActive: true },
]
