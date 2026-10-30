import { describe, it, expect } from '@jest/globals';
import { getEffectiveTiers, getLiveTiers, TIER_ORDER } from '../leaveService';

describe('TIER_ORDER (canonical 5-tier chain)', () => {
  it('matches the backend order: RM → HR → CA → Exec → TL', () => {
    expect(TIER_ORDER).toEqual(['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader']);
  });
});

describe('getEffectiveTiers (role-based chain)', () => {
  it('employee → RM → HR → Company Admin → Executive → Team Leader (5 tiers)', () => {
    expect(getEffectiveTiers('employee')).toEqual(['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader']);
  });
  it('reporting-manager → HR + CA + Exec + TL (4); hr → CA + Exec + TL (3); executive → team leader; team leader → none', () => {
    expect(getEffectiveTiers('reporting-manager')).toEqual(['hr', 'companyAdmin', 'executive', 'teamLeader']);
    expect(getEffectiveTiers('hr')).toEqual(['companyAdmin', 'executive', 'teamLeader']);
    expect(getEffectiveTiers('executive')).toEqual(['teamLeader']);
    expect(getEffectiveTiers('team-leader')).toEqual([]);
  });
  it('unknown / legacy role → the full chain', () => {
    expect(getEffectiveTiers(undefined)).toEqual(TIER_ORDER);
    expect(getEffectiveTiers('some-legacy-role')).toEqual(TIER_ORDER);
  });
});

describe('getLiveTiers (progress denominator)', () => {
  it('drops skipped tiers so the counter can actually reach completion', () => {
    // Regression: a company with only a reporting manager and a company admin
    // showed a permanent "2/3" even after the request was Approved.
    const leave = {
      applicantRole: 'employee',
      approvalStatus: {
        reportingManager: 'Pending',
        hr: 'Skipped',
        companyAdmin: 'Pending',
        executive: 'Skipped',
        teamLeader: 'Skipped',
      },
    };
    expect(getEffectiveTiers(leave.applicantRole)).toHaveLength(5);
    expect(getLiveTiers(leave)).toEqual(['reportingManager', 'companyAdmin']);
  });

  it('keeps every tier when nothing was skipped', () => {
    expect(
      getLiveTiers({
        applicantRole: 'employee',
        approvalStatus: {
          reportingManager: 'Approved',
          hr: 'Pending',
          companyAdmin: 'Pending',
          executive: 'Skipped',
          teamLeader: 'Skipped',
        },
      }),
    ).toEqual(['reportingManager', 'hr', 'companyAdmin']);
  });

  it('applies the same role rules as getEffectiveTiers', () => {
    expect(
      getLiveTiers({ applicantRole: 'reporting-manager', approvalStatus: { hr: 'Skipped', companyAdmin: 'Approved', executive: 'Skipped', teamLeader: 'Skipped' } }),
    ).toEqual(['companyAdmin']);
    expect(
      getLiveTiers({ applicantRole: 'hr', approvalStatus: { companyAdmin: 'Pending', executive: 'Skipped', teamLeader: 'Skipped' } }),
    ).toEqual(['companyAdmin']);
    expect(getLiveTiers({ applicantRole: 'team-leader', approvalStatus: {} })).toEqual([]);
  });

  it('treats a missing approvalStatus as "nothing skipped"', () => {
    expect(getLiveTiers({ applicantRole: 'employee' })).toHaveLength(5);
    expect(getLiveTiers({ applicantRole: 'employee', approvalStatus: null })).toHaveLength(5);
  });
});
