/**
 * Shared company-scoping helpers (mirrors frontend/src/utils/companyScope.ts).
 *
 * When no specific company is selected ("All Companies" mode), executives and
 * team leaders operate across ALL their authorized companies. The helpers
 * return the FULL assigned scope (no cap); consumers that issue a single
 * Firestore `in` query must chunk into groups of <= 10 themselves.
 */

/** Platform-bucket companyIds that are never a real tenant. */
const PLATFORM_SENTINELS = new Set(['master-admin', 'global']);

export const scopedCompanyIds = (
  selectedCompanyId: string | null | undefined,
  availableCompanies: { id: string }[]
): string[] => {
  // `'master-admin'`/`'global'` are role-sentinel companyIds, never real
  // companies — treat them as "no selection" so master-admin stays
  // unrestricted (web parity). In this deployment the platform account's
  // companyId is literally 'global', which previously scoped every list to a
  // non-existent tenant and showed "No employees yet."
  if (selectedCompanyId && !PLATFORM_SENTINELS.has(selectedCompanyId)) return [selectedCompanyId];
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
  // Never treat the platform sentinels ('master-admin' / 'global') as a
  // selection: scope = ['global'] matched no real companyId, which emptied the
  // Master Admin employee list, verification panel and leave queue on mobile
  // while web (unscoped) showed everything.
  if (selectedCompanyId && !PLATFORM_SENTINELS.has(selectedCompanyId)) return [selectedCompanyId];
  if (role === 'executive' || role === 'team-leader') {
    return [...new Set(availableCompanies.map((c) => c.id).filter(Boolean))];
  }
  return [];
};
