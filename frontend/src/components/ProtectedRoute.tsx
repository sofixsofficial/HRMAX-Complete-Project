/**
 * Protected Route Component
 * Handles authentication and authorization guards
 */

import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/user';

// ============================================
// PROTECTED ROUTE PROPS
// ============================================

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  fallback?: React.ReactNode;
}

// ============================================
// PROTECTED ROUTE COMPONENT
// ============================================

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  fallback,
}) => {
  const { 
    isAuthenticated, 
    isLoading, 
    user,
    refreshUser,
  } = useAuth();
  
  const location = useLocation();
  const tokenRefreshed = useRef(false);

  // Force refresh the idToken + user doc on mount
  // This ensures the latest role/permissions are loaded from the server
  useEffect(() => {
    if (!tokenRefreshed.current && isAuthenticated && auth.currentUser) {
      tokenRefreshed.current = true;
      auth.currentUser.getIdToken(true).catch(() => {});
      refreshUser();
    }
  }, [isAuthenticated]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role restrictions
  if (allowedRoles && user?.role && !allowedRoles.includes(user.role)) {
    console.debug(
      `[ProtectedRoute] Access DENIED for ${location.pathname}`,
      { userRole: user.role, allowedRoles, userPermissions: user.permissions, userId: user.id }
    );
    return fallback ? (
      <>{fallback}</>
    ) : (
      <Navigate to="/unauthorized" replace />
    );
  }

  // Also log successful access for debugging
  if (allowedRoles && allowedRoles.length > 0) {
    console.debug(
      `[ProtectedRoute] Access GRANTED for ${location.pathname}`,
      { userRole: user?.role }
    );
  }

  // All checks passed - render children
  return <>{children}</>;
};

// ============================================
// ROLE-BASED ROUTE COMPONENTS
// ============================================

interface RoleRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const MasterAdminRoute: React.FC<RoleRouteProps> = ({ children, fallback }) => (
  <ProtectedRoute allowedRoles={['master-admin']} fallback={fallback}>
    {children}
  </ProtectedRoute>
);

export const CompanyAdminRoute: React.FC<RoleRouteProps> = ({ children, fallback }) => (
  <ProtectedRoute allowedRoles={['master-admin', 'company-admin']} fallback={fallback}>
    {children}
  </ProtectedRoute>
);

export const TeamLeaderRoute: React.FC<RoleRouteProps> = ({ children, fallback }) => (
  <ProtectedRoute allowedRoles={['master-admin', 'company-admin', 'team-leader']} fallback={fallback}>
    {children}
  </ProtectedRoute>
);

export const ExecutiveRoute: React.FC<RoleRouteProps> = ({ children, fallback }) => (
  <ProtectedRoute 
    allowedRoles={['master-admin', 'company-admin', 'team-leader', 'executive']} 
    fallback={fallback}
  >
    {children}
  </ProtectedRoute>
);

// ============================================
// PUBLIC ONLY ROUTE (for login/register pages)
// ============================================

interface PublicOnlyRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export const PublicOnlyRoute: React.FC<PublicOnlyRouteProps> = ({ 
  children, 
  redirectTo = '/' 
}) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // If authenticated, redirect to appropriate dashboard
  if (isAuthenticated && user) {
    const from = (location.state as any)?.from?.pathname;
    
    const rolePathMap: Record<string, string> = {
      'master-admin': '/master-admin/dashboard',
      'company-admin': '/company-admin/dashboard',
      'executive': '/executive/dashboard',
      'team-leader': '/team-leader/dashboard',
      'reporting-manager': '/reporting-manager/dashboard',
      'employee': '/employee/dashboard',
    };
    const dashboard = rolePathMap[user.role] || redirectTo;
    
    return <Navigate to={from || dashboard} replace />;
  }

  return <>{children}</>;
};

// ============================================
// UNAUTHORIZED PAGE
// ============================================

export const UnauthorizedPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-6xl mb-4">🚫</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-gray-600 mb-6">
          You do not have permission to access this section.
        </p>
        <a 
          href="/" 
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
};
