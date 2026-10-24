import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { safeStore } from '../utils/safeStorage';
import { onAuthChange, signIn as remoteSignIn, logOut as remoteLogOut } from '../services/authService';
import { auth, db } from '../aws/clients';
import { doc, getDoc, onSnapshot } from '../aws/firestore-compat';
import { isCorePermissionKey } from '../services/permissionConfig';
import type { User, UserRole } from '../types/user';

const USER_CACHE_KEY = 'cached_user_data';

// Legacy hard-coded permission defaults previously written to team-leader /
// executive user docs. Users still carrying one of these arrays keep full
// access until an admin explicitly saves a new permission matrix.
const LEGACY_ROLE_DEFAULT_PERMS: Record<string, string[]> = {
  'team-leader': [
    'employees.view', 'departments.view',
    'attendance.view', 'attendance.edit', 'attendance.manage',
    'leave.view', 'leave.manage',
    'payroll.view', 'payroll.edit', 'payroll.manage',
    'reports.view', 'company.view',
    'tasks.view', 'tasks.create', 'tasks.edit',
    'emails.view',
  ],
  'executive': [
    'employees.view', 'employees.create', 'employees.edit',
    'departments.view',
    'payroll.view', 'payroll.edit', 'payroll.manage',
    'attendance.view',
    'leave.view', 'leave.apply', 'leave.manage',
    'settings.view', 'company.view',
    'tasks.view', 'tasks.create', 'tasks.edit',
    'emails.view', 'emails.create',
    'assets.view',
  ],
};

const isSameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every(p => bSet.has(p));
};

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
  refreshUser: () => Promise<void>;
  getScopedCompanyIds: (overrideIds?: string[]) => string[];
  isReportingManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReportingManager, setIsReportingManager] = useState(false);
  const isSigningIn = useRef(false);

  // Load cached user on mount
  useEffect(() => {
    const loadCachedUser = async () => {
      try {
        const cached = await safeStore.getItem(USER_CACHE_KEY);
        if (cached) {
          setUser(JSON.parse(cached));
        }
      } catch {}
      setIsLoading(false);
    };
    loadCachedUser();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange((remoteUser) => {
      if (!isSigningIn.current) {
        setUser(remoteUser);
        setIsLoading(false);
        if (remoteUser) {
          safeStore.setItem(USER_CACHE_KEY, JSON.stringify(remoteUser)).catch(() => {});
        } else {
          safeStore.deleteItem(USER_CACHE_KEY).catch(() => {});
        }
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
          safeStore.setItem(USER_CACHE_KEY, JSON.stringify(freshData)).catch(() => {});
        }
      },
      () => {}
    );
    return () => unsub();
  }, [auth.currentUser?.uid]);

  // Check if employee is also a reporting manager
  useEffect(() => {
    if (!user || user.role !== 'employee' || !user.companyId) {
      setIsReportingManager(false);
      return;
    }
    const checkReportingManager = async () => {
      try {
        const { collection, query, where, getDocs } = await import('../aws/firestore-compat');
        const empQuery = query(collection(db, 'employees'), where('userId', '==', user.id));
        const empSnap = await getDocs(empQuery);
        if (!empSnap.empty) {
          const empData = empSnap.docs[0].data();
          setIsReportingManager(empData.isReportingManager === true);
        }
      } catch {}
    };
    checkReportingManager();
  }, [user?.id, user?.role, user?.companyId]);

  const login = useCallback(async (email: string, password: string) => {
    isSigningIn.current = true;
    try {
      const userData = await remoteSignIn(email, password);
      setUser(userData);
      await safeStore.setItem(USER_CACHE_KEY, JSON.stringify(userData));
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
      await safeStore.deleteItem(USER_CACHE_KEY);
      await remoteLogOut();
      setUser(null);
      setIsReportingManager(false);
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
        await auth.currentUser.getIdToken(true);
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const freshUserData = userDoc.data() as User;
          setUser(freshUserData);
          await safeStore.setItem(USER_CACHE_KEY, JSON.stringify(freshUserData));
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
      if (permission.startsWith('leave.')) return true;
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

  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
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

export type { User, UserRole };
