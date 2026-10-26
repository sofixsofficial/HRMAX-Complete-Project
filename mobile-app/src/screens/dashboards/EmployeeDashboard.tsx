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
import { BrandHomeHero, type HeroStat } from '../../components/BrandHomeHero';
import Svg, { Circle } from 'react-native-svg';
import type { AttendanceRecord } from '../../types/user';

const QUICK_ACTIONS = [
  { label: 'Check In / Out', icon: 'log-in-outline', screen: 'Attendance', color: '#FF6600' },
  { label: 'Apply Leave', icon: 'calendar-outline', screen: 'ApplyLeave', color: '#3b82f6' },
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

  // Real punch events, newest first — never invented activity. (Declared after
  // formatDate/formatTime: a useMemo above them hits the temporal dead zone.)
  const recentActivity = useMemo(() => {
    const rows = [...monthRecords]
      .filter((r: any) => r?.checkIn || r?.checkOut)
      .sort((a: any, b: any) => new Date(b?.date).getTime() - new Date(a?.date).getTime());
    return rows
      .flatMap((r: any) => {
        const out: Array<{ key: string; title: string; when: string; icon: any; color: string }> = [];
        if (r.checkOut) {
          out.push({ key: `${r.id}-out`, title: 'Checked out', when: `${formatDate(r.date)} · ${formatTime(r.checkOut)}`, icon: 'log-out-outline', color: '#3b82f6' });
        }
        if (r.checkIn) {
          out.push({ key: `${r.id}-in`, title: 'Checked in', when: `${formatDate(r.date)} · ${formatTime(r.checkIn)}`, icon: 'log-in-outline', color: '#10b981' });
        }
        return out;
      })
      .slice(0, 5);
  }, [monthRecords]);

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  const handleCheckIn = async () => {
    if (!user?.id || checking) return;
    if (!user.companyId) {
      setActionMsg({ type: 'error', text: 'No company assigned to your account.' });
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
        // On-screen banner, not Alert.alert: RN-web's Alert is a no-op, which
        // made every blocked/failed punch look like "nothing happened".
        setActionMsg({ type: 'error', text: res.reason || 'Attendance policy not satisfied.' });
        return;
      }
      const result = await markCheckIn(user.companyId, {
        selfieUri: selfieUriRef.current || undefined,
      });
      selfieUriRef.current = null;
      setActionMsg({ type: 'success', text: result.message || 'Checked in.' });
      // Re-read the record the SERVER just wrote — the dashboard previously
      // kept showing "Not Checked In" after a successful punch.
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Check-in failed' });
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
        setActionMsg({ type: 'error', text: res.reason || 'Attendance policy not satisfied.' });
        return;
      }
      const result = await markCheckOut(user.companyId, todayRecord.id);
      setActionMsg({ type: 'success', text: result.message || 'Checked out.' });
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Check-out failed' });
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
      <BrandHomeHero
        name={user?.name || 'Employee'}
        subtitle={designation || 'Employee'}
        unread={0}
        onAvatarPress={() => navigation?.navigate('MyProfile')}
        onBellPress={() => navigation?.navigate('Notifications')}
        stats={[
          // Present includes Late, same as the ring's percentage — one number,
          // two places, never disagreeing.
          { label: 'Present', value: monthStats.present + monthStats.late, icon: 'checkmark-circle-outline', color: '#10b981' },
          { label: 'Absent', value: monthStats.absent, icon: 'close-circle-outline', color: '#ef4444' },
          { label: 'On Leave', value: monthStats.onLeave, icon: 'umbrella-outline', color: '#8b5cf6' },
          { label: 'Total', value: monthStats.total, icon: 'people-outline', color: '#3b82f6' },
        ]}
        onPressStat={() => navigation?.navigate('Attendance')}
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

      {/* Today's status — white card with the green checked-in state, date/time
          rows and a full-width punch button (reference layout). */}
      <View style={s.checkInCard}>
        <View style={s.statusHead}>
          <View
            style={[
              s.statusCircle,
              { backgroundColor: todayRecord && !completed ? '#10b981' : completed ? '#3b82f6' : '#94a3b8' },
            ]}>
            <Icon
              name={completed ? 'checkmark-done' : todayRecord ? 'checkmark' : 'time-outline'}
              size={26}
              color="#fff"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusHeadline}>
              {completed ? 'Day Complete' : todayRecord ? 'Checked In' : 'Not Checked In'}
            </Text>
            <Text style={s.statusSub} numberOfLines={1}>
              {todayRecord?.status ? `${todayRecord.status} · ` : ''}
              {formatDate(todayRecord?.date)}
            </Text>
          </View>
        </View>

        <View style={s.statusRows}>
          <View style={s.statusRow}>
            <Icon name="calendar-outline" size={15} color={colors.textSecondary} />
            <Text style={s.statusRowText}>{formatDate(todayRecord?.date)}</Text>
          </View>
          <View style={s.statusRow}>
            <Icon name="time-outline" size={15} color={colors.textSecondary} />
            <Text style={s.statusRowText}>
              {formatTime(todayRecord?.checkIn) || '—'}
              {todayRecord?.checkOut ? `  →  ${formatTime(todayRecord.checkOut)}` : ''}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.checkInWideBtn, (checking || completed) && { opacity: 0.6 }]}
          onPress={canCheckOut ? handleCheckOut : canCheckIn ? handleCheckIn : undefined}
          disabled={checking || completed}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={canCheckOut ? 'Check out' : 'Check in'}>
          <Icon
            name={canCheckOut ? 'log-out-outline' : canCheckIn ? 'log-in-outline' : 'checkmark-circle-outline'}
            size={18}
            color="#fff"
          />
          <Text style={s.checkInWideBtnText}>
            {checking ? 'Please wait…' : canCheckOut ? 'Check Out' : canCheckIn ? 'Check In' : 'Completed'}
          </Text>
        </TouchableOpacity>

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
      </View>

      <View style={s.sectionHeader}>
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Actions</Text>
      </View>
      <View style={s.quickGrid}>
        {QUICK_ACTIONS.map((q) => (
          <TouchableOpacity
            key={q.label}
            style={s.quickCardGrid}
            onPress={() => navigation?.navigate(q.screen)}
            accessibilityRole="button"
            accessibilityLabel={q.label}>
            <View style={[s.quickIconWrap, { backgroundColor: `${q.color}1a` }]}>
              <Icon name={q.icon as any} size={20} color={q.color} />
            </View>
            <Text style={s.quickLabelGrid}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── TODAY'S ATTENDANCE: real monthly figures behind a progress ring ── */}
      <View style={s.sectionHeader}>
        <Icon name="pie-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Today's Attendance</Text>
      </View>
      <View style={s.ringCard}>
        <View style={s.ringWrap}>
          <Svg width={104} height={104} viewBox="0 0 104 104">
            <Circle cx="52" cy="52" r="44" stroke={`${colors.borderLight}`} strokeWidth="11" fill="none" />
            <Circle
              cx="52"
              cy="52"
              r="44"
              stroke="#10b981"
              strokeWidth="11"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - (attendanceRate ?? 0) / 100)}`}
              transform="rotate(-90 52 52)"
            />
          </Svg>
          <View style={s.ringCenter}>
            <Text style={s.ringValue}>{attendanceRate === null ? '—' : `${attendanceRate}%`}</Text>
            <Text style={s.ringLabel}>Present</Text>
          </View>
        </View>

        <View style={{ flex: 1, gap: 10 }}>
          {[
            // Present includes Late — the same numerator the ring's % uses
            // (present + late) / total, so the two never disagree.
            { label: 'Present', value: monthStats.present + monthStats.late, color: '#10b981', icon: 'checkmark-circle-outline' },
            { label: 'Absent', value: monthStats.absent, color: '#ef4444', icon: 'close-circle-outline' },
            { label: 'On Leave', value: monthStats.onLeave, color: '#8b5cf6', icon: 'umbrella-outline' },
          ].map((row) => (
            <View key={row.label} style={s.ringRow}>
              <View style={[s.ringDot, { backgroundColor: row.color }]} />
              <Text style={s.ringRowLabel}>{row.label}</Text>
              <Text style={s.ringRowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── RECENT ACTIVITY: real punch events, never fabricated ── */}
      <View style={s.sectionHeader}>
        <Icon name="pulse-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Recent Activity</Text>
      </View>
      <View style={s.activityCard}>
        {recentActivity.length === 0 ? (
          <Text style={s.activityEmpty}>No punch activity yet this month.</Text>
        ) : (
          recentActivity.map((a) => (
            <View key={a.key} style={s.activityRow}>
              <View style={[s.activityIcon, { backgroundColor: `${a.color}1a` }]}>
                <Icon name={a.icon} size={15} color={a.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.activityTitle}>{a.title}</Text>
                <Text style={s.activityWhen}>{a.when}</Text>
              </View>
            </View>
          ))
        )}
      </View>

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
    backgroundColor: c.card,
    padding: 16,
  },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusHeadline: { fontSize: 18, fontWeight: '800', color: c.text },
  statusSub: { fontSize: 12.5, color: c.textSecondary, marginTop: 2 },
  statusRows: { gap: 8, marginTop: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusRowText: { fontSize: 13.5, color: c.text, fontWeight: '600' },
  checkInWideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF6600',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
    shadowColor: '#FF6600',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  checkInWideBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  policyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  policyChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  historyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 },
  historyLinkText: { fontSize: 13, fontWeight: '600', color: c.accent },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
  },
  quickCardGrid: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.borderLight,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  quickIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabelGrid: { fontSize: 12.5, fontWeight: '700', color: c.text, textAlign: 'center' },
  ringCard: {
    marginHorizontal: 16,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.borderLight,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  ringWrap: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  ringValue: { fontSize: 22, fontWeight: '800', color: c.text },
  ringLabel: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ringDot: { width: 9, height: 9, borderRadius: 5 },
  ringRowLabel: { flex: 1, fontSize: 13.5, color: c.textSecondary, fontWeight: '600' },
  ringRowValue: { fontSize: 15, fontWeight: '800', color: c.text },
  activityCard: {
    marginHorizontal: 16,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.borderLight,
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  activityEmpty: { fontSize: 13, color: c.textTertiary, textAlign: 'center', paddingVertical: 6 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activityIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
  activityWhen: { fontSize: 11.5, color: c.textTertiary, marginTop: 1 },
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
