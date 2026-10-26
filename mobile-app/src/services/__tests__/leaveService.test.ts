import { describe, it, expect } from '@jest/globals';
import { getEffectiveTiers, getLiveTiers } from '../leaveService';

describe('getEffectiveTiers (role-based chain)', () => {
  it('employee → all four tiers', () => {
    expect(getEffectiveTiers('employee')).toEqual(['reportingManager', 'companyAdmin', 'executive', 'teamLeader']);
  });
  it('reporting-manager → three tiers; executive → team leader; team leader → none', () => {
    expect(getEffectiveTiers('reporting-manager')).toEqual(['companyAdmin', 'executive', 'teamLeader']);
    expect(getEffectiveTiers('executive')).toEqual(['teamLeader']);
    expect(getEffectiveTiers('team-leader')).toEqual([]);
  });
});

describe('getLiveTiers (progress denominator)', () => {
  it('drops skipped tiers so the counter can actually reach completion', () => {
    // Regression: a company with only a reporting manager and a company admin
    // showed a permanent "2/4" even after the request was Approved.
    const leave = {
      applicantRole: 'employee',
      approvalStatus: {
        reportingManager: 'Pending',
        companyAdmin: 'Pending',
        executive: 'Skipped',
        teamLeader: 'Skipped',
      },
    };
    expect(getEffectiveTiers(leave.applicantRole)).toHaveLength(4);
    expect(getLiveTiers(leave)).toEqual(['reportingManager', 'companyAdmin']);
  });

  it('keeps every tier when nothing was skipped', () => {
    expect(
      getLiveTiers({
        applicantRole: 'employee',
        approvalStatus: { reportingManager: 'Approved', companyAdmin: 'Pending', executive: 'Pending', teamLeader: 'Pending' },
      }),
    ).toEqual(['reportingManager', 'companyAdmin', 'executive', 'teamLeader']);
  });

  it('applies the same role rules as getEffectiveTiers', () => {
    expect(
      getLiveTiers({ applicantRole: 'reporting-manager', approvalStatus: { companyAdmin: 'Approved', executive: 'Skipped', teamLeader: 'Skipped' } }),
    ).toEqual(['companyAdmin']);
    expect(getLiveTiers({ applicantRole: 'team-leader', approvalStatus: {} })).toEqual([]);
  });

  it('treats a missing approvalStatus as "nothing skipped"', () => {
    expect(getLiveTiers({ applicantRole: 'employee' })).toHaveLength(4);
    expect(getLiveTiers({ applicantRole: 'employee', approvalStatus: null })).toHaveLength(4);
  });
});
