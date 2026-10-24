import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, Animated, Modal, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, getDoc, query, where, onSnapshot, collection } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useEmployeePersonalStats } from '../../hooks/useEmployeePersonalStats';
import { useAttendanceGate } from '../../hooks/useAttendanceGate';
import { isActiveMissedPunchRecord } from '../../utils/attendanceStatus';
import { markCheckIn, markCheckOut, requestPunchRectification } from '../../services/attendanceApi';
import { notifyPunchRectificationRequested } from '../../services/notificationService';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { SelfieCaptureModal } from '../../components/SelfieCaptureModal';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard';
import { PremiumCard } from '../../components/PremiumComponents';
import { DashboardHero } from '../../components/DashboardHero';
import type { AttendanceRecord } from '../../types/user';

const QUICK_ACTIONS = [
  { label: 'Apply Leave', icon: 'add-circle-outline', screen: 'ApplyLeave', color: '#3b82f6' },
  { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance', color: '#10b981' },
  { label: 'My Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks', color: '#ec4899' },
  { label: 'Salary Slips', icon: 'wallet-outline', screen: 'SalarySlips', color: '#8b5cf6' },
];

const statusColor = (s?: string) => {
  switch (s) {
    case 'Present': return '#10b981';
    case 'Late': return '#eab308';
    case 'Absent': return '#ef4444';
    case 'On Leave': return '#3b82f6';
    case 'Miss Punch': return '#8b5cf6';
    default: return '#FF6600';
  }
};

export const EmployeeDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const stats = useEmployeePersonalStats(refreshKey);
  const { policy, validateCheckIn, validateCheckOut } = useAttendanceGate();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [designation, setDesignation] = useState<string | null>(null);
  const [showSelfieCapture, setShowSelfieCapture] = useState(false);
  const selfieUriRef = useRef<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [rectifyModal, setRectifyModal] = useState<AttendanceRecord | null>(null);
  const [rectifyTime, setRectifyTime] = useState('');
  const [submittingRectify, setSubmittingRectify] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [managers, setManagers] = useState<string[]>([]);

  const { todayRecord, checkedIn, monthStats, monthRecords, pendingLeaves, activeTasks, upcomingHolidays, todayBirthdays, salarySlips, attendanceRate, loading } = stats;

  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, 'employees', user.id))
      .then((snap) => {
        if (snap.exists()) setDesignation((snap.data() as any).designation || null);
      })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', 'in', ['company-admin', 'executive', 'team-leader'])),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const scoped = user?.companyId
          ? list.filter((u: any) => u.companyId === user.companyId || (u.assignedCompanyIds || []).includes(user.companyId))
          : list;
        setManagers(scoped.map((u: any) => u.id));
      },
      () => {}
    );
    return () => unsub();
  }, [user?.companyId]);

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return;
    setSubmittingRectify(true);
    try {
      const [h, m] = rectifyTime.split(':').map(Number);
      const corrected = new Date(rectifyModal.date);
      corrected.setHours(h, m, 0, 0);
      await requestPunchRectification(rectifyModal.id, corrected);
      await notifyPunchRectificationRequested(
        user.id, user.name || 'Employee',
        new Date(rectifyModal.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        rectifyModal.companyId || user.companyId || '',
        managers
      );
      setActionMsg({ type: 'success', text: 'Rectification request submitted for manager review.' });
      setRectifyModal(null);
      setRectifyTime('');
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Failed to submit rectification' });
    } finally {
      setSubmittingRectify(false);
    }
  };

  const canCheckIn = !todayRecord;
  const canCheckOut = !!todayRecord && !!todayRecord.checkIn && !todayRecord.checkOut;
  const completed = !!todayRecord && !!todayRecord.checkIn && !!todayRecord.checkOut;
  const unresolvedMissPunch = monthRecords.filter((r) => isActiveMissedPunchRecord(r)).length;

  const formatTime = (d: any) => {
    if (!d) return '--';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDate = (d: any) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  const handleCheckIn = async () => {
    if (!user?.id || checking) return;
    if (!user.companyId) {
      Alert.alert('Error', 'No company assigned to your account.');
      return;
    }
    setChecking(true);
    try {
      const res = await validateCheckIn({ selfieUri: selfieUriRef.current || undefined });
      if (!res.ok) {
        if (res.needsSelfie) {
          setChecking(false);
          setShowSelfieCapture(true);
          return;
        }
        Alert.alert('Check-in blocked', res.reason || 'Attendance policy not satisfied.');
        return;
      }
      const result = await markCheckIn(user.companyId, {
        selfieUri: selfieUriRef.current || undefined,
      });
      selfieUriRef.current = null;
      Alert.alert('Checked in', result.message || 'Your attendance has been marked.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Check-in failed');
    } finally {
      setChecking(false);
    }
  };

  const handleSelfieCaptured = (url: string) => {
    setShowSelfieCapture(false);
    selfieUriRef.current = url;
    handleCheckIn();
  };

  const handleCheckOut = async () => {
    if (!todayRecord || checking || !user?.companyId) return;
    setChecking(true);
    try {
      const res = await validateCheckOut();
      if (!res.ok) {
        Alert.alert('Check-out blocked', res.reason || 'Attendance policy not satisfied.');
        return;
      }
      const result = await markCheckOut(user.companyId, todayRecord.id);
      Alert.alert('Checked out', result.message || 'See you tomorrow!');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Check-out failed');
    } finally {
      setChecking(false);
    }
  };

  if (loading && !refreshing) return <DashboardSkeleton />;

  const policyHints: { label: string; color: string }[] = [];
  if (policy) {
    if (policy.wifiOnly) policyHints.push({ label: 'Wi-Fi required', color: '#3b82f6' });
    if (policy.enableGeofence && policy.officeLocation?.latitude) policyHints.push({ label: `Geofence ${policy.officeLocation.radiusMeters || 100}m`, color: '#10b981' });
    if (policy.requireSelfie || policy.enableSelfie) policyHints.push({ label: 'Selfie required', color: '#ec4899' });
  }

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHero
        name={user?.name || 'Employee'}
        roleLabel={designation || 'Employee'}
        subtitle="Here's your personal summary for today."
        showPunchActions={false}
        stats={[
          { label: 'Month %', value: attendanceRate === null ? '—' : `${attendanceRate}%`, color: '#10b981' },
          { label: 'Leaves', value: pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: activeTasks, color: '#ec4899' },
          { label: 'Slips', value: salarySlips, color: '#8b5cf6' },
        ]}
      />

      {actionMsg && (
        <View style={[s.actionBanner, { backgroundColor: actionMsg.type === 'success' ? '#dcfce7' : '#fee2e2', borderColor: actionMsg.type === 'success' ? '#bbf7d0' : '#fecaca' }]}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444' }}>{actionMsg.text}</Text>
          <TouchableOpacity onPress={() => setActionMsg(null)}><Text style={{ fontSize: 16, color: '#666' }}>×</Text></TouchableOpacity>
        </View>
      )}

      <MissedPunchAlertCard
        count={unresolvedMissPunch}
        label="Missed Punch / Rectification"
        onPress={() => navigation?.navigate('Attendance')}
      />

      <LinearGradient
        colors={['#1F2937', '#111827']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.checkInCard}>
        <View style={s.checkInTop}>
          <View style={[s.statusDot, { backgroundColor: statusColor(todayRecord?.status) }]} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.checkInLabel}>Today's Status</Text>
            <Text style={[s.checkInStatus, { color: statusColor(todayRecord?.status) }]}>
              {completed ? 'Completed' : todayRecord?.status || (canCheckIn ? 'Not Checked In' : 'Checked In')}
            </Text>
            <Text style={s.checkInTime}>
              In: {formatTime(todayRecord?.checkIn)}
              {todayRecord?.checkIn ? '  |  ' : ''}Out: {formatTime(todayRecord?.checkOut)}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[s.checkInBtn, (checking || completed) && { opacity: 0.6 }]}
              onPress={canCheckOut ? handleCheckOut : canCheckIn ? handleCheckIn : undefined}
              disabled={checking || completed}
              activeOpacity={0.85}>
              <Icon name={canCheckOut ? 'exit-outline' : 'enter-outline'} size={30} color="#fff" />
              <Text style={s.checkInBtnText}>
                {checking ? 'Please wait...' : canCheckOut ? 'Check Out' : canCheckIn ? 'Check In' : 'Completed'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {policyHints.length > 0 && (
          <View style={s.policyRow}>
            {policyHints.map((h) => (
              <View key={h.label} style={[s.policyChip, { backgroundColor: `${h.color}18`, borderColor: `${h.color}45` }]}>
                <Icon name="shield-checkmark-outline" size={12} color={h.color} />
                <Text style={{ color: h.color, fontSize: 11, fontWeight: '600' }}>{h.label}</Text>
              </View>
            ))}
          </View>
        )}

        {todayRecord && !todayRecord.checkOut && !completed && (
          <TouchableOpacity style={s.missPunchBtn} onPress={() => setRectifyModal(todayRecord)}>
            <Icon name="alert-circle-outline" size={14} color="#f59e0b" />
            <Text style={s.missPunchText}>Forgot to check out? Request punch rectification</Text>
            <Icon name="chevron-forward-outline" size={14} color="#f59e0b" />
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.historyLink} onPress={() => navigation?.navigate('Attendance')}>
          <Text style={s.historyLinkText}>View full attendance history</Text>
          <Icon name="chevron-forward-outline" size={14} color={colors.accent} />
        </TouchableOpacity>
      </LinearGradient>

      <View style={s.sectionHeader}>
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Actions</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
        {QUICK_ACTIONS.map((q) => (
          <TouchableOpacity key={q.label} style={[s.quickCard, { backgroundColor: `${q.color}10`, borderColor: `${q.color}30` }]} onPress={() => navigation?.navigate(q.screen)}>
            <Icon name={q.icon} size={20} color={q.color} />
            <Text style={[s.quickLabel, { color: q.color }]}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.sectionHeader}>
        <Icon name="stats-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>My Summary</Text>
      </View>
      <StatsGrid>
        <StatCard label="Month Attendance" value={attendanceRate === null ? '—' : `${attendanceRate}%`} icon="pie-chart-outline" color="#10b981" onClick={() => navigation?.navigate('Attendance')} />
        <StatCard label="Pending Leaves" value={pendingLeaves} icon="umbrella-outline" color="#f59e0b" onClick={() => navigation?.navigate('ApplyLeave')} />
        <StatCard label="Active Tasks" value={activeTasks} icon="checkmark-circle-outline" color="#ec4899" onClick={() => navigation?.navigate('Tasks')} />
        <StatCard label="Upcoming Holidays" value={upcomingHolidays.length} icon="calendar-outline" color="#FF6600" />
      </StatsGrid>

      {monthRecords.length > 0 && (
        <>
          <View style={s.sectionHeader}>
            <Icon name="calendar-outline" size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>This Month's Attendance</Text>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {monthRecords.slice(0, 10).map((rec) => (
              <TouchableOpacity
                key={rec.id}
                style={s.monthRow}
                onPress={() => !rec.checkOut && setRectifyModal(rec)}>
                <View style={[s.monthDot, { backgroundColor: statusColor(rec.status) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{formatDate(rec.date)}</Text>
                  <Text style={{ fontSize: 11, color: colors.textTertiary, textTransform: 'capitalize' }}>{rec.status || 'Unknown'}</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  {formatTime(rec.checkIn)} – {formatTime(rec.checkOut)}
                </Text>
                {!rec.checkOut && (
                  <TouchableOpacity style={s.rectifyChip} onPress={() => setRectifyModal(rec)}>
                    <Text style={s.rectifyChipText}>Fix</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={s.sectionHeader}>
        <Icon name="calendar-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>What's Coming</Text>
      </View>
      <View style={s.todayRow}>
        <PremiumCard style={{ flex: 1, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name="gift-outline" size={16} color="#ec4899" />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Birthdays Today</Text>
          </View>
          {todayBirthdays.length === 0 ? (
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>No birthdays today</Text>
          ) : (
            todayBirthdays.slice(0, 3).map((b) => (
              <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <View style={s.avatarCircle}>
                  <Text style={s.avatarText}>{(b.name || '?').charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.text, flex: 1 }} numberOfLines={1}>{b.name}</Text>
                <Icon name="cake-outline" size={14} color="#ec4899" />
              </View>
            ))
          )}
          <TouchableOpacity onPress={() => navigation?.navigate('Birthdays')}>
            <Text style={{ fontSize: 12, color: colors.accent, fontWeight: '600', marginTop: 4 }}>View all</Text>
          </TouchableOpacity>
        </PremiumCard>

        <PremiumCard style={{ flex: 1, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name="calendar-outline" size={16} color="#FF6600" />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Holidays</Text>
          </View>
          {upcomingHolidays.length === 0 ? (
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>No upcoming holidays</Text>
          ) : (
            upcomingHolidays.slice(0, 3).map((h) => (
              <View key={h.id} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 13, color: colors.text }} numberOfLines={1}>{h.name}</Text>
                <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                  {formatDate(h.date)}
                </Text>
              </View>
            ))
          )}
          <TouchableOpacity onPress={() => navigation?.navigate('HolidayCalendar')}>
            <Text style={{ fontSize: 12, color: colors.accent, fontWeight: '600', marginTop: 4 }}>View calendar</Text>
          </TouchableOpacity>
        </PremiumCard>
      </View>

      <View style={s.sectionHeader}>
        <Icon name="grid-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Links</Text>
      </View>
      <View style={s.moduleGrid}>
        {[
          { key: 'Attendance', label: 'Attendance', desc: 'Check in/out & view history', icon: 'clipboard-outline', color: '#10b981' },
          { key: 'ApplyLeave', label: 'Apply Leave', desc: 'Submit leave request', icon: 'add-circle-outline', color: '#3b82f6' },
          { key: 'Tasks', label: 'My Tasks', desc: 'View & update tasks', icon: 'checkmark-circle-outline', color: '#ec4899' },
          { key: 'SalarySlips', label: 'Salary Slips', desc: 'View payslips', icon: 'wallet-outline', color: '#8b5cf6' },
          { key: 'MyProfile', label: 'My Profile', desc: 'Profile & preferences', icon: 'person-circle-outline', color: '#FF6600' },
          { key: 'Notifications', label: 'Notifications', desc: 'View notifications', icon: 'notifications-outline', color: '#64748b' },
        ].map((mod) => (
          <TouchableOpacity key={mod.key} style={s.moduleCard} onPress={() => navigation?.navigate(mod.key)}>
            <View style={[s.moduleIconWrap, { backgroundColor: `${mod.color}15` }]}>
              <Icon name={mod.icon} size={20} color={mod.color} />
            </View>
            <View style={s.moduleInfo}>
              <Text style={s.moduleLabel}>{mod.label}</Text>
              <Text style={s.moduleDesc}>{mod.desc}</Text>
            </View>
            <Icon name="chevron-forward-outline" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ height: 24 }} />
      <SelfieCaptureModal
        visible={showSelfieCapture}
        companyId={user?.companyId || ''}
        userId={user?.id || ''}
        onClose={() => setShowSelfieCapture(false)}
        onCaptured={handleSelfieCaptured}
      />

      <Modal
        visible={!!rectifyModal}
        transparent
        animationType="fade"
        onRequestClose={() => !submittingRectify && setRectifyModal(null)}>
        <View style={[s.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Request Punch Rectification</Text>
              <TouchableOpacity onPress={() => setRectifyModal(null)} disabled={submittingRectify}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalDesc}>
              Date: {rectifyModal?.date ? formatDate(rectifyModal.date) : '—'}
            </Text>
            <Text style={[s.modalDesc, { marginTop: 4 }]}>
              Current check-out: {formatTime(rectifyModal?.checkOut) || 'Not recorded'}
            </Text>
            <Text style={[s.modalDesc, { color: colors.textSecondary, marginTop: 12, fontWeight: '600' }]}>Corrected check-out time (HH:MM)</Text>
            <TextInput
              style={[s.timeInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={rectifyTime}
              onChangeText={setRectifyTime}
              placeholder="e.g. 18:30"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, { borderColor: colors.border }]} onPress={() => setRectifyModal(null)} disabled={submittingRectify}>
                <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: '#FF6600' }, (!rectifyTime || submittingRectify) && { opacity: 0.6 }]}
                onPress={handleRectifyRequest}
                disabled={!rectifyTime || submittingRectify}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{submittingRectify ? 'Submitting...' : 'Submit Request'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  checkInCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.borderLight,
    padding: 16,
  },
  checkInTop: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  checkInLabel: { fontSize: 11, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  checkInStatus: { fontSize: 18, fontWeight: '700', marginTop: 1 },
  checkInTime: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  checkInBtn: {
    width: 118, height: 118, borderRadius: 59,
    backgroundColor: '#FF6600',
    alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#FF6600', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10,
  },
  checkInBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 4 },
  policyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  policyChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  historyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 },
  historyLinkText: { fontSize: 13, fontWeight: '600', color: c.accent },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text },
  quickRow: { paddingLeft: 20, marginBottom: 4 },
  quickCard: {
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 14,
  },
  quickLabel: { fontSize: 13, fontWeight: '600' },
  todayRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  avatarCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#ec489920', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#ec4899' },
  moduleGrid: { paddingHorizontal: 16, gap: 8 },
  moduleCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, padding: 14,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  moduleIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  moduleInfo: { flex: 1, marginLeft: 12 },
  moduleLabel: { fontSize: 14, fontWeight: '600', color: c.text },
  moduleDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  actionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 12, padding: 12,
    borderWidth: 1, borderRadius: 12,
  },
  missPunchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, paddingVertical: 8,
  },
  missPunchText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#f59e0b' },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, padding: 12,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 12,
  },
  monthDot: { width: 8, height: 8, borderRadius: 4 },
  rectifyChip: {
    backgroundColor: '#f59e0b18', borderWidth: 1, borderColor: '#f59e0b45',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  rectifyChipText: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },
  modalOverlay: { flex: 1, justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#00000012' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  modalDesc: { fontSize: 13, color: c.textSecondary },
  timeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, marginTop: 8, fontWeight: '600',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderRadius: 10 },
});
