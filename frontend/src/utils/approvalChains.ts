import type { ApprovalTier } from '../types/user';

/**
 * Configurable approval chains (mirror of backend/aws/src/lib/types.ts).
 *
 * A company may override WHICH approver stages are live for each requester
 * role via `company.approvalChains`; the stages always execute in the
 * canonical TIER_ORDER, so a config is a per-role set of live tiers. With no
 * config the shipped per-role defaults apply (employee → RM → HR → CA, RM →
 * HR → CA, HR → CA, exec → TL → MA gate, TL → MA gate).
 *
 * Company Admin / Master Admin are absent on purpose: they have no personal
 * leave, so there is nothing to configure.
 */

export type RequesterRole = 'employee' | 'reporting-manager' | 'hr' | 'executive' | 'team-leader';

export const REQUESTER_ROLES: RequesterRole[] = ['employee', 'reporting-manager', 'hr', 'executive', 'team-leader'];

export const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];

export const TIER_LABELS: Record<ApprovalTier, string> = {
  reportingManager: 'Reporting Manager',
  hr: 'HR',
  companyAdmin: 'Company Admin',
  executive: 'Executive',
  teamLeader: 'Team Leader',
};

export const ROLE_LABELS: Record<RequesterRole, string> = {
  employee: 'Employee',
  'reporting-manager': 'Reporting Manager',
  hr: 'HR',
  executive: 'Executive',
  'team-leader': 'Team Leader',
};

/** Per-requester-role override of the live approver stages. */
export type ApprovalChainConfig = Partial<Record<RequesterRole, ApprovalTier[]>>;

/** The shipped defaults (identical to the historical hard-coded chains). */
export const DEFAULT_APPROVAL_CHAINS: Record<RequesterRole, ApprovalTier[]> = {
  employee: ['reportingManager', 'hr', 'companyAdmin'],
  'reporting-manager': ['hr', 'companyAdmin'],
  hr: ['companyAdmin'],
  executive: ['teamLeader'],
  'team-leader': [],
};

/** Sanitise one role's configured stages: valid tiers only, de-duped, canonical order. */
export function normalizeChain(raw: unknown): ApprovalTier[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((t): t is ApprovalTier => TIER_ORDER.includes(t as ApprovalTier));
  return TIER_ORDER.filter((t) => valid.includes(t));
}

/**
 * Resolve the live, ordered tier list for a requester role: the company's
 * configured stages when present, otherwise the default chain. Admin roles
 * (company-admin / master-admin) resolve to [] — they cannot file leave.
 */
export function resolveApprovalChain(role?: string | null, configured?: ApprovalChainConfig | null): ApprovalTier[] {
  const key = role as RequesterRole;
  if (!role || !REQUESTER_ROLES.includes(key)) return [];
  const raw = configured?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_APPROVAL_CHAINS[key]];
  return normalizeChain(raw);
}

/** Human-readable chain for a role, e.g. "Reporting Manager → HR → Company Admin". */
export function describeChain(tiers: ApprovalTier[]): string {
  if (tiers.length === 0) return 'Master Admin only';
  return tiers.map((t) => TIER_LABELS[t]).join(' → ');
}
