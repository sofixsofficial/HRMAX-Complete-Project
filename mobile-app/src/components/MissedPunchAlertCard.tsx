import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../utils/icons';
import { computeMissedPunchProgress, computeMissedPunchTotalTiers, getRecordEffectiveMissedPunchTiers } from '../services/attendanceApi';

interface MissedPunchAlertCardProps {
  count: number;
  label?: string;
  onPress?: () => void;
  /** Optional: show the most recent pending record's progress inline */
  latestRecord?: any;
}

/**
 * Prominent Missed Punch / Attendance Alert card + counter badge used on the
 * role dashboards. Tapping it routes to the scoped missed-punch view.
 * Now includes an optional verification progress preview for the latest pending record.
 */
export const MissedPunchAlertCard: React.FC<MissedPunchAlertCardProps> = ({
  count,
  label = 'Missed Punch',
  onPress,
  latestRecord,
}) => {
  const { colors } = useTheme();
  const hasAlerts = count > 0;
  const Wrapper = onPress ? TouchableOpacity : View;

  const mp = latestRecord?.missedPunchRectification;
  const showProgress = hasAlerts && mp?.requested && !mp?.resolved;
  const tiers = showProgress ? getRecordEffectiveMissedPunchTiers(mp) : [];
  const progress = showProgress ? computeMissedPunchProgress(mp) : 0;
  const total = showProgress ? computeMissedPunchTotalTiers(mp) : 0;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  const overall = mp?.status || (mp?.resolved ? 'Approved' : 'Pending');

  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        s.card,
        {
          backgroundColor: hasAlerts ? colors.dangerBg : colors.card,
          borderColor: hasAlerts ? (colors.danger as string) : colors.borderLight,
        },
      ]}
    >
      <View
        style={[
          s.iconWrap,
          { backgroundColor: hasAlerts ? `${colors.danger}22` : colors.background },
        ]}
      >
        <Icon name={hasAlerts ? 'warning-outline' : 'time-outline'} size={24} color={hasAlerts ? (colors.danger as string) : colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.label, { color: hasAlerts ? (colors.danger as string) : colors.textSecondary }]}>{label}</Text>
        <View style={s.valueRow}>
          <Text style={[s.value, { color: hasAlerts ? (colors.danger as string) : colors.text }]}>{count}</Text>
          {hasAlerts && <Text style={[s.needs, { color: colors.danger }]}>needs review</Text>}
        </View>
        {showProgress && (
          <View style={s.progressRow}>
            <View style={s.progressBar}>
              <View style={[s.progressFill, { width: `${pct}%`, backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea' }]} />
            </View>
            <Text style={s.progressText}>{Math.min(progress, total)}/{total} tiers</Text>
          </View>
        )}
      </View>
      {hasAlerts && (
        <View style={[s.badge, { backgroundColor: colors.danger }]}>
          <Text style={s.badgeText}>{count}</Text>
        </View>
      )}
      <Icon name="arrow-forward-outline" size={18} color={hasAlerts ? (colors.danger as string) : colors.textTertiary} />
    </Wrapper>
  );
};

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  value: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
  needs: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.85,
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: '#e9d5ff',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b21a8',
  },
});
