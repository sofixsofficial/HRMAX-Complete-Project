import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { subscribeToUnreadCount } from '../services/notificationService';
import { Icon } from '../utils/icons';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuPress: () => void;
  onNotificationPress?: () => void;
  navigation?: any;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, onMenuPress, onNotificationPress }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { selectedCompanyName, availableCompanies } = useCompany();
  const isRestrictedMulti = (user?.role === 'executive' || user?.role === 'team-leader') && availableCompanies.length > 1;
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeToUnreadCount(user.id, setUnreadCount);
    return unsub;
  }, [user?.id]);

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.card, paddingTop: insets.top + 4, borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
      <View style={styles.container}>
        <View style={styles.left}>
          <TouchableOpacity onPress={onMenuPress} style={[styles.menuBtn, { backgroundColor: colors.background }]}>
            <Icon name="menu-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} resizeMode="cover" />
          <View style={styles.titleArea}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            {subtitle && <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
          </View>
        </View>
        <View style={styles.right}>
          {(selectedCompanyName || isRestrictedMulti) && (
            <View style={[styles.companyChip, { backgroundColor: colors.accentBg }]}>
              <Text style={[styles.companyText, { color: colors.accent }]}>
                {selectedCompanyName || 'All Companies'}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={onNotificationPress} style={styles.notifBtn}>
            <Icon name="notifications-outline" size={22} color={colors.textSecondary} />
            {unreadCount > 0 && (
              <View style={[styles.notifBadge, { backgroundColor: colors.danger }]}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={[styles.avatar, { backgroundColor: colors.accentBg }]}>
            <Text style={[styles.avatarText, { color: colors.accent }]}>
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    height: 56,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleArea: {
    flex: 1,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#FF6600',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  companyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  companyText: {
    fontSize: 11,
    fontWeight: '600',
  },
  notifBtn: {
    position: 'relative',
    padding: 4,
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
