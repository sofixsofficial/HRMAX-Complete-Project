import { useMemo } from 'react'
import { useCompany } from '../context/CompanyContext'
import { useAuth } from '../context/AuthContext'
import { scopeOrDefault, type PermissionScope } from '../services/permissionConfig'

/**
 * Per-module data-visibility scope for the current user.
 *
 * Mirrors firestore.rules `canScopeRecord` semantics:
 *   - 'all'      (default) -> every authorized company (executive assignedCompanyIds
 *                             portfolio / team-leader linked-executive portfolio).
 *   - 'assigned'            -> only the company the user directly belongs to
 *                             (their own `companyId`; server-side `belongsToCompany`).
 *
 * The Firestore rules are the authoritative filter; this hook only steers the
 * active company so page queries target the scoped set and the UI reflects it.
 * For roles with no permission matrix (master-admin / company-admin / employee)
 * `permissionScopes` is absent and the hook is a pure passthrough.
 */
export function usePermissionScope(moduleKey: string) {
  const { user } = useAuth()
  const ctx = useCompany()

  const scope: PermissionScope = useMemo(
    () => scopeOrDefault(user?.permissionScopes ?? null, moduleKey),
    [user?.permissionScopes, moduleKey]
  )

  const isAssigned = scope === 'assigned'

  const effectiveCompanyId = useMemo(() => {
    if (!isAssigned) return ctx.effectiveCompanyId
    const ownId = user?.companyId || null
    if (ownId) return ownId
    return ctx.effectiveCompanyId
  }, [isAssigned, ctx.effectiveCompanyId, user?.companyId])

  return {
    ...ctx,
    scope,
    isAssigned,
    effectiveCompanyId,
  }
}