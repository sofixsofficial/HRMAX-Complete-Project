import { describe, it, expect, afterEach } from '@jest/globals';
import { scopedCompanyIds, scopedCompanyIdsForRole, companyIdWhere } from '../companyScope';

const COMPANIES = [{ id: 'companyA' }, { id: 'companyB' }];

describe('scopedCompanyIds', () => {
  it('returns the selected company when a real one is selected', () => {
    expect(scopedCompanyIds('companyA', COMPANIES)).toEqual(['companyA']);
  });

  it("treats 'global' as a platform sentinel, not a tenant", () => {
    // Regression: this deployment stores the platform account's companyId as
    // 'global', which scoped every list to a non-existent tenant and showed
    // "No employees yet" while the API returned the records.
    expect(scopedCompanyIds('global', COMPANIES)).toEqual(['companyA', 'companyB']);
  });

  it("treats 'master-admin' as a platform sentinel too", () => {
    expect(scopedCompanyIds('master-admin', COMPANIES)).toEqual(['companyA', 'companyB']);
  });

  it('falls back to every available company when nothing is selected', () => {
    expect(scopedCompanyIds(null, COMPANIES)).toEqual(['companyA', 'companyB']);
    expect(scopedCompanyIds(undefined, COMPANIES)).toEqual(['companyA', 'companyB']);
  });

  it('deduplicates and drops empty ids', () => {
    expect(scopedCompanyIds(null, [{ id: 'a' }, { id: 'a' }, { id: '' } as any])).toEqual(['a']);
  });
});

describe('scopedCompanyIdsForRole', () => {
  it('unrestricted roles with no selection get [] (unfiltered whole-collection)', () => {
    expect(scopedCompanyIdsForRole('master-admin', null, COMPANIES)).toEqual([]);
    expect(scopedCompanyIdsForRole('company-admin', null, COMPANIES)).toEqual([]);
  });

  it("'global' never becomes a scope for a master admin (regression)", () => {
    expect(scopedCompanyIdsForRole('master-admin', 'global', COMPANIES)).toEqual([]);
  });

  it('a real selected company always wins', () => {
    expect(scopedCompanyIdsForRole('master-admin', 'companyB', COMPANIES)).toEqual(['companyB']);
    expect(scopedCompanyIdsForRole('executive', 'companyA', COMPANIES)).toEqual(['companyA']);
  });

  it('executives and team leaders with nothing selected aggregate all authorized companies', () => {
    expect(scopedCompanyIdsForRole('executive', null, COMPANIES)).toEqual(['companyA', 'companyB']);
    expect(scopedCompanyIdsForRole('team-leader', 'global', COMPANIES)).toEqual(['companyA', 'companyB']);
  });
});

describe('companyIdWhere', () => {
  it('no scope → none, one → equality, many → in', () => {
    expect(companyIdWhere([])).toEqual({ op: 'none' });
    expect(companyIdWhere(['x'])).toEqual({ op: '==', id: 'x' });
    expect(companyIdWhere(['x', 'y'])).toEqual({ op: 'in', ids: ['x', 'y'] });
  });
});
