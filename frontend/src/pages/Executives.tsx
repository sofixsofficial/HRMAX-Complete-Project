import { useState, useEffect, useRef, useMemo } from 'react'
import { Crown, Search, Plus, Eye, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Mail, Phone, Briefcase, X, User as UserIcon, Shield, Building2, Lock, Users, Check, CheckSquare, ChevronDown, Upload, DollarSign, CalendarDays, MapPin, Phone as PhoneIcon, FileText, CreditCard, BadgeAlert, KeyRound, Crosshair, Wifi, Camera, Smartphone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { Resolver } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { collection, doc, onSnapshot, query, updateDoc, deleteDoc, serverTimestamp, getDocs, getDoc, where } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { sendPasswordResetEmail } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { createAdminAlert, createNotification } from '../services/notificationService'
import { auth, db, storage, functions } from '../config/firebase'
import { logAudit } from '../services/auditLogService'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Toast } from '../components/Toast'
import { isDate } from '../utils/dateUtils'
import { useAuth } from '../context/AuthContext'
import { useTLFilter } from '../context/TLFilterContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { scopedCompanyIds } from '../utils/companyScope'
import { getDepartmentsByCompany, getAllDepartments } from '../services/departmentService'
import { getAllCompanies } from '../services/companyService'
import type { User, Department, Company } from '../types/user'
import './Employees.css'

const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const
const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const

const cleanText = (value?: string | null): string => {
  if (!value) return ''
  return value
    .replace(/\u00e2\u20ac\u201d/g, '\u2014')
    .replace(/\u00e2\u20ac\u201c/g, '\u2013')
    .replace(/\u00e2\u20ac\u2122/g, '\u2019')
    .replace(/\u00e2\u20ac\u2019/g, '\u2019')
    .replace(/\u00e2\u20ac\u2018/g, '\u2018')
    .replace(/\u00c2/g, '')
}

const resolveName = (u?: User): string => {
  const name = u?.name || (u as any)?.fullName || (u as any)?.displayName || ''
  return cleanText(name)
}

const resolveDepartment = (u: any, departments: Department[]): string => {
  const viaId = u?.departmentId ? departments.find(d => d.id === u.departmentId)?.name || '' : ''
  const stored = u?.department || u?.departmentName || ''
  const viaStoredId = stored && !viaId ? departments.find(d => d.id === stored)?.name || '' : ''
  return cleanText(viaId || viaStoredId || stored)
}

const executiveSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  executiveTitle: z.string().optional().default(''),
  companyId: z.string().optional().default(''),
  departmentId: z.string().optional().default(''),
  departmentName: z.string().optional().default(''),
  assignedCompanyIds: z.array(z.string()).default([]),
  assignedTeamLeaderIds: z.array(z.string()).default([]),

  // Employment & Compliance
  employmentType: z.enum(EMPLOYMENT_TYPE_OPTIONS).optional().default('Full-time'),
  status: z.enum(STATUS_OPTIONS).optional().default('Active'),
  joinDate: z.string().optional().default(''),
  aadharNumber: z.string().optional().default(''),
  aadharDoc: z.string().optional().default(''),
  panNumber: z.string().optional().default(''),
  panDoc: z.string().optional().default(''),
  joiningLetterDoc: z.string().optional().default(''),

  // Bank & Statutory
  bankName: z.string().optional().default(''),
  accountHolderName: z.string().optional().default(''),
  accountNumber: z.string().optional().default(''),
  ifscCode: z.string().optional().default(''),
  pfAccountNumber: z.string().optional().default(''),
  uanNumber: z.string().optional().default(''),
  offerLetterDoc: z.string().optional().default(''),

  // Contact Information
  address: z.string().optional().default(''),
  emergencyContactName: z.string().optional().default(''),
  emergencyContactPhone: z.string().optional().default(''),

  // Compensation
  monthlyGrossSalary: z.preprocess(
    (v) => (typeof v === 'number' && Number.isNaN(v) ? undefined : v),
    z.number().min(0).optional()
  ),
  salaryEffectiveDate: z.string().optional().default(''),

  // Attendance Configuration
  officeAddress: z.string().optional().default(''),
  latitude: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.number().optional()).default(0),
  longitude: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.number().optional()).default(0),
  radiusInMeters: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.number().min(50).max(500).optional()).default(100),
  allowMobileData: z.boolean().default(true),
  requireWifi: z.boolean().default(false),
  wifiSSID: z.string().optional().default(''),
  requireSelfie: z.boolean().default(false),
})

type ExecutiveFormValues = z.infer<typeof executiveSchema>

const authErrorMessage = (code: string): string => {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please use a different email or log in.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    case 'auth/invalid-email':
      return 'The email address is not valid.'
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled. Contact your administrator.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.'
    default:
      return code.includes('auth/') ? 'Authentication failed. Please try again.' : ''
  }
}

interface PermissionGroup {
  module: string
  actions: string[]
  description: string
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  { module: 'Employees', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'Manage employee profiles, records, and account data' },
  { module: 'Attendance', actions: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'manage'], description: 'View and manage attendance logs, check-ins/outs' },
  { module: 'Leave', actions: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'manage'], description: 'View, create, and approve/reject leave requests' },
  { module: 'Payroll', actions: ['view', 'create', 'edit', 'delete', 'approve', 'calculate', 'disburse', 'manage'], description: 'View and manage payroll runs and disbursements' },
  { module: 'Salary', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'], description: 'View and manage salary structures and slips' },
  { module: 'Tasks', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View and manage tasks across the organization' },
  { module: 'Support', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View and manage support tickets' },
  { module: 'Holidays', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'], description: 'View and manage holiday calendars' },
  { module: 'Announcements', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View and manage company announcements' },
  { module: 'Reports', actions: ['view', 'create', 'edit', 'delete', 'export', 'download', 'manage'], description: 'View analytics reports and dashboards' },
  { module: 'Settings', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View and modify system configuration settings' },
  { module: 'Companies', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View and manage company profiles and data' },
  { module: 'Departments', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'View, create, edit, and delete departments for assigned companies' },
  { module: 'Assets', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'Manage company assets, assignments, and returns' },
]

const getPermissionKey = (module: string, action: string) =>
  `${module.toLowerCase().replace(/\s+/g, '_')}.${action}`

// â”€â”€ Multi-Select Component â”€â”€
interface MultiSelectProps {
  label: string
  options: { id: string; label: string; sublabel?: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
}

const MultiSelect = ({ label, options, selected, onChange, placeholder, searchPlaceholder }: MultiSelectProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sublabel || '').toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  const toggleAll = () => {
    onChange(selected.length === options.length ? [] : options.map(o => o.id))
  }

  return (
    <div className="form-group hierarchy-multi-select">
      <label>{label}</label>
      <div className="hms-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="hms-placeholder">
          {selected.length === 0 ? (placeholder || `Select ${label.toLowerCase()}...`) : `${selected.length} selected`}
        </span>
        <ChevronDown size={16} className={`hms-chevron ${isOpen ? 'open' : ''}`} />
      </div>
      {selected.length > 0 && (
        <div className="hms-tags">
          {selected.slice(0, 3).map(id => {
            const opt = options.find(o => o.id === id)
            return opt ? <span key={id} className="hms-tag">{opt.label}</span> : null
          })}
          {selected.length > 3 && <span className="hms-tag hms-tag-more">+{selected.length - 3}</span>}
        </div>
      )}
      {isOpen && (
        <div className="hms-dropdown">
          <div className="hms-search-row">
            <input
              type="text"
              placeholder={searchPlaceholder || 'Search...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <button type="button" className="hms-toggle-all" onClick={toggleAll}>
              {selected.length === options.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="hms-options">
            {filtered.length === 0 ? (
              <div className="hms-empty">No options found</div>
            ) : filtered.map(opt => (
              <label key={opt.id} className={`hms-option ${selected.includes(opt.id) ? 'selected' : ''}`}>
                <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)} />
                <div className="hms-option-info">
                  <span className="hms-option-label">{opt.label}</span>
                  {opt.sublabel && <span className="hms-option-sub">{opt.sublabel}</span>}
                </div>
                {selected.includes(opt.id) && <Check size={14} className="hms-check" />}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// â”€â”€ Permissions Section â”€â”€
const ACTION_META: Record<string, { label: string; desc: string; tooltip: string }> = {
  view:      { label: 'View',    desc: 'Read-only access',  tooltip: 'Access to read-only data' },
  create:    { label: 'Create',  desc: 'Add new entries',   tooltip: 'Permission to add new entries' },
  edit:      { label: 'Edit',    desc: 'Update records',    tooltip: 'Permission to update existing records' },
  delete:    { label: 'Delete',  desc: 'Remove entries',    tooltip: 'Permission to remove entries permanently' },
  approve:   { label: 'Approve', desc: 'Authorize',         tooltip: 'Authority to authorize requests (e.g., Leave/Payroll)' },
  reject:    { label: 'Reject',  desc: 'Decline requests',  tooltip: 'Authority to decline requests' },
  cancel:    { label: 'Cancel',  desc: 'Withdraw requests', tooltip: 'Authority to withdraw/cancel requests' },
  calculate: { label: 'Calc',    desc: 'Run calculations',  tooltip: 'Permission to run payroll/salary calculations' },
  disburse:  { label: 'Disburse',desc: 'Release payouts',   tooltip: 'Permission to release salary payouts' },
  export:    { label: 'Export',  desc: 'Download data',     tooltip: 'Permission to export data files' },
  download:  { label: 'Download',desc: 'Save reports',      tooltip: 'Permission to download reports/documents' },
  manage:    { label: 'Manage',  desc: 'Full control',      tooltip: 'Full administrative control over this module' },
}

// Columns are derived from the catalog so every declared action gets a real,
// working checkbox — and the "X of Y selected" counter always matches the grid.
const ACTION_COLUMN_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'calculate', 'disburse', 'export', 'download', 'manage']
const MATRIX_ACTIONS: string[] = [...new Set(PERMISSION_GROUPS.flatMap(g => g.actions))]
  .sort((a, b) => {
    const ia = ACTION_COLUMN_ORDER.indexOf(a), ib = ACTION_COLUMN_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.actions.map(a => getPermissionKey(g.module, a)))

// â”€â”€ Quick-Start Templates â”€â”€
const TEMPLATES: Record<string, { label: string; icon: any; desc: string; perms: string[] | null }> = {
  'full-access': {
    label: 'Full Access',
    icon: Crown,
    desc: 'All modules, all actions',
    perms: ALL_PERMISSIONS,
  },
  'hr-manager': {
    label: 'HR Manager',
    icon: Users,
    desc: 'Employee, attendance, leave, payroll, holidays',
    perms: PERMISSION_GROUPS
      .filter(g => ['Employees', 'Attendance', 'Leave', 'Payroll', 'Salary', 'Holidays', 'Reports'].includes(g.module))
      .flatMap(g => g.actions.map(a => getPermissionKey(g.module, a)))
      .concat(['settings.view', 'companies.view']),
  },
  'team-leader': {
    label: 'Team Leader',
    icon: Shield,
    desc: 'All modules, all actions (assigned companies only)',
    perms: ALL_PERMISSIONS,
  },
  'custom': {
    label: 'Custom',
    icon: CheckSquare,
    desc: 'Manually toggle individual permissions',
    perms: null,
  },
}

function buildSummaryLabel(permissions: string[]): string {
  const lines: string[] = []
  for (const g of PERMISSION_GROUPS) {
    const active = g.actions.filter(a => permissions.includes(getPermissionKey(g.module, a)))
    if (active.length === 0) continue
    if (active.length === g.actions.length) {
      lines.push(`All ${g.module} access`)
    } else {
      const labels = active.map(a => a.charAt(0).toUpperCase() + a.slice(1))
      lines.push(`${labels.join(', ')} ${g.module}`)
    }
  }
  return lines.length > 0 ? 'This executive can: ' + lines.join('; ') : 'No permissions assigned'
}

function PermissionsSection({
  permissions, setter,
}: {
  permissions: string[]
  setter: (p: string[]) => void
}) {
  const totalActions = PERMISSION_GROUPS.reduce((s, g) => s + g.actions.length, 0)
  const selectedCount = permissions.length
  const allSelected = permissions.length === totalActions
  const gridCols = `minmax(180px, 1.6fr) repeat(${MATRIX_ACTIONS.length}, minmax(88px, 1fr))`

  const toggleModule = (module: string, actions: string[]) => {
    const perms = actions.map(a => getPermissionKey(module, a))
    const allChecked = perms.every(p => permissions.includes(p))
    setter(allChecked ? permissions.filter(p => !perms.includes(p)) : [...new Set([...permissions, ...perms])])
  }

  // Column header click: toggle this action across every module that supports it
  const toggleColumn = (action: string) => {
    const keys = PERMISSION_GROUPS.filter(g => g.actions.includes(action)).map(g => getPermissionKey(g.module, action))
    const allChecked = keys.every(k => permissions.includes(k))
    setter(allChecked ? permissions.filter(p => !keys.includes(p)) : [...new Set([...permissions, ...keys])])
  }

  const handleGrantAll = (granted: boolean) => {
    if (granted) {
      setter(ALL_PERMISSIONS)
    }
  }

  const selectAll = () => setter(ALL_PERMISSIONS)
  const clearAll = () => setter([])

  const applyTemplate = (key: string) => {
    const tpl = TEMPLATES[key]
    if (tpl && tpl.perms) {
      setter(tpl.perms)
    }
  }

  const isTemplateMatch = (key: string): boolean => {
    if (key === 'custom') {
      return !Object.keys(TEMPLATES).some(k => k !== 'custom' && arraysMatch(TEMPLATES[k].perms || [], permissions))
    }
    const tpl = TEMPLATES[key]
    return tpl?.perms !== null && arraysMatch(tpl?.perms || [], permissions)
  }

  const arraysMatch = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    return a.every(v => b.includes(v))
  }

  const activeTemplate = Object.keys(TEMPLATES).find(k => isTemplateMatch(k)) || 'custom'

  return (
    <div>
      {/* Quick-Start Templates */}
      <div className="perm-templates">
        <span className="perm-templates-label">Quick-Start Templates</span>
        <div className="perm-templates-grid">
          {Object.entries(TEMPLATES).map(([key, tpl]) => {
            const TplIcon = tpl.icon
            return (
              <button
                key={key}
                type="button"
                className={`perm-template-btn ${activeTemplate === key ? 'active' : ''}`}
                onClick={() => applyTemplate(key)}
                title={tpl.desc}
              >
                <TplIcon size={14} />
                <span>{tpl.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Permission Matrix (scrollable) */}
      <div className="perm-table-container">
        <div className="perm-table-controls">
          <div className="perm-table-summary">
            <strong>{selectedCount}</strong> of <strong>{totalActions}</strong> permissions selected
          </div>
          <button type="button" className="perm-table-action-btn" onClick={selectAll}>Select All</button>
          <button type="button" className="perm-table-action-btn" onClick={clearAll}>Clear All</button>
        </div>

        <div className="perm-table">
          <div className="perm-table-header" style={{ gridTemplateColumns: gridCols }}>
            <div className="perm-table-col-module">Module</div>
            {MATRIX_ACTIONS.map(a => {
              const colKeys = PERMISSION_GROUPS.filter(g => g.actions.includes(a)).map(g => getPermissionKey(g.module, a))
              const colAllChecked = colKeys.every(k => permissions.includes(k))
              const colSomeChecked = !colAllChecked && colKeys.some(k => permissions.includes(k))
              return (
                <button
                  key={a}
                  type="button"
                  className={`perm-table-col-action perm-table-col-head ${colAllChecked ? 'col-all' : ''} ${colSomeChecked ? 'col-some' : ''}`}
                  onClick={() => toggleColumn(a)}
                  title={`${ACTION_META[a].tooltip} — click to toggle "${ACTION_META[a].label}" for every module`}
                >
                  <span className="perm-table-action-label">{ACTION_META[a].label}</span>
                  <span className="perm-table-action-desc">{ACTION_META[a].desc}</span>
                </button>
              )
            })}
          </div>
          {PERMISSION_GROUPS.map(group => {
            const perms = group.actions.map(a => getPermissionKey(group.module, a))
            const checkedCount = perms.filter(p => permissions.includes(p)).length
            const allChecked = checkedCount === perms.length

            const toggle = (key: string) => {
              setter(permissions.includes(key) ? permissions.filter(p => p !== key) : [...permissions, key])
            }

            return (
              <div key={group.module} className={`perm-table-row ${allChecked ? 'all-checked' : ''}`} style={{ gridTemplateColumns: gridCols }}>
                <div className="perm-table-col-module">
                  <label className="perm-table-module-label">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = checkedCount > 0 && !allChecked }}
                      onChange={() => toggleModule(group.module, group.actions)}
                    />
                    <span className="perm-table-module-name">{group.module}</span>
                    <span className={`perm-table-module-count ${allChecked ? 'full' : checkedCount > 0 ? 'partial' : ''}`}>
                      {checkedCount}/{perms.length}
                    </span>
                  </label>
                  <span className="perm-table-module-desc">{group.description}</span>
                </div>
                {MATRIX_ACTIONS.map(action => {
                  const hasAction = group.actions.includes(action)
                  const key = getPermissionKey(group.module, action)
                  return (
                    <div key={action} className="perm-table-col-action">
                      {hasAction ? (
                        <label className="perm-table-check-label" title={`${ACTION_META[action].tooltip} in ${group.module}`}>
                          <input
                            type="checkbox"
                            checked={permissions.includes(key)}
                            onChange={() => toggle(key)}
                          />
                        </label>
                      ) : (
                        <span className="perm-table-col-na" title={`${action} is not applicable for ${group.module}`}>—</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="perm-table-summary-bar">
          <span className="perm-table-summary-text">{buildSummaryLabel(permissions)}</span>
        </div>
      )}
    </div>
  )
}

export function Executives() {
  const navigate = useNavigate()
  const { user: authUser, hasPermission } = useAuth()
  const { availableCompanies, effectiveCompanyId } = usePermissionScope('employees')
  // Single global scope for Team Leaders: effectiveCompanyId == null means
  // "All Companies" (aggregate the whole portfolio); == a company id means only
  // that company. scopedCompanyIds() turns that into the concrete company set.
  // Masters can manage every executive; restricted roles only see the
  // executives and companies they are assigned to (parity with the dashboard
  // "Total Executives" / "Total Companies" cards, no global leakage).
  const isMaster = authUser?.role === 'master-admin'
  const isTeamLeaderRole = authUser?.role === 'team-leader'
  const scopeCompanyIds = scopedCompanyIds(effectiveCompanyId, availableCompanies)
  // A Team Leader should only ever see the executives actually linked to them
  // (their oversight), not every executive who happens to manage a company in
  // their portfolio. Linked ids come from the shared TL filter (single source).
  const tlFilter = useTLFilter()
  const linkedExecIds = useMemo(() => {
    if (!isTeamLeaderRole) return null
    return new Set(tlFilter.executives.map(e => e.id))
  }, [isTeamLeaderRole, tlFilter.executives])
  const [users, setUsers] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allTeamLeaders, setAllTeamLeaders] = useState<User[]>([])
  const [allTLUsers, setAllTLUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const [addPermissions, setAddPermissions] = useState<string[]>(ALL_PERMISSIONS)
  const [editPermissions, setEditPermissions] = useState<string[]>([])

  const form = useForm<ExecutiveFormValues>({
    // Cast: known @hookform/resolvers/zod inference mismatch (runtime identical).
    resolver: zodResolver(executiveSchema) as Resolver<ExecutiveFormValues>,
    defaultValues: {
      name: '', email: '', username: '', password: '', phone: '',
      executiveTitle: '', companyId: '', departmentId: '', departmentName: '',
      assignedCompanyIds: [], assignedTeamLeaderIds: [],
      employmentType: 'Full-time', status: 'Active', joinDate: '',
      aadharNumber: '', aadharDoc: '', panNumber: '', panDoc: '', joiningLetterDoc: '',
      bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
      pfAccountNumber: '', uanNumber: '', offerLetterDoc: '',
      address: '', emergencyContactName: '', emergencyContactPhone: '',
      monthlyGrossSalary: 0, salaryEffectiveDate: '',
      officeAddress: '', latitude: 0, longitude: 0, radiusInMeters: 100,
      allowMobileData: true, requireWifi: false, wifiSSID: '', requireSelfie: false,
    },
  })

  // Collapsible sections
  const [empOpen, setEmpOpen] = useState(true)
  const [bankOpen, setBankOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [compOpen, setCompOpen] = useState(false)
  const [attOpen, setAttOpen] = useState(false)
  const [locating, setLocating] = useState(false)

  // File upload refs
  const aadharFileRef = useRef<File | null>(null)
  const panFileRef = useRef<File | null>(null)
  const joiningLetterFileRef = useRef<File | null>(null)
  const offerLetterFileRef = useRef<File | null>(null)
  const [aadharFileName, setAadharFileName] = useState('')
  const [panFileName, setPanFileName] = useState('')
  const [joiningLetterFileName, setJoiningLetterFileName] = useState('')
  const [offerLetterFileName, setOfferLetterFileName] = useState('')

  useEffect(() => { loadCompanies() }, [])
  useEffect(() => { loadDepartments() }, [])

  useEffect(() => {
    const inScope = (u: any) => {
      if (isMaster) return true
      if (scopeCompanyIds.length === 0) return false
      const assigned: string[] = u.assignedCompanyIds || []
      const companyMatch = assigned.some(cid => scopeCompanyIds.includes(cid))
      if (!companyMatch) return false
      // Team Leaders: only linked executives (their actual oversight) show —
      // never other executives who merely manage a portfolio company.
      if (isTeamLeaderRole && linkedExecIds) return linkedExecIds.has(u.id)
      return true
    }
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as User[]
      setAllUsers(all)
      const execs = all.filter(u => u.role === 'executive' && inScope(u))
      const inScopeExecIds = new Set(execs.map(e => e.id))
      const tls = all.filter(u => u.role === 'team-leader')
      // Team Leaders carry companyId / linkedExecutiveIds, NOT assignedCompanyIds,
      // so the company-scope check above alone drops every TL for scoped viewers.
      // Include any TL that is linked to (or reports to) an in-scope executive.
      const scopedTls = tls.filter(tl =>
        inScope(tl) ||
        (tl.linkedExecutiveIds || []).some(id => inScopeExecIds.has(id)) ||
        (tl.reportingExecutiveId && inScopeExecIds.has(tl.reportingExecutiveId))
      )
      setUsers(execs)
      setAllTeamLeaders(scopedTls)
      // Full TL registry for join resolution in the table: users docs are listable
      // by every authenticated user per rules; scoping only gates row visibility.
      setAllTLUsers(tls)
      setLoading(false)
    }, err => {
      console.error(err)
      setLoading(false)
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster, isTeamLeaderRole, scopeCompanyIds.join('|'), linkedExecIds])

  const loadDepartments = async (companyId?: string) => {
    try {
      const id = companyId || authUser?.companyId
      const depts = id ? await getDepartmentsByCompany(id) : await getAllDepartments()
      setDepartments(depts)
    } catch (err) {
      console.error('Failed to load departments', err)
    }
  }

  const loadCompanies = async () => {
    try {
      const all = await getAllCompanies()
      setCompanies(isMaster || scopeCompanyIds.length === 0
        ? all
        : all.filter(c => scopeCompanyIds.includes(c.id)))
    } catch (err) {
      console.error('Failed to load companies', err)
    }
  }

  const handleCompanyChange = (companyId: string) => {
    form.setValue('companyId', companyId)
    form.setValue('departmentId', '')
    form.setValue('departmentName', '')
    loadDepartments(companyId || undefined)
  }

  const buildAttendanceSettings = (v: ExecutiveFormValues) => ({
    officeAddress: v.officeAddress || '',
    latitude: Number(v.latitude) || 0,
    longitude: Number(v.longitude) || 0,
    radiusInMeters: Number(v.radiusInMeters) || 100,
    allowMobileData: v.allowMobileData ?? true,
    requireWifi: v.requireWifi ?? false,
    wifiSSID: v.wifiSSID || '',
    requireSelfie: v.requireSelfie ?? false,
  })

  const getLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue('latitude', pos.coords.latitude)
        form.setValue('longitude', pos.coords.longitude)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const togglePermission = (perm: string, isEdit: boolean) => {
    const setter = isEdit ? setEditPermissions : setAddPermissions
    const current = isEdit ? editPermissions : addPermissions
    setter(current.includes(perm) ? current.filter(p => p !== perm) : [...current, perm])
  }

  const toggleAllForModule = (module: string, actions: readonly string[], isEdit: boolean) => {
    const setter = isEdit ? setEditPermissions : setAddPermissions
    const current = isEdit ? editPermissions : addPermissions
    const perms = actions.map(a => getPermissionKey(module, a))
    const allChecked = perms.every(p => current.includes(p))
    setter(allChecked ? current.filter(p => !perms.includes(p)) : [...current.filter(p => !perms.includes(p)), ...perms])
  }

  const resetFileStates = () => {
    aadharFileRef.current = null
    panFileRef.current = null
    joiningLetterFileRef.current = null
    offerLetterFileRef.current = null
    setAadharFileName('')
    setPanFileName('')
    setJoiningLetterFileName('')
    setOfferLetterFileName('')
  }

  const handleDocSelect = (
    field: 'aadharDoc' | 'panDoc' | 'joiningLetterDoc' | 'offerLetterDoc',
    fileRef: React.MutableRefObject<File | null>,
    setFileName: (name: string) => void
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const uploadFileToStorage = async (file: File, userId: string, field: string): Promise<string> => {
    const sRef = storageRef(storage, `executives/${userId}/${field}`)
    const snapshot = await uploadBytes(sRef, file)
    return getDownloadURL(snapshot.ref)
  }

  const handleAdd = async (values: ExecutiveFormValues) => {
    setIsSubmitting(true)
    try {
      if (authUser?.role !== 'master-admin' && !hasPermission('executives.create')) {
        setToast({ message: 'You do not have permission to create executives', type: 'error' })
        setIsSubmitting(false)
        return
      }
      if (!values.username || values.username.length < 3) {
        setToast({ message: 'Username must be at least 3 characters', type: 'error' })
        setIsSubmitting(false)
        return
      }
      if (!values.password || values.password.length < 6) {
        setToast({ message: 'Password must be at least 6 characters', type: 'error' })
        setIsSubmitting(false)
        return
      }
      const dept = departments.find(d => d.id === values.departmentId)
      const targetCompanyId = values.companyId || authUser?.companyId || null

      const createStaffUser = httpsCallable(functions, 'createStaffUser')
      const { data: result } = await createStaffUser({
        email: values.email,
        password: values.password,
        name: values.name,
        username: values.username,
        phone: values.phone || '',
        role: 'executive',
        companyId: targetCompanyId || undefined,
        departmentId: values.departmentId || undefined,
        departmentName: cleanText(dept?.name) || '',
        executiveTitle: values.executiveTitle,
        assignedCompanyIds: values.assignedCompanyIds,
        assignedTeamLeaderIds: values.assignedTeamLeaderIds,
        employmentType: values.employmentType,
        status: values.status,
        joinDate: values.joinDate,
        aadharNumber: values.aadharNumber,
        panNumber: values.panNumber,
        bankName: values.bankName,
        accountHolderName: values.accountHolderName,
        accountNumber: values.accountNumber,
        ifscCode: values.ifscCode,
        pfAccountNumber: values.pfAccountNumber,
        uanNumber: values.uanNumber,
        offerLetterDoc: values.offerLetterDoc,
        address: values.address,
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
        monthlyGrossSalary: values.monthlyGrossSalary || 0,
        salaryEffectiveDate: values.salaryEffectiveDate,
        attendanceSettings: buildAttendanceSettings(values),
        permissions: addPermissions, permissionsConfigured: true,
      } as any)
      const firebaseUid = (result as any).uid as string

      const newUser: User = {
        id: firebaseUid,
        name: values.name,
        email: values.email,
        role: 'executive',
        companyId: targetCompanyId,
        departmentId: values.departmentId || null,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(values.name)}&background=f97316&color=fff`,
        permissions: addPermissions, permissionsConfigured: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        phone: values.phone || '',
        executiveTitle: values.executiveTitle,
        department: cleanText(dept?.name) || '',
        assignedCompanyIds: values.assignedCompanyIds,
        assignedTeamLeaderIds: values.assignedTeamLeaderIds,
        employmentType: values.employmentType,
        status: values.status,
        joinDate: values.joinDate,
        aadharNumber: values.aadharNumber,
        aadharDoc: '',
        panNumber: values.panNumber,
        panDoc: '',
        joiningLetterDoc: '',
        bankName: values.bankName,
        accountHolderName: values.accountHolderName,
        accountNumber: values.accountNumber,
        ifscCode: values.ifscCode,
        pfAccountNumber: values.pfAccountNumber,
        uanNumber: values.uanNumber,
        offerLetterDoc: '',
        address: values.address,
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
        monthlyGrossSalary: values.monthlyGrossSalary || 0,
        salaryEffectiveDate: values.salaryEffectiveDate,
      } as any

      // Upload files if any (account and user doc are created server-side by the admin callable)
      const uploads: { field: string; url: string }[] = []
      if (aadharFileRef.current) {
        const url = await uploadFileToStorage(aadharFileRef.current, firebaseUid, 'aadharDoc')
        uploads.push({ field: 'aadharDoc', url })
      }
      if (panFileRef.current) {
        const url = await uploadFileToStorage(panFileRef.current, firebaseUid, 'panDoc')
        uploads.push({ field: 'panDoc', url })
      }
      if (joiningLetterFileRef.current) {
        const url = await uploadFileToStorage(joiningLetterFileRef.current, firebaseUid, 'joiningLetterDoc')
        uploads.push({ field: 'joiningLetterDoc', url })
      }
      if (offerLetterFileRef.current) {
        const url = await uploadFileToStorage(offerLetterFileRef.current, firebaseUid, 'offerLetterDoc')
        uploads.push({ field: 'offerLetterDoc', url })
      }
      if (uploads.length > 0) {
        const updateData: Record<string, string> = {}
        uploads.forEach(u => (updateData[u.field] = u.url))
        await updateDoc(doc(db, 'users', firebaseUid), updateData)
        uploads.forEach(u => { (newUser as any)[u.field] = u.url })
      }

      setUsers(prev => [...prev, newUser])
      setIsAddModalOpen(false)
      form.reset()
      setAddPermissions(ALL_PERMISSIONS)
      resetFileStates()
      setToast({ message: `Executive created! Username: ${values.username}, Password: ${values.password}`, type: 'success' })
    } catch (err: any) {
      const friendly = authErrorMessage(err?.code || err?.message || '')
      setToast({ message: friendly || err?.message || 'Failed to create executive. Please try again.', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const openAdd = () => {
    form.reset({ companyId: authUser?.companyId || '', assignedCompanyIds: [], assignedTeamLeaderIds: [] })
    setAddPermissions(ALL_PERMISSIONS)
    if (authUser?.companyId) loadDepartments(authUser.companyId)
    setIsAddModalOpen(true)
  }

  const openView = (u: User) => {
    setSelectedUser(u)
    setIsViewModalOpen(true)
  }

  const openEdit = (u: User) => {
    setSelectedUser(u)
    const targetCompany = u.companyId || authUser?.companyId || ''
    form.setValue('name', u.name)
    form.setValue('email', u.email)
    form.setValue('phone', (u as any).phone || '')
    form.setValue('executiveTitle', (u as any).executiveTitle || '')
    form.setValue('companyId', targetCompany)
    form.setValue('departmentId', u.departmentId || '')
    form.setValue('departmentName', cleanText((u as any).department) || '')
    form.setValue('assignedCompanyIds', (u as any).assignedCompanyIds || [])
    form.setValue('assignedTeamLeaderIds', (u as any).assignedTeamLeaderIds || [])
    form.setValue('employmentType', (u as any).employmentType || 'Full-time')
    form.setValue('status', (u as any).status || 'Active')
    form.setValue('joinDate', (u as any).joinDate || '')
    form.setValue('aadharNumber', (u as any).aadharNumber || '')
    form.setValue('panNumber', (u as any).panNumber || '')
    form.setValue('bankName', (u as any).bankName || '')
    form.setValue('accountHolderName', (u as any).accountHolderName || '')
    form.setValue('accountNumber', (u as any).accountNumber || '')
    form.setValue('ifscCode', (u as any).ifscCode || '')
    form.setValue('pfAccountNumber', (u as any).pfAccountNumber || '')
    form.setValue('uanNumber', (u as any).uanNumber || '')
    form.setValue('address', (u as any).address || '')
    form.setValue('emergencyContactName', (u as any).emergencyContactName || '')
    form.setValue('emergencyContactPhone', (u as any).emergencyContactPhone || '')
    form.setValue('monthlyGrossSalary', (u as any).monthlyGrossSalary || 0)
    form.setValue('salaryEffectiveDate', (u as any).salaryEffectiveDate && isDate((u as any).salaryEffectiveDate) ? (u as any).salaryEffectiveDate.toISOString().split('T')[0] : typeof (u as any).salaryEffectiveDate === 'string' ? (u as any).salaryEffectiveDate : '')
    const savedAtt = (u as any).attendanceSettings || {}
    form.setValue('officeAddress', savedAtt.officeAddress || '')
    form.setValue('latitude', savedAtt.latitude || 0)
    form.setValue('longitude', savedAtt.longitude || 0)
    form.setValue('radiusInMeters', savedAtt.radiusInMeters || 100)
    form.setValue('allowMobileData', savedAtt.allowMobileData ?? true)
    form.setValue('requireWifi', savedAtt.requireWifi ?? false)
    form.setValue('wifiSSID', savedAtt.wifiSSID || '')
    form.setValue('requireSelfie', savedAtt.requireSelfie ?? false)
    setEditPermissions(u.permissions || [])
    loadDepartments(targetCompany || undefined)
    resetFileStates()
    setIsEditModalOpen(true)
  }

  const handleResetPassword = async (u: User) => {
    const confirmReset = window.confirm(`Reset password for ${u.name}? A password reset email will be sent to ${u.email}.`)
    if (!confirmReset) return
    try {
      await updateDoc(doc(db, 'users', u.id), { updatedAt: serverTimestamp() })
      await sendPasswordResetEmail(auth, u.email)
      await logAudit({
        userId: authUser?.id || '',
        userName: authUser?.name || '',
        userRole: authUser?.role || '',
        action: `Reset password for ${u.name}`,
        actionType: 'update',
        module: 'Executive Profile',
        targetEntity: u.name,
        status: 'success',
        details: `Password reset email sent to ${u.email}`,
      })
      if (authUser) {
        await createNotification(
          authUser.id, 'general', 'Password Reset',
          `Password reset email sent to ${u.name} (${u.email})`,
          `/executives`, u.companyId || ''
        )
      }
      setToast({ type: 'success', message: `Password reset email sent to ${u.email}` })
    } catch (err) {
      console.error('Password reset error:', err)
      setToast({ type: 'error', message: 'Failed to send password reset email' })
    }
  }

  const handleEdit = async (values: ExecutiveFormValues) => {
    if (!selectedUser) return
    setIsSubmitting(true)
    try {
      const dept = departments.find(d => d.id === values.departmentId)
      const prevCompanyIds = (selectedUser as any).assignedCompanyIds || []
      const newCompanyIds = values.assignedCompanyIds

      // Remove executive from previously assigned companies that are no longer selected
      const removedCompanies = prevCompanyIds.filter((id: string) => !newCompanyIds.includes(id))
      if (removedCompanies.length > 0) {
        await Promise.all(removedCompanies.map((cId: string) =>
          updateDoc(doc(db, 'companies', cId), {
            assignedExecutiveId: null,
            assignedExecutiveName: null,
          })
        ))
      }

      // Add executive to newly selected companies
      const addedCompanies = newCompanyIds.filter((id: string) => !prevCompanyIds.includes(id))
      if (addedCompanies.length > 0) {
        await Promise.all(addedCompanies.map((cId: string) =>
          updateDoc(doc(db, 'companies', cId), {
            assignedExecutiveId: selectedUser.id,
            assignedExecutiveName: values.name,
          })
        ))
      }

      // Handle team leader reassignment
      const prevTLIds = (selectedUser as any).assignedTeamLeaderIds || []
      const newTLIds = values.assignedTeamLeaderIds
      const removedTLs = prevTLIds.filter((id: string) => !newTLIds.includes(id))
      const addedTLs = newTLIds.filter((id: string) => !prevTLIds.includes(id))

      // Keep each team leader's authoritative `linkedExecutiveIds` array in sync.
      // Dashboards/filters read `linkedExecutiveIds` to derive a TL's portfolio,
      // so assigning an executive to a TL must append the executive there too.
      const syncLinkedExec = async (tlId: string, op: 'add' | 'remove') => {
        const tlSnap = await getDoc(doc(db, 'users', tlId))
        const current: string[] = (tlSnap.exists() && (tlSnap.data() as any).linkedExecutiveIds) || []
        const next = op === 'add'
          ? (current.includes(selectedUser.id) ? current : [...current, selectedUser.id])
          : current.filter((x: string) => x !== selectedUser.id)
        await updateDoc(doc(db, 'users', tlId), { linkedExecutiveIds: next })
      }

      if (removedTLs.length > 0) {
        await Promise.all(removedTLs.map(async (tlId: string) => {
          await updateDoc(doc(db, 'users', tlId), {
            reportingExecutiveId: null,
            reportingExecutiveName: null,
          })
          await syncLinkedExec(tlId, 'remove')
        }))
      }
      if (addedTLs.length > 0) {
        await Promise.all(addedTLs.map(async (tlId: string) => {
          await updateDoc(doc(db, 'users', tlId), {
            reportingExecutiveId: selectedUser.id,
            reportingExecutiveName: values.name,
          })
          await syncLinkedExec(tlId, 'add')
        }))
      }

      // Check for sensitive field changes
      const salaryChanged = (selectedUser as any).monthlyGrossSalary !== values.monthlyGrossSalary
      const bankChanged = (selectedUser as any).accountNumber !== values.accountNumber || (selectedUser as any).ifscCode !== values.ifscCode
      const identityChanged = (selectedUser as any).aadharNumber !== values.aadharNumber || (selectedUser as any).panNumber !== values.panNumber

      // Only Master Admin may rewrite the permission matrix from this screen.
      // Team Leaders edit executives without touching permissions — the
      // firestore rules (and the access-management checkboxes) own that field.
      const updateData: Record<string, any> = {
        name: values.name,
        email: values.email,
        phone: values.phone || '',
        executiveTitle: values.executiveTitle,
        departmentId: values.departmentId || null,
        department: cleanText(dept?.name) || '',
        assignedCompanyIds: values.assignedCompanyIds,
        assignedTeamLeaderIds: values.assignedTeamLeaderIds,
        employmentType: values.employmentType,
        status: values.status,
        joinDate: values.joinDate,
        aadharNumber: values.aadharNumber,
        panNumber: values.panNumber,
        bankName: values.bankName,
        accountHolderName: values.accountHolderName,
        accountNumber: values.accountNumber,
        ifscCode: values.ifscCode,
        pfAccountNumber: values.pfAccountNumber,
        uanNumber: values.uanNumber,
        address: values.address,
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
        monthlyGrossSalary: values.monthlyGrossSalary || 0,
        salaryEffectiveDate: values.salaryEffectiveDate,
        attendanceSettings: buildAttendanceSettings(values),
        updatedAt: serverTimestamp(),
      }
      if (authUser?.role === 'master-admin') {
        updateData.permissions = editPermissions
        updateData.permissionsConfigured = true
      }
      await updateDoc(doc(db, 'users', selectedUser.id), updateData)

      // Upload files if any (non-fatal — an upload failure must not fail the save)
      const uploads: { field: string; url: string }[] = []
      try {
        if (aadharFileRef.current) {
          const url = await uploadFileToStorage(aadharFileRef.current, selectedUser.id, 'aadharDoc')
          uploads.push({ field: 'aadharDoc', url })
        }
        if (panFileRef.current) {
          const url = await uploadFileToStorage(panFileRef.current, selectedUser.id, 'panDoc')
          uploads.push({ field: 'panDoc', url })
        }
        if (joiningLetterFileRef.current) {
          const url = await uploadFileToStorage(joiningLetterFileRef.current, selectedUser.id, 'joiningLetterDoc')
          uploads.push({ field: 'joiningLetterDoc', url })
        }
        if (offerLetterFileRef.current) {
          const url = await uploadFileToStorage(offerLetterFileRef.current, selectedUser.id, 'offerLetterDoc')
          uploads.push({ field: 'offerLetterDoc', url })
        }
      } catch (uploadErr) {
        console.warn('Document upload skipped during save:', uploadErr)
      }
      if (uploads.length > 0) {
        try {
          const updateData: Record<string, string> = {}
          uploads.forEach(u => (updateData[u.field] = u.url))
          await updateDoc(doc(db, 'users', selectedUser.id), updateData)
        } catch (uploadErr) {
          console.warn('Document URL update skipped:', uploadErr)
        }
      }

      // Audit logs for sensitive changes
      if (salaryChanged) {
        const oldSal = (selectedUser as any).monthlyGrossSalary || 0
        const newSal = values.monthlyGrossSalary || 0
        logAudit({
          userId: authUser?.id || '',
          userName: authUser?.name || 'System',
          userRole: authUser?.role || 'master-admin',
          action: `Salary for Executive ${values.name} updated from $${oldSal.toFixed(2)} to $${newSal.toFixed(2)} by ${authUser?.name || 'System'}`,
          actionType: 'update',
          module: 'Payroll',
          targetEntity: values.name,
          targetId: selectedUser.id,
          companyId: selectedUser.companyId || undefined,
          details: `Previous: $${oldSal.toFixed(2)}, New: $${newSal.toFixed(2)}${values.salaryEffectiveDate ? `, Effective: ${values.salaryEffectiveDate}` : ''}`,
          status: 'success',
        })
      }
      if (bankChanged) {
        logAudit({
          userId: authUser?.id || '',
          userName: authUser?.name || 'System',
          userRole: authUser?.role || 'master-admin',
          action: `Bank details for Executive ${values.name} updated by ${authUser?.name || 'System'}`,
          actionType: 'update',
          module: 'Payroll',
          targetEntity: values.name,
          targetId: selectedUser.id,
          companyId: selectedUser.companyId || undefined,
          details: 'Bank account/IFSC changed',
          status: 'success',
        })
      }
      if (identityChanged) {
        logAudit({
          userId: authUser?.id || '',
          userName: authUser?.name || 'System',
          userRole: authUser?.role || 'master-admin',
          action: `Identity documents for Executive ${values.name} updated by ${authUser?.name || 'System'}`,
          actionType: 'update',
          module: 'Compliance',
          targetEntity: values.name,
          targetId: selectedUser.id,
          companyId: selectedUser.companyId || undefined,
          details: 'Aadhaar/PAN details changed',
          status: 'success',
        })
      }

      setUsers(prev => prev.map(u => u.id === selectedUser.id ? {
        ...u,
        name: values.name,
        email: values.email,
        phone: values.phone || '',
        executiveTitle: values.executiveTitle as any,
        departmentId: values.departmentId || null,
        department: cleanText(dept?.name) || '',
        permissions: editPermissions,
        assignedCompanyIds: values.assignedCompanyIds,
        assignedTeamLeaderIds: values.assignedTeamLeaderIds,
        employmentType: values.employmentType as any,
        status: values.status as any,
        joinDate: values.joinDate,
        aadharNumber: values.aadharNumber,
        panNumber: values.panNumber,
        bankName: values.bankName,
        accountHolderName: values.accountHolderName,
        accountNumber: values.accountNumber,
        ifscCode: values.ifscCode,
        pfAccountNumber: values.pfAccountNumber,
        uanNumber: values.uanNumber,
        address: values.address,
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
        monthlyGrossSalary: values.monthlyGrossSalary || 0,
        salaryEffectiveDate: values.salaryEffectiveDate,
      } : u))
      setIsEditModalOpen(false)
      setSelectedUser(null)
      form.reset()
      setEditPermissions([])
      resetFileStates()
      setToast({ message: 'Executive profile updated successfully!', type: 'success' })
    } catch {
      setToast({ message: 'Failed to update executive', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (u: User) => {
    if (authUser?.role !== 'master-admin' && !hasPermission('executives.delete')) {
      setToast({ message: 'You do not have permission to deactivate executives', type: 'error' })
      return
    }
    const assignedCompanies = (u as any).assignedCompanyIds || []
    const assignedTLs = (u as any).assignedTeamLeaderIds || []
    let warningMsg = `Deactivate ${u.name}? They will no longer be able to log in.`
    if (assignedCompanies.length > 0 || assignedTLs.length > 0) {
      warningMsg += `\n\nThis executive manages ${assignedCompanies.length} company(ies) and ${assignedTLs.length} team leader(s). Their assignments will be cleared.`
    }
    if (!confirm(warningMsg)) return
    try {
      // Clear company assignments / TL reporting (best-effort — the core
      // deactivation must still succeed even if a scope edge case blocks one).
      try {
        if (assignedCompanies.length > 0) {
          await Promise.all(assignedCompanies.map((cId: string) =>
            updateDoc(doc(db, 'companies', cId), {
              assignedExecutiveId: null,
              assignedExecutiveName: null,
            })
          ))
        }
        if (assignedTLs.length > 0) {
          await Promise.all(assignedTLs.map((tlId: string) =>
            updateDoc(doc(db, 'users', tlId), {
              reportingExecutiveId: null,
              reportingExecutiveName: null,
            })
          ))
        }
      } catch (clearErr) {
        console.warn('Assignment cleanup skipped during executive deactivation:', clearErr)
      }
      await updateDoc(doc(db, 'users', u.id), { isActive: false, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isActive: false } : x))
      createAdminAlert('executive', 'Executive Deactivated', `${u.name} has been deactivated by ${authUser?.name || 'Admin'}. ${assignedCompanies.length} company(ies) and ${assignedTLs.length} TL(s) were unassigned.`, '/executives', 'high', {
        actionBy: authUser?.id, actionByName: authUser?.name,
      })
      setToast({ message: `${u.name} deactivated`, type: 'success' })
    } catch {
      setToast({ message: 'Failed to deactivate executive', type: 'error' })
    }
  }

  const filtered = users.filter(u => {
    const s = searchTerm.toLowerCase()
    return !s || u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s)
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const companyOptions = companies.map(c => ({ id: c.id, label: c.name, sublabel: c.code || '' }))
  const teamLeaderOptions = allTeamLeaders.filter(tl => tl.isActive).map(tl => ({ id: tl.id, label: tl.name, sublabel: tl.email }))

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Executives" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading executives...</p></div></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Executives" />
      <div className="page-content">
        <div className="emp-stats-row">
          <div className="emp-mini-stat"><Crown size={22} /><div><strong>{users.length}</strong><span>Total Executives</span></div></div>
          <div className="emp-mini-stat"><Building2 size={22} /><div><strong>{companies.filter(c => (c as any).assignedExecutiveId).length}</strong><span>Companies Assigned</span></div></div>
          <div className="emp-mini-stat"><Users size={22} /><div><strong>{allTeamLeaders.filter(tl => (tl as any).reportingExecutiveId).length}</strong><span>Team Leaders Reporting</span></div></div>
        </div>

        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search executives by name or email..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
          </div>
          <div className="emp-toolbar-actions">
            {(authUser?.role === 'master-admin' || hasPermission('executives.create')) && (
              <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={16} /> Add Executive</button>
            )}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table exec-table">
            <thead>
              <tr>
                <th>Name &amp; Email</th>
                <th>Title</th>
                <th>Companies Managed</th>
                <th>Team Leaders Managed</th>
                <th>Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={7} className="empty-cell">No executives found</td></tr>
              ) : paginated.map(u => {
                const compIds: string[] = (u as any).assignedCompanyIds || []
                const tlIds: string[] = (u as any).assignedTeamLeaderIds || []
                const compNames = compIds.map(id => companies.find(c => c.id === id)?.name || id).filter(Boolean)
                const tlNames = tlIds.map(id => {
                  const byRole = allTLUsers.find(t => t.id === id)
                  const resolvedRole = byRole ? resolveName(byRole) : ''
                  if (resolvedRole) return resolvedRole
                  const byAny = allUsers.find(t => t.id === id)
                  return resolveName(byAny) || id
                }).filter(Boolean)
                const MAX_VISIBLE = 3
                return (
                <tr key={u.id}>
                  <td>
                    <div className="exec-name-cell">
                      <span className="name">{u.name}</span>
                      <span className="email">{u.email}</span>
                    </div>
                  </td>
                  <td><span className="exec-title-cell">{(u as any).executiveTitle || '-'}</span></td>
                  <td>
                    {compNames.length === 0 ? <span className="exec-count-num muted">—</span> : (
                      <div className="exec-chip-list">
                        {compNames.slice(0, MAX_VISIBLE).map(n => <span key={n} className="exec-chip exec-chip-company">{n}</span>)}
                        {compNames.length > MAX_VISIBLE && <span className="exec-chip exec-chip-more">+{compNames.length - MAX_VISIBLE} more</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    {tlNames.length === 0 ? <span className="exec-count-num muted">—</span> : (
                      <div className="exec-chip-list">
                        {tlNames.slice(0, MAX_VISIBLE).map(n => <span key={n} className="exec-chip exec-chip-tl">{n}</span>)}
                        {tlNames.length > MAX_VISIBLE && <span className="exec-chip exec-chip-more">+{tlNames.length - MAX_VISIBLE} more</span>}
                      </div>
                    )}
                  </td>
                  <td><span className="exec-dept">{resolveDepartment(u, departments) || '—'}</span></td>
                  <td><span className={`exec-status-pill ${u.isActive ? 'active' : 'inactive'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="emp-actions">
                      <button className="emp-action-icon view" onClick={() => openView(u)} title="View"><Eye size={15} /></button>
                      {(authUser?.role === 'master-admin' || hasPermission('executives.edit')) && (
                        <button className="emp-action-icon edit" onClick={() => openEdit(u)} title="Edit"><Pencil size={15} /></button>
                      )}
          {authUser?.role === 'master-admin' && (
                        <button className="emp-action-icon" style={{ background: '#fef3c7', color: '#d97706' }} onClick={() => handleResetPassword(u)} title="Reset Password"><KeyRound size={15} /></button>
                      )}
                      {(authUser?.role === 'master-admin' || hasPermission('executives.delete')) && (
                        <button className="emp-action-icon delete" onClick={() => handleDelete(u)} title="Deactivate"><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="pagination-info">Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="pagination-controls">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
            <span className="pagination-page">{currentPage} / {totalPages || 1}</span>
            <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
          </div>
        </div>
      </div>

      {/* VIEW EXECUTIVE MODAL */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Executive Profile"
        size="large"
        footer={
          <>
            {selectedUser && (authUser?.role === 'master-admin' || hasPermission('executives.edit')) && (
              <button className="btn-secondary" onClick={() => { setIsViewModalOpen(false); openEdit(selectedUser) }}><Pencil size={14} /> Edit</button>
            )}
            <button className="btn-primary" onClick={() => setIsViewModalOpen(false)}>Close</button>
          </>
        }
      >
        {selectedUser && (() => {
          const assignedIds: string[] = (selectedUser as any).assignedCompanyIds || []
          const assignedCompanies = assignedIds.map((cId: string) => companies.find(c => c.id === cId)?.name || cId)
          const title = (selectedUser as any).executiveTitle || 'Executive'
          return (
            <div>
              <div className="modal-profile-header">
                <div className="modal-profile-info">
                  <h2>{selectedUser.name}</h2>
                  <p>{title}{assignedCompanies.length > 0 ? ` Â· ${assignedCompanies.join(', ')}` : ''}</p>
                  <div className="modal-profile-badges">
                    <span className={`tl-status-pill ${selectedUser.isActive ? 'active' : 'inactive'}`}>{selectedUser.isActive ? 'Active' : 'Inactive'}</span>
                    <span className="emp-dept-badge" style={{ background: '#fef3c7', color: '#d97706' }}>{title}</span>
                  </div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><UserIcon size={18} /><h4>Basic Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Full Name</label><div className="field-value">{selectedUser.name}</div></div>
                  <div className="modal-field"><label>Email</label><div className="field-value">{selectedUser.email}</div></div>
                  <div className="modal-field"><label>Phone</label><div className="field-value">{(selectedUser as any).phone || '-'}</div></div>
                  <div className="modal-field"><label>Created</label><div className="field-value">{selectedUser.createdAt && isDate(selectedUser.createdAt) ? selectedUser.createdAt.toLocaleDateString() : '-'}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Building2 size={18} /><h4>Organization Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Executive Title</label><div className="field-value">{title}</div></div>
                  <div className="modal-field"><label>Department</label><div className="field-value">{resolveDepartment(selectedUser, departments) || '-'}</div></div>
                  <div className="modal-field" style={{ gridColumn: '1 / -1' }}><label>Assigned Companies</label><div className="field-value">{assignedCompanies.length > 0 ? assignedCompanies.join(', ') : 'None'}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Briefcase size={18} /><h4>Employment Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Employment Type</label><div className="field-value">{(selectedUser as any).employmentType || '-'}</div></div>
                  <div className="modal-field"><label>Join Date</label><div className="field-value">{(selectedUser as any).joinDate && isDate((selectedUser as any).joinDate) ? (selectedUser as any).joinDate.toLocaleDateString() : (selectedUser as any).joinDate || '-'}</div></div>
                  <div className="modal-field"><label>Monthly Salary</label><div className="field-value">{(selectedUser as any).monthlyGrossSalary ? `$${(selectedUser as any).monthlyGrossSalary.toFixed(2)}` : '-'}</div></div>
                  <div className="modal-field"><label>Status</label><div className="field-value" style={{ color: selectedUser.isActive ? '#16a34a' : '#ef4444' }}>{selectedUser.isActive ? 'Active' : 'Inactive'}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Shield size={18} /><h4>Account &amp; Access</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Role</label><div className="field-value">Executive</div></div>
                  <div className="modal-field"><label>Status</label><div className="field-value">{selectedUser.isActive ? 'Active' : 'Inactive'}</div></div>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ADD EXECUTIVE MODAL */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Executive"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
            <button className="btn-primary" form="exec-add-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Executive'}
            </button>
          </>
        }
      >
        <form id="exec-add-form" onSubmit={form.handleSubmit(handleAdd)}>
          <div className="modal-section">
            <div className="modal-section-header">
              <UserIcon size={18} /><h4>Personal Information</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Full Name *</label>
                <input type="text" {...form.register('name')} placeholder="Enter full name" />
                {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}
              </div>
              <div className="modal-field">
                <label>Corporate Email *</label>
                <input type="email" {...form.register('email')} placeholder="executive@company.com" />
                {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}
              </div>
              <div className="modal-field">
                <label>Phone Number</label>
                <input type="text" {...form.register('phone')} placeholder="+1 234 567 890" />
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
                <input type="text" {...form.register('username')} placeholder="e.g. sarahj" />
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
              <Briefcase size={18} /><h4>Position Details</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Executive Role / Title</label>
                <input type="text" {...form.register('executiveTitle')} placeholder="e.g. Vice President, Managing Director" />
                {form.formState.errors.executiveTitle && <span className="field-error">{form.formState.errors.executiveTitle.message}</span>}
              </div>
              {!authUser?.companyId && (
                <div className="modal-field">
                  <label>Company *</label>
                  <select {...form.register('companyId')} onChange={e => handleCompanyChange(e.target.value)}>
                    <option value="">Select company</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="modal-field">
                <label>Department Linkage</label>
                <select {...form.register('departmentId')} onChange={e => {
                  const dept = departments.find(d => d.id === e.target.value)
                  form.setValue('departmentName', dept?.name || '')
                }}>
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Employment & Compliance Details */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setEmpOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <Briefcase size={18} /><h4>Employment & Compliance Details</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: empOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {empOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Employment Type</label>
                  <select {...form.register('employmentType')}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Status</label>
                  <select {...form.register('status')}>
                    {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Join Date</label>
                  <input type="date" {...form.register('joinDate')} />
                </div>
                <div className="modal-field">
                  <label>Aadhaar Number</label>
                  <input type="text" {...form.register('aadharNumber')} placeholder="12-digit Aadhaar number" maxLength={12} />
                </div>
                <div className="modal-field full-width">
                  <label>Aadhaar Card Upload</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('aadharDoc', aadharFileRef, setAadharFileName)} style={{ display: 'none' }} id="exec-aadhar-upload" />
                    <label htmlFor="exec-aadhar-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{aadharFileName || 'Upload Aadhaar card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field">
                  <label>PAN Number</label>
                  <input type="text" {...form.register('panNumber')} placeholder="e.g. ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="modal-field full-width">
                  <label>PAN Card Upload</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('panDoc', panFileRef, setPanFileName)} style={{ display: 'none' }} id="exec-pan-upload" />
                    <label htmlFor="exec-pan-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{panFileName || 'Upload PAN card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field full-width">
                  <label>Company Joining Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('joiningLetterDoc', joiningLetterFileRef, setJoiningLetterFileName)} style={{ display: 'none' }} id="exec-joining-letter-upload" />
                    <label htmlFor="exec-joining-letter-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{joiningLetterFileName || 'Upload joining letter (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bank & Statutory Details */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setBankOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <CreditCard size={18} /><h4>Bank & Statutory Details</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: bankOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {bankOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Bank Name</label>
                  <input type="text" {...form.register('bankName')} placeholder="e.g. State Bank of India" />
                </div>
                <div className="modal-field">
                  <label>Account Holder Name</label>
                  <input type="text" {...form.register('accountHolderName')} placeholder="Name as on bank account" />
                </div>
                <div className="modal-field">
                  <label>Account Number</label>
                  <input type="text" {...form.register('accountNumber')} placeholder="Bank account number" />
                </div>
                <div className="modal-field">
                  <label>IFSC Code</label>
                  <input type="text" {...form.register('ifscCode')} placeholder="e.g. SBIN0001234" />
                </div>
                <div className="modal-field">
                  <label>PF Account Number</label>
                  <input type="text" {...form.register('pfAccountNumber')} placeholder="PF account number" />
                </div>
                <div className="modal-field">
                  <label>UAN Number</label>
                  <input type="text" {...form.register('uanNumber')} placeholder="Universal Account Number" />
                </div>
                <div className="modal-field full-width">
                  <label>Offer Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('offerLetterDoc', offerLetterFileRef, setOfferLetterFileName)} style={{ display: 'none' }} id="exec-offer-letter-upload" />
                    <label htmlFor="exec-offer-letter-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{offerLetterFileName || 'Upload offer letter (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setContactOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <MapPin size={18} /><h4>Contact Information</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: contactOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {contactOpen && (
              <div className="modal-section-content">
                <div className="modal-field full-width">
                  <label>Address</label>
                  <textarea {...form.register('address')} placeholder="Full residential address" rows={3} />
                </div>
                <div className="modal-field">
                  <label>Emergency Contact Name</label>
                  <input type="text" {...form.register('emergencyContactName')} placeholder="Full name of emergency contact" />
                </div>
                <div className="modal-field">
                  <label>Emergency Contact Phone</label>
                  <input type="text" {...form.register('emergencyContactPhone')} placeholder="Phone number of emergency contact" />
                </div>
              </div>
            )}
          </div>

          {/* Compensation Details */}
          {(authUser?.role === 'master-admin' || authUser?.role === 'executive') && (
            <div className="modal-section">
              <div className="modal-section-header" onClick={() => setCompOpen(o => !o)} style={{ cursor: 'pointer' }}>
                <DollarSign size={18} /><h4>Compensation Details</h4>
                <ChevronDown size={16} style={{ marginLeft: 'auto', transform: compOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>
              {compOpen && (
                <div className="modal-section-content">
                  <div className="modal-field">
                    <label>Monthly Gross Salary ($)</label>
                    <input type="number" step="0.01" min="0" {...form.register('monthlyGrossSalary', { valueAsNumber: true })} placeholder="0.00" />
                  </div>
                  <div className="modal-field">
                    <label>Salary Effective Date</label>
                    <input type="date" {...form.register('salaryEffectiveDate')} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hierarchy Assignment */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Building2 size={18} /><h4>Hierarchy Assignment</h4>
            </div>
            <div className="modal-section-content">
              <MultiSelect
                label="Assign Companies"
                options={companyOptions}
                selected={form.watch('assignedCompanyIds')}
                onChange={v => form.setValue('assignedCompanyIds', v)}
                placeholder="Select companies this executive will manage..."
                searchPlaceholder="Search companies..."
              />
              <MultiSelect
                label="Assign Team Leaders"
                options={teamLeaderOptions}
                selected={form.watch('assignedTeamLeaderIds')}
                onChange={v => form.setValue('assignedTeamLeaderIds', v)}
                placeholder="Select team leaders reporting to this executive..."
                searchPlaceholder="Search team leaders..."
              />
            </div>
          </div>

          {/* Attendance Configuration */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setAttOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <MapPin size={18} /><h4>Attendance Configuration</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: attOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {attOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Office Full Address</label>
                  <input type="text" {...form.register('officeAddress')} placeholder="e.g. Bardibas, Madhesh Province, Nepal" />
                  {form.formState.errors.officeAddress && <span className="field-error">{form.formState.errors.officeAddress.message}</span>}
                </div>
                <div className="modal-field">
                  <label>Latitude</label>
                  <input type="number" step="any" {...form.register('latitude', { valueAsNumber: true })} placeholder="27.0" />
                </div>
                <div className="modal-field">
                  <label>Longitude</label>
                  <input type="number" step="any" {...form.register('longitude', { valueAsNumber: true })} placeholder="85.0" />
                </div>
                <div className="modal-field">
                  <button type="button" className="btn-outline location-btn" onClick={getLocation} disabled={locating}>
                    <Crosshair size={16} className={locating ? 'spinning' : ''} />
                    {locating ? 'Detecting...' : 'Get Current Location'}
                  </button>
                </div>
                <div className="modal-field">
                  <label>Attendance Radius (meters)</label>
                  <input type="number" min={50} max={500} {...form.register('radiusInMeters', { valueAsNumber: true })} />
                </div>
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Smartphone size={20} />
                    <div>
                      <strong>Allow Mobile Data</strong>
                      <p>Allow check-in using mobile data</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('allowMobileData')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Wifi size={20} />
                    <div>
                      <strong>Require Office Wi-Fi</strong>
                      <p>Check-in requires connection to office Wi-Fi</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('requireWifi')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                {form.watch('requireWifi') && (
                  <div className="modal-field conditional-field">
                    <label>Office Wi-Fi SSID</label>
                    <input type="text" {...form.register('wifiSSID')} placeholder="e.g. Sofixs_Office_5G" />
                  </div>
                )}
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Camera size={20} />
                    <div>
                      <strong>Require Selfie</strong>
                      <p>Check-in requires a selfie</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('requireSelfie')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Access Permissions (Master Admin only — permission checkboxes are
              managed centrally in Access Management) */}
          {authUser?.role === 'master-admin' && (
            <div className="modal-section">
              <div className="modal-section-header">
                <Lock size={18} /><h4>Access Permissions</h4>
              </div>
              <div className="modal-section-content">
                <PermissionsSection
                  permissions={addPermissions}
                  setter={setAddPermissions}
                />
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* EDIT EXECUTIVE MODAL */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); form.reset(); setEditPermissions([]) }}
        title="Edit Executive"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => { setIsEditModalOpen(false); form.reset(); setEditPermissions([]) }}>Cancel</button>
            <button className="btn-primary" form="exec-edit-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <form id="exec-edit-form" onSubmit={form.handleSubmit(handleEdit)}>
          <div className="modal-section">
            <div className="modal-section-header">
              <UserIcon size={18} /><h4>Personal Information</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Full Name *</label>
                <input type="text" {...form.register('name')} placeholder="Enter full name" />
                {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}
              </div>
              <div className="modal-field">
                <label>Corporate Email *</label>
                <input type="email" {...form.register('email')} placeholder="executive@company.com" />
                {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}
              </div>
              <div className="modal-field">
                <label>Phone Number</label>
                <input type="text" {...form.register('phone')} placeholder="+1 234 567 890" />
              </div>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-header">
              <Briefcase size={18} /><h4>Position Details</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Executive Role / Title</label>
                <input type="text" {...form.register('executiveTitle')} placeholder="e.g. Vice President, Managing Director" />
                {form.formState.errors.executiveTitle && <span className="field-error">{form.formState.errors.executiveTitle.message}</span>}
              </div>
              {!authUser?.companyId && (
                <div className="modal-field">
                  <label>Company *</label>
                  <select {...form.register('companyId')} onChange={e => handleCompanyChange(e.target.value)}>
                    <option value="">Select company</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="modal-field">
                <label>Department Linkage</label>
                <select {...form.register('departmentId')} onChange={e => {
                  const dept = departments.find(d => d.id === e.target.value)
                  form.setValue('departmentName', dept?.name || '')
                }}>
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Employment & Compliance Details */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setEmpOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <Briefcase size={18} /><h4>Employment & Compliance Details</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: empOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {empOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Employment Type</label>
                  <select {...form.register('employmentType')}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Status</label>
                  <select {...form.register('status')}>
                    {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Join Date</label>
                  <input type="date" {...form.register('joinDate')} />
                </div>
                <div className="modal-field">
                  <label>Aadhaar Number</label>
                  <input type="text" {...form.register('aadharNumber')} placeholder="12-digit Aadhaar number" maxLength={12} />
                </div>
                <div className="modal-field full-width">
                  <label>Aadhaar Card Upload</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('aadharDoc', aadharFileRef, setAadharFileName)} style={{ display: 'none' }} id="exec-edit-aadhar-upload" />
                    <label htmlFor="exec-edit-aadhar-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{aadharFileName || 'Upload Aadhaar card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field">
                  <label>PAN Number</label>
                  <input type="text" {...form.register('panNumber')} placeholder="e.g. ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="modal-field full-width">
                  <label>PAN Card Upload</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('panDoc', panFileRef, setPanFileName)} style={{ display: 'none' }} id="exec-edit-pan-upload" />
                    <label htmlFor="exec-edit-pan-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{panFileName || 'Upload PAN card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field full-width">
                  <label>Company Joining Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('joiningLetterDoc', joiningLetterFileRef, setJoiningLetterFileName)} style={{ display: 'none' }} id="exec-edit-joining-letter-upload" />
                    <label htmlFor="exec-edit-joining-letter-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{joiningLetterFileName || 'Upload joining letter (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bank & Statutory Details */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setBankOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <CreditCard size={18} /><h4>Bank & Statutory Details</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: bankOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {bankOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Bank Name</label>
                  <input type="text" {...form.register('bankName')} placeholder="e.g. State Bank of India" />
                </div>
                <div className="modal-field">
                  <label>Account Holder Name</label>
                  <input type="text" {...form.register('accountHolderName')} placeholder="Name as on bank account" />
                </div>
                <div className="modal-field">
                  <label>Account Number</label>
                  <input type="text" {...form.register('accountNumber')} placeholder="Bank account number" />
                </div>
                <div className="modal-field">
                  <label>IFSC Code</label>
                  <input type="text" {...form.register('ifscCode')} placeholder="e.g. SBIN0001234" />
                </div>
                <div className="modal-field">
                  <label>PF Account Number</label>
                  <input type="text" {...form.register('pfAccountNumber')} placeholder="PF account number" />
                </div>
                <div className="modal-field">
                  <label>UAN Number</label>
                  <input type="text" {...form.register('uanNumber')} placeholder="Universal Account Number" />
                </div>
                <div className="modal-field full-width">
                  <label>Offer Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('offerLetterDoc', offerLetterFileRef, setOfferLetterFileName)} style={{ display: 'none' }} id="exec-edit-offer-letter-upload" />
                    <label htmlFor="exec-edit-offer-letter-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{offerLetterFileName || 'Upload offer letter (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setContactOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <MapPin size={18} /><h4>Contact Information</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: contactOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {contactOpen && (
              <div className="modal-section-content">
                <div className="modal-field full-width">
                  <label>Address</label>
                  <textarea {...form.register('address')} placeholder="Full residential address" rows={3} />
                </div>
                <div className="modal-field">
                  <label>Emergency Contact Name</label>
                  <input type="text" {...form.register('emergencyContactName')} placeholder="Full name of emergency contact" />
                </div>
                <div className="modal-field">
                  <label>Emergency Contact Phone</label>
                  <input type="text" {...form.register('emergencyContactPhone')} placeholder="Phone number of emergency contact" />
                </div>
              </div>
            )}
          </div>

          {/* Compensation Details */}
          {(authUser?.role === 'master-admin' || authUser?.role === 'executive') && (
            <div className="modal-section">
              <div className="modal-section-header" onClick={() => setCompOpen(o => !o)} style={{ cursor: 'pointer' }}>
                <DollarSign size={18} /><h4>Compensation Details</h4>
                <ChevronDown size={16} style={{ marginLeft: 'auto', transform: compOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>
              {compOpen && (
                <div className="modal-section-content">
                  <div className="modal-field">
                    <label>Monthly Gross Salary ($)</label>
                    <input type="number" step="0.01" min="0" {...form.register('monthlyGrossSalary', { valueAsNumber: true })} placeholder="0.00" />
                  </div>
                  <div className="modal-field">
                    <label>Salary Effective Date</label>
                    <input type="date" {...form.register('salaryEffectiveDate')} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hierarchy Assignment */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Building2 size={18} /><h4>Hierarchy Assignment</h4>
            </div>
            <div className="modal-section-content">
              <MultiSelect
                label="Assign Companies"
                options={companyOptions}
                selected={form.watch('assignedCompanyIds')}
                onChange={v => form.setValue('assignedCompanyIds', v)}
                placeholder="Select companies this executive will manage..."
                searchPlaceholder="Search companies..."
              />
              <MultiSelect
                label="Assign Team Leaders"
                options={teamLeaderOptions}
                selected={form.watch('assignedTeamLeaderIds')}
                onChange={v => form.setValue('assignedTeamLeaderIds', v)}
                placeholder="Select team leaders reporting to this executive..."
                searchPlaceholder="Search team leaders..."
              />
            </div>
          </div>

          {/* Attendance Configuration */}
          <div className="modal-section">
            <div className="modal-section-header" onClick={() => setAttOpen(o => !o)} style={{ cursor: 'pointer' }}>
              <MapPin size={18} /><h4>Attendance Configuration</h4>
              <ChevronDown size={16} style={{ marginLeft: 'auto', transform: attOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {attOpen && (
              <div className="modal-section-content">
                <div className="modal-field">
                  <label>Office Full Address</label>
                  <input type="text" {...form.register('officeAddress')} placeholder="e.g. Bardibas, Madhesh Province, Nepal" />
                  {form.formState.errors.officeAddress && <span className="field-error">{form.formState.errors.officeAddress.message}</span>}
                </div>
                <div className="modal-field">
                  <label>Latitude</label>
                  <input type="number" step="any" {...form.register('latitude', { valueAsNumber: true })} placeholder="27.0" />
                </div>
                <div className="modal-field">
                  <label>Longitude</label>
                  <input type="number" step="any" {...form.register('longitude', { valueAsNumber: true })} placeholder="85.0" />
                </div>
                <div className="modal-field">
                  <button type="button" className="btn-outline location-btn" onClick={getLocation} disabled={locating}>
                    <Crosshair size={16} className={locating ? 'spinning' : ''} />
                    {locating ? 'Detecting...' : 'Get Current Location'}
                  </button>
                </div>
                <div className="modal-field">
                  <label>Attendance Radius (meters)</label>
                  <input type="number" min={50} max={500} {...form.register('radiusInMeters', { valueAsNumber: true })} />
                </div>
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Smartphone size={20} />
                    <div>
                      <strong>Allow Mobile Data</strong>
                      <p>Allow check-in using mobile data</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('allowMobileData')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Wifi size={20} />
                    <div>
                      <strong>Require Office Wi-Fi</strong>
                      <p>Check-in requires connection to office Wi-Fi</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('requireWifi')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                {form.watch('requireWifi') && (
                  <div className="modal-field conditional-field">
                    <label>Office Wi-Fi SSID</label>
                    <input type="text" {...form.register('wifiSSID')} placeholder="e.g. Sofixs_Office_5G" />
                  </div>
                )}
                <div className="toggle-card">
                  <div className="toggle-card-left">
                    <Camera size={20} />
                    <div>
                      <strong>Require Selfie</strong>
                      <p>Check-in requires a selfie</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" {...form.register('requireSelfie')} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            )}
          </div>

          {authUser?.role === 'master-admin' && (
            <div className="modal-section">
              <div className="modal-section-header">
                <Lock size={18} /><h4>Access Permissions</h4>
              </div>
              <div className="modal-section-content">
                <PermissionsSection
                  permissions={editPermissions}
                  setter={setEditPermissions}
                />
              </div>
            </div>
          )}
        </form>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
