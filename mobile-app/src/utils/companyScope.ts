/**
 * Shared company-scoping helpers (mirrors frontend/src/utils/companyScope.ts).
 *
 * When no specific company is selected ("All Companies" mode), executives and
 * team leaders operate across ALL their authorized companies. The helpers
 * return the FULL assigned scope (no cap); consumers that issue a single
 * Firestore `in` query must chunk into groups of <= 10 themselves.
 */

export const scopedCompanyIds = (
  selectedCompanyId: string | null | undefined,
  availableCompanies: { id: string }[]
): string[] => {
  // `'master-admin'` is a role-sentinel companyId, never a real company — treat
  // it as "no selection" so master-admin stays unrestricted (web parity).
  if (selectedCompanyId && selectedCompanyId !== 'master-admin') return [selectedCompanyId];
  return [...new Set(availableCompanies.map((c) => c.id).filter(Boolean))];
};

export type CompanyIdWhere =
  | { op: 'none' }
  | { op: '=='; id: string }
  | { op: 'in'; ids: string[] };

export const companyIdWhere = (ids: string[]): CompanyIdWhere => {
  if (ids.length === 0) return { op: 'none' };
  if (ids.length === 1) return { op: '==', id: ids[0] };
  return { op: 'in', ids };
};

/**
 * Role-aware scope resolution.
 * - A selected company always wins.
 * - Executives / team leaders with nothing selected aggregate across ALL their
 *   authorized companies ("All Companies" mode).
 * - Unrestricted roles (master-admin) return [] which callers translate to the
 *   legacy unfiltered whole-collection behaviour.
 */
export const scopedCompanyIdsForRole = (
  role: string | undefined,
  selectedCompanyId: string | null | undefined,
  availableCompanies: { id: string }[]
): string[] => {
  // Never treat the `'master-admin'` sentinel as a selection: scope = ['master-admin']
  // matched no real companyId, which emptied the Master Admin verification panel
  // and the leave management queue on mobile while web (unscoped) showed everything.
  if (selectedCompanyId && selectedCompanyId !== 'master-admin') return [selectedCompanyId];
  if (role === 'executive' || role === 'team-leader') {
    return [...new Set(availableCompanies.map((c) => c.id).filter(Boolean))];
  }
  return [];
};
