import { useAuth } from '../context/AuthContext'
import { AuthenticatedLayout } from './AuthenticatedLayout'
import { ProtectedRoute, ExecutiveRoute, TeamLeaderRoute, MasterAdminRoute, CompanyAdminRoute } from './ProtectedRoute'
import { CompanyRouteGuard } from './CompanyRouteGuard'
import type { UserRole } from '../types/user'

interface RoleRouteGuardProps {
  children: React.ReactNode
  allowedRoles: UserRole[]
  requireScope?: boolean
}

export function RoleRouteGuard({ children, allowedRoles, requireScope = false }: RoleRouteGuardProps) {
  const inner = requireScope ? (
    <CompanyRouteGuard>{children}</CompanyRouteGuard>
  ) : (
    <>{children}</>
  )

  return (
    <AuthenticatedLayout>
      <ProtectedRoute allowedRoles={allowedRoles}>
        {inner}
      </ProtectedRoute>
    </AuthenticatedLayout>
  )
}

export function ExecutivePageRoute({ children, requireScope = true }: { children: React.ReactNode; requireScope?: boolean }) {
  const inner = requireScope ? <CompanyRouteGuard>{children}</CompanyRouteGuard> : <>{children}</>
  return (
    <AuthenticatedLayout>
      <ExecutiveRoute>{inner}</ExecutiveRoute>
    </AuthenticatedLayout>
  )
}

export function TeamLeaderPageRoute({ children, requireScope = true }: { children: React.ReactNode; requireScope?: boolean }) {
  const inner = requireScope ? <CompanyRouteGuard>{children}</CompanyRouteGuard> : <>{children}</>
  return (
    <AuthenticatedLayout>
      <TeamLeaderRoute>{inner}</TeamLeaderRoute>
    </AuthenticatedLayout>
  )
}

export function MasterAdminPageRoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedLayout>
      <MasterAdminRoute>{children}</MasterAdminRoute>
    </AuthenticatedLayout>
  )
}

export function CompanyAdminPageRoute({ children, requireScope = true }: { children: React.ReactNode; requireScope?: boolean }) {
  const inner = requireScope ? <CompanyRouteGuard>{children}</CompanyRouteGuard> : <>{children}</>
  return (
    <AuthenticatedLayout>
      <CompanyAdminRoute>{inner}</CompanyAdminRoute>
    </AuthenticatedLayout>
  )
}

export function EmployeePageRoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedLayout>
      <ProtectedRoute allowedRoles={['master-admin', 'company-admin', 'employee']}>
        {children}
      </ProtectedRoute>
    </AuthenticatedLayout>
  )
}

export function ReportingManagerPageRoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedLayout>
      <ProtectedRoute allowedRoles={['master-admin', 'company-admin', 'reporting-manager']}>
        {children}
      </ProtectedRoute>
    </AuthenticatedLayout>
  )
}
