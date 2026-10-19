import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { HeroBanner, PremiumCard, SegmentControl, StatusBadge, EmptyStateView, PremiumBottomSheet } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import type { AttendanceRecord } from '../../types/user';
import type { AttendancePolicy } from '../../services/attendanceSettingsService';
import { subscribeAttendancePolicy } from '../../services/attendanceSettingsService';
import { reviewMissedPunchTier, reviewMasterAdminMissedPunch, getNextPendingMissedPunchTier, getActionableMissedPunchTier, getRecordEffectiveMissedPunchTiers, computeMissedPunchProgress, computeMissedPunchTotalTiers, MISSED_PUNCH_TIER_LABELS, MISSED_PUNCH_MASTER_ADMIN_LABEL } from '../../services/attendanceApi';
import { Icon } from '../../utils/icons';

type Tab = 'overview' | 'employees';

const STATUS_COLORS: Record<string, string> = {
  Present: '#10b981', Absent: '#ef4444', Late: '#f59e0b',
  'On Leave': '#3b82f6', 'Miss Punch': '#8b5cf6', 'Early Checkout': '#FF6600',
};

const formatTime = (d: any): string => {
  if (!d) return '--:--';
  const date = d?.toDate ? d.toDate() : new Date(d);
  if (isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const formatDateShort = (d: any): string => {
  if (!d) return '';
  const date = d?.toDate ? d.toDate() : new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const todayStr = () => new Date().toISOString().split('T')[0];

export default function AttendanceDashboardScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { effectiveCompanyId, selectedCompanyName } = useCompany();
  const companyId = effectiveCompanyId || user?.companyId || '';
  const s = useMemo(() => createStyles(colors), [colors]);

  const [tab, setTab] = useState<Tab>('overview');
  const [records, setRecords] = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [exporting, setExporting] = useState(false);

  const [empStatsPage, setEmpStatsPage] = useState(1);
  const [empStatsSearch, setEmpStatsSearch] = useState('');

  // Missed punch review states (matching web's missed punch workflow)
  const [reviewRecord, setReviewRecord] = useState<any>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewRemark, setReviewRemark] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    const unsub = onSnapshot(
      query(collection(db, 'attendance'), where('companyId', '==', companyId)),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRecords(data.filter((r: any) => {
          const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
          return d.toISOString().split('T')[0] === todayStr();
        }));
        setAllRecords(data);
        setLoading(false);
      }, () => setLoading(false)
    );
    return unsub;
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const unsub = onSnapshot(
      query(collection(db, 'employees'), where('companyId', '==', companyId)),
      (snap) => {
        setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, () => {}
    );
    return unsub;
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeAttendancePolicy(companyId, (p) => setPolicy(p));
    return unsub;
  }, [companyId]);

  const present = records.filter((r: any) => r.status === 'Present' || r.status === 'Approved');
  const late = records.filter((r: any) => r.status === 'Late');
  const absent = records.filter((r: any) => r.status === 'Absent');
  const onLeave = records.filter((r: any) => r.status === 'On Leave');
  const missPunch = records.filter((r: any) => r.status === 'Miss Punch' || r.status === 'MissPunch');
  const avgHours = records.length > 0 ? records.reduce((sum: number, r: any) => sum + (r.workHours || 0), 0) / records.length : 0;

  const dateFiltered = allRecords;
  const filtered = dateFiltered.filter((r: any) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = (r.name || '').toLowerCase().includes(q) || (r.department || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(1); }, [totalPages]);

  const empStats = employees.map((emp: any) => {
    const empRecs = dateFiltered.filter((r: any) => r.userId === emp.userId);
    const presentDays = empRecs.filter((r: any) => r.status === 'Present' || r.status === 'Approved').length;
    const lateDays = empRecs.filter((r: any) => r.status === 'Late').length;
    const absentDays = empRecs.filter((r: any) => r.status === 'Absent').length;
    const approvedLeaveDays = empRecs.filter((r: any) => r.status === 'On Leave').length;
    const missPunchDays = empRecs.filter((r: any) => r.status === 'Miss Punch' || r.status === 'MissPunch').length;
    const totalDays = Math.max(empRecs.length, 1);
    const attendancePercentage = ((presentDays + lateDays) / totalDays) * 100;
    return {
      userId: emp.userId, employeeName: emp.name, employeeId: emp.employeeId,
      department: emp.department, presentDays, lateDays, absentDays,
      approvedLeaveDays, missPunchDays,
      totalWorkingHours: empRecs.reduce((s: number, r: any) => s + (r.workHours || 0), 0),
      totalOvertimeHours: empRecs.reduce((s: number, r: any) => s + (r.overtimeHours || 0), 0),
      attendancePercentage: Math.round(attendancePercentage * 10) / 10,
    };
  });
  const filteredEmpStats = empStats.filter((e: any) => {
    const q = empStatsSearch.toLowerCase();
    return e.employeeName.toLowerCase().includes(q) || (e.employeeId || '').toLowerCase().includes(q);
  });
  const totalEmpStatsPages = Math.max(1, Math.ceil(filteredEmpStats.length / pageSize));
  const paginatedEmpStats = filteredEmpStats.slice((empStatsPage - 1) * pageSize, empStatsPage * pageSize);

  useEffect(() => { setEmpStatsPage(1); }, [empStatsSearch]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Department,Date,Status,Check In,Check Out,Hours'];
      const rows = filtered.map(r => `${(r.name || '').replace(/,/g, ';')},${(r.department || '').replace(/,/g, ';')},${formatDateShort(r.date)},${r.status || ''},${formatTime(r.checkIn)},${formatTime(r.checkOut)},${r.workHours || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'attendance_dashboard_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // ── Missed Punch Review Handlers (matching web's team review workflow) ──
  // From ALL records, not just today's: a rectification submitted yesterday is
  // still pending today — deriving this list from `records` (today-filtered)
  // made "Pending Missed Punch Reviews" silently drop overnight submissions.
  const pendingMissedPunches = allRecords.filter((r: any) => r.missedPunchRectification?.requested && !r.missedPunchRectification.resolved);

  // Web parity: single shared routing helper (stamped approver + MA override +
  // natural-role/legacy/scope fallbacks).
  const getMyTier = (r: any) =>
    getActionableMissedPunchTier(r, user?.id || '', user?.role);

  const isMaPending = (r: any) => {
    const mp = r.missedPunchRectification;
    if (!mp?.requested || !mp?.approvalStatus) return false;
    return !!mp.masterAdminRequired
      && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending')
      && getRecordEffectiveMissedPunchTiers(mp).every((t: any) => mp.approvalStatus?.[t] === 'Approved');
  };

  const handleReviewMissedPunch = async (record: any, action: 'approve' | 'reject') => {
    if (!user) return;
    if (!reviewRemark.trim()) {
      Alert.alert('Remark required', 'A mandatory remark is required to review this missed punch.');
      return;
    }
    setSubmittingReview(true);
    const mp = record.missedPunchRectification || {};
    const isMA = isMaPending(record) && user.role === 'master-admin';
    try {
      if (isMA) {
        await reviewMasterAdminMissedPunch(
          record.id, action === 'approve' ? 'Approved' : 'Rejected',
          user.id, user.name || '', reviewRemark.trim()
        );
      } else {
        const tier = getMyTier(record);
        if (!tier) {
          Alert.alert('Not your turn', 'You are not the assigned reviewer for this step.');
          setSubmittingReview(false);
          return;
        }
        await reviewMissedPunchTier(
          record.id, tier, action === 'approve' ? 'Approved' : 'Rejected',
          user.id, user.name || '', reviewRemark.trim()
        );
      }
      setReviewRecord(null); setReviewRemark('');
      Alert.alert(action === 'approve' ? 'Approved' : 'Rejected',
        isMA ? 'Missed punch finalized as Master Admin.' : 'Verification updated.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const trendData = (() => {
    const days: { label: string; present: number; late: number; absent: number; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
      const dayRecords = allRecords.filter((r: any) => {
        const rd = r.date?.toDate ? r.date.toDate() : new Date(r.date);
        return rd.toDateString() === d.toDateString();
      });
      days.push({
        label: dayStr,
        present: dayRecords.filter((r: any) => r.status === 'Present' || r.status === 'Approved').length,
        late: dayRecords.filter((r: any) => r.status === 'Late').length,
        absent: dayRecords.filter((r: any) => r.status === 'Absent').length,
        total: employees.length,
      });
    }
    return days;
  })();

  const getAttPercent = (p: number, t: number) => t > 0 ? Math.round((p / t) * 100) : 0;

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#FF6600" />
          <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Loading dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container}>
      <ScreenHeader title="Attendance Dashboard" onBack={() => navigation.goBack()} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <HeroBanner greeting="Attendance" name="Dashboard" subtitle={`${selectedCompanyName || 'All Companies'} · ${employees.length} employees`}
          stats={[
            { label: 'Present', value: present.length, color: '#10b981' },
            { label: 'Late', value: late.length, color: '#eab308' },
            { label: 'Absent', value: absent.length, color: '#ef4444' },
            { label: 'Miss Punch', value: missPunch.length, color: '#8b5cf6' },
          ]}
        />

        <View style={s.toolbar}>
          <View style={s.header}>
            <Text style={s.title}>Attendance Records</Text>
            <Text style={s.count}>{filtered.length} total</Text>
          </View>
          <View style={s.searchExportRow}>
            <View style={[s.searchRow, { flex: 1 }]}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search employees..."
                placeholderTextColor={colors.textTertiary}
                value={searchTerm}
                onChangeText={setSearchTerm}
              />
            </View>
            <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
              {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Ionicons name="download-outline" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.statsRow}>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={s.statValue}>{employees.length}</Text>
            <Text style={s.statLabel}>Total Employees</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: '#10b981' }]}>{present.length}</Text>
            <Text style={s.statLabel}>Present</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: '#f59e0b' }]}>{late.length}</Text>
            <Text style={s.statLabel}>Late</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: '#ef4444' }]}>{absent.length}</Text>
            <Text style={s.statLabel}>Absent</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: '#3b82f6' }]}>{onLeave.length}</Text>
            <Text style={s.statLabel}>On Leave</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: '#8b5cf6' }]}>{avgHours.toFixed(1)}h</Text>
            <Text style={s.statLabel}>Avg Hours</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
          {(['overview', 'employees'] as Tab[]).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => { setTab(t); setCurrentPage(1); }}
              style={[s.tabBtn, tab === t && s.tabActive]}
            >
              <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                {t === 'overview' ? 'Overview' : 'Employee Stats'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {tab === 'overview' && (
          <>
            <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <Text style={s.cardTitle}>Today's Attendance Summary</Text>
              <View style={s.summaryGrid}>
                {[
                  { label: 'Present', count: present.length, color: '#10b981', bg: '#dcfce7' },
                  { label: 'Late', count: late.length, color: '#f59e0b', bg: '#fef3c7' },
                  { label: 'Absent', count: absent.length, color: '#ef4444', bg: '#fee2e2' },
                  { label: 'On Leave', count: onLeave.length, color: '#3b82f6', bg: '#eff6ff' },
                  { label: 'Miss Punch', count: missPunch.length, color: '#8b5cf6', bg: '#f3e8ff' },
                ].map(item => (
                  <View key={item.label} style={[s.summaryItem, { backgroundColor: item.bg }]}>
                    <Text style={[s.summaryCount, { color: item.color }]}>{item.count}</Text>
                    <Text style={[s.summaryLabel, { color: item.color }]}>{item.label}</Text>
                    <Text style={s.summaryPct}>{getAttPercent(item.count, employees.length)}%</Text>
                  </View>
                ))}
              </View>
            </PremiumCard>

            <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>Geofence Status</Text>
              </View>
              {[
                { label: 'Geofence', active: policy?.enableGeofence },
                { label: 'Network Guard', active: policy?.enableNetworkGuard },
                { label: 'Anti-Spoofing', active: policy?.enableAntiSpoofing },
              ].map(item => (
                <View key={item.label} style={[s.geoRow, { backgroundColor: item.active ? '#dcfce7' : colors.surface }]}>
                  <Text style={s.geoLabel}>{item.label}</Text>
                  <Text style={[s.geoStatus, { color: item.active ? '#10b981' : colors.textTertiary }]}>
                    {item.active ? 'Active' : 'Disabled'}
                  </Text>
                </View>
              ))}
              {policy?.enableGeofence && policy?.officeLocation?.name && (
                <Text style={s.geoDetail}>Office: {policy.officeLocation.name} ({policy.officeLocation.radiusMeters}m radius)</Text>
              )}
            </PremiumCard>

            <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <Text style={s.cardTitle}>Attendance Trend (Last 7 Days)</Text>
              <View style={s.trendContainer}>
                {trendData.map((d, i) => {
                  const total = d.total || 1;
                  const presentPct = (d.present / total) * 100;
                  const latePct = (d.late / total) * 100;
                  const absentPct = (d.absent / total) * 100;
                  return (
                    <View key={i} style={s.trendCol}>
                      <View style={s.trendBars}>
                        <View style={[s.trendBar, { height: `${Math.max(absentPct, 2)}%`, backgroundColor: '#fee2e2' }]} />
                        <View style={[s.trendBar, { height: `${Math.max(latePct, 2)}%`, backgroundColor: '#fef3c7' }]} />
                        <View style={[s.trendBar, { height: `${Math.max(presentPct, 2)}%`, backgroundColor: '#dcfce7' }]} />
                      </View>
                      <Text style={s.trendLabel}>{d.label}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={s.legend}>
                <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#dcfce7' }]} /><Text style={s.legendText}>Present</Text></View>
                <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#fef3c7' }]} /><Text style={s.legendText}>Late</Text></View>
                <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#fee2e2' }]} /><Text style={s.legendText}>Absent</Text></View>
              </View>
            </PremiumCard>

            {/* Pending Missed Punch Reviews (matching web's team review workflow) */}
            {pendingMissedPunches.length > 0 && (
              <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }} accentColor="#8b5cf6">
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>Pending Missed Punch Reviews</Text>
                  <View style={{ backgroundColor: '#8b5cf6', borderRadius: 100, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{pendingMissedPunches.length}</Text>
                  </View>
                </View>
                {pendingMissedPunches.map((r: any) => {
                  const mp = r.missedPunchRectification;
                  const tiers = getRecordEffectiveMissedPunchTiers(mp);
                  const progress = computeMissedPunchProgress(mp);
                  const total = computeMissedPunchTotalTiers(mp);
                  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
                  const overall = mp.status || (mp.resolved ? 'Approved' : 'Pending');
                  const tier = getMyTier(r);
                  const maP = isMaPending(r);

                  return (
                    <View key={r.id} style={[s.missedPunchItem, { backgroundColor: colors.background }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{r.name || 'Unknown'}</Text>
                          <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                            {r.department || ''} · {formatDateShort(r.date)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>
                            {Math.min(progress, total)}/{total} tiers
                          </Text>
                        </View>
                      </View>
                      {/* Progress bar */}
                      <View style={{ height: 3, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginVertical: 6 }}>
                        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 2 }} />
                      </View>
                      {/* Tier chips */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {tiers.map((t: string) => {
                          const st = (mp.approvalStatus as Record<string, string>)?.[t] || 'Pending';
                          const conf: Record<string, { bg: string; tc: string }> = {
                            Approved: { bg: '#dcfce7', tc: '#16a34a' },
                            Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                            Pending: { bg: '#fef3c7', tc: '#b45309' },
                          };
                          const c = conf[st] || conf.Pending;
                          return (
                            <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{(MISSED_PUNCH_TIER_LABELS as Record<string, string>)[t]}: {st}</Text>
                            </View>
                          );
                        })}
                        {mp.masterAdminRequired && (
                          <View style={{ backgroundColor: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, fontWeight: '600', color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                              {MISSED_PUNCH_MASTER_ADMIN_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                            </Text>
                          </View>
                        )}
                      </View>
                      {/* Action buttons */}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {maP && user?.role === 'master-admin' && (
                          <TouchableOpacity
                            style={{ flex: 1, backgroundColor: '#c2410c', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                            onPress={() => { setReviewRecord(r); setReviewAction('approve'); setReviewRemark(''); }}>
                            <Icon name="star-outline" size={12} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Master Admin Review</Text>
                          </TouchableOpacity>
                        )}
                        {overall === 'Pending' && tier && (
                          <>
                            <TouchableOpacity
                              style={{ flex: 1, backgroundColor: '#10b981', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                              onPress={() => { setReviewRecord(r); setReviewAction('approve'); setReviewRemark(''); }}>
                              <Ionicons name="checkmark-circle-outline" size={12} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{ flex: 1, backgroundColor: '#ef4444', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                              onPress={() => { setReviewRecord(r); setReviewAction('reject'); setReviewRemark(''); }}>
                              <Ionicons name="close-circle-outline" size={12} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Reject</Text>
                            </TouchableOpacity>
                          </>
                        )}
                        {overall === 'Pending' && !tier && !maP && (
                          <View style={{ flex: 1, backgroundColor: '#e5e7eb', paddingVertical: 6, borderRadius: 8, alignItems: 'center' }}>
                            <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '600' }}>Awaiting Next Tier</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </PremiumCard>
            )}

            <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <Text style={s.cardTitle}>Detailed Attendance</Text>
              {paginated.length === 0 ? (
                <EmptyStateView icon="calendar-outline" title="No Records" subtitle="No attendance records found in this date range" />
              ) : (
                <>
                  {paginated.map((r: any) => {
                    const color = STATUS_COLORS[r.status] || '#6b7280';
                    return (
                      <View key={r.id} style={s.attRow}>
                        <View style={s.attInfo}>
                          <Text style={s.attName}>{r.name}</Text>
                          <Text style={s.attDept}>{r.department || '--'} · {formatDateShort(r.date)}</Text>
                        </View>
                        <View style={s.attDetails}>
                          <Text style={s.attTime}>{formatTime(r.checkIn)}-{formatTime(r.checkOut)}</Text>
                          <StatusBadge status={r.status || 'Present'} color={color} />
                        </View>
                      </View>
                    );
                  })}
                  <View style={s.pagination}>
                    <TouchableOpacity disabled={currentPage <= 1} onPress={() => setCurrentPage(p => p - 1)} style={s.pageBtn}>
                      <Ionicons name="chevron-back" size={16} color={currentPage <= 1 ? colors.textTertiary : colors.accent} />
                    </TouchableOpacity>
                    <Text style={s.pageText}>{currentPage} / {totalPages || 1}</Text>
                    <TouchableOpacity disabled={currentPage >= totalPages} onPress={() => setCurrentPage(p => p + 1)} style={s.pageBtn}>
                      <Ionicons name="chevron-forward" size={16} color={currentPage >= totalPages ? colors.textTertiary : colors.accent} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </PremiumCard>
          </>
        )}

        {tab === 'employees' && (
          <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16 }}>
            <Text style={s.cardTitle}>Employee Attendance Stats</Text>
            <View style={s.searchRow}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search employees..."
                placeholderTextColor={colors.textTertiary}
                value={empStatsSearch}
                onChangeText={(t) => { setEmpStatsSearch(t); setEmpStatsPage(1); }}
              />
            </View>
            {filteredEmpStats.length === 0 ? (
              <EmptyStateView icon="people-outline" title="No Data" subtitle="No employee data found for this date range" />
            ) : (
              <>
                {paginatedEmpStats.map((e: any) => (
                  <View key={e.userId} style={s.attRow}>
                    <View style={s.attInfo}>
                      <Text style={s.attName}>{e.employeeName}</Text>
                      <Text style={s.attDept}>{e.department || '--'} · {e.employeeId}</Text>
                    </View>
                    <View style={s.empStatsRight}>
                      <View style={s.percentBar}>
                        <View style={[s.percentFill, {
                          width: `${Math.min(e.attendancePercentage, 100)}%`,
                          backgroundColor: e.attendancePercentage >= 90 ? '#10b981' : e.attendancePercentage >= 75 ? '#f59e0b' : '#ef4444'
                        }]} />
                      </View>
                      <Text style={[s.percentText, {
                        color: e.attendancePercentage >= 90 ? '#10b981' : e.attendancePercentage >= 75 ? '#f59e0b' : '#ef4444'
                      }]}>{e.attendancePercentage}%</Text>
                    </View>
                  </View>
                ))}
                <View style={s.pagination}>
                  <TouchableOpacity disabled={empStatsPage <= 1} onPress={() => setEmpStatsPage(p => p - 1)} style={s.pageBtn}>
                    <Ionicons name="chevron-back" size={16} color={empStatsPage <= 1 ? colors.textTertiary : colors.accent} />
                  </TouchableOpacity>
                  <Text style={s.pageText}>{empStatsPage} / {totalEmpStatsPages || 1}</Text>
                  <TouchableOpacity disabled={empStatsPage >= totalEmpStatsPages} onPress={() => setEmpStatsPage(p => p + 1)} style={s.pageBtn}>
                    <Ionicons name="chevron-forward" size={16} color={empStatsPage >= totalEmpStatsPages ? colors.textTertiary : colors.accent} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </PremiumCard>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Miss Punch Review Bottom Sheet (matching web's missed punch review modal) ── */}
      <PremiumBottomSheet
        visible={!!reviewRecord}
        onClose={() => { setReviewRecord(null); setReviewRemark(''); }}
        title={reviewAction === 'approve' ? 'Approve Missed Punch' : 'Reject Missed Punch'}>
        {reviewRecord && (() => {
          const mp = reviewRecord.missedPunchRectification;
          const tiers = getRecordEffectiveMissedPunchTiers(mp);
          const progress = computeMissedPunchProgress(mp);
          const total = computeMissedPunchTotalTiers(mp);
          const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
          return (
            <>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
                {reviewRecord.name} requested rectification for a missed punch.
              </Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
                A mandatory remark is required to <Text style={{ fontWeight: '700', color: reviewAction === 'approve' ? '#10b981' : '#ef4444' }}>{reviewAction}</Text>.
              </Text>
              {/* Verification progress preview */}
              <View style={{ padding: 10, backgroundColor: '#faf5ff', borderRadius: 8, borderWidth: 1, borderColor: '#e9d5ff', marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                  <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                </View>
                <View style={{ height: 3, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                  <View style={{ width: `${pct}%`, height: '100%', backgroundColor: '#9333ea', borderRadius: 2 }} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {tiers.map((t: string) => {
                    const st = (mp.approvalStatus as Record<string, string>)?.[t] || 'Pending';
                    const conf: Record<string, { bg: string; tc: string }> = {
                      Approved: { bg: '#dcfce7', tc: '#16a34a' },
                      Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                      Pending: { bg: '#fef3c7', tc: '#b45309' },
                    };
                    const c = conf[st] || conf.Pending;
                    return (
                      <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{(MISSED_PUNCH_TIER_LABELS as Record<string, string>)[t]}: {st}</Text>
                      </View>
                    );
                  })}
                  {mp.masterAdminRequired && (
                    <View style={{ backgroundColor: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                        {MISSED_PUNCH_MASTER_ADMIN_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              {/* Remark */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6 }}>
                  Remark <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <TextInput
                  style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top' }}
                  placeholder="Enter mandatory remark..." placeholderTextColor={colors.textTertiary}
                  value={reviewRemark} onChangeText={setReviewRemark} multiline />
              </View>
              {/* Action buttons */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                  onPress={() => { setReviewRecord(null); setReviewRemark(''); }}>
                  <Text style={{ color: colors.text, fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: reviewAction === 'approve' ? '#10b981' : '#ef4444', opacity: (reviewRemark.trim() && !submittingReview) ? 1 : 0.5, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  disabled={!reviewRemark.trim() || submittingReview}
                  onPress={() => handleReviewMissedPunch(reviewRecord, reviewAction)}>
                  {submittingReview && <ActivityIndicator size={14} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{reviewAction === 'approve' ? 'Approve' : 'Reject'}</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
      </PremiumBottomSheet>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  toolbar: { paddingHorizontal: 16, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  searchExportRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, color: c.text, fontSize: 14 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginBottom: 16, gap: 8 },
  statCard: { width: '30%', flexGrow: 1, padding: 12, borderRadius: 10, minWidth: 100 },
  statValue: { fontSize: 22, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, borderBottomWidth: 2, borderBottomColor: c.border },
  tabBtn: { paddingVertical: 10, paddingHorizontal: 14, marginRight: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: c.accent, marginBottom: -2 },
  tabText: { fontSize: 13, fontWeight: '500', color: c.textSecondary },
  tabTextActive: { color: c.accent },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryItem: { flex: 1, minWidth: '18%', padding: 12, borderRadius: 10, alignItems: 'center' },
  summaryCount: { fontSize: 20, fontWeight: '700' },
  summaryLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  summaryPct: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  geoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 8, marginBottom: 8 },
  geoLabel: { fontSize: 14, fontWeight: '500', color: c.text },
  geoStatus: { fontSize: 13, fontWeight: '600' },
  geoDetail: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
  trendContainer: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 4, paddingVertical: 8 },
  trendCol: { flex: 1, alignItems: 'center' },
  trendBars: { flex: 1, width: '100%', flexDirection: 'column-reverse', gap: 1 },
  trendBar: { width: '100%', borderRadius: 2, minHeight: 2 },
  trendLabel: { fontSize: 9, color: c.textTertiary, marginTop: 4 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, color: c.textSecondary },
  attRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  attInfo: { flex: 1 },
  attName: { fontSize: 14, fontWeight: '600', color: c.text },
  attDept: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  attDetails: { alignItems: 'flex-end' },
  attTime: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  attStatus: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pagination: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, paddingVertical: 12 },
  pageBtn: { padding: 8 },
  pageText: { fontSize: 13, color: c.textSecondary },
  empStatsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  percentBar: { width: 60, height: 6, backgroundColor: c.surface, borderRadius: 3, overflow: 'hidden' },
  percentFill: { height: '100%', borderRadius: 3 },
  percentText: { fontSize: 13, fontWeight: '700', minWidth: 40, textAlign: 'right' },
  missedPunchItem: { padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e9d5ff' },
});
