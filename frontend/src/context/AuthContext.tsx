import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { onAuthChange, signIn as remoteSignIn, logOut as remoteLogOut } from '../services/authService';
import { isSameSet, LEGACY_ROLE_DEFAULT_PERMS, isCorePermissionKey } from '../services/permissionConfig';
import { auth, db } from '../aws/clients';
import { doc, getDoc, onSnapshot } from '../aws/firestore-compat';
import type { User, UserRole } from '../types/user';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
  refreshUser: () => Promise<void>;
  /** Returns the company IDs this user can access based on their role */
  getScopedCompanyIds: (overrideIds?: string[]) => string[];
  /** True if user is a reporting manager (has reportingManagerId references) */
  isReportingManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isSigningIn = useRef(false);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange((remoteUser) => {
      if (!isSigningIn.current) {
        setUser(remoteUser);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Real-time listener for user doc changes (permissions, role updates)
  useEffect(() => {
    if (!auth.currentUser) return;

    const unsub = onSnapshot(
      doc(db, 'users', auth.currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const freshData = snap.data() as User;
          setUser(freshData);
        }
      },
      () => { /* ignore listener errors */ }
    );

    return () => unsub();
  }, [auth.currentUser?.uid]);

  const login = useCallback(async (email: string, password: string) => {
    // NOTE: deliberately does NOT toggle the global `isLoading` flag.
    // AppRoutes swaps the whole route tree for a spinner whenever isLoading is
    // true, so setting it here unmounted <Login> mid-attempt: on failure the
    // catch block's setError() ran on the unmounted component and the fresh
    // remount had error='' again — wrong-credentials messages never appeared.
    // The Login page renders its own "Signing In..." spinner while awaiting.
    isSigningIn.current = true;
    try {
      const userData = await remoteSignIn(email, password);
      setUser(userData);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    } finally {
      isSigningIn.current = false;
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      localStorage.clear();
      sessionStorage.clear();
      await remoteLogOut();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      if (auth.currentUser) {
        // Force refresh the auth token to get latest claims
        await auth.currentUser.getIdToken(true);
        // Re-fetch the Firestore user document to get latest role/permissions
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const freshUserData = userDoc.data() as User;
          setUser(freshUserData);
        }
      }
    } catch (err) {
      console.error('[AuthContext] refreshUser error:', err);
    }
  }, []);

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false;

    // Company Admin: strictly view-only for all modules regardless of permissions array
    if (user.role === 'company-admin') {
      const action = permission.split('.')[1] || '';
      return action === 'view' || action === 'reports' || action === 'analytics';
    }

    // Master Admin keeps unrestricted access
    if (user.role === 'master-admin') return true;

    // Executives and Team Leaders: enforce the saved permission matrix.
    //  - empty/unset matrix  -> full access (legacy default for new staff)
    //  - legacy hard-coded role defaults -> full access (pre-matrix users)
    //  - otherwise            -> strictly enforced; no module auto-grants
    if (user.role === 'executive' || user.role === 'team-leader') {
      const perms: string[] = (user as any).permissions || [];
      const configured = (user as any).permissionsConfigured === true;
      // An admin-saved matrix with everything disabled grants nothing.
      if (configured && perms.length === 0) return false;
      if (!configured && (perms.length === 0 || perms.includes('*'))) return true;
      if (isSameSet(perms, LEGACY_ROLE_DEFAULT_PERMS[user.role])) return true;
      // Core CRUD is default-on unless the admin configured a matrix for the role.
      if (!configured && isCorePermissionKey(permission)) return true;
      if (perms.includes(permission)) return true;
      const [moduleName] = permission.split('.');
      if (moduleName && perms.includes(moduleName + '.*')) return true;
      // 'manage' on a module implies every action within it
      if (moduleName && perms.includes(moduleName + '.manage')) return true;
      return false;
    }

    // Employees can always apply for leave and view/manage their own attendance
    if (user.role === 'employee' && (permission === 'leave.apply' || permission === 'leave.create' || permission === 'leave.view' || permission === 'attendance.view' || permission === 'attendance.create')) return true;

    // Reporting Managers: can view employees + apply/manage own leave
    if (user.role === 'reporting-manager') {
      if (permission === 'employees.view') return true;
      if (permission === 'leave.apply' || permission === 'leave.create' || permission === 'leave.view' || permission === 'leave.manage') return true;
    }

    const perms: string[] = (user as any).permissions || [];
    if (perms.includes('*')) return true;
    if (perms.includes(permission)) return true;

    const moduleName = permission.split('.')[0];
    if (perms.includes(moduleName + '.*')) return true;
    if (perms.includes(moduleName + '.manage')) return true;

    return false;
  }, [user]);

  const hasRole = useCallback((roles: UserRole[]): boolean => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  const getScopedCompanyIds = useCallback((overrideIds?: string[]): string[] => {
    if (!user) return [];
    const normalize = (ids?: string[]) => [...new Set((ids || []).filter(Boolean))];
    switch (user.role) {
      case 'master-admin':
        return []; // empty = all companies
      case 'company-admin':
        return user.companyId ? [user.companyId] : [];
      case 'executive':
        return normalize(overrideIds && overrideIds.length > 0 ? overrideIds : (user.assignedCompanyIds || []));
      case 'team-leader':
        return normalize(overrideIds || []);
      case 'reporting-manager':
        return user.companyId ? [user.companyId] : [];
      case 'employee':
        return user.companyId ? [user.companyId] : [];
      default:
        return [];
    }
  }, [user]);

  const isReportingManager = !!(user && (user as any).isReportingManager);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    hasPermission,
    hasRole,
    refreshUser,
    getScopedCompanyIds,
    isReportingManager,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Helper hook for protected routes
export const useProtectedRoute = (requiredPermissions?: string[], requiredRoles?: UserRole[]) => {
  const { isAuthenticated, user, hasPermission, hasRole, isLoading } = useAuth();

  const canAccess = React.useMemo(() => {
    if (isLoading) return false;
    if (!isAuthenticated) return false;
    
    if (requiredRoles && !hasRole(requiredRoles)) {
      return false;
    }
    
    if (requiredPermissions) {
      return requiredPermissions.every(perm => hasPermission(perm));
    }
    
    return true;
  }, [isAuthenticated, isLoading, requiredPermissions, requiredRoles, hasPermission, hasRole]);

  return { canAccess, isAuthenticated, user, isLoading };
};

export type { User, UserRole };
