import { describe, it, expect } from 'vitest';
import { getEffectiveTiers, getLiveTiers } from '../leaveService';

describe('getEffectiveTiers (role-based chain)', () => {
  it('employee → reporting manager, HR, company admin', () => {
    expect(getEffectiveTiers('employee')).toEqual(['reportingManager', 'hr', 'companyAdmin']);
  });
  it('reporting-manager → HR, company admin', () => {
    expect(getEffectiveTiers('reporting-manager')).toEqual(['hr', 'companyAdmin']);
  });
  it('hr (and hr-manager alias) → company admin only', () => {
    expect(getEffectiveTiers('hr')).toEqual(['companyAdmin']);
    expect(getEffectiveTiers('hr-manager')).toEqual(['companyAdmin']);
  });
  it('executive → team leader only; team leader → straight to master admin', () => {
    expect(getEffectiveTiers('executive')).toEqual(['teamLeader']);
    expect(getEffectiveTiers('team-leader')).toEqual([]);
  });
  it('unknown role → full chain', () => {
    expect(getEffectiveTiers('some-new-role')).toEqual(['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader']);
  });
});

describe('getEffectiveTiers (configurable company override)', () => {
  it('uses the company-configured stages when present', () => {
    expect(getEffectiveTiers('employee', { employee: ['companyAdmin'] })).toEqual(['companyAdmin']);
    expect(getEffectiveTiers('employee', { employee: ['hr', 'reportingManager'] })).toEqual(['reportingManager', 'hr']);
  });
  it('falls back to the default when the override is empty/invalid', () => {
    expect(getEffectiveTiers('employee', { employee: [] })).toEqual(['reportingManager', 'hr', 'companyAdmin']);
    expect(getEffectiveTiers('employee', { employee: ['bogus'] as never })).toEqual([]);
    expect(getEffectiveTiers('employee', null)).toEqual(['reportingManager', 'hr', 'companyAdmin']);
  });
});

describe('getLiveTiers (progress denominator)', () => {
  it('drops tiers the company skipped', () => {
    // Regression: a company with only a reporting manager and a company admin
    // showed a permanent "2/3" progress even after the request was Approved.
    const leave = {
      applicantRole: 'employee',
      approvalStatus: {
        reportingManager: 'Pending',
        hr: 'Skipped',
        companyAdmin: 'Pending',
      },
    };
    expect(getEffectiveTiers(leave.applicantRole)).toHaveLength(3);
    expect(getLiveTiers(leave)).toEqual(['reportingManager', 'companyAdmin']);
  });

  it('keeps every tier when nothing was skipped', () => {
    const leave = {
      applicantRole: 'employee',
      approvalStatus: {
        reportingManager: 'Approved',
        hr: 'Pending',
        companyAdmin: 'Pending',
      },
    };
    expect(getLiveTiers(leave)).toEqual(['reportingManager', 'hr', 'companyAdmin']);
  });

  it('applies the same role rules as getEffectiveTiers', () => {
    // A Skipped tier (company didn't assign / not in chain) is dropped; a real
    // decision (Pending/Approved/Rejected) stays in the denominator.
    expect(getLiveTiers({ applicantRole: 'reporting-manager', approvalStatus: { hr: 'Skipped', companyAdmin: 'Pending' } })).toEqual(['companyAdmin']);
    expect(getLiveTiers({ applicantRole: 'team-leader', approvalStatus: {} })).toEqual([]);
  });

  it('treats a missing approvalStatus as "nothing decided yet" (no live tiers)', () => {
    // Without a stamped status there is no real decision on any tier, so the
    // live set is empty — real requests always carry a server-stamped status.
    expect(getLiveTiers({ applicantRole: 'employee' })).toEqual([]);
    expect(getLiveTiers({ applicantRole: 'employee', approvalStatus: null })).toEqual([]);
  });
});
