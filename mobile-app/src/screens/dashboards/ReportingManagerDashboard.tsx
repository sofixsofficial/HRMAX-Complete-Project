import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useReportingTeamStats } from '../../hooks/useReportingTeamStats';
import { useReportingTeamScope } from '../../hooks/useReportingTeamScope';
import { useCompany } from '../../context/CompanyContext';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard';
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel';
import { DashboardHeader } from '../../components/DashboardHeader';
import { createLeaveRequest, calcLeaveDays, isLeaveTypePaid } from '../../services/leaveService';
import type { LeaveType } from '../../types/user';

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

const QUICK_ACTIONS = [
  { key: 'LeaveManagement', label: 'Review Leaves', icon: 'umbrella-outline', color: '#eab308' },
];

const MANAGEMENT_MODULES = [
  { key: 'LeaveManagement', label: 'Review Leaves', desc: 'Approve/reject your team\'s leaves', icon: 'umbrella-outline', color: '#eab308' },
  { key: 'HolidayCalendar', label: 'Holidays', desc: 'View holidays', icon: 'calendar-outline', color: '#FF6600' },
];

const statusColors: Record<string, string> = {
  Active: '#16a34a',
  Inactive: '#ef4444',
  'On Leave': '#f97316',
};

export const ReportingManagerDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const [refreshKey, setRefreshKey] = useState(0);
  const team = useReportingTeamStats(user?.id, effectiveCompanyId, refreshKey, user?.role);
  const scope = useReportingTeamScope(user?.id, effectiveCompanyId, true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tab, setTab] = useState<'overview' | 'my-team'>('overview');

  // Manual leave modal state
  const [leaveTarget, setLeaveTarget] = useState<any>(null);
  const [leaveType, setLeaveType] = useState<LeaveType>('Casual');
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const s = useMemo(() => createStyles(colors), [colors]);

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!team.loading) setRefreshing(false);
  }, [team.loading]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const members = scope.members || [];
  const active = members.filter((e) => e.status === 'Active').length;
  const onLeave = members.filter((e) => e.status === 'On Leave').length;
  const inactive = members.filter((e) => e.status === 'Inactive').length;

  const filtered = members.filter((e) => {
    const q = searchTerm.toLowerCase();
    return !q || (e.name || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q);
  });

  const openLeaveModal = (emp: any) => {
    setLeaveTarget(emp);
    setLeaveType('Casual');
    setLeaveStart(new Date().toISOString().split('T')[0]);
    setLeaveEnd(new Date().toISOString().split('T')[0]);
    setLeaveReason('');
  };

  const handleSubmitLeave = async () => {
    if (!leaveTarget || !user) return;
    const start = new Date(leaveStart);
    const end = new Date(leaveEnd);
    const totalDays = calcLeaveDays(start, end);
    if (totalDays <= 0) {
      setToast({ type: 'error', message: 'End date must be on or after start date.' });
      return;
    }
    setIsSubmitting(true);
    try {
      await createLeaveRequest(
        {
          userId: leaveTarget.userId || leaveTarget.id,
          employeeName: leaveTarget.name,
          employeeId: leaveTarget.employeeId,
          employeeEmail: leaveTarget.email,
          avatar: leaveTarget.avatar || '',
          department: leaveTarget.department,
          departmentId: leaveTarget.departmentId,
          companyId: leaveTarget.companyId || effectiveCompanyId || user.companyId || '',
          leaveType,
          startDate: start,
          endDate: end,
          totalDays,
          reason: leaveReason,
          isPaid: isLeaveTypePaid(leaveType),
        },
        { reportingManager: 'Approved' }
      );
      setLeaveTarget(null);
      setToast({ type: 'success', message: `Manual ${leaveType} leave submitted for ${leaveTarget.name}.` });
    } catch {
      setToast({ type: 'error', message: 'Failed to submit leave request' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canAddLeave = !!(leaveTarget && leaveType && leaveStart && leaveEnd && leaveReason);

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHeader
        name={user?.name || 'Manager'}
        roleLabel={(user as any)?.department || 'Reporting Manager'}
        subtitle={`Managing ${team.directReports} direct report${team.directReports === 1 ? '' : 's'}`}
        stats={[
          { label: 'Present', value: team.presentToday, color: '#10b981' },
          { label: 'Leaves', value: team.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: team.activeTasks, color: '#ec4899' },
          { label: 'Team', value: team.directReports, color: '#3b82f6' },
        ]}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
        {(['overview', 'my-team'] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t === 'overview' ? 'Overview' : 'My Team'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {toast && (
        <View style={[s.toast, { backgroundColor: toast.type === 'success' ? '#dcfce7' : '#fee2e2', borderColor: toast.type === 'success' ? '#bbf7d0' : '#fecaca' }]}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: toast.type === 'success' ? '#16a34a' : '#ef4444', flex: 1 }}>{toast.message}</Text>
          <TouchableOpacity onPress={() => setToast(null)}><Text style={{ fontSize: 16, color: '#666' }}>×</Text></TouchableOpacity>
        </View>
      )}

      {tab === 'overview' && (
        <>
          <View style={s.sectionHeader}>
            <Icon name="people-outline" size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>Direct Reporting Overview</Text>
          </View>
          <MissedPunchAlertCard
            count={team.missPunchPending}
            label="Missed Punch / Attendance Alert"
            onPress={() => navigation?.navigate('AttendanceOverview', { status: 'Miss Punch' })}
          />
          {/* Leave queue: Eye view + Approve/Reject at this role's tier (matches web) */}
          <LeaveApprovalsPanel />
          <StatsGrid>
            <StatCard label="Team Members" value={team.directReports} icon="people-outline" color="#3b82f6" onClick={() => setTab('my-team')} />
            <StatCard label="Active" value={active} icon="checkmark-circle-outline" color="#10b981" onClick={() => setTab('my-team')} />
            <StatCard label="On Leave" value={onLeave} icon="umbrella-outline" color="#f97316" onClick={() => setTab('my-team')} />
            <StatCard label="Pending Leave Approvals" value={team.pendingLeaves} icon="time-outline" color="#eab308" onClick={() => navigation?.navigate('LeaveManagement')} />
          </StatsGrid>

          <View style={s.sectionHeader}>
            <Icon name="flash-outline" size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>Quick Actions</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
            {QUICK_ACTIONS.map((q) => (
              <TouchableOpacity key={q.key} style={[s.quickCard, { backgroundColor: `${q.color}10` }]} onPress={() => navigation?.navigate(q.key)}>
                <Icon name={q.icon} size={20} color={q.color} />
                <Text style={[s.quickLabel, { color: q.color }]}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {tab === 'my-team' && (
        <>
          <View style={s.sectionHeader}>
            <Icon name="people-outline" size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>My Team</Text>
          </View>
          <View style={s.searchBox}>
            <Icon name="search-outline" size={16} color={colors.textTertiary} />
            <TextInput
              placeholder="Search team..."
              placeholderTextColor={colors.textTertiary}
              value={searchTerm}
              onChangeText={setSearchTerm}
              style={[s.searchInput, { color: colors.text }]}
            />
          </View>
          {scope.loading ? (
            <View style={s.feedLoading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={s.feedLoadingText}>Loading your team...</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={s.feedEmpty}>
              <Icon name="people-outline" size={28} color={colors.textTertiary} />
              <Text style={s.feedEmptyText}>No team members found.</Text>
            </View>
          ) : (
            <View style={s.teamList}>
              {filtered.map((emp) => {
                const sc = statusColors[emp.status] || '#6b7280';
                return (
                  <View key={emp.id} style={s.teamItem}>
                    <View style={[s.avatarCircle, { backgroundColor: `${sc}20` }]}>
                      <Text style={[s.avatarText, { color: sc }]}>{(emp.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.teamName} numberOfLines={1}>{emp.name}</Text>
                      <Text style={s.teamSub} numberOfLines={1}>
                        {emp.department ? `${emp.department}${emp.designation ? ' · ' : ''}` : ''}{emp.designation || ''}
                      </Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${sc}15` }]}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: sc }}>{emp.status || 'Active'}</Text>
                    </View>
                    <TouchableOpacity style={s.addLeaveBtn} onPress={() => openLeaveModal(emp)}>
                      <Icon name="add-outline" size={16} color="#2563eb" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      {tab === 'overview' && (
        <>
          <View style={s.sectionHeader}>
            <Icon name="grid-outline" size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>Management</Text>
          </View>
          <View style={s.moduleGrid}>
            {MANAGEMENT_MODULES.map((mod) => (
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
        </>
      )}

      <View style={{ height: 24 }} />

      <Modal visible={!!leaveTarget} transparent animationType="fade" onRequestClose={() => setLeaveTarget(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>Manual Leave — {leaveTarget?.name || ''}</Text>
              <TouchableOpacity onPress={() => setLeaveTarget(null)}><Icon name="close-outline" size={20} color={colors.textSecondary} /></TouchableOpacity>
            </View>

            <View style={[s.bypassNote, { backgroundColor: colors.accentBg }]}>
              <Text style={{ fontSize: 12, color: colors.accent, lineHeight: 18 }}>
                Bypass Notice: Tier 1 (Reporting Manager) will be auto-approved. This leave goes directly to Company Admin for approval.
              </Text>
            </View>

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Leave Type *</Text>
            <View style={s.leaveTypeRow}>
              {LEAVE_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setLeaveType(t)}
                  style={[s.leaveTypeChip, leaveType === t && s.leaveTypeChipActive]}
                >
                  <Text style={{ fontSize: 11, fontWeight: '600', color: leaveType === t ? '#fff' : colors.textSecondary }}>
                    {t}{isLeaveTypePaid(t) ? ' (Paid)' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.modalRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Start Date *</Text>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  value={leaveStart}
                  onChangeText={setLeaveStart}
                  style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={[s.inputLabel, { color: colors.textSecondary }]}>End Date *</Text>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  value={leaveEnd}
                  onChangeText={setLeaveEnd}
                  style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
            </View>

            {leaveStart && leaveEnd && (
              <View style={[s.daysNote, { backgroundColor: colors.surface }]}>
                <Text style={{ fontSize: 13, color: colors.text }}>
                  Total Days: <Text style={{ fontWeight: '700' }}>{calcLeaveDays(new Date(leaveStart), new Date(leaveEnd))}</Text>
                </Text>
              </View>
            )}

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Reason *</Text>
            <TextInput
              placeholder="Reason for leave..."
              placeholderTextColor={colors.textTertiary}
              value={leaveReason}
              onChangeText={setLeaveReason}
              multiline
              style={[s.input, s.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            <View style={s.modalFooter}>
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.surface }]} onPress={() => setLeaveTarget(null)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: canAddLeave && !isSubmitting ? '#FF6600' : colors.border }]}
                onPress={handleSubmitLeave}
                disabled={!canAddLeave || isSubmitting}
              >
                {isSubmitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Submit Manual Leave</Text>}
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
  tabRow: { flexDirection: 'row' as const, paddingHorizontal: 16, gap: 10, paddingTop: 14 },
  tab: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  tabActive: { backgroundColor: c.accent, borderColor: c.accent },
  tabText: { fontSize: 13, fontWeight: '600' as const, color: '#1F2937' },
  tabTextActive: { color: '#fff' },
  toast: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, flexDirection: 'row' as const, alignItems: 'center', gap: 8 },
  searchBox: {
    marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, backgroundColor: c.card,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0 },
  feedLoading: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  feedLoadingText: { fontSize: 13, color: c.textSecondary },
  feedEmpty: { alignItems: 'center', paddingVertical: 28, gap: 8, paddingHorizontal: 20 },
  feedEmptyText: { fontSize: 13, color: c.textTertiary, textAlign: 'center' },
  teamList: { paddingHorizontal: 16, gap: 10 },
  teamItem: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 10,
    backgroundColor: c.card, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: c.borderLight,
  },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700' as const },
  teamName: { fontSize: 14, fontWeight: '600' as const, color: c.text },
  teamSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  addLeaveBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 16, padding: 18 },
  modalHeader: { flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 16, fontWeight: '700' as const, flex: 1, marginRight: 10 },
  bypassNote: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, marginBottom: 4 },
  leaveTypeRow: { flexDirection: 'row' as const, flexWrap: 'wrap', gap: 6 },
  leaveTypeChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.background,
  },
  leaveTypeChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  inputLabel: { fontSize: 12, fontWeight: '600' as const, marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' as const },
  modalRow: { flexDirection: 'row' as const, marginTop: 4 },
  daysNote: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, marginTop: 10 },
  modalFooter: { flexDirection: 'row' as const, gap: 10, marginTop: 18 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
  sectionHeader: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const, color: c.text },
  quickRow: { paddingLeft: 20, marginBottom: 4 },
  quickCard: {
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 10,
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  quickLabel: { fontSize: 13, fontWeight: '600' as const },
  statsGrid: { paddingHorizontal: 16, gap: 12 },
  moduleGrid: { paddingHorizontal: 16, gap: 8 },
  moduleCard: {
    flexDirection: 'row' as const, alignItems: 'center',
    backgroundColor: c.card, padding: 14,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  moduleIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  moduleInfo: { flex: 1, marginLeft: 12 },
  moduleLabel: { fontSize: 14, fontWeight: '600' as const, color: c.text },
  moduleDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
});
