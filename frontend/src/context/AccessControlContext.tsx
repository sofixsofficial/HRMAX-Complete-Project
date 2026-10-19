import React, { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { useCompany } from './CompanyContext'
import { TLFilterContext } from './TLFilterContext'
import type { UserRole } from '../types/user'

export interface ScopeInfo {
  scopeCompanyId: string | null
  scopeCompanyName: string | null
  isScopeReady: boolean
  isViewOnly: boolean
  gatedRoles: UserRole[]
}

interface AccessControlContextType {
  /** The resolved company ID for scoped CRUD operations — null when scope not available */
  scopeCompanyId: string | null
  scopeCompanyName: string | null
  /** True when a specific company context is selected and CRUD operations are allowed */
  isScopeReady: boolean
  /** True when scope is not ready — read-only mode (view data, no write/delete) */
  isViewOnly: boolean
  /** Check if a specific CRUD action + module combination is allowed in current scope */
  canPerform: (action: 'create' | 'edit' | 'delete' | 'manage', module: string) => boolean
  /** Full scope info for display/debugging */
  scopeInfo: ScopeInfo
  /** Roles that require explicit company selection for CRUD */
  gatedRoles: UserRole[]
}

const AccessControlContext = createContext<AccessControlContextType | undefined>(undefined)

const REQUIRES_SCOPE_ROLES: UserRole[] = ['executive', 'team-leader']

export const AccessControlProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, hasPermission } = useAuth()
  const {
    selectedCompanyId,
    selectedCompanyName,
    availableCompanies,
    effectiveCompanyId,
  } = useCompany()

  // Safely consume TLFilterContext (only meaningful for team-leader; silent fallback for others)
  const tlCtx = useContext(TLFilterContext)
  const tlFilter = tlCtx
    ? { isReady: tlCtx.isReady, selectedCompanyId: tlCtx.selectedCompanyId, currentCompany: tlCtx.currentCompany }
    : { isReady: false, selectedCompanyId: null, currentCompany: null }

  const { isScopeReady, isViewOnly, scopeCompanyId, scopeCompanyName } = useMemo(() => {
    if (!user) {
      return { isScopeReady: false, isViewOnly: true, scopeCompanyId: null, scopeCompanyName: null }
    }

    switch (user.role) {
      case 'master-admin': {
        // Master Admin gets global access — no scope gating; per-module filters handle company selection
        return {
          isScopeReady: true,
          isViewOnly: false,
          scopeCompanyId: null,
          scopeCompanyName: null,
        }
      }
      case 'company-admin': {
        // Company Admin: view-only — scope is ready (can view data) but writes are denied
        return {
          isScopeReady: true,
          isViewOnly: true,
          scopeCompanyId: user.companyId || selectedCompanyId,
          scopeCompanyName: selectedCompanyName || user.companyId,
        }
      }
      case 'executive': {
        // "All Companies" is a first-class operating mode: executives are never
        // view-only; their actions are governed purely by their permission set.
        return {
          isScopeReady: true,
          isViewOnly: false,
          scopeCompanyId: selectedCompanyId,
          scopeCompanyName: selectedCompanyName,
        }
      }
      case 'team-leader': {
        return {
          isScopeReady: true,
          isViewOnly: false,
          scopeCompanyId: tlFilter.selectedCompanyId || null,
          scopeCompanyName: tlFilter.currentCompany?.name || null,
        }
      }
      case 'reporting-manager':
      case 'employee': {
        return {
          isScopeReady: true,
          isViewOnly: false,
          scopeCompanyId: effectiveCompanyId || user.companyId || null,
          scopeCompanyName: selectedCompanyName,
        }
      }
      default:
        return { isScopeReady: false, isViewOnly: true, scopeCompanyId: null, scopeCompanyName: null }
    }
  }, [user, selectedCompanyId, selectedCompanyName, availableCompanies, effectiveCompanyId, tlFilter])

  const canPerform = useMemo(() => {
    return (action: 'create' | 'edit' | 'delete' | 'manage', module: string): boolean => {
      if (!user) return false
      // Company Admin is view-only EXCEPT for salary-slip corrections: they may
      // edit + regenerate corrected payslips inside their own company.
      if (user.role === 'company-admin') {
        return module === 'salary' && action === 'edit'
      }
      // View-only roles (e.g. company-admin) can never perform mutations, regardless of permissions
      if (isViewOnly) return false
      if (user.role === 'master-admin') {
        return hasPermission('*') || hasPermission(`${module}.${action}`) || hasPermission(`${module}.*`)
      }
      return hasPermission(`${module}.${action}`) || hasPermission(`${module}.*`)
    }
  }, [user, hasPermission, isViewOnly])

  const gatedRoles = REQUIRES_SCOPE_ROLES

  const value = useMemo(() => ({
    scopeCompanyId,
    scopeCompanyName,
    isScopeReady,
    isViewOnly,
    canPerform,
    gatedRoles,
    scopeInfo: { scopeCompanyId, scopeCompanyName, isScopeReady, isViewOnly, gatedRoles },
  }), [scopeCompanyId, scopeCompanyName, isScopeReady, isViewOnly, canPerform, gatedRoles])

  return (
    <AccessControlContext.Provider value={value}>
      {children}
    </AccessControlContext.Provider>
  )
}

export const useAccessControl = (): AccessControlContextType => {
  const context = useContext(AccessControlContext)
  if (!context) {
    throw new Error('useAccessControl must be used within an AccessControlProvider')
  }
  return context
}

/** ScopeGuard — wraps CRUD-requiring sections; shows placeholder when scope not ready */
export const ScopeGuard: React.FC<{
  children: React.ReactNode
  fallback?: React.ReactNode
  message?: string
}> = ({ children, fallback, message }) => {
  const { isScopeReady } = useAccessControl()
  if (isScopeReady) return <>{children}</>
  if (fallback) return <>{fallback}</>
  return (
    <div style={{
      padding: '40px 20px',
      textAlign: 'center',
      background: '#fff8f0',
      borderRadius: 12,
      border: '1px dashed #f97316',
    }}>
      <p style={{ margin: 0, color: '#9a3412', fontSize: 14, fontWeight: 500 }}>
        {message || 'Select a company above to enable data management.'}
      </p>
    </div>
  )
}
