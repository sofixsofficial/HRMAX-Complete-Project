import type { User } from '../types/user'

const ROLE_LABELS: Record<string, string> = {
  'master-admin': 'Master Admin',
  'company-admin': 'Company Admin',
  'team-leader': 'Team Leader',
  executive: 'Executive',
  'reporting-manager': 'Reporting Manager',
  employee: 'Employee',
}

/** Human-readable role label (e.g. 'team-leader' → 'Team Leader'). */
export const roleLabel = (role?: string | null): string =>
  role
    ? ROLE_LABELS[role] || role.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    : ''

/**
 * Role + Department badge label for headers / user profile cards, e.g.
 * 'Executive • HR'. Falls back to the bare role when the user has no
 * department assigned in their Firestore profile.
 */
export const roleDepartmentLabel = (u?: Pick<User, 'role' | 'department'> | null): string => {
  const label = roleLabel(u?.role)
  const dept = (u?.department || '').trim()
  return dept ? `${label} • ${dept}` : label
}