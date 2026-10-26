import { describe, it, expect } from 'vitest';
import { getEffectiveTiers, getLiveTiers } from '../leaveService';

describe('getEffectiveTiers (role-based chain)', () => {
  it('employee → all four tiers', () => {
    expect(getEffectiveTiers('employee')).toEqual(['reportingManager', 'companyAdmin', 'executive', 'teamLeader']);
  });
  it('reporting-manager → three tiers below them', () => {
    expect(getEffectiveTiers('reporting-manager')).toEqual(['companyAdmin', 'executive', 'teamLeader']);
  });
  it('executive → team leader only; team leader → straight to master admin', () => {
    expect(getEffectiveTiers('executive')).toEqual(['teamLeader']);
    expect(getEffectiveTiers('team-leader')).toEqual([]);
  });
});

describe('getLiveTiers (progress denominator)', () => {
  it('drops tiers the company skipped', () => {
    // Regression: a company with only a reporting manager and a company admin
    // showed a permanent "2/4" progress even after the request was Approved.
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
    const leave = {
      applicantRole: 'employee',
      approvalStatus: {
        reportingManager: 'Approved',
        companyAdmin: 'Pending',
        executive: 'Pending',
        teamLeader: 'Pending',
      },
    };
    expect(getLiveTiers(leave)).toEqual(['reportingManager', 'companyAdmin', 'executive', 'teamLeader']);
  });

  it('applies the same role rules as getEffectiveTiers', () => {
    expect(getLiveTiers({ applicantRole: 'reporting-manager', approvalStatus: { companyAdmin: 'Approved', executive: 'Skipped', teamLeader: 'Skipped' } })).toEqual(['companyAdmin']);
    expect(getLiveTiers({ applicantRole: 'team-leader', approvalStatus: {} })).toEqual([]);
  });

  it('treats a missing approvalStatus as "nothing skipped"', () => {
    expect(getLiveTiers({ applicantRole: 'employee' })).toHaveLength(4);
    expect(getLiveTiers({ applicantRole: 'employee', approvalStatus: null })).toHaveLength(4);
  });
});
