import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'reject' | 'manage' | 'add' | 'disburse' | 'calculate' | 'export' | 'download';

export const permissionKey = (module: string, action: string): string =>
  `${module.toLowerCase().replace(/\s+/g, '_')}.${action}`;

export const usePermissions = () => {
  const { user, hasPermission } = useAuth();
  const permissions: string[] = user?.permissions || [];

  const can = useCallback(
    (module: string, action: string): boolean => hasPermission(permissionKey(module, action)),
    [hasPermission]
  );

  const canAny = useCallback(
    (module: string, actions: PermissionAction[]): boolean =>
      actions.some(a => hasPermission(permissionKey(module, a))),
    [hasPermission]
  );

  return { can, canAny, permissions, hasMatrix: permissions.length > 0 };
};
