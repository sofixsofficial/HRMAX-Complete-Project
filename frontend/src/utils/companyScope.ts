import { where } from '../aws/firestore-compat'

/** Platform-bucket companyIds that are never a real tenant. */
const PLATFORM_SENTINELS = new Set(['master-admin', 'global'])

/**
 * True for the platform-bucket ids ('global' / 'master-admin'). Those are scope
 * sentinels stored on the platform account, never a companies/{id} document -
 * reading them as a document only produces a 404 in the console.
 */
export function isPlatformCompanyId(companyId?: string | null): boolean {
  return !!companyId && PLATFORM_SENTINELS.has(companyId)
}

/**
 * Company ids for the active scope: the selected company, or ALL authorized
 * companies when nothing is selected ("All Companies" mode).
 * Returns the FULL assigned scope (no truncation). Callers that need a single
 * Firestore `in` query must chunk into groups of <= 10 via `chunkCompanyIds`.
 */
export function scopedCompanyIds(
  effectiveCompanyId: string | null | undefined,
  availableCompanies: { id: string }[]
): string[] {
  // 'master-admin'/'global' are platform buckets, not tenants: this deployment
  // stores the platform account's companyId as 'global', which made every
  // scoped list query a non-existent partition and show an empty directory
  // even though the API returned records (same fix as the mobile app).
  if (effectiveCompanyId && !PLATFORM_SENTINELS.has(effectiveCompanyId)) return [effectiveCompanyId]
  return [...new Set(availableCompanies.map(c => c.id).filter(Boolean))]
}

/**
 * Split a list of company ids into groups of at most `size` (10 for Firestore
 * `in` limits). Used by pages that query a single collection with a where
 * `companyId in [...]` clause and must therefore issue one query per chunk.
 */
export function chunkCompanyIds(ids: string[], size = 10): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

/**
 * Firestore where clause matching any of the given company ids.
 * Returns null when the list is empty (caller should show empty state).
 */
export function companyIdWhere(ids: string[]) {
  if (ids.length === 0) return null
  return ids.length === 1
    ? where('companyId', '==', ids[0])
    : where('companyId', 'in', ids)
}
