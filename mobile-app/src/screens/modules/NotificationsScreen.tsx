import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Switch, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  subscribeToNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  AppNotification,
} from '../../services/notificationService';
import { Icon } from '../../utils/icons';
import { navigateToNotificationLink } from '../../navigation/navigationRef';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';

function timeAgo(date: Date): string {
  const diff = Math.max(0, Date.now() - (date instanceof Date ? date.getTime() : new Date(date).getTime()));
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-IN');
}

function iconForType(type: string): string {
  if (type.startsWith('team_leader')) return 'people-outline';
  if (type.startsWith('executive')) return 'briefcase-outline';
  if (type.startsWith('leave')) return 'umbrella-outline';
  if (type.startsWith('task')) return 'checkmark-circle-outline';
  if (type.startsWith('payroll')) return 'wallet-outline';
  if (type.startsWith('attendance')) return 'time-outline';
  return 'notifications-outline';
}

export const NotificationsScreen: React.FC = () => {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeToNotifications(user.id, (list) => {
      setItems(list);
      setLoading(false);
    });
    return unsub;
  }, [user?.id]);

  const unreadCount = items.filter((n) => !n.read).length;

  const handlePress = useCallback(async (n: AppNotification) => {
    if (!n.read) {
      await markNotificationAsRead(n.id);
    }
    if (n.link) {
      navigateToNotificationLink(n.link, user?.role);
    }
  }, [user?.role]);

  const handleMarkAll = useCallback(async () => {
    if (user?.id) await markAllNotificationsAsRead(user.id);
  }, [user?.id]);

  // Notifications are a permanent record: the server refuses deletes for
  // everyone (including master admins), so there is deliberately no delete
  // affordance in this screen.

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Notifications" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: `${colors.accent}15` }]}>
            <Icon name="notifications-off-outline" size={36} color={colors.textTertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No notifications</Text>
          <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
            Updates about your team, leaves, and approvals will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          ListHeaderComponent={
            unreadCount > 0 ? (
              <TouchableOpacity onPress={handleMarkAll} style={[styles.markAllBtn, { backgroundColor: colors.accentBg }]}>
                <Icon name="checkmark-done-outline" size={16} color={colors.accent} />
                <Text style={[styles.markAllText, { color: colors.accent }]}>Mark all as read ({unreadCount})</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handlePress(item)}
              style={[styles.notifCard, { backgroundColor: colors.card, borderColor: item.read ? colors.border : colors.accent }]}
            >
              <View style={[styles.iconBox, { backgroundColor: `${colors.accent}15` }]}>
                <Icon name={iconForType(item.type)} size={20} color={colors.accent} />
              </View>
              <View style={styles.content}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                  {!item.read && <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />}
                </View>
                <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>{item.body}</Text>
                <Text style={[styles.time, { color: colors.textTertiary }]}>{timeAgo(item.createdAt)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  markAllText: { fontSize: 13, fontWeight: '600' },
  notifCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: { flex: 1, marginRight: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '600', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  body: { fontSize: 13, marginTop: 2, lineHeight: 17 },
  time: { fontSize: 11, marginTop: 4 },
});
