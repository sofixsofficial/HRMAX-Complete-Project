import { useAuth } from '../context/AuthContext';

// Hook to filter data based on user role
export function useRoleBasedData<T extends { companyId?: string; departmentId?: string; employeeId?: string }>(
  data: T[]
): T[] {
  const { user } = useAuth();

  if (!user) return [];

  // Master Admin sees all data
  if (user.role === 'master-admin') {
    return data;
  }

  // Company Admin sees only their company's data
  if (user.role === 'company-admin') {
    return data.filter(item =>
      !item.companyId || item.companyId === user.companyId
    );
  }

  // Team Leader sees only their department's data
  if (user.role === 'team-leader') {
    return data.filter(item =>
      !item.departmentId || item.departmentId === user.departmentId
    );
  }

  // Executive sees only their own data
  if (user.role === 'executive') {
    return data.filter(item =>
      item.employeeId === user.id
    );
  }

  return data;
}

// Hook to get stats based on role
export function useRoleBasedStats() {
  const { user } = useAuth();

  const canViewAllStats = ['master-admin', 'company-admin', 'executive'].includes(user?.role || '');
  const canViewDepartmentStats = ['team-leader'].includes(user?.role || '');
  const canViewOwnStatsOnly = ['employee'].includes(user?.role || '');

  return {
    canViewAllStats,
    canViewDepartmentStats,
    canViewOwnStatsOnly,
    isAdmin: canViewAllStats,
    isManager: canViewDepartmentStats,
    isEmployee: canViewOwnStatsOnly,
  };
}

// Hook to get page title based on role
export function useRoleBasedTitle(baseTitle: string): string {
  const { user } = useAuth();

  if (user?.role === 'executive') {
    return `My ${baseTitle}`;
  }

  if (user?.role === 'team-leader') {
    return `Team ${baseTitle}`;
  }

  return baseTitle;
}
