import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { Icon } from '../utils/icons';
import type { UserRole } from '../types/user';

interface RoleGateProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const RoleGate: React.FC<RoleGateProps> = ({ allowedRoles, children, fallback }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  if (!user || !allowedRoles.includes(user.role)) {
    if (fallback) return <>{fallback}</>;
    return (
      <View style={s.container}>
        <View style={s.icon}>
          <Icon name="lock-closed-outline" size={48} color={colors.text} />
        </View>
        <Text style={s.title}>Access Denied</Text>
        <Text style={s.message}>You don't have permission to access this page.</Text>
      </View>
    );
  }

  return <>{children}</>;
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.background,
    padding: 20,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: c.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: c.textTertiary,
    textAlign: 'center',
  },
});
