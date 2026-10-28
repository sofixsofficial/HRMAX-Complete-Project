import React from 'react';
import { Check } from 'lucide-react';
import {
  REQUESTER_ROLES,
  TIER_ORDER,
  TIER_LABELS,
  ROLE_LABELS,
  DEFAULT_APPROVAL_CHAINS,
  normalizeChain,
  describeChain,
  type ApprovalChainConfig,
  type RequesterRole,
} from '../utils/approvalChains';

/**
 * Per-requester-role approval-chain editor (master-admin, on the company form).
 *
 * For each role that can hold personal leave, the admin toggles WHICH approver
 * stages are live. Stages always run in the canonical order (Reporting Manager
 * → HR → Company Admin → Executive → Team Leader); the company only chooses
 * the set. Company Admin / Master Admin are intentionally not editable here —
 * they have no personal leave. Empty selection = the shipped default.
 */
interface Props {
  value: ApprovalChainConfig;
  onChange: (next: ApprovalChainConfig) => void;
}

const ROLE_HELP: Record<RequesterRole, string> = {
  employee: 'Chain an employee’s leave follows',
  'reporting-manager': 'A reporting manager’s own leave',
  hr: 'An HR member’s own leave',
  executive: 'An executive’s own leave (Master Admin gives final approval)',
  'team-leader': 'A team leader’s own leave (Master Admin gives final approval)',
};

export function ApprovalChainsEditor({ value, onChange }: Props) {
  const setRoleChain = (role: RequesterRole, tiers: string[]) => {
    onChange({ ...value, [role]: normalizeChain(tiers) });
  };

  const toggleTier = (role: RequesterRole, tier: string, checked: boolean) => {
    const current = normalizeChain(value?.[role] ?? DEFAULT_APPROVAL_CHAINS[role]);
    const next = checked ? [...current, tier] : current.filter((t) => t !== tier);
    setRoleChain(role, next);
  };

  const resetRole = (role: RequesterRole) => {
    const next = { ...value };
    delete next[role];
    onChange(next);
  };

  return (
    <div className="approval-chains-editor">
      <p className="ace-intro">
        Choose which approvers must sign off on leave for each role. Stages always run in order
        (Reporting Manager → HR → Company Admin → Executive → Team Leader); you are choosing which
        of them are required. Leave a role at its default by resetting it.
      </p>

      {REQUESTER_ROLES.map((role) => {
        const configured = value?.[role];
        const tiers = normalizeChain(configured ?? DEFAULT_APPROVAL_CHAINS[role]);
        const isDefault = !configured || configured.length === 0;
        return (
          <div className="ace-role" key={role}>
            <div className="ace-role-head">
              <div>
                <strong>{ROLE_LABELS[role]}</strong>
                <p>{ROLE_HELP[role]}</p>
              </div>
              {!isDefault && (
                <button type="button" className="ace-reset" onClick={() => resetRole(role)}>
                  Use default
                </button>
              )}
            </div>

            <div className="ace-tiers">
              {TIER_ORDER.map((tier) => {
                const active = tiers.includes(tier);
                return (
                  <label key={tier} className={`ace-tier ${active ? 'ace-tier-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => toggleTier(role, tier, e.target.checked)}
                    />
                    <span className="ace-tier-box">{active && <Check size={12} />}</span>
                    <span className="ace-tier-label">{TIER_LABELS[tier]}</span>
                  </label>
                );
              })}
            </div>

            <p className="ace-summary">
              {role === 'team-leader' && tiers.length === 0
                ? 'No extra approvers — goes straight to the Master Admin final approval.'
                : `Chain: ${describeChain(tiers)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default ApprovalChainsEditor;
