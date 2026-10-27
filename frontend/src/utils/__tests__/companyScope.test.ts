import { describe, it, expect, vi } from 'vitest'

// The module also exports a Firestore where-clause builder; mock the compat
// shim so this unit test never pulls the AWS/Cognito client graph in.
vi.mock('../../aws/firestore-compat', () => ({
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
}))

import { scopedCompanyIds, chunkCompanyIds, companyIdWhere, isPlatformCompanyId } from '../companyScope'

const COMPANIES = [{ id: 'companyA' }, { id: 'companyB' }]

describe('scopedCompanyIds', () => {
  it('returns the selected real company', () => {
    expect(scopedCompanyIds('companyA', COMPANIES)).toEqual(['companyA'])
  })

  it("'global' is a platform bucket, never a tenant (regression)", () => {
    // This deployment stores the platform account's companyId as 'global'.
    // Without the sentinel, every scoped list queried a partition that holds
    // no records and showed an empty directory while the API returned rows.
    expect(scopedCompanyIds('global', COMPANIES)).toEqual(['companyA', 'companyB'])
  })

  it("'master-admin' is a platform sentinel too", () => {
    expect(scopedCompanyIds('master-admin', COMPANIES)).toEqual(['companyA', 'companyB'])
  })

  it('no selection → every available company ("All Companies" mode)', () => {
    expect(scopedCompanyIds(null, COMPANIES)).toEqual(['companyA', 'companyB'])
    expect(scopedCompanyIds(undefined, COMPANIES)).toEqual(['companyA', 'companyB'])
  })

  it('deduplicates and drops empty ids', () => {
    expect(scopedCompanyIds(null, [{ id: 'a' }, { id: 'a' }, { id: '' }])).toEqual(['a'])
  })
})

describe('isPlatformCompanyId', () => {
  it("'global' and 'master-admin' are sentinels, real ids are not (regression)", () => {
    // The dashboard hero reads companies/{id} for the weekly-off schedule;
    // with the platform sentinel it fired GET /api/companies/global -> 404
    // in the console on every master-admin dashboard load.
    expect(isPlatformCompanyId('global')).toBe(true)
    expect(isPlatformCompanyId('master-admin')).toBe(true)
    expect(isPlatformCompanyId('companyA')).toBe(false)
    expect(isPlatformCompanyId(null)).toBe(false)
    expect(isPlatformCompanyId(undefined)).toBe(false)
    expect(isPlatformCompanyId('')).toBe(false)
  })
})

describe('chunkCompanyIds', () => {
  it('splits into Firestore-safe groups of 10', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `c${i}`)
    const chunks = chunkCompanyIds(ids)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(10)
    expect(chunks[2]).toHaveLength(5)
    expect(chunks.flat()).toEqual(ids)
  })

  it('leaves a short list untouched', () => {
    expect(chunkCompanyIds(['a', 'b'])).toEqual([['a', 'b']])
  })

  it('handles the empty list', () => {
    expect(chunkCompanyIds([])).toEqual([])
  })
})

describe('companyIdWhere', () => {
  it('empty scope → null (empty state, never an unfiltered query)', () => {
    expect(companyIdWhere([])).toBeNull()
  })

  it('one id → equality clause', () => {
    expect(companyIdWhere(['x'])).toEqual({ field: 'companyId', op: '==', value: 'x' })
  })

  it('many ids → in clause', () => {
    expect(companyIdWhere(['x', 'y'])).toEqual({ field: 'companyId', op: 'in', value: ['x', 'y'] })
  })
})
