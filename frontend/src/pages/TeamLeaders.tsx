import { useState, useEffect, useRef } from 'react'
import { errText } from '../aws/errors';
import { UserPlus, Search, Plus, Eye, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Mail, Shield, User as UserIcon, Briefcase, Lock, Crown, Building2, Users, ChevronDown, Check, Activity, Bell, Upload, DollarSign, CalendarDays, MapPin, CreditCard, BadgeAlert, Filter, CheckSquare, Crosshair, Wifi, Camera, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Toast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { getAllUsers } from '../services/authService'
import { getAllCompanies } from '../services/companyService'
import { getDepartmentsByCompany, getAllDepartments } from '../services/departmentService'
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from '../aws/firestore-compat'
import { ref as storageRef, uploadBytes, getDownloadURL } from '../aws/storage-compat'
import { httpsCallable } from '../aws/functions-compat'
import { db, storage, functions } from '../aws/clients'
import { logAudit } from '../services/auditLogService'
import { isDate } from '../utils/dateUtils'
import { useForm } from 'react-hook-form'
import type { Resolver } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { User, Company, Department } from '../types/user'
import './Employees.css'

const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const
const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const

const teamLeaderSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  // Credentials are only collected on the Add flow and validated there;
  // optional here so editing a team leader never gets blocked by them.
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  companyId: z.string().optional().default(''),
  executiveIds: z.array(z.string()).optional().default([]),

  // Position Details
  designation: z.string().optional().default(''),
  departmentId: z.string().optional().default(''),
  departmentName: z.string().optional().default(''),

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

type TeamLeaderFormValues = z.infer<typeof teamLeaderSchema>

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

// ============================================
// PERMISSION MATRIX (same catalogue as Executives, plus an Executives module)
// ============================================
interface TLPermissionGroup {
  module: string
  actions: string[]
  description: string
}

const TL_PERMISSION_GROUPS: TLPermissionGroup[] = [
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
  { module: 'Executives', actions: ['view', 'create', 'edit', 'delete'], description: 'View, create, edit, and delete executive profiles and accounts' },
  { module: 'Assets', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'], description: 'Manage company assets, assignments, and returns' },
]

const getTLPermissionKey = (module: string, action: string) =>
  `${module.toLowerCase().replace(/\s+/g, '_')}.${action}`

const TL_ACTION_META: Record<string, { label: string; desc: string; tooltip: string }> = {
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

// Columns derived from the catalog so every declared action has a real checkbox
const TL_ACTION_COLUMN_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'calculate', 'disburse', 'export', 'download', 'manage']
const TL_MATRIX_ACTIONS: string[] = [...new Set(TL_PERMISSION_GROUPS.flatMap(g => g.actions))]
  .sort((a, b) => {
    const ia = TL_ACTION_COLUMN_ORDER.indexOf(a), ib = TL_ACTION_COLUMN_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

const TL_ALL_PERMISSIONS = TL_PERMISSION_GROUPS.flatMap(g => g.actions.map(a => getTLPermissionKey(g.module, a)))

function buildTLSummaryLabel(permissions: string[]): string {
  const lines: string[] = []
  for (const g of TL_PERMISSION_GROUPS) {
    const active = g.actions.filter(a => permissions.includes(getTLPermissionKey(g.module, a)))
    if (active.length === 0) continue
    if (active.length === g.actions.length) {
      lines.push(`All ${g.module} access`)
    } else {
      const labels = active.map(a => a.charAt(0).toUpperCase() + a.slice(1))
      lines.push(`${labels.join(', ')} ${g.module}`)
    }
  }
  return lines.length > 0 ? 'This team leader can: ' + lines.join('; ') : 'No permissions assigned'
}

function TLPermissionsSection({
  permissions, setter,
}: {
  permissions: string[]
  setter: (p: string[]) => void
}) {
  const totalActions = TL_PERMISSION_GROUPS.reduce((s, g) => s + g.actions.length, 0)
  const selectedCount = permissions.length
  const gridCols = `minmax(180px, 1.6fr) repeat(${TL_MATRIX_ACTIONS.length}, minmax(88px, 1fr))`

  const toggleModule = (module: string, actions: string[]) => {
    const perms = actions.map(a => getTLPermissionKey(module, a))
    const allChecked = perms.every(p => permissions.includes(p))
    setter(allChecked ? permissions.filter(p => !perms.includes(p)) : [...new Set([...permissions, ...perms])])
  }

  // Column header click: toggle this action across every module that supports it
  const toggleColumn = (action: string) => {
    const keys = TL_PERMISSION_GROUPS.filter(g => g.actions.includes(action)).map(g => getTLPermissionKey(g.module, action))
    const allChecked = keys.every(k => permissions.includes(k))
    setter(allChecked ? permissions.filter(p => !keys.includes(p)) : [...new Set([...permissions, ...keys])])
  }

  return (
    <div>
      <div className="perm-table-container">
        <div className="perm-table-controls">
          <div className="perm-table-summary">
            <strong>{selectedCount}</strong> of <strong>{totalActions}</strong> permissions selected
          </div>
          <button type="button" className="perm-table-action-btn" onClick={() => setter(TL_ALL_PERMISSIONS)}>Select All</button>
          <button type="button" className="perm-table-action-btn" onClick={() => setter([])}>Clear All</button>
        </div>

        <div className="perm-table">
          <div className="perm-table-header" style={{ gridTemplateColumns: gridCols }}>
            <div className="perm-table-col-module">Module</div>
            {TL_MATRIX_ACTIONS.map(a => {
              const colKeys = TL_PERMISSION_GROUPS.filter(g => g.actions.includes(a)).map(g => getTLPermissionKey(g.module, a))
              const colAllChecked = colKeys.every(k => permissions.includes(k))
              const colSomeChecked = !colAllChecked && colKeys.some(k => permissions.includes(k))
              return (
                <button
                  key={a}
                  type="button"
                  className={`perm-table-col-action perm-table-col-head ${colAllChecked ? 'col-all' : ''} ${colSomeChecked ? 'col-some' : ''}`}
                  onClick={() => toggleColumn(a)}
                  title={`${TL_ACTION_META[a].tooltip} — click to toggle "${TL_ACTION_META[a].label}" for every module`}
                >
                  <span className="perm-table-action-label">{TL_ACTION_META[a].label}</span>
                  <span className="perm-table-action-desc">{TL_ACTION_META[a].desc}</span>
                </button>
              )
            })}
          </div>
          {TL_PERMISSION_GROUPS.map(group => {
            const perms = group.actions.map(a => getTLPermissionKey(group.module, a))
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
                {TL_MATRIX_ACTIONS.map(action => {
                  const hasAction = group.actions.includes(action)
                  const key = getTLPermissionKey(group.module, action)
                  return (
                    <div key={action} className="perm-table-col-action">
                      {hasAction ? (
                        <label className="perm-table-check-label" title={`${TL_ACTION_META[action].tooltip} in ${group.module}`}>
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
          <span className="perm-table-summary-text">{buildTLSummaryLabel(permissions)}</span>
        </div>
      )}
    </div>
  )
}

export function TeamLeaders() {
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [executives, setExecutives] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [executiveFilter, setExecutiveFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const form = useForm<TeamLeaderFormValues>({
    // Cast: known @hookform/resolvers/zod inference mismatch (runtime identical).
    resolver: zodResolver(teamLeaderSchema) as Resolver<TeamLeaderFormValues>,
    defaultValues: {
      name: '', email: '', username: '', password: '', phone: '', companyId: '', executiveIds: [],
      designation: '', departmentId: '', departmentName: '',
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

  // Permission matrix (all 53 enabled by default for Team Leaders)
  const [addPermissions, setAddPermissions] = useState<string[]>(TL_ALL_PERMISSIONS)
  const [editPermissions, setEditPermissions] = useState<string[]>([])

  // File upload refs
  const aadharFileRef = useRef<File | null>(null)
  const panFileRef = useRef<File | null>(null)
  const joiningLetterFileRef = useRef<File | null>(null)
  const offerLetterFileRef = useRef<File | null>(null)
  const [aadharFileName, setAadharFileName] = useState('')
  const [panFileName, setPanFileName] = useState('')
  const [joiningLetterFileName, setJoiningLetterFileName] = useState('')
  const [offerLetterFileName, setOfferLetterFileName] = useState('')

  const handleDocSelect = (
    field: 'aadharDoc' | 'panDoc' | 'joiningLetterDoc' | 'offerLetterDoc',
    fileRef: React.MutableRefObject<File | null>,
    setFileName: (name: string) => void
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setToast({ message: 'File size exceeds 5MB limit. Please choose a smaller file.', type: 'error' })
      e.target.value = ''
      return
    }
    fileRef.current = file
    setFileName(file.name)
  }

  const uploadFileToStorage = async (file: File, userId: string, field: string): Promise<string> => {
    const sRef = storageRef(storage, `team-leaders/${userId}/${field}`)
    const snapshot = await uploadBytes(sRef, file)
    return getDownloadURL(snapshot.ref)
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

  const buildAttendanceSettings = (v: TeamLeaderFormValues) => ({
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

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as User[]
      setUsers(all.filter(u => u.role === 'team-leader'))
      setExecutives(all.filter(u => u.role === 'executive' && u.isActive))
      setLoading(false)
    }, err => {
      console.error(err)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [comps, depts] = await Promise.all([
        getAllCompanies().catch(() => [] as Company[]),
        getAllDepartments().catch(() => [] as Department[]),
      ])
      setCompanies(comps)
      setDepartments(depts)
    } catch (err) {
      console.error(err)
    }
  }

  const handleAdd = async (values: TeamLeaderFormValues) => {
    if (!values.username || values.username.length < 3) {
      setToast({ message: 'Username must be at least 3 characters', type: 'error' })
      return
    }
    if (!values.password || values.password.length < 6) {
      setToast({ message: 'Password must be at least 6 characters', type: 'error' })
      return
    }
    setIsSubmitting(true)
    try {
      const selectedExecs = executives.filter(e => values.executiveIds?.includes(e.id))
      const targetCompanyId = values.companyId || authUser?.companyId || null

      const createStaffUser = httpsCallable(functions, 'createStaffUser')
      const { data: result } = await createStaffUser({
        email: values.email,
        password: values.password,
        name: values.name,
        username: values.username,
        phone: values.phone || '',
        role: 'team-leader',
        companyId: targetCompanyId || undefined,
        departmentId: values.departmentId || undefined,
        departmentName: values.departmentName || '',
        designation: values.designation || '',
        contingencyAccess: false,
        linkedExecutiveIds: selectedExecs.map(e => e.id),
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
      const accountUid = (result as any).uid as string

      const newUser: User = {
        id: accountUid,
        name: values.name,
        email: values.email,
        role: 'team-leader',
        companyId: targetCompanyId,
        departmentId: values.departmentId || null,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(values.name)}&background=f97316&color=fff`,
        permissions: addPermissions, permissionsConfigured: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        phone: values.phone || '',
        department: values.departmentName || '',
        linkedExecutiveIds: selectedExecs.map(e => e.id),
        contingencyAccess: false,
        designation: values.designation || '',
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

      // Upload files (account and user doc are created server-side by the admin callable)
      const uploads: { field: string; url: string }[] = []
      if (aadharFileRef.current) {
        const url = await uploadFileToStorage(aadharFileRef.current, accountUid, 'aadharDoc')
        uploads.push({ field: 'aadharDoc', url })
      }
      if (panFileRef.current) {
        const url = await uploadFileToStorage(panFileRef.current, accountUid, 'panDoc')
        uploads.push({ field: 'panDoc', url })
      }
      if (joiningLetterFileRef.current) {
        const url = await uploadFileToStorage(joiningLetterFileRef.current, accountUid, 'joiningLetterDoc')
        uploads.push({ field: 'joiningLetterDoc', url })
      }
      if (offerLetterFileRef.current) {
        const url = await uploadFileToStorage(offerLetterFileRef.current, accountUid, 'offerLetterDoc')
        uploads.push({ field: 'offerLetterDoc', url })
      }
      if (uploads.length > 0) {
        const updateData: Record<string, string> = {}
        uploads.forEach(u => (updateData[u.field] = u.url))
        await updateDoc(doc(db, 'users', accountUid), updateData)
        uploads.forEach(u => { (newUser as any)[u.field] = u.url })
      }

      // Update each selected executive's assignedTeamLeaderIds
      for (const exec of selectedExecs) {
        const currentTLs = (exec as any).assignedTeamLeaderIds || []
        if (!currentTLs.includes(accountUid)) {
          await updateDoc(doc(db, 'users', exec.id), {
            assignedTeamLeaderIds: [...currentTLs, accountUid],
          })
        }
      }

      setUsers(prev => [...prev, newUser])
      setIsAddModalOpen(false)
      form.reset()
      resetFileStates()
      const execNames = selectedExecs.map(e => e.name).join(', ') || 'no executive'
      logAudit({
        userId: authUser?.id || '',
        userName: authUser?.name || 'System',
        userRole: authUser?.role || 'master-admin',
        action: `TL ${newUser.name} created`,
        actionType: 'create',
        module: 'Team Leaders',
        targetEntity: 'team-leader',
        targetId: newUser.id,
        companyId: targetCompanyId || undefined,
        companyName: companies.find(c => c.id === targetCompanyId)?.name,
        details: `Team Leader ${newUser.name} was created and linked to ${execNames}`,
        status: 'success',
      })
      setToast({ message: `Team Leader created! Username: ${values.username}, Password: ${values.password}`, type: 'success' })
    } catch (err: any) {
      const friendly = authErrorMessage(err?.code || err?.message || '')
      setToast({ message: friendly || errText(err, 'Failed to create team leader. Please try again.'), type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const loadDepartments = async (companyId?: string) => {
    try {
      const id = companyId || authUser?.companyId
      const depts = id ? await getDepartmentsByCompany(id) : await getAllDepartments()
      setDepartments(depts)
    } catch (err) {
      console.error('Failed to load departments', err)
    }
  }

  const openAdd = () => {
    form.reset({ companyId: authUser?.companyId || '', executiveIds: [] })
    setAddPermissions(TL_ALL_PERMISSIONS)
    setIsAddModalOpen(true)
  }

  const filtered = users.filter(u => {
    const s = searchTerm.toLowerCase()
    if (s && !u.name?.toLowerCase().includes(s) && !u.email?.toLowerCase().includes(s)) return false
    if (executiveFilter) {
      const linkedIds: string[] = (u as any).linkedExecutiveIds || ((u as any).reportingExecutiveId ? [(u as any).reportingExecutiveId] : [])
      if (!linkedIds.includes(executiveFilter)) return false
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const openView = (u: User) => {
    setSelectedUser(u)
    setIsViewModalOpen(true)
  }

  const openEdit = (u: User) => {
    setSelectedUser(u)
    const linkedIds = (u as any).linkedExecutiveIds || ((u as any).reportingExecutiveId ? [(u as any).reportingExecutiveId] : [])
    form.reset({
      name: u.name,
      email: u.email,
      phone: (u as any).phone || '',
      executiveIds: linkedIds,
      designation: (u as any).designation || '',
      departmentId: (u as any).departmentId || '',
      departmentName: (u as any).departmentName || '',
      employmentType: (u as any).employmentType || 'Full-time',
      status: (u as any).status || 'Active',
      joinDate: (u as any).joinDate || '',
      aadharNumber: (u as any).aadharNumber || '',
      panNumber: (u as any).panNumber || '',
      bankName: (u as any).bankName || '',
      accountHolderName: (u as any).accountHolderName || '',
      accountNumber: (u as any).accountNumber || '',
      ifscCode: (u as any).ifscCode || '',
      pfAccountNumber: (u as any).pfAccountNumber || '',
      uanNumber: (u as any).uanNumber || '',
      address: (u as any).address || '',
      emergencyContactName: (u as any).emergencyContactName || '',
      emergencyContactPhone: (u as any).emergencyContactPhone || '',
      monthlyGrossSalary: (u as any).monthlyGrossSalary || 0,
      salaryEffectiveDate: (u as any).salaryEffectiveDate && isDate((u as any).salaryEffectiveDate) ? (u as any).salaryEffectiveDate.toISOString().split('T')[0] : typeof (u as any).salaryEffectiveDate === 'string' ? (u as any).salaryEffectiveDate : '',
      officeAddress: ((u as any).attendanceSettings || {}).officeAddress || '',
      latitude: ((u as any).attendanceSettings || {}).latitude || 0,
      longitude: ((u as any).attendanceSettings || {}).longitude || 0,
      radiusInMeters: ((u as any).attendanceSettings || {}).radiusInMeters || 100,
      allowMobileData: ((u as any).attendanceSettings || {}).allowMobileData ?? true,
      requireWifi: ((u as any).attendanceSettings || {}).requireWifi ?? false,
      wifiSSID: ((u as any).attendanceSettings || {}).wifiSSID || '',
      requireSelfie: ((u as any).attendanceSettings || {}).requireSelfie ?? false,
    })
    // Existing TLs keep their saved matrix; empty/legacy docs default to full access
    const savedPerms: string[] = (u as any).permissions || []
    setEditPermissions(savedPerms.length > 0 ? savedPerms : TL_ALL_PERMISSIONS)
    resetFileStates()
    setIsEditModalOpen(true)
  }

  const handleToggleContingency = async (tl: User, enable: boolean) => {
    try {
      await updateDoc(doc(db, 'users', tl.id), { contingencyAccess: enable, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(u => u.id === tl.id ? { ...u, contingencyAccess: enable } as any : u))
      const linkedIds = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : [])
      const execNames = linkedIds.map((id: string) => executives.find(e => e.id === id)?.name).filter(Boolean).join(', ') || 'Unknown'
      logAudit({
        userId: authUser?.id || '',
        userName: authUser?.name || 'System',
        userRole: authUser?.role || 'master-admin',
        action: `TL ${tl.name} ${enable ? 'activated' : 'deactivated'} Contingency Access for ${execNames}`,
        actionType: 'update',
        module: 'Team Leaders',
        targetEntity: 'team-leader',
        targetId: tl.id,
        companyId: tl.companyId || undefined,
        companyName: companies.find(c => c.id === tl.companyId)?.name,
        details: `Contingency Access was ${enable ? 'enabled' : 'disabled'} for Team Leader ${tl.name} ${enable ? 'granting full executive permissions for ' + execNames : ''}`.trim(),
        status: enable ? 'success' : 'warning',
      })
      setToast({ message: `Contingency Access ${enable ? 'activated' : 'deactivated'} for ${tl.name}`, type: 'success' })
    } catch {
      setToast({ message: 'Failed to update contingency access', type: 'error' })
    }
  }

  const handleEdit = async (values: TeamLeaderFormValues) => {
    if (!selectedUser) return
    setIsSubmitting(true)
    try {
      const prevLinkedIds: string[] = (selectedUser as any).linkedExecutiveIds || ((selectedUser as any).reportingExecutiveId ? [(selectedUser as any).reportingExecutiveId] : [])
      const newIds: string[] = values.executiveIds || []
      const newExecs = executives.filter(e => newIds.includes(e.id))

      const toRemove = prevLinkedIds.filter(id => !newIds.includes(id))
      const toAdd = newIds.filter(id => !prevLinkedIds.includes(id))

      // Remove TL from unselected executives' assignedTeamLeaderIds
      for (const execId of toRemove) {
        const exec = await getAllUsers().then(all => all.find(x => x.id === execId))
        if (exec) {
          const updatedTLs = ((exec as any).assignedTeamLeaderIds || []).filter((id: string) => id !== selectedUser.id)
          await updateDoc(doc(db, 'users', execId), { assignedTeamLeaderIds: updatedTLs })
        }
      }

      // Add TL to newly selected executives' assignedTeamLeaderIds
      for (const execId of toAdd) {
        const exec = executives.find(e => e.id === execId)
        if (exec) {
          const currentTLs = (exec as any).assignedTeamLeaderIds || []
          if (!currentTLs.includes(selectedUser.id)) {
            await updateDoc(doc(db, 'users', execId), {
              assignedTeamLeaderIds: [...currentTLs, selectedUser.id],
            })
          }
        }
      }

      // Check sensitive field changes
      const salaryChanged = (selectedUser as any).monthlyGrossSalary !== values.monthlyGrossSalary
      const bankChanged = (selectedUser as any).accountNumber !== values.accountNumber || (selectedUser as any).ifscCode !== values.ifscCode
      const identityChanged = (selectedUser as any).aadharNumber !== values.aadharNumber || (selectedUser as any).panNumber !== values.panNumber

      await updateDoc(doc(db, 'users', selectedUser.id), {
        name: values.name,
        email: values.email,
        phone: values.phone || '',
        linkedExecutiveIds: newIds,
        reportingExecutiveId: newExecs[0]?.id || null,
        reportingExecutiveName: newExecs[0]?.name || null,
        permissions: editPermissions,
        permissionsConfigured: true,
        designation: values.designation || '',
        departmentId: values.departmentId || null,
        department: values.departmentName || '',
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
      })

      // Upload files (non-fatal — an upload failure must not fail the save)
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

      // Audit logs
      if (salaryChanged) {
        const oldSal = (selectedUser as any).monthlyGrossSalary || 0
        const newSal = values.monthlyGrossSalary || 0
        logAudit({
          userId: authUser?.id || '',
          userName: authUser?.name || 'System',
          userRole: authUser?.role || 'master-admin',
          action: `Salary for TL ${values.name} updated from $${oldSal.toFixed(2)} to $${newSal.toFixed(2)} by ${authUser?.name || 'System'}`,
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
          action: `Bank details for TL ${values.name} updated by ${authUser?.name || 'System'}`,
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
          action: `Identity documents for TL ${values.name} updated by ${authUser?.name || 'System'}`,
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
        linkedExecutiveIds: newIds,
        reportingExecutiveId: newExecs[0]?.id || null,
        reportingExecutiveName: newExecs[0]?.name || null,
        permissions: [...editPermissions],
        designation: values.designation || '',
        departmentId: values.departmentId || null,
        department: values.departmentName || '',
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
      } as any : u))
      setIsEditModalOpen(false)
      setSelectedUser(null)
      form.reset()
      resetFileStates()
      const names = newExecs.map(e => e.name).join(', ') || 'no executive'
      logAudit({
        userId: authUser?.id || '',
        userName: authUser?.name || 'System',
        userRole: authUser?.role || 'master-admin',
        action: `TL ${values.name} reassigned to ${names}`,
        actionType: 'update',
        module: 'Team Leaders',
        targetEntity: 'team-leader',
        targetId: selectedUser.id,
        companyId: selectedUser.companyId || undefined,
        companyName: companies.find(c => c.id === selectedUser.companyId)?.name,
        details: `Team Leader ${values.name} updated — linked executives: ${names}`,
        status: 'success',
      })
      setToast({ message: 'Team Leader updated successfully!', type: 'success' })
    } catch {
      setToast({ message: 'Failed to update team leader', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (u: User) => {
    if (!confirm(`Deactivate ${u.name}? They will no longer be able to log in.`)) return
    try {
      // Remove TL from all linked executives' assignedTeamLeaderIds
      const linkedIds: string[] = (u as any).linkedExecutiveIds || ((u as any).reportingExecutiveId ? [(u as any).reportingExecutiveId] : [])
      for (const execId of linkedIds) {
        const exec = await getAllUsers().then(all => all.find(x => x.id === execId))
        if (exec) {
          const updatedTLs = ((exec as any).assignedTeamLeaderIds || []).filter((id: string) => id !== u.id)
          await updateDoc(doc(db, 'users', execId), { assignedTeamLeaderIds: updatedTLs })
        }
      }
      await updateDoc(doc(db, 'users', u.id), { isActive: false, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isActive: false } : x))
      setToast({ message: `${u.name} deactivated`, type: 'success' })
    } catch {
      setToast({ message: 'Failed to deactivate team leader', type: 'error' })
    }
  }

  const executiveOptions = executives.filter(e => e.isActive).map(e => ({
    id: e.id,
    name: e.name,
    title: (e as any).executiveTitle || 'Executive',
  }))

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Team Leaders" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading team leaders...</p></div></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Team Leaders" />
      <div className="page-content">
          <div className="emp-stats-row">
            <div className="emp-mini-stat"><UserPlus size={22} /><div><strong>{users.length}</strong><span>Total Team Leaders</span></div></div>
            <div className="emp-mini-stat"><Crown size={22} /><div><strong>{executiveOptions.length}</strong><span>Active Executives</span></div></div>
            <div className="emp-mini-stat"><Building2 size={22} /><div><strong>{users.filter(u => { const ids = (u as any).linkedExecutiveIds || ((u as any).reportingExecutiveId ? [(u as any).reportingExecutiveId] : []); return ids.length > 0 }).length}</strong><span>Linked to Executive</span></div></div>
            <div className="emp-mini-stat"><Activity size={22} /><div><strong>{users.filter(u => (u as any).contingencyAccess).length}</strong><span>Contingency Active</span></div></div>
          </div>

        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search team leaders by name or email..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
          </div>
          <div className="emp-toolbar-actions">
            <div className="emp-filter-group">
              <Filter size={14} />
              <select value={executiveFilter} onChange={e => { setExecutiveFilter(e.target.value); setCurrentPage(1) }}>
                <option value="">All Executives</option>
                {executiveOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            {authUser?.role === 'master-admin' && (
              <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={16} /> Add Team Leader</button>
            )}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="tl-table data-table">
            <thead>
              <tr>
                <th>Team Leader Name</th>
                <th>Assigned Executive</th>
                <th>Companies Handled</th>
                <th>Contingency Status</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={6} className="empty-cell" style={{ padding: 48, color: '#9ca3af' }}>No team leaders found</td></tr>
              ) : paginated.map(u => {
                const linkedExecIds: string[] = (u as any).linkedExecutiveIds || ((u as any).reportingExecutiveId ? [(u as any).reportingExecutiveId] : [])
                const linkedExecs = executives.filter(e => linkedExecIds.includes(e.id))
                const companyIds = linkedExecs.flatMap((e: any) => e?.assignedCompanyIds || [])
                const uniqueCompanyIds = [...new Set(companyIds)]
                const hasContingency = !!(u as any).contingencyAccess
                return (
                <tr key={u.id}>
                  <td>
                    <div className="tl-name-cell">
                      <span className="name">{u.name}</span>
                      <span className="sub">{u.email}</span>
                    </div>
                  </td>
                  <td>
                    {linkedExecs.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {linkedExecs.slice(0, 2).map(ex => (
                          <span
                            key={ex.id}
                            className="tl-exec-link"
                            onClick={(ev) => { ev.stopPropagation(); navigate('/executive-oversight') }}
                          >
                            {ex.name}
                          </span>
                        ))}
                        {linkedExecs.length > 2 && (
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>+{linkedExecs.length - 2} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="tl-exec-none">Not Assigned</span>
                    )}
                  </td>
                  <td>
                    {uniqueCompanyIds.length > 0 ? (
                      <div className="tl-companies-wrap">
                        {uniqueCompanyIds.slice(0, 3).map((cId: string) => {
                          const comp = companies.find(c => c.id === cId)
                          return (
                            <span
                              key={cId}
                              className="tl-company-chip"
                              onClick={(ev) => { ev.stopPropagation(); navigate('/companies') }}
                            >
                              {comp?.name || cId}
                            </span>
                          )
                        })}
                        {uniqueCompanyIds.length > 3 && (
                          <span className="tl-company-chip-more">+{uniqueCompanyIds.length - 3}</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>None</span>
                    )}
                  </td>
                  <td>
                    <span className={`tl-cont-pill ${hasContingency ? 'active' : 'contingency'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={(ev) => { ev.stopPropagation(); handleToggleContingency(u, !hasContingency) }}>
                      {hasContingency ? 'Active' : 'Contingency'}
                    </span>
                  </td>
                  <td>
                    <span className={`tl-status-pill ${u.isActive ? 'active' : 'inactive'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="emp-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="emp-action-icon view" onClick={() => openView(u)} title="View"><Eye size={15} /></button>
                      {authUser?.role === 'master-admin' && (
                        <>
                          <button className="emp-action-icon edit" title="Edit" onClick={() => openEdit(u)}><Pencil size={15} /></button>
                          <button className="emp-action-icon delete" title="Deactivate" onClick={() => handleDelete(u)}><Trash2 size={15} /></button>
                        </>
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

      {/* VIEW TEAM LEADER MODAL */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Team Leader Profile"
        size="large"
        footer={
          <>
            {selectedUser && authUser?.role === 'master-admin' && (
              <button className="btn-secondary" onClick={() => { setIsViewModalOpen(false); openEdit(selectedUser) }}><Pencil size={14} /> Edit</button>
            )}
            <button className="btn-primary" onClick={() => setIsViewModalOpen(false)}>Close</button>
          </>
        }
      >
        {selectedUser && (() => {
          const linkedExecIds: string[] = (selectedUser as any).linkedExecutiveIds || ((selectedUser as any).reportingExecutiveId ? [(selectedUser as any).reportingExecutiveId] : [])
          const linkedExecs = executives.filter(e => linkedExecIds.includes(e.id))
          const companyIds = linkedExecs.flatMap((e: any) => e?.assignedCompanyIds || [])
          const uniqueCompanyIds = [...new Set(companyIds)]
          const hasContingency = !!(selectedUser as any).contingencyAccess
          return (
            <div>
              <div className="modal-profile-header">
                <div className="modal-profile-info">
                  <h2>{selectedUser.name}</h2>
                  <p>Team Leader{linkedExecs.length > 0 ? ` Â· ${linkedExecs.map(e => e.name).join(', ')}` : ''}</p>
                  <div className="modal-profile-badges">
                    <span className={`tl-status-pill ${selectedUser.isActive ? 'active' : 'inactive'}`}>{selectedUser.isActive ? 'Active' : 'Inactive'}</span>
                    <span className={`tl-cont-pill ${hasContingency ? 'active' : 'contingency'}`}>{hasContingency ? 'Contingency Active' : 'Contingency'}</span>
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
                <div className="modal-section-header"><Crown size={18} /><h4>Organization Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Assigned Executives</label><div className="field-value">{linkedExecs.length > 0 ? linkedExecs.map(e => e.name).join(', ') : 'Not Assigned'}</div></div>
                  <div className="modal-field"><label>Companies Handled</label><div className="field-value">{uniqueCompanyIds.length > 0 ? uniqueCompanyIds.map((cId: string) => companies.find(c => c.id === cId)?.name || cId).join(', ') : 'None'}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Shield size={18} /><h4>Account &amp; Access</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Role</label><div className="field-value">Team Leader</div></div>
                  <div className="modal-field"><label>Contingency Access</label><div className="field-value">{hasContingency ? 'Enabled' : 'Disabled'}</div></div>
                  <div className="modal-field"><label>Status</label><div className="field-value" style={{ color: selectedUser.isActive ? '#16a34a' : '#ef4444' }}>{selectedUser.isActive ? 'Active' : 'Inactive'}</div></div>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ADD TEAM LEADER MODAL */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Team Leader"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
            <button className="btn-primary" form="tl-add-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Team Leader'}
            </button>
          </>
        }
      >
        <form id="tl-add-form" onSubmit={form.handleSubmit(handleAdd)}>
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
                <input type="email" {...form.register('email')} placeholder="leader@company.com" />
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

          {/* Position Details */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Briefcase size={18} /><h4>Position Details</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Designation</label>
                <input type="text" {...form.register('designation')} placeholder="e.g. Senior Team Leader" />
              </div>
              {!authUser?.companyId && (
                <div className="modal-field">
                  <label>Company *</label>                  <select {...form.register('companyId')} onChange={e => {
                    const cId = e.target.value
                    form.setValue('companyId', cId)
                    form.setValue('departmentId', '')
                    form.setValue('departmentName', '')
                    loadDepartments(cId || undefined)
                  }}>
                    <option value="">Select company</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="modal-field">
                <label>Department</label>
                <select {...form.register('departmentId')} onChange={e => {
                  const dept = departments.find(d => d.id === e.target.value)
                  form.setValue('departmentName', dept?.name || '')
                }}>
                  <option value="">Select department</option>
                  {departments.filter(d => !authUser?.companyId || d.companyId === (form.watch('companyId') || authUser?.companyId)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
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

          {/* Access Permissions (53 permissions, all enabled by default) */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Shield size={18} /><h4>Access Permissions</h4>
            </div>
            <div className="modal-section-content">
              <TLPermissionsSection permissions={addPermissions} setter={setAddPermissions} />
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('aadharDoc', aadharFileRef, setAadharFileName)} style={{ display: 'none' }} id="tl-aadhar-upload" />
                    <label htmlFor="tl-aadhar-upload" className="file-upload-label">
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('panDoc', panFileRef, setPanFileName)} style={{ display: 'none' }} id="tl-pan-upload" />
                    <label htmlFor="tl-pan-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{panFileName || 'Upload PAN card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field full-width">
                  <label>Company Joining Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('joiningLetterDoc', joiningLetterFileRef, setJoiningLetterFileName)} style={{ display: 'none' }} id="tl-joining-letter-upload" />
                    <label htmlFor="tl-joining-letter-upload" className="file-upload-label">
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('offerLetterDoc', offerLetterFileRef, setOfferLetterFileName)} style={{ display: 'none' }} id="tl-offer-letter-upload" />
                    <label htmlFor="tl-offer-letter-upload" className="file-upload-label">
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

          {/* Reporting Hierarchy */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Crown size={18} /><h4>Reporting Hierarchy</h4>
            </div>
            <div className="modal-section-content">
              {!authUser?.companyId && (
                <div className="modal-field">
                  <label>Company</label>
                  <select {...form.register('companyId')}>
                    <option value="">Select company</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="modal-field">
                <label>Linked Executives</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
                  {executiveOptions.map(e => {
                    const checked = form.watch('executiveIds')?.includes(e.id) || false
                    return (
                      <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fff7ed' : 'transparent', border: checked ? '1px solid #fed7aa' : '1px solid transparent', fontSize: 13 }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const current = form.getValues('executiveIds') || []
                          if (checked) form.setValue('executiveIds', current.filter(id => id !== e.id), { shouldValidate: true })
                          else form.setValue('executiveIds', [...current, e.id], { shouldValidate: true })
                        }} style={{ accentColor: '#f97316' }} />
                        <Crown size={14} style={{ color: '#c2410c', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>{e.name}</div>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{e.title}</span>
                      </label>
                    )
                  })}
                  {executiveOptions.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No active executives available</span>}
                </div>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* EDIT TEAM LEADER MODAL */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); form.reset() }}
        title="Edit Team Leader"
        size="large"
        footer={
          <>
            <button className="btn-secondary" onClick={() => { setIsEditModalOpen(false); form.reset() }}>Cancel</button>
            <button className="btn-primary" form="tl-edit-form" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <form id="tl-edit-form" onSubmit={form.handleSubmit(handleEdit)}>
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
                <label>Email *</label>
                <input type="email" {...form.register('email')} placeholder="leader@company.com" />
                {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}
              </div>
              <div className="modal-field">
                <label>Phone Number</label>
                <input type="text" {...form.register('phone')} placeholder="+1 234 567 890" />
              </div>
          </div>
        </div>

          {/* Position Details */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Briefcase size={18} /><h4>Position Details</h4>
            </div>
            <div className="modal-section-content">
              <div className="modal-field">
                <label>Designation</label>
                <input type="text" {...form.register('designation')} placeholder="e.g. Senior Team Leader" />
              </div>
              <div className="modal-field">
                <label>Department</label>
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

          {/* Access Permissions (53 permissions, all enabled by default) */}
          <div className="modal-section">
            <div className="modal-section-header">
              <Shield size={18} /><h4>Access Permissions</h4>
            </div>
            <div className="modal-section-content">
              <TLPermissionsSection permissions={editPermissions} setter={setEditPermissions} />
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('aadharDoc', aadharFileRef, setAadharFileName)} style={{ display: 'none' }} id="tl-edit-aadhar-upload" />
                    <label htmlFor="tl-edit-aadhar-upload" className="file-upload-label">
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('panDoc', panFileRef, setPanFileName)} style={{ display: 'none' }} id="tl-edit-pan-upload" />
                    <label htmlFor="tl-edit-pan-upload" className="file-upload-label">
                      <Upload size={18} />
                      <span>{panFileName || 'Upload PAN card (JPG, PNG or PDF, max 5MB)'}</span>
                    </label>
                  </div>
                </div>
                <div className="modal-field full-width">
                  <label>Company Joining Letter</label>
                  <div className="file-upload-wrapper">
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('joiningLetterDoc', joiningLetterFileRef, setJoiningLetterFileName)} style={{ display: 'none' }} id="tl-edit-joining-letter-upload" />
                    <label htmlFor="tl-edit-joining-letter-upload" className="file-upload-label">
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
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleDocSelect('offerLetterDoc', offerLetterFileRef, setOfferLetterFileName)} style={{ display: 'none' }} id="tl-edit-offer-letter-upload" />
                    <label htmlFor="tl-edit-offer-letter-upload" className="file-upload-label">
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

        <div className="modal-section">
          <div className="modal-section-header">
            <Crown size={18} /><h4>Reporting Hierarchy</h4>
          </div>
          <div className="modal-section-content">
            <div className="modal-field">
              <label>Linked Executives</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
                {executiveOptions.map(e => {
                  const checked = form.watch('executiveIds')?.includes(e.id) || false
                  return (
                    <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: checked ? '#fff7ed' : 'transparent', border: checked ? '1px solid #fed7aa' : '1px solid transparent', fontSize: 13 }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        const current = form.getValues('executiveIds') || []
                        if (checked) form.setValue('executiveIds', current.filter(id => id !== e.id), { shouldValidate: true })
                        else form.setValue('executiveIds', [...current, e.id], { shouldValidate: true })
                      }} style={{ accentColor: '#f97316' }} />
                      <Crown size={14} style={{ color: '#c2410c', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>{e.name}</div>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>{e.title}</span>
                    </label>
                  )
                })}
                {executiveOptions.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No active executives available</span>}
              </div>
            </div>
          </div>
        </div>

          <div className="modal-section">
            <div className="modal-section-header">
              <Activity size={18} /><h4>Contingency Access</h4>
            </div>
            <div className="modal-section-content">
              {selectedUser && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', gridColumn: '1 / -1' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Grant Full Executive Access</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>When enabled, this TL inherits A-Z permissions from their assigned executive for operational continuity.</div>
                  </div>
                  <div
                    className={`perm-grant-switch ${(selectedUser as any).contingencyAccess ? 'on' : ''}`}
                    onClick={() => {
                      const newVal = !(selectedUser as any).contingencyAccess
                      handleToggleContingency(selectedUser, newVal)
                      setSelectedUser({ ...selectedUser, contingencyAccess: newVal } as any)
                    }}
                  >
                    <div className="perm-grant-switch-knob" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </form>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
