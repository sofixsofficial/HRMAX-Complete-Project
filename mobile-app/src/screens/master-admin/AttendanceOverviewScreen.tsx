import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../aws/clients';
import { collection, getDocs, query, where, Timestamp } from '../../aws/firestore-compat';
import { dayKey } from '../../utils/attendanceDate';
import { useCompany } from '../../context/CompanyContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useReportingTeamScope } from '../../hooks/useReportingTeamScope';
import { createNotification, notifyTLAction } from '../../services/notificationService';
import {
  reviewMissedPunchTier,
  reviewMasterAdminMissedPunch,
  getNextPendingMissedPunchTier,
  getActionableMissedPunchTier,
  getRecordEffectiveMissedPunchTiers,
  computeMissedPunchProgress,
  computeMissedPunchTotalTiers,
  MISSED_PUNCH_TIER_LABELS,
  MISSED_PUNCH_MASTER_ADMIN_LABEL,
} from '../../services/attendanceApi';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { ScreenHeader } from '../../components/ScreenHeader';

const PERIODS = ['Today', 'This Week', 'This Month'] as const;
type Period = typeof PERIODS[number];

const getPeriodRange = (period: Period) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'This Week') {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  } else if (period === 'This Month') {
    start.setDate(1);
  }
  const end = new Date(start);
  if (period === 'Today') end.setDate(end.getDate() + 1);
  else if (period === 'This Week') end.setDate(start.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
};

const STATUS_COLORS: Record<string, string> = {
  Present: '#10b981', Absent: '#ef4444', Late: '#eab308',
  'On Leave': '#3b82f6', 'Miss Punch': '#8b5cf6', Approved: '#10b981', 'Early Checkout': '#FF6600',
};

export const AttendanceOverviewScreen: React.FC<{ route?: any }> = ({ route }) => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { user } = useAuth();
  const isRM = user?.role === 'reporting-manager';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scope = useReportingTeamScope(user?.id, effectiveCompanyId, isRM);
  // Active scope: selected company, or every authorized company in "All" mode.
  // Empty array = unrestricted role (master-admin) keeps legacy unfiltered view.
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );
  const [records, setRecords] = useState<any[]>([]);
  const [filter, setFilter] = useState('All');
  const [period, setPeriod] = useState<Period>('Today');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailModal, setDetailModal] = useState<any>(null);
  const [missPunchModal, setMissPunchModal] = useState<any>(null);
  const [rectifyNote, setRectifyNote] = useState('');
  const s = useMemo(() => createStyles(colors), [colors]);

  const fetchAttendance = useCallback(async () => {
    try {
      const { start, end } = getPeriodRange(period);
      if (scopeIds.length === 0) {
        if (isRestrictedScope) { setRecords([]); return; }
        const snap = await getDocs(query(
          collection(db, 'attendance'),
          // day keys, not Timestamps — attendance.date is stored as 'YYYY-MM-DD'
          where('date', '>=', dayKey(start)),
          where('date', '<', dayKey(end))
        ));
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) =>
          getDocs(query(
            collection(db, 'attendance'),
            where('companyId', '==', id),
            where('date', '>=', dayKey(start)),
            where('date', '<', dayKey(end))
          )).catch(() => ({ docs: [] as any[] }))
        )
      );
      const data = results.flatMap((snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setRecords(data);
    } catch (err) { console.error('Failed to fetch attendance:', err); }
  }, [scopeIds, isRestrictedScope, period]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  // Deep-link status filter from dashboard cards (e.g. Present / Absent / Late / Miss Punch)
  useEffect(() => {
    const st = route?.params?.status as string | undefined;
    if (!st) return;
    const valid = ['All', 'Present', 'Absent', 'Late', 'On Leave', 'Miss Punch', 'Approved'].includes(st);
    setFilter(valid ? st : 'All');
    // Pending rectifications can be days old — 'Today' hid every rectify row the
    // morning after submission (web has no period restriction at all).
    setPeriod(st === 'Miss Punch' ? 'This Week' : 'Today');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.status]);

  const onRefresh = async () => { setRefreshing(true); await fetchAttendance(); setRefreshing(false); };

  // Which missed-punch tier can the current user act on? Single source of truth
  // = getActionableMissedPunchTier (web parity: incl. hr-manager, master-admin
  // override, legacy empty-stamp + company-scope fallbacks).
  const getMyMissedPunchTier = (r: any) =>
    getActionableMissedPunchTier(r, user?.id || '', user?.role);

  // Is this record awaiting the Master Admin final gate?
  const isMissedPunchMAPending = (r: any) => {
    const mp = r?.missedPunchRectification;
    if (!mp?.requested || !mp?.approvalStatus) return false;
    return !!mp.masterAdminRequired
      && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending')
      && getRecordEffectiveMissedPunchTiers(mp).every((t: any) => mp.approvalStatus?.[t] === 'Approved');
  };

  const handleRectify = async (status: 'Approved' | 'Rejected') => {
    if (!missPunchModal) return;
    // Mandatory remark (matches web's missed-punch review modal)
    if (!rectifyNote.trim()) {
      Alert.alert('Remark required', 'A mandatory remark is required to review this missed punch.');
      return;
    }
    // Tier-locked review: advance the sequential verification chain exactly like
    // the website — never resolve the attendance record directly.
    const maGate = user?.role === 'master-admin' && isMissedPunchMAPending(missPunchModal);
    const tier = maGate ? null : getMyMissedPunchTier(missPunchModal);
    if (!maGate && !tier) {
      Alert.alert('Not your tier', 'This verification step is currently routed to another approver.');
      return;
    }
    try {
      if (maGate) {
        await reviewMasterAdminMissedPunch(missPunchModal.id, status, user?.id || '', user?.name || '', rectifyNote.trim());
      } else {
        await reviewMissedPunchTier(missPunchModal.id, tier!, status, user?.id || '', user?.name || '', rectifyNote.trim());
      }
      setMissPunchModal(null);
      setRectifyNote('');
      await fetchAttendance();
      const empName = missPunchModal.name || 'An employee';
      if (missPunchModal.userId && missPunchModal.userId !== user?.id) {
        try {
          await createNotification(
            missPunchModal.userId,
            status === 'Approved' ? 'attendance_approved' : 'attendance_rejected',
            status === 'Approved' ? 'Missed Punch Approved' : 'Missed Punch Rejected',
            `Your missed punch rectification was ${status.toLowerCase()} by ${user?.name || 'your manager'}.`,
            '/attendance',
            missPunchModal.companyId
          );
        } catch {}
      }
      if (user?.role === 'team-leader') {
        await notifyTLAction(
          user.id,
          `attendance_${status.toLowerCase()}_by_tl`,
          `Attendance ${status} by Team Leader`,
          `${user?.name || 'A team leader'} ${status.toLowerCase()} a missed punch for ${empName}.`,
          missPunchModal.companyId
        );
      }
    } catch (err: any) {
      // Surface the HttpsError code too — 400 = invalid-argument/failed-precondition
      // (e.g. "X must verify first", missing remark), 403 = permission-denied.
      console.error('[reviewMissedPunchTier]', err?.code, err?.message, { status, tier });
      Alert.alert('Error', `${err?.message || 'Failed to process rectification'}${err?.code ? ` (${err.code})` : ''}`);
    }
  };

  const filtered = useMemo(() => {
    const base = isRM ? records.filter((r) => scope.userIds.has(r.userId)) : records;
    return base.filter((r) => {
      if (filter !== 'All' && r.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.name?.toLowerCase().includes(q) && !(r.department || r.designation || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [records, isRM, scope.userIds, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filter, period]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Department,Status,Date,Check In,Check Out,Hours,Late (min)'];
      const rows = filtered.map(r => `${r.name || ''},${r.department || r.designation || ''},${r.status || ''},${formatDate(r.date)},${formatTime(r.checkIn)},${formatTime(r.checkOut)},${formatDuration(r.workHours)},${r.lateMinutes || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'attendance_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const renderPagination = () => {
    if (filtered.length <= pageSize) return null;
    return (
      <View style={s.paginationRow}>
        <TouchableOpacity style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageSizeText}>Show:</Text>
        <TouchableOpacity style={s.pageSizeBtn} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={s.pageSizeBtnText}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const summary = useMemo(() => {
    const base = isRM ? records.filter((r) => scope.userIds.has(r.userId)) : records;
    return {
      Present: base.filter((r) => r.status === 'Present').length,
      Absent: base.filter((r) => r.status === 'Absent').length,
      Late: base.filter((r) => r.status === 'Late').length,
      MissPunch: base.filter((r) => r.status === 'Miss Punch').length,
      OnLeave: base.filter((r) => r.status === 'On Leave').length,
      total: base.length,
    };
  }, [records, isRM, scope.userIds]);

  const formatTime = (d: any) => {
    if (!d) return '--';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (hours: number) => {
    if (!hours && hours !== 0) return '--';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Today's Attendance" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Attendance</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity key={p} style={[s.periodBtn, period === p && s.periodBtnActive]} onPress={() => setPeriod(p)}>
              <Text style={[s.periodText, period === p && s.periodTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search employees..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          {[
            { label: 'Total', value: summary.total, color: '#FF6600' },
            { label: 'Present', value: summary.Present, color: '#10b981' },
            { label: 'Absent', value: summary.Absent, color: '#ef4444' },
            { label: 'Late', value: summary.Late, color: '#eab308' },
            { label: 'Miss Punch', value: summary.MissPunch, color: '#8b5cf6' },
            { label: 'On Leave', value: summary.OnLeave, color: '#3b82f6' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {['All', 'Present', 'Absent', 'Late', 'Miss Punch', 'On Leave'].map((f) => (
            <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterText, filter === f && s.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No attendance records found</Text>
          ) : (
            paginated.map((rec) => (
              <TouchableOpacity key={rec.id} onPress={() => setDetailModal(rec)}>
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={s.empRow}>
                        <Text style={s.name}>{rec.name}</Text>
                        <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[rec.status] || '#64748b' }]} />
                      </View>
                      <Text style={s.dept}>{rec.department || rec.designation || ''}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[rec.status] || '#64748b'}20` }]}>
                      <Text style={[s.statusText, { color: STATUS_COLORS[rec.status] || '#64748b' }]}>{rec.status}</Text>
                    </View>
                  </View>
                  <View style={s.times}>
                    <View style={s.timeBlock}>
                      <Text style={s.timeLabel}>In</Text>
                      <Text style={s.timeValue}>{formatTime(rec.checkIn)}</Text>
                    </View>
                    <View style={s.timeBlock}>
                      <Text style={s.timeLabel}>Out</Text>
                      <Text style={s.timeValue}>{formatTime(rec.checkOut)}</Text>
                    </View>
                    <View style={s.timeBlock}>
                      <Text style={s.timeLabel}>Hours</Text>
                      <Text style={s.timeValue}>{formatDuration(rec.workHours)}</Text>
                    </View>
                  </View>
                  {rec.status === 'Miss Punch' && rec.missedPunchRectification?.requested && !rec.missedPunchRectification.resolved && (
                    <View style={s.rectifyRow}>
                      <Text style={s.rectifyText}>
                        Rectification requested · {Math.min(computeMissedPunchProgress(rec.missedPunchRectification), computeMissedPunchTotalTiers(rec.missedPunchRectification))}/{computeMissedPunchTotalTiers(rec.missedPunchRectification)} verified
                      </Text>
                      {(user?.role === 'master-admin' && isMissedPunchMAPending(rec)) || getMyMissedPunchTier(rec) ? (
                        <TouchableOpacity style={s.rectifyBtn} onPress={() => setMissPunchModal(rec)}>
                          <Text style={s.rectifyBtnText}>Review</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[s.rectifyBtn, { backgroundColor: '#e5e7eb' }]}>
                          <Text style={[s.rectifyBtnText, { color: '#6b7280' }]}>Awaiting Tier</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {rec.lateMinutes ? <Text style={s.lateText}>Late by {rec.lateMinutes} min</Text> : null}
                </View>
              </TouchableOpacity>
            ))
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={!!detailModal} transparent animationType="fade" onRequestClose={() => setDetailModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailModal(null)}>
          <View style={s.detailModal}>
            <Text style={s.detailName}>{detailModal?.name}</Text>
            <View style={s.detailRow}><Text style={s.detailLabel}>Status:</Text><Text style={[s.detailValue, { color: STATUS_COLORS[detailModal?.status] || '#64748b' }]}>{detailModal?.status}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Check In:</Text><Text style={s.detailValue}>{formatTime(detailModal?.checkIn)}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Check Out:</Text><Text style={s.detailValue}>{formatTime(detailModal?.checkOut)}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Work Hours:</Text><Text style={s.detailValue}>{formatDuration(detailModal?.workHours)}</Text></View>
            {detailModal?.department && <View style={s.detailRow}><Text style={s.detailLabel}>Department:</Text><Text style={s.detailValue}>{detailModal.department}</Text></View>}
            {detailModal?.lateMinutes ? <View style={s.detailRow}><Text style={s.detailLabel}>Late By:</Text><Text style={[s.detailValue, { color: '#eab308' }]}>{detailModal.lateMinutes} min</Text></View> : null}
            {detailModal?.notes ? <View style={s.detailRow}><Text style={s.detailLabel}>Notes:</Text><Text style={s.detailValue}>{detailModal.notes}</Text></View> : null}
            {/* Verification chain (Eye view) — same block as the web view modal */}
            {detailModal?.missedPunchRectification?.requested && (() => {
              const mp = detailModal.missedPunchRectification;
              const tiers = getRecordEffectiveMissedPunchTiers(mp);
              const progress = computeMissedPunchProgress(mp);
              const total = computeMissedPunchTotalTiers(mp);
              const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
              const overall = mp.status || (mp.resolved ? 'Approved' : 'Pending');
              const conf: Record<string, { bg: string; tc: string }> = {
                Approved: { bg: '#dcfce7', tc: '#16a34a' },
                Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                Pending: { bg: '#fef3c7', tc: '#b45309' },
              };
              return (
                <View style={{ marginTop: 12, padding: 10, backgroundColor: '#faf5ff', borderRadius: 8, borderWidth: 1, borderColor: '#e9d5ff' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                    <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                  </View>
                  <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 2 }} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {tiers.map((t: any) => {
                      const st = mp.approvalStatus?.[t] || 'Pending';
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
              );
            })()}
            {!detailModal?.missedPunchRectification?.requested && (
              <Text style={{ fontSize: 12, color: colors.textTertiary, fontStyle: 'italic', marginTop: 10 }}>
                No verification chain active for this record.
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!missPunchModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Rectify Miss Punch</Text>
            <Text style={s.modalSubtitle}>{missPunchModal?.name} • {missPunchModal?.date?.toDate?.().toLocaleDateString('en-IN') || ''}</Text>
            <View style={s.recTimes}>
              <Text style={s.recTimeText}>Check In: {formatTime(missPunchModal?.checkIn)}</Text>
              <Text style={s.recTimeText}>Check Out: {formatTime(missPunchModal?.checkOut)}</Text>
            </View>
            {/* Current chain state before acting */}
            {missPunchModal?.missedPunchRectification && (() => {
              const mp = missPunchModal.missedPunchRectification;
              const tiers = getRecordEffectiveMissedPunchTiers(mp);
              const progress = computeMissedPunchProgress(mp);
              const total = computeMissedPunchTotalTiers(mp);
              const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
              const conf: Record<string, { bg: string; tc: string }> = {
                Approved: { bg: '#dcfce7', tc: '#16a34a' },
                Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                Pending: { bg: '#fef3c7', tc: '#b45309' },
              };
              return (
                <View style={{ marginVertical: 8, padding: 10, backgroundColor: '#faf5ff', borderRadius: 8, borderWidth: 1, borderColor: '#e9d5ff' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                    <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                  </View>
                  <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: '#9333ea', borderRadius: 2 }} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {tiers.map((t: any) => {
                      const st = mp.approvalStatus?.[t] || 'Pending';
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
              );
            })()}
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 }}>
              Remark <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TextInput style={s.modalInput} placeholder="Mandatory remark for the audit trail" placeholderTextColor={colors.textTertiary} value={rectifyNote} onChangeText={setRectifyNote} multiline numberOfLines={3} />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.rejectConfirmBtn} onPress={() => handleRectify('Rejected')}>
                <Text style={s.rejectConfirmText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.approveConfirmBtn} onPress={() => handleRectify('Approved')}>
                <Text style={s.approveConfirmText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 13 },
  periodRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12 },
  periodBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  periodBtnActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  periodText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  periodTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statsRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 22, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  filterRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: c.textPrimary, fontSize: 16, fontWeight: '600' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dept: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  times: { flexDirection: 'row', gap: 16, marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  timeBlock: { alignItems: 'center', flex: 1 },
  timeLabel: { color: c.textTertiary, fontSize: 11, marginBottom: 2 },
  timeValue: { color: c.textPrimary, fontWeight: '600', fontSize: 14 },
  rectifyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  rectifyText: { color: '#8b5cf6', fontSize: 12, fontWeight: '600' },
  rectifyBtn: { backgroundColor: '#8b5cf620', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  rectifyBtnText: { color: '#8b5cf6', fontWeight: '600', fontSize: 12 },
  lateText: { color: '#eab308', fontSize: 11, marginTop: 4, fontWeight: '600' },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  modalSubtitle: { color: c.textSecondary, fontSize: 14, marginBottom: 16 },
  recTimes: { backgroundColor: c.background, borderRadius: 8, padding: 12, marginBottom: 16 },
  recTimeText: { color: c.textPrimary, fontSize: 13, marginBottom: 4 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 16, minHeight: 60, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  rejectConfirmBtn: { flex: 1, backgroundColor: '#ef444420', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  rejectConfirmText: { color: '#ef4444', fontWeight: 'bold', fontSize: 15 },
  approveConfirmBtn: { flex: 1, backgroundColor: '#10b98120', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  approveConfirmText: { color: '#10b981', fontWeight: 'bold', fontSize: 15 },
  detailModal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  detailName: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { color: c.textSecondary, fontSize: 14, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 2, textAlign: 'right' },
});
