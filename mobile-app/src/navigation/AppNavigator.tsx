import React from 'react';
import { useAuth } from '../context/AuthContext';
import { DrawerNavigator } from './DrawerNavigator';

export const AppNavigator: React.FC = () => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return <DrawerNavigator />;
};
