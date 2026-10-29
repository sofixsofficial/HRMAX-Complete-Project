/**
 * Roles that own a personal "My Leaves & Attendance" page.
 *
 * Their personal punches and leave requests live THERE and are excluded from
 * the Operations management tables (Attendance / Leaves), which exist to
 * review the company's or team's records. Employees are deliberately NOT in
 * this list: their Attendance/Leaves pages are personal views of their own
 * data. Master-admin / company-admin are also excluded: they have no personal
 * page, so their own rows legitimately appear in their management tables.
 */
export const PERSONAL_PAGE_ROLES = [
  'executive',
  'team-leader',
  'hr',
  'reporting-manager',
  'hr-manager',
] as const

export function hasPersonalPage(role?: string | null): boolean {
  return !!role && (PERSONAL_PAGE_ROLES as readonly string[]).includes(role)
}
