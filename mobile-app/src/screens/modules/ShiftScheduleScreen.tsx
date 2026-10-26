import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { collection, doc, getDoc, getDocs, query, where } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { HeroBanner, PremiumCard, EmptyStateView, ShimmerLoader } from '../../components/PremiumComponents';
import { Icon } from '../../utils/icons';
import { subscribeAttendancePolicy, type AttendancePolicy } from '../../services/attendanceSettingsService';
import { resolveCompanyTimezone } from '../../utils/heroScene';

/**
 * Shift & Work Schedule (spec §9 item 13).
 *
 * Shows the employee's own shift, the company's default shift + attendance
 * rules, and every configured shift — all read from real backend documents
 * (`employees/{uid}`, `attendanceSettings`, `shiftConfigs`). Nothing is
 * invented: when a value is not configured it says so.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ShiftConfig {
  id: string;
  name?: string;
  shiftStart?: string;
  shiftEnd?: string;
  type?: string;
  workingDays?: number[];
}

export const ShiftScheduleScreen: React.FC = () => {
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [employee, setEmployee] = useState<Record<string, any> | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const companyId = effectiveCompanyId || user?.companyId || '';

  const load = () => {
    if (!companyId) return;
    setLoading(true);

    const unsubPolicy = subscribeAttendancePolicy(companyId, (p) => {
      setPolicy(p);
      setLoading(false);
    });

    getDocs(query(collection(db, 'shiftConfigs'), where('companyId', '==', companyId)))
      .then((snap) => setShifts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as ShiftConfig)))
      .catch(() => setShifts([]));

    if (user?.id) {
      getDoc(doc(db, 'employees', user.id))
        .then((snap) => setEmployee(snap.exists() ? (snap.data() as Record<string, any>) : null))
        .catch(() => setEmployee(null));
    }

    resolveCompanyTimezone(companyId)
      .then((tz) => setTimezone(tz))
      .catch(() => setTimezone(null));

    return unsubPolicy;
  };

  const [unsub, setUnsub] = useState<(() => void) | null>(null);
  useEffect(() => {
    const u = load();
    if (typeof u === 'function') setUnsub(() => u);
    return () => {
      if (typeof u === 'function') u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  };

  if (loading && !policy) return <ShimmerLoader count={4} height={90} style={{ padding: 16 }} />;

  // Only show company-wide values that actually exist in the policy document —
  // when no policy is configured we say so instead of printing code defaults.
  const weekendDays = (policy?.weekendDays ?? []).map((d) => WEEKDAY_NAMES[d] ?? String(d));
  const grace = policy ? `${policy.gracePeriodMinutes} minutes` : null;
  const myStart = (employee?.shiftStart as string) || policy?.defaultShiftStart || null;
  const myEnd = (employee?.shiftEnd as string) || policy?.defaultShiftEnd || null;
  const myType = (employee?.shiftType as string) || null;

  const stats = [
    { label: 'Start', value: myStart ?? '—', color: '#10b981' },
    { label: 'End', value: myEnd ?? '—', color: '#3b82f6' },
    { label: 'Grace', value: policy ? `${policy.gracePeriodMinutes}m` : '—', color: '#f59e0b' },
    { label: 'Weekly Off', value: weekendDays.length ? `${weekendDays.length}d` : '—', color: '#8b5cf6' },
  ];

  return (
    <View style={s.container}>
      <ScreenHeader title="Shift Schedule" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        <HeroBanner
          greeting="Shifts"
          name="Work Schedule"
          subtitle={policy ? `Company default ${policy.defaultShiftStart} – ${policy.defaultShiftEnd}` : 'No attendance policy configured yet'}
          stats={stats}
        />

        {/* ── My shift ── */}
        <PremiumCard style={s.card}>
          <View style={s.cardHead}>
            <Icon name="time-outline" size={16} color="#FF6600" />
            <Text style={s.cardTitle}>My Shift</Text>
          </View>
          <Row label="Shift" value={myStart && myEnd ? `${myStart} – ${myEnd}` : 'Not set — using company default below'} />
          <Row label="Type" value={myType ?? 'General'} />
          <Row label="Weekly off" value={weekendDays.join(', ') || '—'} />
          <Row label="Grace period" value={grace ? `${grace} (late after that)` : '—'} />
          <Row label="Timezone" value={timezone || 'Company default'} />
        </PremiumCard>

        {/* ── Configured shifts ── */}
        <PremiumCard style={s.card}>
          <View style={s.cardHead}>
            <Icon name="calendar-outline" size={16} color="#3b82f6" />
            <Text style={s.cardTitle}>Configured Shifts</Text>
          </View>
          {shifts.length === 0 ? (
            <EmptyStateView
              icon="calendar-outline"
              title="No shift configurations"
              subtitle="Your company has not defined additional shifts yet — the default shift above applies."
            />
          ) : (
            shifts.map((sh) => (
              <View key={sh.id} style={s.shiftRow}>
                <View style={[s.shiftDot, { backgroundColor: '#3b82f6' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.shiftName}>{sh.name || 'Shift'}</Text>
                  <Text style={s.shiftMeta}>
                    {sh.shiftStart || '—'} – {sh.shiftEnd || '—'}{sh.type ? ` · ${sh.type}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </PremiumCard>

        {/* ── Attendance rules that affect the shift ── */}
        <PremiumCard style={s.card}>
          <View style={s.cardHead}>
            <Icon name="shield-checkmark-outline" size={16} color="#10b981" />
            <Text style={s.cardTitle}>Punch Rules</Text>
          </View>
          <Rule label="Office location check" on={!!policy?.enableGeofence} detail={policy?.officeLocation?.name || policy?.officeLocation?.address || 'No office location configured'} />
          <Rule label="Selfie on check-in" on={!!(policy?.requireSelfie || policy?.enableSelfie)} detail={policy?.requireSelfie || policy?.enableSelfie ? 'Required' : 'Not required'} />
          <Rule label="Wi-Fi restriction" on={!!(policy?.wifiOnly || policy?.enableNetworkGuard)} detail={policy?.wifiOnly ? 'Approved network only' : 'Any network allowed'} />
          <Rule label="Auto check-out" on={!!policy?.enableAutoCheckout} detail={policy?.enableAutoCheckout ? `After ${policy.autoCheckoutMinutes || 0} min idle` : 'Off'} />
        </PremiumCard>
      </ScrollView>
    </View>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { colors } = useTheme();
  return (
    <View style={rowStyles.row}>
      <Text style={[rowStyles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[rowStyles.value, { color: colors.text }]} numberOfLines={2}>{value}</Text>
    </View>
  );
};

const Rule: React.FC<{ label: string; on: boolean; detail: string }> = ({ label, on, detail }) => {
  const { colors } = useTheme();
  const tint = on ? '#10b981' : '#94a3b8';
  return (
    <View style={rowStyles.ruleRow}>
      <View style={[rowStyles.ruleDot, { backgroundColor: tint }]} />
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.ruleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[rowStyles.ruleDetail, { color: colors.textSecondary }]} numberOfLines={2}>{detail}</Text>
      </View>
      <Text style={[rowStyles.ruleState, { color: tint }]}>{on ? 'ON' : 'OFF'}</Text>
    </View>
  );
};

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7 },
  label: { fontSize: 13.5, flex: 1 },
  value: { fontSize: 13.5, fontWeight: '700', flex: 1.2, textAlign: 'right' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  ruleDot: { width: 9, height: 9, borderRadius: 5 },
  ruleLabel: { fontSize: 13.5, fontWeight: '700' },
  ruleDetail: { fontSize: 11.5, marginTop: 1 },
  ruleState: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
});

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  card: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  shiftDot: { width: 10, height: 10, borderRadius: 5 },
  shiftName: { fontSize: 14, fontWeight: '700', color: c.text },
  shiftMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
});
