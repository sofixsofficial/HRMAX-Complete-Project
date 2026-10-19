import React from 'react';
import { usePermissions } from '../hooks/usePermissions';

interface PermissionGateProps {
  module: string;
  action: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({ module, action, children, fallback = null }) => {
  const { can } = usePermissions();
  if (!can(module, action)) return <>{fallback}</>;
  return <>{children}</>;
};
