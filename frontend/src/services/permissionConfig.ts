/**
 * Permission Matrix Configuration
 *
 * Single source of truth for the Access Management permission editor:
 *  - all modules available in the app (grouped into categories)
 *  - the 12-action permission vocabulary per module
 *  - Quick-Start templates for Team Leader & Executive roles
 *  - helpers to convert between the in-editor matrix and the compressed
 *    dot-string array persisted on the user document
 *
 * Enforcement ("real rules", not just UI):
 *  - frontend:  AuthContext.hasPermission()
 *  - backend:   firestore.rules hasPermission()
 * Both treat `module.*` / `module.manage` as "every action in the module"
 * and a `*` entry as full access, so the compressed arrays stay small.
 */

import {
  LayoutDashboard, Building2, Users, CheckSquare,
  BarChart3, Settings, Wallet, PartyPopper, Calendar, Crown,
  Megaphone, UserCog, Mail, Cake, HelpCircle, Network, Clock,
  TrendingUp, CalendarDays, BadgeDollarSign, FolderOpen, BookUser,
  KeyRound, ShieldCheck, Shield, Eye,
} from 'lucide-react'

type Icon = typeof LayoutDashboard
export type PermissionActionKey =
  | 'view' | 'create' | 'edit' | 'delete'
  | 'approve' | 'reject' | 'cancel' | 'calc' | 'disburse'
  | 'export' | 'download' | 'manage'

export interface PermissionModule {
  key: string
  label: string
  icon?: Icon
  color: string
  category: string
  /** Subset of the 12 actions that make sense for this module */
  actions: PermissionActionKey[]
}

export interface PermissionCategory {
  key: string
  label: string
  icon: Icon
  color: string
}

// ─── Action vocabulary (12 columns) ────────────────────────────────
export const PERMISSION_ACTIONS: { key: PermissionActionKey; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'approve', label: 'Approve' },
  { key: 'reject', label: 'Reject' },
  { key: 'cancel', label: 'Cancel' },
  { key: 'calc', label: 'Calculate' },
  { key: 'disburse', label: 'Disburse' },
  { key: 'export', label: 'Export' },
  { key: 'download', label: 'Download' },
  { key: 'manage', label: 'Manage' },
]
export const ACTION_KEYS: PermissionActionKey[] = PERMISSION_ACTIONS.map(a => a.key)

// ─── Categories ────────────────────────────────────────────────────
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, color: '#f97316' },
  { key: 'company', label: 'Company', icon: Building2, color: '#3b82f6' },
  { key: 'people', label: 'People', icon: Users, color: '#6366f1' },
  { key: 'operations', label: 'Operations', icon: Clock, color: '#f59e0b' },
  { key: 'finance', label: 'Finance & Reporting', icon: Wallet, color: '#16a34a' },
  { key: 'system', label: 'Communication & System', icon: ShieldCheck, color: '#7c3aed' },
]

// ─── Modules (from the actual app sections) ────────────────────────
export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: '#f97316', category: 'overview', actions: ['view', 'export', 'download'] },
  { key: 'companies', label: 'Companies', icon: Building2, color: '#3b82f6', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'departments', label: 'Departments', icon: Network, color: '#6b7280', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'holidays', label: 'Holidays', icon: PartyPopper, color: '#f59e0b', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'announcements', label: 'Announcements', icon: Megaphone, color: '#f43f5e', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'executives', label: 'Executives', icon: Crown, color: '#f59e0b', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'team-leaders', label: 'Team Leaders', icon: UserCog, color: '#10b981', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'employees', label: 'Employees', icon: Users, color: '#6366f1', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'export', 'download', 'manage'] },
  { key: 'birthdays', label: 'Birthdays', icon: Cake, color: '#ec4899', category: 'people', actions: ['view', 'export'] },
  { key: 'addressbook', label: 'Address Book', icon: BookUser, color: '#0ea5e9', category: 'people', actions: ['view', 'export'] },
  { key: 'attendance', label: 'Attendance', icon: Clock, color: '#f59e0b', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'download', 'manage'] },
  { key: 'leave', label: 'Leave Management', icon: CalendarDays, color: '#8b5cf6', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'export', 'manage'] },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare, color: '#14b8a6', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'] },
  { key: 'calendar', label: 'Calendar', icon: Calendar, color: '#eab308', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'documents', label: 'Documents', icon: FolderOpen, color: '#0ea5e9', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'download', 'manage'] },
  { key: 'payroll', label: 'Payroll', icon: Wallet, color: '#06b6d4', category: 'finance', actions: ['view', 'create', 'edit', 'approve', 'calc', 'disburse', 'export', 'download', 'manage'] },
  { key: 'salary', label: 'Salary', icon: BadgeDollarSign, color: '#f97316', category: 'finance', actions: ['view', 'create', 'edit', 'calc', 'disburse', 'export', 'download', 'manage'] },
  { key: 'reports', label: 'Reports', icon: BarChart3, color: '#22c55e', category: 'finance', actions: ['view', 'create', 'export', 'download'] },
  { key: 'analytics', label: 'Analytics', icon: TrendingUp, color: '#84cc16', category: 'finance', actions: ['view', 'export', 'download'] },
  { key: 'emails', label: 'Email', icon: Mail, color: '#6366f1', category: 'system', actions: ['view', 'create', 'export', 'manage'] },
  { key: 'settings', label: 'Settings', icon: Settings, color: '#64748b', category: 'system', actions: ['view', 'edit', 'manage'] },
  { key: 'access', label: 'Access & Permissions', icon: KeyRound, color: '#7c3aed', category: 'system', actions: ['view', 'manage'] },
  { key: 'support', label: 'Support', icon: HelpCircle, color: '#0284c7', category: 'system', actions: ['view', 'create', 'delete'] },
]

export const CATEGORIES_OF_MODULES = (categoryKey: string) =>
  PERMISSION_MODULES.filter(m => m.category === categoryKey)

// ─── Matrix helpers ────────────────────────────────────────────────
export type PermMatrix = Record<string, boolean>

export const allPermissionKeys = (): string[] =>
  PERMISSION_MODULES.flatMap(m => m.actions.map(a => `${m.key}.${a}`))

export const allMatrixFalse = (): PermMatrix => {
  const m: PermMatrix = {}
  allPermissionKeys().forEach(k => { m[k] = false })
  return m
}

const allMatrixTrue = (): PermMatrix => {
  const m = allMatrixFalse()
  allPermissionKeys().forEach(k => { m[k] = true })
  return m
}

export const countEnabled = (matrix: PermMatrix): number =>
  allPermissionKeys().filter(k => !!matrix[k]).length

export const TOTAL_PERMISSION_KEYS = allPermissionKeys().length

export const modulePermissionKeys = (mod: PermissionModule): string[] =>
  mod.actions.map(a => `${mod.key}.${a}`)

/**
 * Convert a stored permission array back into the full editor matrix.
 * Empty / missing / `*` arrays (legacy "full access" defaults) come back
 * fully enabled so the editor never silently locks anyone out.
 */
export const arrayToMatrix = (arr?: string[] | null): PermMatrix => {
  const m = allMatrixFalse()
  if (!arr || arr.length === 0 || arr.includes('*')) return allMatrixTrue()
  if (arr.includes('none')) return m
  for (const p of arr) {
    const sep = p.lastIndexOf('.')
    if (sep <= 0) continue
    const modKey = p.slice(0, sep)
    const action = p.slice(sep + 1)
    const mod = PERMISSION_MODULES.find(x => x.key === modKey)
    if (!mod) continue
    if (action === '*' || action === 'manage') {
      mod.actions.forEach(a => { m[`${modKey}.${a}`] = true })
    } else if ((mod.actions as string[]).includes(action)) {
      m[p] = true
    }
  }
  return m
}

/**
 * Compress an editor matrix back into the persisted array.
 *  - all enabled  -> ['*']        (full access)
 *  - none enabled -> ['none']     (explicit deny – NOT treated as full access)
 *  - otherwise    -> module.* for fully-enabled modules + individual keys
 */
export const matrixToArray = (matrix: PermMatrix): string[] => {
  const keys = allPermissionKeys()
  const enabled = keys.filter(k => matrix[k])
  if (enabled.length === keys.length) return ['*']
  if (enabled.length === 0) return ['none']
  const out: string[] = []
  for (const mod of PERMISSION_MODULES) {
    const modKeys = modulePermissionKeys(mod)
    if (modKeys.every(k => !!matrix[k])) {
      out.push(`${mod.key}.*`)
    } else {
      modKeys.forEach(k => { if (matrix[k]) out.push(k) })
    }
  }
  return out
}

// ─── Quick-Start Templates ─────────────────────────────────────────
export type TemplateKey = 'full' | 'standard' | 'operations' | 'reports' | 'view-only'

export interface PermissionTemplate {
  key: TemplateKey
  label: string
  icon: Icon
  color: string
  description: string
  keys: string[]
}

const TS_FULL: string[] = allPermissionKeys()
const TS_STANDARD: string[] = TS_FULL.filter(k => !['access.manage', 'documents.delete', 'emails.create'].includes(k))
const TS_VIEW_ONLY: string[] = allPermissionKeys().filter(k => k.endsWith('.view'))

const TS_OPERATIONS: string[] = [
  'dashboard.view',
  'companies.view', 'companies.export',
  'departments.view', 'departments.create', 'departments.edit', 'departments.delete', 'departments.manage',
  'holidays.view', 'holidays.create', 'holidays.edit', 'holidays.delete', 'holidays.export', 'holidays.manage',
  'announcements.view', 'announcements.create', 'announcements.edit', 'announcements.delete', 'announcements.manage',
  'executives.view', 'executives.create', 'executives.edit', 'executives.delete', 'executives.manage',
  'team-leaders.view', 'team-leaders.create', 'team-leaders.edit', 'team-leaders.delete', 'team-leaders.manage',
  'employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.export', 'employees.download', 'employees.manage',
  'birthdays.view', 'birthdays.export',
  'addressbook.view', 'addressbook.export',
  'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.delete', 'attendance.approve', 'attendance.export', 'attendance.download', 'attendance.manage',
  'leave.view', 'leave.create', 'leave.edit', 'leave.delete', 'leave.approve', 'leave.reject', 'leave.cancel', 'leave.export', 'leave.manage',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.approve', 'tasks.export', 'tasks.manage',
  'calendar.view', 'calendar.create', 'calendar.edit', 'calendar.delete', 'calendar.export', 'calendar.manage',
  'documents.view', 'documents.create', 'documents.edit', 'documents.download', 'documents.manage',
  'reports.view', 'reports.export', 'reports.download',
  'support.view', 'support.create', 'support.delete',
]

const TS_REPORTS: string[] = [
  'dashboard.view', 'dashboard.export', 'dashboard.download',
  'companies.view', 'companies.export',
  'employees.view', 'employees.export', 'employees.download',
  'attendance.view', 'attendance.export', 'attendance.download',
  'leave.view', 'leave.export',
  'payroll.view', 'payroll.export', 'payroll.download',
  'salary.view', 'salary.export', 'salary.download',
  'reports.view', 'reports.create', 'reports.export', 'reports.download',
  'analytics.view', 'analytics.export', 'analytics.download',
  'access.view',
]

// These templates apply to both Team Leaders and Executives. Access lists
// the exact modules each user can manage so a single template set works for
// both team-based (TL) and company-based (Executive) scopes.
export const ROLE_TEMPLATES: PermissionTemplate[] = [
  { key: 'full', label: 'Full Access', icon: ShieldCheck, color: '#16a34a', description: 'Every module with every action enabled.', keys: TS_FULL },
  { key: 'standard', label: 'Standard', icon: Shield, color: '#3b82f6', description: 'Full operational access; permission assignment, document deletion and outbound email sending are disabled.', keys: TS_STANDARD },
  { key: 'operations', label: 'Operations', icon: Clock, color: '#f59e0b', description: 'Day-to-day team operations — no payroll, salary, analytics or email sending.', keys: TS_OPERATIONS },
  { key: 'reports', label: 'Reports & Analytics', icon: BarChart3, color: '#22c55e', description: 'Read, export and download reporting data across modules.', keys: TS_REPORTS },
  { key: 'view-only', label: 'View Only', icon: Eye, color: '#64748b', description: 'View-only access — no create, edit, delete, approve or manage actions.', keys: TS_VIEW_ONLY },
]

/** Applies a template to a fresh matrix (still editable before saving). */
export const applyTemplate = (key: TemplateKey): PermMatrix => {
  const t = ROLE_TEMPLATES.find(x => x.key === key)
  if (!t) return allMatrixFalse()
  const m = allMatrixFalse()
  t.keys.forEach(k => { m[k] = true })
  return m
}

// Legacy hard-coded defaults that were previously written to user docs for
// team-leaders/executives. Users still carrying one of these arrays keep full
// access until an admin explicitly saves a new matrix (see AuthContext).
export const LEGACY_ROLE_DEFAULT_PERMS: Record<string, string[]> = {
  'team-leader': [
    'employees.view', 'departments.view',
    'attendance.view', 'attendance.edit', 'attendance.manage',
    'leave.view', 'leave.manage',
    'payroll.view', 'payroll.edit', 'payroll.manage',
    'reports.view', 'company.view',
    'tasks.view', 'tasks.create', 'tasks.edit',
    'emails.view',
  ],
  'executive': [
    'employees.view', 'employees.create', 'employees.edit',
    'departments.view',
    'payroll.view', 'payroll.edit', 'payroll.manage',
    'attendance.view',
    'leave.view', 'leave.apply', 'leave.manage',
    'settings.view', 'company.view',
    'tasks.view', 'tasks.create', 'tasks.edit',
    'emails.view', 'emails.create',
    'assets.view',
  ],
}

export const isSameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every(p => bSet.has(p))
}

// ─── Scope controls ────────────────────────────────────────────────
// Each module row in the matrix editor can carry a data-visibility scope:
//   'all'      -> the user sees every authorized company for that module
//                (Team Leader: whole linked-executives portfolio; Executive:
//                 all assignedCompanyIds). This is the default.
//   'assigned' -> only the companies the user directly belongs to.
// Served to pages via usePermissionScope(module) and enforced in
// firestore.rules via canCrudScoped / canManageAttendance / portfolio reads.
export type PermissionScope = 'all' | 'assigned'
export type PermissionScopeMap = Record<string, PermissionScope>

export const PERMISSION_SCOPE_OPTIONS: { key: PermissionScope; label: string; hint?: string }[] = [
  { key: 'all', label: 'All', hint: 'Every authorized company' },
  { key: 'assigned', label: 'Assigned only', hint: 'Only companies this user belongs to' },
]

/** Resolve the effective scope for a module (missing entry = 'all'). */
export const scopeOrDefault = (
  scopes: PermissionScopeMap | null | undefined,
  moduleKey: string
): PermissionScope => scopes?.[moduleKey] || 'all'

// ─── Core CRUD simplification ──────────────────────────────────────
// Team Leaders manage Companies, Executives and Employees; Executives manage
// Employees. Each core module uses the plain View / Create / Update / Delete
// vocabulary. Roles get full core CRUD by default and each action stays an
// individually toggleable checkbox in the editor.
export const CORE_CRUD_ACTIONS = ['view', 'create', 'edit', 'delete'] as const

export interface CoreCrudModule {
  key: string
  label: string
  icon: Icon
  color: string
}

export const CORE_CRUD_CONFIG: Record<'team-leader' | 'executive', {
  label: string
  description: string
  modules: CoreCrudModule[]
}> = {
  'team-leader': {
    label: 'Team Leader',
    description: 'Full CRUD on Companies, Executives and Employees.',
    modules: [
      { key: 'companies', label: 'Companies', icon: Building2, color: '#3b82f6' },
      { key: 'executives', label: 'Executives', icon: UserCog, color: '#f59e0b' },
      { key: 'employees', label: 'Employees', icon: Users, color: '#6366f1' },
    ],
  },
  'executive': {
    label: 'Executive',
    description: 'Full CRUD on Employees.',
    modules: [
      { key: 'employees', label: 'Employees', icon: Users, color: '#6366f1' },
    ],
  },
}

export const isCoreCrudRole = (role: string): role is 'team-leader' | 'executive' =>
  role === 'team-leader' || role === 'executive'

export const coreModulesForRole = (role: string): CoreCrudModule[] =>
  isCoreCrudRole(role) ? CORE_CRUD_CONFIG[role].modules : []

export const coreKeysForRole = (role: string): string[] =>
  coreModulesForRole(role).flatMap(m => CORE_CRUD_ACTIONS.map(a => `${m.key}.${a}`))

export const totalCoreKeys = (role: string): number => coreKeysForRole(role).length

/** True if `key` is one of the core CRUD keys for any matrix role. */
export const isCorePermissionKey = (key: string): boolean => {
  const core = ['companies', 'executives', 'employees']
  return core.some(m => CORE_CRUD_ACTIONS.some(a => `${m}.${a}` === key))
}

/**
 * Initial toggle state for the core CRUD grid. Unconfigured / legacy roles
 * start fully granted (the rule-side default); configured roles start from the
 * exact keys stored on the user document.
 */
export const initialCoreEnabled = (
  role: string,
  permissions: string[] | null | undefined,
  configured: boolean
): Record<string, boolean> => {
  const map: Record<string, boolean> = {}
  const perms = permissions || []
  const baselineFull = !configured || perms.length === 0 || perms.includes('*')
  coreKeysForRole(role).forEach(k => { map[k] = baselineFull || perms.includes(k) })
  return map
}

/**
 * Build the permissions array written back to Firestore. Enabled core keys are
 * written explicitly; every existing non-core grant is preserved untouched so
 * restricting the core modules never regresses the rest of the app.
 */
export const buildCorePermissionsArray = (
  role: string,
  enabled: Record<string, boolean>,
  existing: string[] | null | undefined
): string[] => {
  const existingArr = existing || []
  const enabledCore = coreKeysForRole(role).filter(k => enabled[k])
  let preserved: string[]
  if (existingArr.includes('*') || existingArr.length === 0) {
    // "Full access" baseline: keep full access to everything except core,
    // materialised explicitly so individual core toggles still bind.
    preserved = allPermissionKeys().filter(k => !isCorePermissionKey(k))
  } else if (existingArr.includes('none')) {
    preserved = []
  } else {
    preserved = existingArr.filter(p => !isCorePermissionKey(p))
  }
  return [...new Set([...enabledCore, ...preserved])]
}