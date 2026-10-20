import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { 
  Users, UserCheck, UserX, UserPlus, Search, Download, Plus, 
  ChevronDown, Eye, Pencil, Trash2, Filter, Loader2, Shield, 
  X, Building2, Mail, Phone, Calendar, CalendarRange, MapPin, ChevronLeft, ChevronRight,
  Upload, Printer, FileSpreadsheet, Briefcase, User,
  MapPinned, Globe, Clock, Hash, BadgeInfo, AlertCircle, DollarSign, EyeOff,
  XCircle
} from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import type { UseFormReturn, Resolver } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { collection, onSnapshot, query, doc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore'
import { Toast } from '../components/Toast'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../config/firebase'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { createEmployee, updateEmployee, getReportingManagersByCompany, getCompanyAdmins, deleteEmployee } from '../services/employeeService'
import { logAudit } from '../services/auditLogService'
import { getAllRoles } from '../services/roleService'
import { getAllUsers, updateUserRole } from '../services/authService'
import { createNotification, createAdminAlert } from '../services/notificationService'
import { isDate } from '../utils/dateUtils'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import { SearchableSelect } from '../components/SearchableSelect'
import { LeaveBalanceCard } from '../components/LeaveBalanceCard'
import { DEFAULT_LEAVE_ALLOWANCES, LEAVE_TYPES, computeLeaveBalance, resolveEmployeeLeaveEntitlements } from '../services/leaveService'
import type { LeaveBalanceConfig } from '../services/leaveService'
import { getLeavePoliciesByCompany } from '../services/leavePolicyService'
import type { Employee, User as UserType, UserRole, Company, Department, LeaveRequest, LeavePolicy } from '../types/user'
import './Employees.css'

const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const
const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const

// Monthly leave entitlement per type, normalized to positive numbers only.
// Yearly entitlement = Monthly × 12. Empty/zero entries are dropped so an
// employee without configured entitlements simply has no leave balance.
const normalizeMonthlyLeaveEntitlements = (raw: Record<string, unknown> | undefined): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const t of LEAVE_TYPES) {
    const v = Number((raw || {})[t])
    if (!isNaN(v) && v > 0) out[t] = Math.round(v * 100) / 100
  }
  return out
}

const yearlyOfMonthly = (monthly: unknown): number => {
  const n = Number(monthly)
  if (isNaN(n) || n <= 0) return 0
  return Math.round(n * 12 * 100) / 100
}

const ROLE_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'employee', label: 'Employee', color: '#6366f1' },
  { value: 'reporting-manager', label: 'Reporting Manager', color: '#10b981' },
]

const employeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional().default(''),
  employeeId: z.string().optional().default(''),
  department: z.string().default(''),
  departmentId: z.string().default(''),
  departmentColor: z.string().default('#f97316'),
  designation: z.string().optional().default(''),
  status: z.enum(STATUS_OPTIONS).default('Active'),
  joinDate: z.string().optional().default(''),
  birthDate: z.string().optional().default(''),
  companyId: z.string().min(1, 'Company is required'),
  employmentType: z.enum(EMPLOYMENT_TYPE_OPTIONS).default('Full-time'),
  address: z.string().optional().default(''),
  emergencyContactName: z.string().optional().default(''),
  emergencyContactPhone: z.string().optional().default(''),
  aadharDoc: z.string().optional().default(''),
  aadharNumber: z.string().optional().default(''),
  panDoc: z.string().optional().default(''),
  panNumber: z.string().optional().default(''),
  joiningLetterDoc: z.string().optional().default(''),
  bankName: z.string().optional().default(''),
  accountHolderName: z.string().optional().default(''),
  accountNumber: z.string().optional().default(''),
  ifscCode: z.string().optional().default(''),
  pfAccountNumber: z.string().optional().default(''),
  uanNumber: z.string().optional().default(''),
  offerLetterDoc: z.string().optional().default(''),
  role: z.string().optional().default('employee'),
  managerId: z.string().optional().default(''),
  managerName: z.string().optional().default(''),
  isReportingManager: z.boolean().optional().default(false),
  userId: z.string().optional().default(''),
  avatar: z.string().optional().default(''),
  salary: z.number().optional(),
  monthlyGrossSalary: z.number().min(0).optional(),
  salaryEffectiveDate: z.string().optional().default(''),
  salaryCycle: z.enum(['Monthly', 'Bi-weekly']).optional().default('Monthly'),
  workingDaysPerMonth: z.number().min(1).max(31).optional().default(26),
  overtimeRatePerHour: z.number().min(0).max(10).optional().default(1.5),
  weekendDays: z.array(z.number()).optional().default([0, 6]),
  leavePolicyId: z.string().optional().default(''),
  monthlyLeaveEntitlements: z.record(z.string(), z.string()).optional().default({}),
})

type EmployeeFormValues = z.infer<typeof employeeSchema>

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Active': return { bg: '#dcfce7', text: '#16a34a' }
    case 'Inactive': return { bg: '#fee2e2', text: '#ef4444' }
    case 'On Leave': return { bg: '#ffedd5', text: '#f97316' }
    default: return { bg: '#f3f4f6', text: '#6b7280' }
  }
}

interface EmployeeFormContentProps {
  form: UseFormReturn<EmployeeFormValues>
  formId: string
  onSubmit: (values: EmployeeFormValues) => Promise<void>
  companies: Company[]
  departments: Department[]
  employees: Employee[]
  managerCandidates: Employee[]
  loadingManagerCandidates: boolean
  fetchManagers: (companyId: string) => void
  users: UserType[]
  excludeEmployeeId?: string
  scopedCompanies?: Array<Pick<Company, 'id' | 'name'>>
}

export interface EmployeeFormRef {
  getFilesForUpload: () => { aadharDoc: File | null; panDoc: File | null; joiningLetterDoc: File | null; offerLetterDoc: File | null }
}

const EmployeeFormContent = forwardRef<EmployeeFormRef, EmployeeFormContentProps>(({ form, formId, onSubmit, companies, departments, managerCandidates, loadingManagerCandidates, fetchManagers, excludeEmployeeId, scopedCompanies }, ref) => {
  const watchCompanyId = form.watch('companyId')
  const watchDepartmentId = form.watch('departmentId')
  const watchRole = form.watch('role')
  const { user } = useAuth()
  const isCompanyAdmin = user?.role === 'company-admin'
  const isMasterAdmin = user?.role === 'master-admin'
  const isRestrictedRole = user?.role === 'executive' || user?.role === 'team-leader'

  // Company options for the modal. Master Admin sees all companies; executives /
  // team-leaders get their scoped portfolio so they can always pick a company
  // inside the modal (even when the top-level scope context hasn't preset one).
  const companyOptions = isMasterAdmin
    ? companies
    : isRestrictedRole && scopedCompanies && scopedCompanies.length > 0
      ? scopedCompanies
      : companies.filter(c => c.id === watchCompanyId)
  const isReportingManager = watchRole === 'reporting-manager'

  const [companyAdminCandidates, setCompanyAdminCandidates] = useState<Employee[]>([])
  const companyAdmins = watchCompanyId ? companyAdminCandidates : []

  useEffect(() => {
    if (watchCompanyId) {
      fetchManagers(watchCompanyId)
    }
  }, [watchCompanyId, fetchManagers])

  useEffect(() => {
    let active = true
    if (watchCompanyId) {
      const companyName = companies.find(c => c.id === watchCompanyId)?.name
      getCompanyAdmins(watchCompanyId, companyName)
        .then((list) => { if (active) setCompanyAdminCandidates(list) })
        .catch(() => { if (active) setCompanyAdminCandidates([]) })
    } else {
      setCompanyAdminCandidates([])
    }
    return () => { active = false }
  }, [watchCompanyId, companies])

  // Re-bind manager / department selections immediately when the target
  // company changes so stale, out-of-scope choices never persist. Skipped on
  // first mount so a prefilled edit form keeps its existing values.
  const prevCompanyRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevCompanyRef.current
    prevCompanyRef.current = watchCompanyId || ''
    if (prev === null || prev === (watchCompanyId || '')) return
    if (form.getValues('managerId')) {
      form.setValue('managerId', '')
      form.setValue('managerName', '')
    }
    if (form.getValues('departmentId')) {
      form.setValue('departmentId', '')
      form.setValue('department', '')
      form.setValue('departmentColor', '#f97316')
    }
  }, [watchCompanyId, form])

  const aadharFileRef = useRef<File | null>(null)
  const panFileRef = useRef<File | null>(null)
  const joiningLetterFileRef = useRef<File | null>(null)
  const offerLetterFileRef = useRef<File | null>(null)
  const [aadharFileName, setAadharFileName] = useState('')
  const [panFileName, setPanFileName] = useState('')
  const [joiningLetterFileName, setJoiningLetterFileName] = useState('')
  const [offerLetterFileName, setOfferLetterFileName] = useState('')
  const [compOpen, setCompOpen] = useState(true)

  const handleDocSelect = (field: 'aadharDoc' | 'panDoc' | 'joiningLetterDoc' | 'offerLetterDoc', fileRef: React.MutableRefObject<File | null>, setFileName: (name: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds 5MB limit')
      e.target.value = ''
      return
    }
    fileRef.current = file
    setFileName(file.name)
  }

  const getFilesForUpload = () => ({
    aadharDoc: aadharFileRef.current,
    panDoc: panFileRef.current,
    joiningLetterDoc: joiningLetterFileRef.current,
    offerLetterDoc: offerLetterFileRef.current,
  })

  useImperativeHandle(ref, () => ({ getFilesForUpload }), [])

  // Hierarchical option labels (never raw emails):
  //   Company Admin  -> "Company Name / Administrator Full Name"
  //   Reporting Mgr  -> "Company Name / Reporting Manager / Manager Full Name"
  const companyNameOf = (e: Employee): string =>
    companies.find(c => c.id === e.companyId)?.name?.trim() || ''
  const fullNameOf = (e: Employee): string => {
    const raw = (e.name || '').trim()
    if (raw) return raw
    const local = (e.email || '').split('@')[0]
    if (local) return local.split(/[._\-]+/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ').trim()
    return e.employeeId || 'Administrator'
  }
  const managerRoleLabel = (e: Employee): string =>
    e.role === 'company-admin' || e.employeeId === 'Company Admin' ? 'Company Admin' : 'Reporting Manager'
  const adminOptionLabel = (e: Employee): string => {
    const name = fullNameOf(e)
    return companyNameOf(e) ? `${companyNameOf(e)} / ${name}` : name
  }
  const managerOptionLabel = (e: Employee): string =>
    [companyNameOf(e), managerRoleLabel(e), fullNameOf(e)].filter(Boolean).join(' / ')

  return (
    <form id={formId} onSubmit={form.handleSubmit(onSubmit)}>
      <div className="modal-section">
        <div className="modal-section-header">
          <User size={18} /><h4>Basic Information</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>Full Name *</label>
            <input type="text" {...form.register('name')} placeholder="Enter full name" />
            {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}
          </div>
          <div className="modal-field">
            <label>Email Address *</label>
            <input type="email" {...form.register('email')} placeholder="email@company.com" />
            {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}
          </div>
          <div className="modal-field">
            <label>Phone Number</label>
            <input type="text" {...form.register('phone')} placeholder="+1 234 567 890" />
          </div>
          <div className="modal-field">
            <label>Date of Birth</label>
            <input type="date" {...form.register('birthDate')} />
          </div>
          <div className="modal-field">
            <label>Role *</label>
            <select {...form.register('role')}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <Shield size={18} /><h4>Account Credentials</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>System Username *</label>
            <input type="text" {...form.register('username')} placeholder="e.g. johndoe" />
            {form.formState.errors.username && <span className="field-error">{form.formState.errors.username.message}</span>}
          </div>
          <div className="modal-field">
            <label>Temporary Password *</label>
            <input type="text" {...form.register('password')} placeholder="Min 6 characters" />
            {form.formState.errors.password && <span className="field-error">{form.formState.errors.password.message}</span>}
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <Building2 size={18} /><h4>Organization Information</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>Company *</label>
            <select {...form.register('companyId')} disabled={isCompanyAdmin}>
              <option value="">{isCompanyAdmin ? user?.companyId ? 'Company (fixed)' : 'Select Company' : 'Select Company'}</option>
              {companyOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {form.formState.errors.companyId && <span className="field-error">{form.formState.errors.companyId.message}</span>}
          </div>
          <Controller
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <SearchableSelect
                label="Department"
                placeholder="Select Department"
                searchPlaceholder="Search departments..."
                value={field.value || ''}
                onChange={(val) => {
                  field.onChange(val)
                  const dept = departments.find(d => d.id === val)
                  form.setValue('department', dept?.name || '')
                  form.setValue('departmentColor', dept?.color || '#f97316')
                }}
                options={departments.filter(d => d.companyId === watchCompanyId).map(d => ({ value: d.id, label: d.name }))}
                disabled={!watchCompanyId}
              />
            )}
          />
          <Controller
            control={form.control}
            name="managerId"
            render={({ field }) => (
              isReportingManager ? (
                <SearchableSelect
                  label="Reporting Manager's Company Admin"
                  placeholder={watchCompanyId ? 'Select Company Admin' : 'Select a company first'}
                  searchPlaceholder="Search company admins..."
                  value={field.value || ''}
                  onChange={(val) => {
                    field.onChange(val)
                    const admin = companyAdmins.find(u => u.id === val)
                    form.setValue('managerName', admin?.name || '')
                  }}
                  options={companyAdmins
                    .filter(u => !excludeEmployeeId || u.id !== excludeEmployeeId)
                    .map(u => ({ value: u.id, label: adminOptionLabel(u) }))}
                  disabled={!watchCompanyId}
                  noOptionsMessage={watchCompanyId ? 'No Company Admin assigned to this company yet' : 'Select a company first'}
                />
              ) : (
                <SearchableSelect
                  label="Manager"
                  placeholder="Select manager"
                  searchPlaceholder="Search managers..."
                  value={field.value || ''}
                  onChange={(val) => {
                    field.onChange(val)
                    const emp = managerCandidates.find(e => e.id === val || e.userId === val)
                    form.setValue('managerName', emp?.name || '')
                  }}
                  options={managerCandidates
                    .filter(e => !excludeEmployeeId || (e.id !== excludeEmployeeId && e.userId !== excludeEmployeeId))
                    .map(e => ({ value: e.userId || e.id, label: managerOptionLabel(e) }))}
                  disabled={!watchCompanyId}
                  loading={loadingManagerCandidates}
                  noOptionsMessage={watchCompanyId ? 'No Reporting Managers or Company Admin found for this company' : 'Select a company first'}
                />
              )
            )}
          />
          <div className="modal-field">
            <label>Designation</label>
            <input type="text" {...form.register('designation')} placeholder="e.g. Senior Developer" />
            {form.formState.errors.designation && <span className="field-error">{form.formState.errors.designation.message}</span>}
          </div>
          <div className="modal-field">
            <label>Employee ID</label>
            <input type="text" {...form.register('employeeId')} placeholder="Auto-generated if empty" />
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <Briefcase size={18} /><h4>Employment Details</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>Employment Type</label>
            <select {...form.register('employmentType')}>
              {EMPLOYMENT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>Status</label>
            <select {...form.register('status')}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>Join Date</label>
            <input type="date" {...form.register('joinDate')} />
          </div>
          <div className="modal-field">
            <label>Aadhar Number</label>
            <input type="text" {...form.register('aadharNumber')} placeholder="Enter Aadhar number" />
          </div>
          <div className="modal-field full-width">
            <label>Aadhar Card</label>
            <div className="file-upload-wrapper">
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('aadharDoc', aadharFileRef, setAadharFileName)} style={{ display: 'none' }} id="aadhar-upload" />
              <label htmlFor="aadhar-upload" className="file-upload-label">
                <Upload size={18} />
                <span>{aadharFileName || 'Upload Aadhar card'}</span>
              </label>
              <p className="file-upload-hint">Upload JPG, PNG or PDF (max 5MB)</p>
            </div>
          </div>
          <div className="modal-field">
            <label>PAN Number</label>
            <input type="text" {...form.register('panNumber')} placeholder="Enter PAN number" />
          </div>
          <div className="modal-field full-width">
            <label>PAN Card</label>
            <div className="file-upload-wrapper">
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('panDoc', panFileRef, setPanFileName)} style={{ display: 'none' }} id="pan-upload" />
              <label htmlFor="pan-upload" className="file-upload-label">
                <Upload size={18} />
                <span>{panFileName || 'Upload PAN card'}</span>
              </label>
              <p className="file-upload-hint">Upload JPG, PNG or PDF (max 5MB)</p>
            </div>
          </div>
          <div className="modal-field full-width">
            <label>Company Joining Letter</label>
            <div className="file-upload-wrapper">
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('joiningLetterDoc', joiningLetterFileRef, setJoiningLetterFileName)} style={{ display: 'none' }} id="joining-letter-upload" />
              <label htmlFor="joining-letter-upload" className="file-upload-label">
                <Upload size={18} />
                <span>{joiningLetterFileName || 'Upload joining letter'}</span>
              </label>
              <p className="file-upload-hint">Upload JPG, PNG or PDF (max 5MB)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <Building2 size={18} /><h4>Bank Details</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>Bank Name</label>
            <input type="text" {...form.register('bankName')} placeholder="e.g. State Bank of India" />
          </div>
          <div className="modal-field">
            <label>Account Holder Name</label>
            <input type="text" {...form.register('accountHolderName')} placeholder="e.g. John Doe" />
          </div>
          <div className="modal-field">
            <label>Account Number</label>
            <input type="text" {...form.register('accountNumber')} placeholder="Enter account number" />
          </div>
          <div className="modal-field">
            <label>IFSC Code</label>
            <input type="text" {...form.register('ifscCode')} placeholder="e.g. SBIN0001234" />
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <BadgeInfo size={18} /><h4>PF & Statutory Details</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field">
            <label>PF Account Number</label>
            <input type="text" {...form.register('pfAccountNumber')} placeholder="Enter PF account number" />
          </div>
          <div className="modal-field">
            <label>UAN Number</label>
            <input type="text" {...form.register('uanNumber')} placeholder="Enter UAN number" />
          </div>
          <div className="modal-field full-width">
            <label>Offer Letter</label>
            <div className="file-upload-wrapper">
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('offerLetterDoc', offerLetterFileRef, setOfferLetterFileName)} style={{ display: 'none' }} id="offer-letter-upload" />
              <label htmlFor="offer-letter-upload" className="file-upload-label">
                <Upload size={18} />
                <span>{offerLetterFileName || 'Upload offer letter'}</span>
              </label>
              <p className="file-upload-hint">Upload JPG, PNG or PDF (max 5MB)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-section">
        <div className="modal-section-header">
          <MapPinned size={18} /><h4>Contact Information</h4>
        </div>
        <div className="modal-section-content">
          <div className="modal-field full-width">
            <label>Address</label>
            <input type="text" {...form.register('address')} placeholder="Enter full address" />
          </div>
          <div className="modal-field">
            <label>Emergency Contact Person Name</label>
            <input type="text" {...form.register('emergencyContactName')} placeholder="Contact person name" />
          </div>
          <div className="modal-field">
            <label>Emergency Contact Phone Number</label>
            <input type="text" {...form.register('emergencyContactPhone')} placeholder="Contact phone number" />
          </div>
        </div>
      </div>

      {(isMasterAdmin || user?.role === 'executive') && (
        <div className="modal-section">
          <div className="modal-section-header" onClick={() => setCompOpen(o => !o)} style={{ cursor: 'pointer' }}>
            <DollarSign size={18} /><h4>Compensation Details</h4>
            <ChevronDown size={16} style={{ marginLeft: 'auto', transform: compOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </div>
          {compOpen && (
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Monthly Gross Salary ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register('monthlyGrossSalary', { valueAsNumber: true })}
                  placeholder="0.00"
                />
              </div>
              <div className="modal-field">
                <label>Salary Effective Date</label>
                <input type="date" {...form.register('salaryEffectiveDate')} />
              </div>
              <hr className="form-divider" style={{ margin: '12px 0' }} />
              <h5 style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Payroll & Attendance Policy</h5>
              <div className="modal-field">
                <label>Salary Cycle</label>
                <select {...form.register('salaryCycle')}>
                  <option value="Monthly">Monthly</option>
                  <option value="Bi-weekly">Bi-weekly</option>
                </select>
              </div>
              <div className="modal-field">
                <label>Working Days / Month</label>
                <input type="number" min={1} max={31} {...form.register('workingDaysPerMonth', { valueAsNumber: true })} />
              </div>
              <div className="modal-field">
                <label>Overtime Rate (× base)</label>
                <input type="number" step="0.1" min={0} max={10} {...form.register('overtimeRatePerHour', { valueAsNumber: true })} />
              </div>
              <div className="modal-field">
                <label>Weekend Days</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                    const weekendVal = form.watch('weekendDays') || [0, 6]
                    const selected = weekendVal.includes(idx)
                    return (
                      <button
                        key={day}
                        type="button"
                        style={{
                          padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                          background: selected ? '#f97316' : '#f3f4f6',
                          color: selected ? '#fff' : '#374151',
                          border: selected ? '2px solid #f97316' : '2px solid #e5e7eb',
                          transition: 'all 0.15s',
                        }}
                        onClick={() => {
                          const current = form.getValues('weekendDays') || [0, 6]
                          const next = current.includes(idx)
                            ? current.filter(d => d !== idx)
                            : [...current, idx]
                          form.setValue('weekendDays', next, { shouldDirty: true })
                        }}
                      >
                        {day}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="modal-field">
                <label>Leave Balances</label>
                <span style={{ fontSize: 13, color: '#6b7280' }}>Set per-employee in Leave Entitlements below.</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="modal-section">
        <div className="modal-section-header">
          <CalendarRange size={18} /><h4>Leave Entitlements (Monthly → Yearly)</h4>
        </div>
        <div className="modal-section-content">
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
            Set this employee's monthly leave per type. Yearly entitlement = Monthly × 12.
            Leave a type blank (or 0) to grant no balance for it.
          </p>
          {LEAVE_TYPES.map((t) => {
            const monthlyVal = (form.watch('monthlyLeaveEntitlements') || {})[t]
            return (
              <div className="modal-field" key={t}>
                <label>{t} (days / month)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    placeholder="0"
                    {...form.register(`monthlyLeaveEntitlements.${t}`)}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                    = <strong>{yearlyOfMonthly(monthlyVal)}</strong> days / year
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </form>
  )
});

export function Employees() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [leaveBalanceMap, setLeaveBalanceMap] = useState<Record<string, Record<string, { avail: number; pending: number; total: number }>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [isDeletePermModalOpen, setIsDeletePermModalOpen] = useState(false)
  const [isDeletingPerm, setIsDeletingPerm] = useState(false)
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
  }
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [managerCandidates, setManagerCandidates] = useState<Employee[]>([])
  const [loadingManagerCandidates, setLoadingManagerCandidates] = useState(false)

  const fetchManagers = useCallback(async (companyId: string) => {
    if (!companyId) { setManagerCandidates([]); return }
    setLoadingManagerCandidates(true)
    try {
      const emps = await getReportingManagersByCompany(companyId)
      setManagerCandidates(emps)
    } catch {
      setManagerCandidates([])
    } finally {
      setLoadingManagerCandidates(false)
    }
  }, [])

  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, onLeave: 0 })

  const [filterDept, setFilterDept] = useState(searchParams.get('department') || '')
  const [filterRole, setFilterRole] = useState(searchParams.get('role') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '')
  const [filterCompany, setFilterCompany] = useState(searchParams.get('company') || '')

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole>('employee')
  const [isAssigningRole, setIsAssigningRole] = useState(false)
  const [showSalary, setShowSalary] = useState(false)

  const addFormRef = useRef<EmployeeFormRef>(null)
  const editFormRef = useRef<EmployeeFormRef>(null)

  const addForm = useForm<EmployeeFormValues>({
    // Cast: known @hookform/resolvers/zod inference mismatch (runtime identical).
    resolver: zodResolver(employeeSchema) as Resolver<EmployeeFormValues>,
    defaultValues: {
      name: '', email: '', username: '', password: '', phone: '', employeeId: '',
      department: '', departmentId: '', departmentColor: '#f97316',
      designation: '', status: 'Active', joinDate: '', birthDate: '',
      companyId: '', employmentType: 'Full-time',
      address: '', emergencyContactName: '', emergencyContactPhone: '',
      aadharDoc: '', aadharNumber: '', panDoc: '', panNumber: '', joiningLetterDoc: '',
      bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
      pfAccountNumber: '', uanNumber: '', offerLetterDoc: '',
      role: 'employee', managerId: '', managerName: '',
      monthlyGrossSalary: 0, salaryEffectiveDate: '',
      salaryCycle: 'Monthly', workingDaysPerMonth: 26, overtimeRatePerHour: 1.5, weekendDays: [0, 6], leavePolicyId: '',
      monthlyLeaveEntitlements: { Casual: '', Sick: '', Earned: '', Unpaid: '', Maternity: '', Paternity: '' },
    }
  })

  const editForm = useForm<EmployeeFormValues>({
    // Cast: known @hookform/resolvers/zod inference mismatch (runtime identical).
    resolver: zodResolver(employeeSchema) as Resolver<EmployeeFormValues>,
    defaultValues: {
      name: '', email: '', username: '', password: '', phone: '', employeeId: '',
      department: '', departmentId: '', departmentColor: '#f97316',
      designation: '', status: 'Active', joinDate: '', birthDate: '',
      companyId: '', employmentType: 'Full-time',
      address: '', emergencyContactName: '', emergencyContactPhone: '',
      aadharDoc: '', aadharNumber: '', panDoc: '', panNumber: '', joiningLetterDoc: '',
      bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
      pfAccountNumber: '', uanNumber: '', offerLetterDoc: '',
      role: 'employee', managerId: '', managerName: '',
      salaryCycle: 'Monthly', workingDaysPerMonth: 26, overtimeRatePerHour: 1.5, weekendDays: [0, 6], leavePolicyId: '',
      monthlyLeaveEntitlements: { Casual: '', Sick: '', Earned: '', Unpaid: '', Maternity: '', Paternity: '' },
    }
  })

  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, canAccessAllCompanies, availableCompanies, isCompanyRestricted } = usePermissionScope('employees')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const isMasterAdmin = user?.role === 'master-admin'
  const isExecutive = user?.role === 'executive'

  useEffect(() => {
    // Scope: selected company, or ALL authorized companies in "All Companies" mode
    const scopeIds = user?.role === 'master-admin'
      ? []
      : scopedCompanyIds(effectiveCompanyId, availableCompanies)

    const unsubs: (() => void)[] = []

    if (user?.role === 'master-admin') {
      const un = onSnapshot(query(collection(db, 'employees')), (snapshot) => {
        const emps = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Employee))
        setEmployees(emps)
        setStats({
          total: emps.length,
          active: emps.filter(e => e.status === 'Active').length,
          inactive: emps.filter(e => e.status === 'Inactive').length,
          onLeave: emps.filter(e => e.status === 'On Leave').length
        })
        setLoading(false)
      }, () => { setError('Failed to load employees'); setLoading(false) })
      unsubs.push(un)
    } else if (scopeIds.length > 0) {
      const mergedMap = new Map<string, Employee>()
      for (const chunk of chunkCompanyIds(scopeIds)) {
        const q = query(collection(db, 'employees'), companyIdWhere(chunk)!)
        const un = onSnapshot(q, (snapshot) => {
          snapshot.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() } as Employee))
          const emps = [...mergedMap.values()]
          setEmployees(emps)
          setStats({
            total: emps.length,
            active: emps.filter(e => e.status === 'Active').length,
            inactive: emps.filter(e => e.status === 'Inactive').length,
            onLeave: emps.filter(e => e.status === 'On Leave').length
          })
          setLoading(false)
        }, () => { setError('Failed to load employees'); setLoading(false) })
        unsubs.push(un)
      }
    } else {
      setEmployees([])
      setStats({ total: 0, active: 0, inactive: 0, onLeave: 0 })
      setLoading(false)
    }

    const unsubComp = onSnapshot(collection(db, 'companies'), (snapshot) => {
      setCompanies(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Company)))
    }, (err) => {
      console.error('[Employees] companies onSnapshot error:', err?.message || err);
    })
    unsubs.push(unsubComp)

    if (user?.role === 'master-admin') {
      const un = onSnapshot(collection(db, 'departments'), (snapshot) => {
        setDepartments(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Department)))
      }, (err) => {
        console.error('[Employees] departments onSnapshot error:', err?.message || err);
      })
      unsubs.push(un)
    } else if (scopeIds.length > 0) {
      const deptMap = new Map<string, Department>()
      for (const chunk of chunkCompanyIds(scopeIds)) {
        const q = query(collection(db, 'departments'), companyIdWhere(chunk)!)
        const un = onSnapshot(q, (snapshot) => {
          snapshot.docs.forEach(d => deptMap.set(d.id, { id: d.id, ...d.data() } as Department))
          setDepartments([...deptMap.values()])
        }, (err) => {
          console.error('[Employees] departments onSnapshot error:', err?.message || err);
        })
        unsubs.push(un)
      }
    } else {
      setDepartments([])
    }

    fetchRefs()

    return () => unsubs.forEach(u => u())
  }, [user?.role, effectiveCompanyId, availableCompanies])

  // Leave Balance computation (shared HR MAX calc: prorated by join date,
  // per-type available + pending days per employee)
  useEffect(() => {
    let active = true
    const ids = isMasterAdmin
      ? companies.map(c => c.id)
      : scopedCompanyIds(effectiveCompanyId, availableCompanies)
    if (ids.length === 0) { setLeaveBalanceMap({}); return }

    const compute = async () => {
      try {
        const allLeaves: LeaveRequest[] = []
        for (const chunk of chunkCompanyIds(ids)) {
          const q = query(collection(db, 'leaveRequests'), companyIdWhere(chunk)!)
          const snap = await getDocs(q)
          snap.docs.forEach(d => allLeaves.push({ id: d.id, ...d.data() } as LeaveRequest))
        }
        // Fetch each company's leave policies once per involved company
        const policiesByCompany: Record<string, LeavePolicy[]> = {}
        for (const cid of ids) {
          try {
            policiesByCompany[cid] = await getLeavePoliciesByCompany(cid)
          } catch (err) {
            policiesByCompany[cid] = []
          }
        }
        // Per-employee resolution: monthly entitlements (× 12) → assigned policy → default policy → company legacy allowances
        const resolveFor = (emp: Employee) => {
          const ent = resolveEmployeeLeaveEntitlements(emp)
          if (ent) return { allowances: ent.yearly, config: ent.config, skipJoinProration: true }
          const list = policiesByCompany[emp.companyId] || []
          const companyLeaveAllowances = companies.find(c => c.id === emp.companyId)?.leaveAllowances || {}
          if (list.length === 0) {
            // No policy and no per-employee entitlements → no hardcoded defaults.
            return { allowances: { ...companyLeaveAllowances }, config: undefined as LeaveBalanceConfig | undefined, skipJoinProration: false }
          }
          const pol = list.find(p => p.id === emp.leavePolicyId) || list.find(p => p.isDefault) || list[0]
          const effective: Record<string, { days: number; paid: boolean; encashable: boolean }> = {}
          for (const t of LEAVE_TYPES) {
            const base = DEFAULT_LEAVE_ALLOWANCES[t] ?? 0
            const entry = pol.types?.[t]
            effective[t] = { days: entry?.days ?? base, paid: entry?.paid ?? true, encashable: entry?.encashable ?? false }
          }
          return {
            allowances: Object.fromEntries(LEAVE_TYPES.map(t => [t, effective[t].days])) as Record<string, number>,
            config: {
              encashable: LEAVE_TYPES.filter(t => effective[t].encashable && effective[t].paid),
              paid: LEAVE_TYPES.filter(t => effective[t].paid),
            },
            skipJoinProration: false,
          }
        }
        const map: Record<string, Record<string, { avail: number; pending: number; total: number }>> = {}
        const year = new Date().getFullYear()
        for (const emp of employees) {
          const { allowances, config, skipJoinProration } = resolveFor(emp)
          const balance = computeLeaveBalance(allowances, allLeaves, emp.userId, year, emp.joinDate, config, skipJoinProration)
          const types: Record<string, { avail: number; pending: number; total: number }> = {}
          for (const t of LEAVE_TYPES) {
            types[t] = { avail: balance[t].available, pending: balance[t].pending, total: balance[t].allowance }
          }
          map[emp.userId] = types
        }
        if (active) setLeaveBalanceMap(map)
      } catch (e) {
        console.error('Failed to compute leave balance:', e)
        if (active) setLeaveBalanceMap({})
      }
    }
    compute()
    return () => { active = false }
  }, [employees, companies, isMasterAdmin, effectiveCompanyId, availableCompanies])

  const fetchRefs = async () => {
    const [usrs, rls] = await Promise.all([
      getAllUsers().catch(() => [] as UserType[]),
      getAllRoles().catch(() => []),
    ])
    setUsers(usrs)
    setRoles(rls)
  }

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus.toLowerCase())
    if (filterCompany) params.set('company', filterCompany)
    if (filterDept) params.set('department', filterDept)
    if (filterRole) params.set('role', filterRole)
    if (searchTerm) params.set('search', searchTerm)
    setSearchParams(params, { replace: true })
  }, [filterStatus, filterCompany, filterDept, filterRole, searchTerm, setSearchParams])

  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (!statusParam) { setFilterStatus(''); return }
    const mapped: Record<string, string> = { active: 'Active', inactive: 'Inactive', leave: 'On Leave', all: '' }
    const val = mapped[statusParam.toLowerCase()]
    if (val !== undefined && val !== filterStatus) setFilterStatus(val)
  }, [searchParams])

  const getFiltered = () => {
    return employees.filter(emp => {
      if (searchTerm) {
        const s = searchTerm.toLowerCase()
        const match = emp.name.toLowerCase().includes(s) ||
          emp.employeeId.toLowerCase().includes(s) ||
          emp.email.toLowerCase().includes(s) ||
          emp.phone.toLowerCase().includes(s) ||
          emp.department.toLowerCase().includes(s) ||
          emp.designation.toLowerCase().includes(s)
        if (!match) return false
      }
      if (filterDept && emp.department !== filterDept) return false
      if (filterStatus && emp.status !== filterStatus) return false
      if (filterCompany && emp.companyId !== filterCompany) return false
      if (filterRole) {
        const u = users.find(u => u.id === emp.userId)
        if (u?.role !== filterRole) return false
      }
      return true
    })
  }

  const filtered = getFiltered()
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (p: number) => { if (p >= 1 && p <= totalPages) setCurrentPage(p) }

  const handleExport = () => {
    const csv = [
      ['Employee ID', 'Name', 'Email', 'Phone', 'Company', 'Department', 'Designation', 'Role', 'Status', 'Join Date'].join(','),
      ...filtered.map(e => {
        const u = users.find(x => x.id === e.userId)
        const c = companies.find(x => x.id === e.companyId)
        return [e.employeeId, e.name, e.email, e.phone, c?.name || '', e.department, e.designation, u?.role || '', e.status, e.joinDate && isDate(e.joinDate) ? e.joinDate.toLocaleDateString() : ''].join(',')
      }),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'employees.csv'; a.click()
  }

  const uploadFileToStorage = async (file: File, employeeId: string, field: string): Promise<string> => {
    const storageRef = ref(storage, `employees/${employeeId}/${field}`)
    const snapshot = await uploadBytes(storageRef, file)
    return getDownloadURL(snapshot.ref)
  }

  const uploadEmployeeFiles = async (employeeId: string, files: { aadharDoc: File | null; panDoc: File | null; joiningLetterDoc: File | null; offerLetterDoc: File | null }) => {
    const uploads: { field: string; url: string }[] = []
    for (const [field, file] of Object.entries(files)) {
      if (file) {
        const url = await uploadFileToStorage(file, employeeId, field)
        uploads.push({ field, url })
      }
    }
    if (uploads.length > 0) {
      const updateData: Record<string, string> = {}
      uploads.forEach(u => updateData[u.field] = u.url)
      await updateEmployee(employeeId, updateData as any)
    }
  }

  const handleAdd = async (values: EmployeeFormValues) => {
    setFormError(null)
    setIsSubmitting(true)

    // Permission + company scope check
    if (!isMasterAdmin) {
      const permittedCompanies: string[] = (user as any)?.assignedCompanyIds || []
      if (!hasPermission('employees.create')) {
        const msg = 'Attempted Create Employee - Access Denied: missing create permission'
        if (user) {
          logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: msg, actionType: 'create', module: 'Employees', targetEntity: values.name, companyId: values.companyId, status: 'failure' })
        }
        setIsSubmitting(false)
        setFormError('You do not have permission to create employees')
        return
      }
      if (!permittedCompanies.includes(values.companyId)) {
        const msg = `Attempted Create Employee - Access Denied for Company: ${values.companyId}`
        if (user) {
          logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: msg, actionType: 'create', module: 'Employees', targetEntity: values.name, companyId: values.companyId, status: 'failure' })
        }
        setIsSubmitting(false)
        setFormError('This company is not in your authorized scope. Contact your admin.')
        return
      }
    }

    try {
      const joinDate = values.joinDate ? new Date(values.joinDate) : new Date()
      const birthDate = values.birthDate ? new Date(values.birthDate) : undefined
      const selectedCompany = companies.find(c => c.id === values.companyId)
      const companyCode = selectedCompany?.code || ''

      // Role: employee requires managerId; reporting-manager sets isReportingManager
      const isReportingManagerRole = values.role === 'reporting-manager'
      // Only enforce when someone is actually assignable — a brand-new company
      // may have zero employees yet, so the first hire can skip this.
      if (!isReportingManagerRole && !values.managerId && managerCandidates.length > 0) {
        setFormError('Manager is required for Employee role')
        setIsSubmitting(false)
        return
      }

      const employeePayload = {
        ...values,
        monthlyLeaveEntitlements: Object.keys(normalizeMonthlyLeaveEntitlements(values.monthlyLeaveEntitlements)).length > 0
          ? normalizeMonthlyLeaveEntitlements(values.monthlyLeaveEntitlements)
          : undefined,
        leaveEntitlementYear: new Date().getFullYear(),
        joinDate,
        birthDate: values.birthDate || '',
        userId: '',
        avatar: '',
        isReportingManager: isReportingManagerRole,
        reportingManagerId: values.managerId || '',
        reportingManagerName: values.managerName || '',
        reportsToRole: isReportingManagerRole
          ? 'company-admin'
          : (values.managerId
              ? managerCandidates.find(m => m.userId === values.managerId || m.id === values.managerId)?.role
              : undefined) === 'company-admin'
            ? 'company-admin'
            : 'reporting-manager',
      }
      const result = await createEmployee(
        employeePayload as any,
        user ? { id: user.id, name: user.name || 'Admin', role: user.role } : undefined,
        companyCode
      )
      if (result.id) {
        // Secondary, best-effort write: a transient rules denial here must never
        // fail the submission — the employee record is already created.
        const files = addFormRef.current?.getFilesForUpload()
        if (files) {
          try {
            await uploadEmployeeFiles(result.id, files)
          } catch (uploadErr) {
            console.warn('Document upload skipped during create:', uploadErr)
          }
        }
      }
      if (result.userId) {
        const targetRole = isReportingManagerRole ? 'reporting-manager' : 'employee'
        await updateUserRole(result.userId, targetRole).catch((e) => console.warn('Role sync skipped:', e))
      }
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: `Created employee: ${values.name}`,
          actionType: 'create',
          module: 'Employees',
          targetEntity: values.name,
          targetId: result.id,
          companyId: values.companyId,
          companyName: selectedCompany?.name,
          status: 'success',
        })
      }
      setIsAddModalOpen(false)
      addForm.reset()
      setFormError(null)
      showToast(
        `${isReportingManagerRole ? 'Reporting Manager' : 'Employee'} created! Username: ${values.username}, Password: ${values.password}`,
        'success'
      )
    } catch (err) {
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: `Attempted Create Employee - Write Error for Company: ${values.companyId}`,
          actionType: 'create',
          module: 'Employees',
          targetEntity: values.name,
          companyId: values.companyId,
          status: 'failure',
        })
      }
      const rawMsg = err instanceof Error ? err.message : String(err || '')
      setFormError(
        rawMsg.includes('already registered') || rawMsg.includes('already-exists')
          ? 'This email is already registered. Please use a different email address.'
          : rawMsg || 'Failed to add employee'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (values: EmployeeFormValues) => {
    if (!selectedEmployee) return
    setFormError(null)
    setIsSubmitting(true)
    try {
      const joinDate = values.joinDate ? new Date(values.joinDate) : new Date()
      const salaryChanged = selectedEmployee.monthlyGrossSalary !== values.monthlyGrossSalary
      const isRm = values.role === 'reporting-manager'
      const wasRm = !!(selectedEmployee as any).isReportingManager
      const roleChanged = isRm !== wasRm

      // Self-assignment prevention
      if (!isRm && values.managerId) {
        const selectedManagerId = values.managerId
        if (selectedManagerId === selectedEmployee.id || selectedManagerId === selectedEmployee.userId) {
          setFormError('An employee cannot be their own manager')
          setIsSubmitting(false)
          return
        }
      }

      const editPayload = {
        ...values,
        monthlyLeaveEntitlements: Object.keys(normalizeMonthlyLeaveEntitlements(values.monthlyLeaveEntitlements)).length > 0
          ? normalizeMonthlyLeaveEntitlements(values.monthlyLeaveEntitlements)
          : undefined,
        leaveEntitlementYear: new Date().getFullYear(),
        joinDate,
        isReportingManager: isRm,
        reportingManagerId: values.managerId || '',
        reportingManagerName: values.managerName || '',
      }
      await updateEmployee(selectedEmployee.id, editPayload as any)
      // Keep the login account (users doc) in sync with role / reporting-manager changes.
      if ((selectedEmployee as any).userId) {
        try {
          await updateDoc(doc(db, 'users', (selectedEmployee as any).userId), {
            name: values.name,
            phone: values.phone || '',
            designation: values.designation || '',
            departmentId: values.departmentId || null,
            isReportingManager: isRm,
            reportingManagerId: editPayload.reportingManagerId,
            reportingManagerName: editPayload.reportingManagerName,
            updatedAt: serverTimestamp(),
          })
        } catch (syncErr) {
          console.warn('User doc sync skipped:', syncErr)
        }
      }
      const files = editFormRef.current?.getFilesForUpload()
      if (files) {
        try {
          await uploadEmployeeFiles(selectedEmployee.id, files)
        } catch (uploadErr) {
          console.warn('Document upload skipped during save:', uploadErr)
        }
      }

      if (user) {
        // Cascading: role changed from RM → Employee -> their direct reports need reassignment
        if (roleChanged && wasRm) {
          logAudit({
            userId: user.id, userName: user.name, userRole: user.role,
            action: `Role changed: ${selectedEmployee.name} is no longer a Reporting Manager — direct reports need reassignment`,
            actionType: 'update', module: 'Employees',
            targetEntity: selectedEmployee.name,
            targetId: selectedEmployee.id,
            companyId: selectedEmployee.companyId,
            status: 'warning',
            details: 'Admin must reassign their former team to a new Reporting Manager',
          })
          createAdminAlert('role_change', 'Reporting Manager Demoted',
            `${selectedEmployee.name} was removed as Reporting Manager. Their direct reports need to be reassigned to a new manager.`,
            '/employees', 'high', {
              actionBy: user.id, actionByName: user.name,
              companyId: selectedEmployee.companyId,
            }
          )
        }

        // Cascading: role changed from Employee → RM
        if (roleChanged && isRm) {
          logAudit({
            userId: user.id, userName: user.name, userRole: user.role,
            action: `Role changed: ${selectedEmployee.name} is now a Reporting Manager`,
            actionType: 'update', module: 'Employees',
            targetEntity: selectedEmployee.name,
            targetId: selectedEmployee.id,
            companyId: selectedEmployee.companyId,
            status: 'success',
            details: 'This employee can now have direct reports assigned to them',
          })
        }

        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: `Updated employee: ${values.name}`,
          actionType: 'update',
          module: 'Employees',
          targetEntity: values.name,
          targetId: selectedEmployee.id,
          companyId: selectedEmployee.companyId,
          status: 'success',
        })
        if (salaryChanged) {
          const oldSalary = selectedEmployee.monthlyGrossSalary || 0
          const newSalary = values.monthlyGrossSalary || 0
          logAudit({
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            action: `Salary for ${values.name} updated from $${oldSalary.toFixed(2)} to $${newSalary.toFixed(2)} by ${user.name}`,
            actionType: 'update',
            module: 'Payroll',
            targetEntity: values.name,
            targetId: selectedEmployee.id,
            companyId: selectedEmployee.companyId,
            details: `Previous: $${oldSalary.toFixed(2)}, New: $${newSalary.toFixed(2)}${values.salaryEffectiveDate ? `, Effective: ${values.salaryEffectiveDate}` : ''}`,
            status: 'success',
          })
        }
      }
      setIsEditModalOpen(false)
      setSelectedEmployee(null)
      showToast(`${values.name} updated successfully!`, 'success')
    } catch (err) {
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: 'Failed to update employee',
          actionType: 'update',
          module: 'Employees',
          targetEntity: selectedEmployee.name,
          status: 'failure',
        })
      }
      setFormError('Failed to update employee')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedEmployee) return
    try {
      const wasRm = !!(selectedEmployee as any).isReportingManager
      await updateEmployee(selectedEmployee.id, { status: 'Inactive' } as any)
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: `Deactivated employee: ${selectedEmployee.name}`,
          actionType: 'update',
          module: 'Employees',
          targetEntity: selectedEmployee.name,
          targetId: selectedEmployee.id,
          companyId: selectedEmployee.companyId,
          status: 'success',
        })
      }
      createAdminAlert('user_deletion', 'Employee Deactivated', `${selectedEmployee.name} has been deactivated by ${user?.name || 'Admin'}`, '/employees', 'high', {
        actionBy: user?.id, actionByName: user?.name, companyId: selectedEmployee.companyId,
      })
      // Cascading alert if deactivated employee was a Reporting Manager
      if (wasRm) {
        createAdminAlert('role_change', 'Reporting Manager Deactivated',
          `${selectedEmployee.name} was a Reporting Manager and has been deactivated. Their direct reports need to be reassigned.`,
          '/employees', 'high', {
            actionBy: user?.id, actionByName: user?.name,
            companyId: selectedEmployee.companyId,
          }
        )
      }
      setIsDeleteModalOpen(false)
      setSelectedEmployee(null)
    } catch (err) {
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: 'Failed to deactivate employee',
          actionType: 'update',
          module: 'Employees',
          targetEntity: selectedEmployee.name,
          status: 'failure',
        })
      }
      setFormError('Failed to deactivate employee')
    }
  }

  const handleDeletePermanently = async () => {
    if (!selectedEmployee) return
    setIsDeletingPerm(true)
    try {
      const emp = selectedEmployee
      await deleteEmployee(emp.id, {
        userId: user?.id || '',
        userName: user?.name || '',
        userRole: user?.role || '',
        companyId: emp.companyId || '',
      })
      setIsDeletePermModalOpen(false)
      setSelectedEmployee(null)
      setToast({ message: `Employee ${emp.name} deleted permanently`, type: 'success' })
    } catch (err: any) {
      setIsDeletePermModalOpen(false)
      setSelectedEmployee(null)
      setToast({
        message: err?.message?.includes('permission')
          ? 'You do not have permission to permanently delete employees'
          : 'Failed to delete employee',
        type: 'error',
      })
    } finally {
      setIsDeletingPerm(false)
    }
  }

  const openAdd = () => {
    if (!canPerform('create', 'employees')) {
      setFormError(isScopeReady ? 'You do not have permission to create employees' : 'Select a company first to add employees.')
      return
    }

    addForm.reset()
    addForm.setValue('companyId', scopeCompanyId || effectiveCompanyId || user?.companyId || '')
    setFormError(null)
    setIsAddModalOpen(true)
  }

  const openEdit = (emp: Employee) => {
    setSelectedEmployee(emp)
    setFormError(null)
    const isRm = !!(emp as any).isReportingManager
    editForm.reset({
      name: emp.name,
      email: emp.email,
      phone: emp.phone || '',
      employeeId: emp.employeeId,
      department: emp.department,
      departmentId: emp.departmentId,
      departmentColor: emp.departmentColor,
      designation: emp.designation,
      status: emp.status,
      joinDate: emp.joinDate && isDate(emp.joinDate) ? emp.joinDate.toISOString().split('T')[0] : typeof emp.joinDate === 'string' ? emp.joinDate : '',
      birthDate: emp.birthDate ? (emp.birthDate && isDate(emp.birthDate) ? emp.birthDate.toISOString().split('T')[0] : typeof emp.birthDate === 'string' ? emp.birthDate : '') : '',
      companyId: emp.companyId,
      employmentType: emp.employmentType,
      address: emp.address || '',
      emergencyContactName: (emp as any).emergencyContactName || '',
      emergencyContactPhone: (emp as any).emergencyContactPhone || '',
      aadharDoc: (emp as any).aadharDoc || '',
      panDoc: (emp as any).panDoc || '',
      joiningLetterDoc: (emp as any).joiningLetterDoc || '',
      role: isRm ? 'reporting-manager' : 'employee',
      managerId: isRm
        ? (emp as any).reportingManagerId || (emp as any).managerId || ''
        : (emp as any).reportingManagerId || (emp as any).managerId || '',
      managerName: isRm
        ? (emp as any).reportingManagerName
          || users.find(u => u.id === ((emp as any).reportingManagerId || (emp as any).managerId))?.name
          || ''
        : (emp as any).reportingManagerName || (emp as any).managerName || '',
      isReportingManager: isRm,
      monthlyGrossSalary: emp.monthlyGrossSalary || 0,
      salaryEffectiveDate: emp.salaryEffectiveDate && isDate(emp.salaryEffectiveDate) ? emp.salaryEffectiveDate.toISOString().split('T')[0] : typeof emp.salaryEffectiveDate === 'string' ? emp.salaryEffectiveDate : '',
      salaryCycle: (emp as any).salaryCycle || 'Monthly',
      workingDaysPerMonth: (emp as any).workingDaysPerMonth || 26,
      overtimeRatePerHour: (emp as any).overtimeRatePerHour || 1.5,
      weekendDays: (emp as any).weekendDays || [0, 6],
      leavePolicyId: (emp as any).leavePolicyId || '',
      monthlyLeaveEntitlements: Object.fromEntries(LEAVE_TYPES.map(t => [t, String((emp as any).monthlyLeaveEntitlements?.[t] ?? '')])),
    })
    setIsEditModalOpen(true)
  }

  const openView = (emp: Employee) => {
    const prefix = location.pathname.startsWith('/team-leader') ? '/team-leader'
      : location.pathname.startsWith('/executive') ? '/executive'
      : location.pathname.startsWith('/company-admin') ? '/company-admin'
      : location.pathname.startsWith('/reporting-manager') ? '/reporting-manager'
      : '/master-admin'
    navigate(`${prefix}/employee-profile/${emp.slug || emp.id}`)
  }

  const openDeleteModal = (emp: Employee) => {
    setSelectedEmployee(emp)
    setIsDeleteModalOpen(true)
  }

  const handleResetPassword = async (emp: Employee) => {
    try {
      const tempPassword = 'HRM@' + Math.random().toString(36).substr(2, 6).toUpperCase()
      await updateEmployee(emp.id, { password: tempPassword } as any)
      if (user) {
        await createNotification(
          user.id, 'general', 'Password Reset',
          `Password for ${emp.name} (${(emp as any).username || emp.employeeId}) has been reset. New temp password: ${tempPassword}`,
          `/employees`, emp.companyId || ''
        )
      }
      setFormError(`Password reset for ${emp.name}. Temp Password: ${tempPassword}`)
    } catch (err) {
      setFormError('Failed to reset password')
    }
  }

  const openRole = (emp: Employee) => {
    setSelectedEmployee(emp)
    const u = users.find(x => x.id === emp.userId)
    setSelectedRole((u?.role || 'employee') as UserRole)
    setIsRoleModalOpen(true)
  }

  const handleAssignRole = async () => {
    if (!selectedEmployee?.userId) { setFormError('No user account linked'); return }
    setIsAssigningRole(true)
    try {
      await updateUserRole(selectedEmployee.userId, selectedRole)
      setIsRoleModalOpen(false)
    } catch (err: any) {
      setFormError(err.message || 'Failed to assign role')
    } finally {
      setIsAssigningRole(false)
    }
  }

  const clearFilters = () => {
    setFilterDept(''); setFilterRole(''); setFilterStatus(''); setFilterCompany(''); setSearchTerm('')
    setSearchParams({}, { replace: true })
  }

  const activeFilters = [filterDept, filterRole, filterStatus, filterCompany].filter(Boolean).length

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id
  const getDeptOptions = () => [...new Set(employees.map(e => e.department))].sort()
  const getCompanyOptions = () => companies
  const getRoleOptions = () => roles.length > 0 ? roles : ROLE_OPTIONS

  const handleCardStatus = (status?: string) => {
    const mapped: Record<string, string> = { active: 'Active', inactive: 'Inactive', leave: 'On Leave' }
    setFilterStatus(status && mapped[status] ? mapped[status] : '')
    setCurrentPage(1)
  }

  if (loading && employees.length === 0) {
    return (
      <div className="page-container">
        <Header title="Employees" breadcrumbs={['Dashboard', 'Employees']} />
        <div className="loading-container"><Loader2 className="spin" size={32} /><p>Loading employees...</p></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Employees" breadcrumbs={['Dashboard', 'Employees']} />

      <div className="page-content">
        {/* Error Banner */}
        {formError && (
          <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16 }}>
            <AlertCircle size={16} color="#ef4444" />
            <span style={{ color: '#991b1b', fontSize: 14 }}>{formError}</span>
            <button onClick={() => setFormError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} color="#991b1b" /></button>
          </div>
        )}

        {/* Scope context badge */}
        <ScopeIndicator />

        {/* Stats Cards */}
        <div className="emp-stats-row">
          {[
            { label: 'Total', key: '', icon: Users, count: stats.total },
            { label: 'Active', key: 'active', icon: UserCheck, count: stats.active },
            { label: 'Inactive', key: 'inactive', icon: UserX, count: stats.inactive },
            { label: 'On Leave', key: 'leave', icon: UserPlus, count: stats.onLeave },
          ].map(card => {
            const isActive = card.key === '' ? !filterStatus : filterStatus === ({ active: 'Active', inactive: 'Inactive', leave: 'On Leave' }[card.key])
            return (
              <div key={card.label}
                className={`emp-mini-stat clickable ${isActive ? 'stat-active' : ''}`}
                onClick={() => handleCardStatus(card.key || undefined)}
                tabIndex={0}
                role="button"
                aria-pressed={isActive}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardStatus(card.key || undefined) }}}>
                <card.icon size={20} /><div><strong>{card.count}</strong><span>{card.label}</span></div>
              </div>
            )
          })}
        </div>

        {/* Search & Filters */}
        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search by name, ID, email, phone, department..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
            {searchTerm && <button className="emp-clear-btn" onClick={() => setSearchTerm('')}><X size={14} /></button>}
          </div>
          <div className="emp-toolbar-actions">
            <div className="emp-filter-group">
              <Filter size={16} />
              <select value={filterDept} onChange={e => { setFilterDept(e.target.value); setCurrentPage(1) }}>
                <option value="">All Depts</option>
                {getDeptOptions().map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setCurrentPage(1) }}>
                <option value="">All Roles</option>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1) }}>
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <select value={filterCompany} onChange={e => { setFilterCompany(e.target.value); setCurrentPage(1) }}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {(canAccessAllCompanies ? companies : availableCompanies).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {activeFilters > 0 && <button className="emp-clear-filters" onClick={clearFilters}>Clear ({activeFilters})</button>}
          </div>
        </div>

        <div className="emp-actions-bar">
          <div className="emp-actions-left"></div>
          <div className="emp-actions-right">
            <div className="emp-export-dropdown">
              <button className="btn-outline btn-sm" onClick={handleExport}><Download size={14} /> Export CSV</button>
            </div>
            {canPerform('create', 'employees') && (
              <button className={`btn-outline btn-sm${showSalary ? ' btn-active' : ''}`} onClick={() => setShowSalary(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {showSalary ? <EyeOff size={14} /> : <DollarSign size={14} />}
                {showSalary ? 'Hide Salary' : 'View Salary'}
              </button>
            )}
            {canPerform('create', 'employees') && (
              <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={16} /> Add Employee</button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="table-container">
          <table className="emp-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Employee Name</th>
                <th>Company</th>
                <th>Department</th>
                <th>Role</th>
                <th>Designation</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Join Date</th>
                {showSalary && <th>Monthly Salary</th>}
                <th>Status</th>
                <th>Casual Leave</th>
                <th>Sick Leave</th>
                <th>Earned Leave</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={showSalary ? 15 : 14}>
                    <div className="emp-empty">
                      <Users size={48} />
                      <h4>No employees found</h4>
                      <p>Create your first employee to get started.</p>
                      {canPerform('create', 'employees') && (
                        <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Employee</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : paginated.map(emp => {
                const sc = getStatusColor(emp.status)
                const u = users.find(x => x.id === emp.userId)
                const roleInfo = ROLE_OPTIONS.find(r => r.value === u?.role)
                const c = companies.find(x => x.id === emp.companyId)
                return (
                  <tr key={emp.id}>
                    <td><span className="emp-id-badge">{emp.employeeId}</span></td>
                    <td>
                      <div className="emp-name-cell">
                        <div>
                          <span className="emp-name">{emp.name}</span>
                          <span className="emp-sub">{emp.designation}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className="emp-company">{c?.name || '-'}</span></td>
                    <td><span className="emp-dept-badge" style={{ background: emp.departmentColor + '20', color: emp.departmentColor }}>{emp.department}</span></td>
                    <td>
                      {roleInfo ? (
                        <span className="emp-role-badge" style={{ background: roleInfo.color + '20', color: roleInfo.color }}>{roleInfo.label}</span>
                      ) : (
                        <span className="emp-no-role">-</span>
                      )}
                    </td>
                    <td><span className="emp-designation">{emp.designation}</span></td>
                    <td><span className="emp-email-cell">{emp.email}</span></td>
                    <td><span className="emp-phone-cell">{emp.phone || '-'}</span></td>
                    <td><span className="emp-date-cell">{emp.joinDate && isDate(emp.joinDate) ? emp.joinDate.toLocaleDateString() : typeof emp.joinDate === 'string' ? emp.joinDate : '-'}</span></td>
                    {showSalary && <td><span className="emp-salary-cell">{emp.monthlyGrossSalary ? `$${emp.monthlyGrossSalary.toFixed(2)}` : '-'}</span></td>}
                    <td><span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{emp.status}</span></td>
                    {['Casual', 'Sick', 'Earned'].map(t => {
                      const b = leaveBalanceMap[emp.userId]?.[t]
                      const color = b && b.avail <= 0 ? '#ef4444' : '#2563eb'
                      return (
                        <td key={t}>
                          {b ? (
                            <span style={{ fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {b.avail}/{b.total}
                              {b.pending > 0 && <span style={{ color: '#f59e0b', fontSize: 10, marginLeft: 3 }}>(+{b.pending})</span>}
                            </span>
                          ) : <span style={{ color: '#6b7280' }}>-</span>}
                        </td>
                      )
                    })}
                    <td>
                      <div className="emp-actions">
                        <button className="emp-action-icon view" onClick={() => openView(emp)} title="View"><Eye size={15} /></button>
                        {canPerform('edit', 'employees') && (
                          <button className="emp-action-icon edit" onClick={() => openEdit(emp)} title="Edit"><Pencil size={15} /></button>
                        )}
                        {canPerform('delete', 'employees') && (
                          <button className="emp-action-icon delete" onClick={() => openDeleteModal(emp)} title="Deactivate"><Trash2 size={15} /></button>
                        )}
                        {canPerform('delete', 'employees') && (
                          <button className="emp-action-icon delete" style={{ color: '#dc2626' }} onClick={() => { setSelectedEmployee(emp); setIsDeletePermModalOpen(true) }} title="Delete Permanently"><XCircle size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="emp-pagination">
          <div className="emp-page-info">
            <span>Showing {paginated.length} of {filtered.length} entries</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
          <div className="emp-page-controls">
            <button disabled={currentPage === 1} onClick={() => handlePageChange(1)}><ChevronLeft size={14} /></button>
            <button disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1).map((p, i, arr) => (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {i > 0 && arr[i - 1] !== p - 1 && <span className="emp-page-dots">...</span>}
                <button className={`emp-page-btn${currentPage === p ? ' active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
              </span>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}><ChevronRight size={14} /></button>
            <button disabled={currentPage === totalPages} onClick={() => handlePageChange(totalPages)}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* ADD EMPLOYEE MODAL */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Create Employee"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
            <button className="btn-primary" form="emp-add-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Employee'}
            </button>
          </>
        }
      >
        <EmployeeFormContent ref={addFormRef} form={addForm} formId="emp-add-form" onSubmit={handleAdd} companies={companies} departments={departments} employees={employees} managerCandidates={managerCandidates} loadingManagerCandidates={loadingManagerCandidates} fetchManagers={fetchManagers} users={users} scopedCompanies={availableCompanies} />
      </Modal>

      {/* EDIT EMPLOYEE MODAL */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Employee"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
            <button className="btn-primary" form="emp-edit-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <EmployeeFormContent ref={editFormRef} form={editForm} formId="emp-edit-form" onSubmit={handleEdit} companies={companies} departments={departments} employees={employees} managerCandidates={managerCandidates} loadingManagerCandidates={loadingManagerCandidates} fetchManagers={fetchManagers} users={users} excludeEmployeeId={selectedEmployee?.id} scopedCompanies={availableCompanies} />
      </Modal>

      {/* VIEW PROFILE MODAL */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Employee Profile"
        size="large"
        footer={
          <>
            {selectedEmployee && (
              <>
                <button className="btn-secondary" onClick={() => handleResetPassword(selectedEmployee)}><Shield size={14} /> Reset Password</button>
                {canPerform('edit', 'employees') && (
                  <button className="btn-secondary" onClick={() => { setIsViewModalOpen(false); if (selectedEmployee) openEdit(selectedEmployee) }}><Pencil size={14} /> Edit</button>
                )}
              </>
            )}
            <button className="btn-primary" onClick={() => setIsViewModalOpen(false)}>Close</button>
          </>
        }
      >
        {selectedEmployee && (() => {
          const u = users.find(x => x.id === selectedEmployee.userId)
          const c = companies.find(x => x.id === selectedEmployee.companyId)
          const roleInfo = ROLE_OPTIONS.find(r => r.value === u?.role)
          const sc = getStatusColor(selectedEmployee.status)
          return (
            <div>
              <div className="modal-profile-header">
                <div className="modal-profile-info">
                  <h2>{selectedEmployee.name}</h2>
                  <p>{selectedEmployee.designation} · {c?.name || 'N/A'}</p>
                  <div className="modal-profile-badges">
                    <span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{selectedEmployee.status}</span>
                    {roleInfo && <span className="emp-role-badge" style={{ background: roleInfo.color + '20', color: roleInfo.color }}>{roleInfo.label}</span>}
                    <span className="emp-dept-badge" style={{ background: selectedEmployee.departmentColor + '20', color: selectedEmployee.departmentColor }}>{selectedEmployee.department}</span>
                  </div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><User size={18} /><h4>Basic Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Full Name</label><div className="field-value">{selectedEmployee.name}</div></div>
                  <div className="modal-field"><label>Email</label><div className="field-value">{selectedEmployee.email}</div></div>
                  <div className="modal-field"><label>Phone</label><div className="field-value">{selectedEmployee.phone || '-'}</div></div>
                  <div className="modal-field"><label>Employee ID</label><div className="field-value">{selectedEmployee.employeeId}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Building2 size={18} /><h4>Organization Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Company</label><div className="field-value">{c?.name || '-'}</div></div>
                  <div className="modal-field"><label>Department</label><div className="field-value">{selectedEmployee.department || '-'}</div></div>
                  <div className="modal-field"><label>Designation</label><div className="field-value">{selectedEmployee.designation}</div></div>
                  <div className="modal-field"><label>Role</label><div className="field-value">{roleInfo?.label || u?.role || '-'}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Briefcase size={18} /><h4>Employment Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Employment Type</label><div className="field-value">{selectedEmployee.employmentType}</div></div>
                  <div className="modal-field"><label>Join Date</label><div className="field-value">{selectedEmployee.joinDate && isDate(selectedEmployee.joinDate) ? selectedEmployee.joinDate.toLocaleDateString() : typeof selectedEmployee.joinDate === 'string' ? selectedEmployee.joinDate : '-'}</div></div>
                  <div className="modal-field"><label>Monthly Salary</label><div className="field-value">{selectedEmployee.monthlyGrossSalary ? `$${selectedEmployee.monthlyGrossSalary.toFixed(2)}` : '-'}</div></div>
                  <div className="modal-field"><label>Salary Effective Date</label><div className="field-value">{selectedEmployee.salaryEffectiveDate ? (isDate(selectedEmployee.salaryEffectiveDate) ? selectedEmployee.salaryEffectiveDate.toLocaleDateString() : selectedEmployee.salaryEffectiveDate) : '-'}</div></div>
                  <div className="modal-field"><label>Status</label><div className="field-value" style={{ color: sc.text }}>{selectedEmployee.status}</div></div>
                  <div className="modal-field"><label>Aadhar Card</label><div className="field-value">{(selectedEmployee as any).aadharDoc ? <a href={(selectedEmployee as any).aadharDoc} target="_blank" rel="noopener noreferrer">View Document</a> : '-'}</div></div>
                  <div className="modal-field"><label>PAN Card</label><div className="field-value">{(selectedEmployee as any).panDoc ? <a href={(selectedEmployee as any).panDoc} target="_blank" rel="noopener noreferrer">View Document</a> : '-'}</div></div>
                  <div className="modal-field"><label>Joining Letter</label><div className="field-value">{(selectedEmployee as any).joiningLetterDoc ? <a href={(selectedEmployee as any).joiningLetterDoc} target="_blank" rel="noopener noreferrer">View Document</a> : '-'}</div></div>
                </div>
              </div>

              {selectedEmployee.userId && (
                <LeaveBalanceCard userId={selectedEmployee.userId} companyId={selectedEmployee.companyId} employeePolicyId={(selectedEmployee as any).leavePolicyId} monthlyEntitlements={(selectedEmployee as any).monthlyLeaveEntitlements} joinDate={selectedEmployee.joinDate} />
              )}

              <div className="modal-section">
                <div className="modal-section-header"><MapPinned size={18} /><h4>Contact Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Address</label><div className="field-value">{selectedEmployee.address || '-'}</div></div>
                  <div className="modal-field"><label>Emergency Contact Person</label><div className="field-value">{(selectedEmployee as any).emergencyContactName || '-'}</div></div>
                  <div className="modal-field"><label>Emergency Contact Phone</label><div className="field-value">{(selectedEmployee as any).emergencyContactPhone || '-'}</div></div>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ROLE ASSIGNMENT MODAL */}
      <Modal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        title="Assign Role"
        size="small"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setIsRoleModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAssignRole} disabled={isAssigningRole}>
              {isAssigningRole ? 'Assigning...' : 'Assign Role'}
            </button>
          </>
        }
      >
        {selectedEmployee && (
          <div>
            <p style={{ marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
              Assign role for <strong>{selectedEmployee.name}</strong>
            </p>
            <div className="emp-role-options">
              {ROLE_OPTIONS.map(r => (
                <label key={r.value} className={`emp-role-option${selectedRole === r.value ? ' selected' : ''}`} style={{ borderColor: selectedRole === r.value ? r.color : '#e5e7eb' }}>
                  <input type="radio" name="role" value={r.value} checked={selectedRole === r.value} onChange={e => setSelectedRole(e.target.value as UserRole)} />
                  <span className="emp-role-radio" style={{ background: selectedRole === r.value ? r.color : '#f3f4f6' }} />
                  <div>
                    <strong style={{ color: r.color }}>{r.label}</strong>
                    <small>{r.value === 'master-admin' ? 'Full system access' : r.value === 'company-admin' ? 'Company management' : r.value === 'team-leader' ? 'Team management' : 'Basic access'}</small>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Deactivate Employee" size="small">
        {selectedEmployee && (
          <div className="delete-confirmation">
            <div className="delete-warning">
              <AlertCircle size={48} color="#ef4444" />
              <h3>Are you sure?</h3>
              <p>You are about to deactivate <strong>{selectedEmployee.name}</strong>. Their status will be set to Inactive.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancel</button>
              {canPerform('delete', 'employees') && (
                <button className="btn-danger" onClick={handleDelete}>Deactivate</button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* DELETE PERMANENTLY CONFIRMATION MODAL */}
      <Modal isOpen={isDeletePermModalOpen} onClose={() => setIsDeletePermModalOpen(false)} title="Delete Employee Permanently" size="small">
        {selectedEmployee && (
          <div className="delete-confirmation">
            <div className="delete-warning">
              <AlertCircle size={48} color="#ef4444" />
              <h3>Are you sure?</h3>
              <p>You are about to permanently delete <strong>{selectedEmployee.name}</strong>. Their employee record will be removed from the system and this cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsDeletePermModalOpen(false)}>Cancel</button>
              {canPerform('delete', 'employees') && (
                <button className="btn-danger" onClick={handleDeletePermanently} disabled={isDeletingPerm}>
                  {isDeletingPerm ? 'Deleting...' : 'Delete Permanently'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
