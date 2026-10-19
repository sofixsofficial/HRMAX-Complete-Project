/**
 * Permission Matrix Configuration (mobile).
 *
 * Mirrors frontend/src/services/permissionConfig.ts with icons replaced by
 * Ionicons glyph names (the mobile app has no lucide-react dependency).
 * Single source of truth for the Access Management permission editor on
 * mobile: module/action vocabulary, quick-start templates, matrix <-> array
 * conversions and per-module data-visibility scopes ('all' | 'assigned').
 */

export type PermissionActionKey =
  | 'view' | 'create' | 'edit' | 'delete'
  | 'approve' | 'reject' | 'cancel' | 'calc' | 'disburse'
  | 'export' | 'download' | 'manage'

export interface PermissionModule {
  key: string
  label: string
  icon: string
  color: string
  category: string
  actions: PermissionActionKey[]
}

export interface PermissionCategory {
  key: string
  label: string
  icon: string
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
  { key: 'overview', label: 'Overview', icon: 'grid-outline', color: '#f97316' },
  { key: 'company', label: 'Company', icon: 'business-outline', color: '#3b82f6' },
  { key: 'people', label: 'People', icon: 'people-outline', color: '#6366f1' },
  { key: 'operations', label: 'Operations', icon: 'time-outline', color: '#f59e0b' },
  { key: 'finance', label: 'Finance & Reporting', icon: 'wallet-outline', color: '#16a34a' },
  { key: 'system', label: 'Communication & System', icon: 'shield-checkmark-outline', color: '#7c3aed' },
]

// ─── Modules (from the actual app sections) ────────────────────────
export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline', color: '#f97316', category: 'overview', actions: ['view', 'export', 'download'] },
  { key: 'companies', label: 'Companies', icon: 'business-outline', color: '#3b82f6', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'departments', label: 'Departments', icon: 'git-network-outline', color: '#6b7280', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'holidays', label: 'Holidays', icon: 'balloon-outline', color: '#f59e0b', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'announcements', label: 'Announcements', icon: 'megaphone-outline', color: '#f43f5e', category: 'company', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'executives', label: 'Executives', icon: 'ribbon-outline', color: '#f59e0b', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'team-leaders', label: 'Team Leaders', icon: 'person-circle-outline', color: '#10b981', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  { key: 'employees', label: 'Employees', icon: 'people-outline', color: '#6366f1', category: 'people', actions: ['view', 'create', 'edit', 'delete', 'export', 'download', 'manage'] },
  { key: 'birthdays', label: 'Birthdays', icon: 'gift-outline', color: '#ec4899', category: 'people', actions: ['view', 'export'] },
  { key: 'addressbook', label: 'Address Book', icon: 'book-outline', color: '#0ea5e9', category: 'people', actions: ['view', 'export'] },
  { key: 'attendance', label: 'Attendance', icon: 'time-outline', color: '#f59e0b', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'download', 'manage'] },
  { key: 'leave', label: 'Leave Management', icon: 'calendar-number-outline', color: '#8b5cf6', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'export', 'manage'] },
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', color: '#14b8a6', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'] },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', color: '#eab308', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  { key: 'documents', label: 'Documents', icon: 'folder-open-outline', color: '#0ea5e9', category: 'operations', actions: ['view', 'create', 'edit', 'delete', 'download', 'manage'] },
  { key: 'payroll', label: 'Payroll', icon: 'wallet-outline', color: '#06b6d4', category: 'finance', actions: ['view', 'create', 'edit', 'approve', 'calc', 'disburse', 'export', 'download', 'manage'] },
  { key: 'salary', label: 'Salary', icon: 'cash-outline', color: '#f97316', category: 'finance', actions: ['view', 'create', 'edit', 'calc', 'disburse', 'export', 'download', 'manage'] },
  { key: 'reports', label: 'Reports', icon: 'bar-chart-outline', color: '#22c55e', category: 'finance', actions: ['view', 'create', 'export', 'download'] },
  { key: 'analytics', label: 'Analytics', icon: 'trending-up-outline', color: '#84cc16', category: 'finance', actions: ['view', 'export', 'download'] },
  { key: 'emails', label: 'Email', icon: 'mail-outline', color: '#6366f1', category: 'system', actions: ['view', 'create', 'export', 'manage'] },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', color: '#64748b', category: 'system', actions: ['view', 'edit', 'manage'] },
  { key: 'access', label: 'Access & Permissions', icon: 'key-outline', color: '#7c3aed', category: 'system', actions: ['view', 'manage'] },
  { key: 'support', label: 'Support', icon: 'help-circle-outline', color: '#0284c7', category: 'system', actions: ['view', 'create', 'delete'] },
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
  icon: string
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

export const ROLE_TEMPLATES: PermissionTemplate[] = [
  { key: 'full', label: 'Full Access', icon: 'shield-checkmark-outline', color: '#16a34a', description: 'Every module with every action enabled.', keys: TS_FULL },
  { key: 'standard', label: 'Standard', icon: 'shield-outline', color: '#3b82f6', description: 'Full operational access; permission assignment, document deletion and outbound email sending are disabled.', keys: TS_STANDARD },
  { key: 'operations', label: 'Operations', icon: 'time-outline', color: '#f59e0b', description: 'Day-to-day team operations — no payroll, salary, analytics or email sending.', keys: TS_OPERATIONS },
  { key: 'reports', label: 'Reports & Analytics', icon: 'bar-chart-outline', color: '#22c55e', description: 'Read, export and download reporting data across modules.', keys: TS_REPORTS },
  { key: 'view-only', label: 'View Only', icon: 'eye-outline', color: '#64748b', description: 'View-only access — no create, edit, delete, approve or manage actions.', keys: TS_VIEW_ONLY },
]

export const applyTemplate = (key: TemplateKey): PermMatrix => {
  const t = ROLE_TEMPLATES.find(x => x.key === key)
  if (!t) return allMatrixFalse()
  const m = allMatrixFalse()
  t.keys.forEach(k => { m[k] = true })
  return m
}

// ─── Scope controls ────────────────────────────────────────────────
export type PermissionScope = 'all' | 'assigned'
export type PermissionScopeMap = Record<string, PermissionScope>

export const PERMISSION_SCOPE_OPTIONS: { key: PermissionScope; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Every authorized company' },
  { key: 'assigned', label: 'Assigned only', hint: 'Only companies this user belongs to' },
]

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
  icon: string
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
      { key: 'companies', label: 'Companies', icon: 'business-outline', color: '#3b82f6' },
      { key: 'executives', label: 'Executives', icon: 'ribbon-outline', color: '#f59e0b' },
      { key: 'employees', label: 'Employees', icon: 'people-outline', color: '#6366f1' },
    ],
  },
  'executive': {
    label: 'Executive',
    description: 'Full CRUD on Employees.',
    modules: [
      { key: 'employees', label: 'Employees', icon: 'people-outline', color: '#6366f1' },
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

export const isCorePermissionKey = (key: string): boolean => {
  const core = ['companies', 'executives', 'employees']
  return core.some(m => CORE_CRUD_ACTIONS.some(a => `${m}.${a}` === key))
}

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

export const buildCorePermissionsArray = (
  role: string,
  enabled: Record<string, boolean>,
  existing: string[] | null | undefined
): string[] => {
  const existingArr = existing || []
  const enabledCore = coreKeysForRole(role).filter(k => enabled[k])
  let preserved: string[]
  if (existingArr.includes('*') || existingArr.length === 0) {
    preserved = allPermissionKeys().filter(k => !isCorePermissionKey(k))
  } else if (existingArr.includes('none')) {
    preserved = []
  } else {
    preserved = existingArr.filter(p => !isCorePermissionKey(p))
  }
  return [...new Set([...enabledCore, ...preserved])]
}