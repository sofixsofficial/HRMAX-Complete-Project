import type { ApprovalTier } from '../types/user';

/**
 * Configurable approval chains (mirror of backend/aws/src/lib/types.ts and the
 * web's utils/approvalChains.ts).
 *
 * A company may override WHICH approver stages are live for each requester
 * role via `company.approvalChains`; stages always execute in the canonical
 * TIER_ORDER, so a config is a per-role set of live tiers. With no config the
 * shipped per-role defaults apply. Company Admin / Master Admin are absent —
 * they have no personal leave.
 */

export type RequesterRole = 'employee' | 'reporting-manager' | 'hr' | 'executive' | 'team-leader';

export const REQUESTER_ROLES: RequesterRole[] = ['employee', 'reporting-manager', 'hr', 'executive', 'team-leader'];

export const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];

export type ApprovalChainConfig = Partial<Record<RequesterRole, ApprovalTier[]>>;

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

/** Live, ordered tier list for a role: company config when present, else default. */
export function resolveApprovalChain(role?: string | null, configured?: ApprovalChainConfig | null): ApprovalTier[] {
  const key = role as RequesterRole;
  if (!role || !REQUESTER_ROLES.includes(key)) return [];
  const raw = configured?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_APPROVAL_CHAINS[key]];
  return normalizeChain(raw);
}
