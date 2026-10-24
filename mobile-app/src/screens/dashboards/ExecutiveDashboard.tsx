import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { collection, query, where, onSnapshot } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { DashboardHero } from '../../components/DashboardHero';
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel';

const QUICK_ACTIONS = [
  { key: 'ExecutiveCompanies', label: 'My Companies', icon: 'business-outline', color: '#FF6600', perm: '' },
  { key: 'ExecutiveTeamLeaders', label: 'My Team Leaders', icon: 'people-outline', color: '#06b6d4', perm: '' },
  { key: 'LeaveManagement', label: 'Approve Leaves', icon: 'umbrella-outline', color: '#eab308', perm: 'leave.view' },
  { key: 'AttendanceOverview', label: "Today's Attendance", icon: 'clipboard-outline', color: '#06b6d4', perm: 'attendance.view' },
  { key: 'TaskManagement', label: 'Assign Tasks', icon: 'document-text-outline', color: '#ec4899', perm: 'tasks.view' },
  { key: 'Employees', label: 'Employees', icon: 'people-outline', color: '#3b82f6', perm: 'employees.view' },
  { key: 'AuditLogs', label: 'Audit Activity', icon: 'document-text-outline', color: '#64748b', perm: '' },
];

const MANAGEMENT_MODULES = [
  { key: 'Employees', label: 'Employees', desc: 'Manage employees', icon: 'people-outline', color: '#3b82f6', perm: 'employees.view' },
  { key: 'Departments', label: 'Departments', desc: 'Manage departments', icon: 'business-outline', color: '#10b981', perm: 'departments.view' },
  { key: 'LeaveManagement', label: 'Leave Mgmt', desc: 'Approve/reject leaves', icon: 'umbrella-outline', color: '#eab308', perm: 'leave.view' },
  { key: 'AttendanceOverview', label: 'Attendance', desc: "Today's attendance", icon: 'clipboard-outline', color: '#06b6d4', perm: 'attendance.view' },
  { key: 'TaskManagement', label: 'Task Mgmt', desc: 'Create & assign tasks', icon: 'document-text-outline', color: '#ec4899', perm: 'tasks.view' },
  { key: 'HolidayCalendar', label: 'Holidays', desc: 'Manage holidays', icon: 'calendar-outline', color: '#FF6600', perm: 'holidays.view' },
  { key: 'Assets', label: 'Assets', desc: 'Manage assets', icon: 'laptop-outline', color: '#10b981', perm: '' },
];

export const ExecutiveDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, hasPermission } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, selectedCompanyName, availableCompanies, setSelectedCompanyId } = useCompany();
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewAll, setViewAll] = useState(true);
  // All → every authorized company · specific chip → just it (never unfiltered).
  // Memoized so the array identity is stable across renders (useDashboardStats
  // subscribes/unsubscribes on scope change — an unmemoized array here caused an
  // infinite subscribe → setState → render → resubscribe loop).
  const statsScope = useMemo(
    () => (viewAll || !effectiveCompanyId
      ? availableCompanies.map((c) => c.id)
      : effectiveCompanyId),
    [viewAll, effectiveCompanyId, availableCompanies]
  );
  const { loading, ...stats } = useDashboardStats(statsScope, refreshKey);
  const [refreshing, setRefreshing] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [reportingTLCount, setReportingTLCount] = useState(0);
  const s = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    const myCompanySet = new Set<string>(user?.assignedCompanyIds || []);
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => {
      setReportingTLCount(snap.docs.filter((d) => {
        const data = d.data();
        const linked = data.linkedExecutiveIds || (data.reportingExecutiveId ? [data.reportingExecutiveId] : []);
        return linked.includes(user?.id);
      }).length);
    }, () => {});
    // Peer executives: only those mapped to (at least one of) this user's companies.
    const qEx = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubEx = onSnapshot(qEx, (snap) => {
      const count = snap.docs.filter((d) => {
        const assigned: string[] = d.data().assignedCompanyIds || [];
        return assigned.some((cid) => myCompanySet.has(cid));
      }).length;
      setPeerCount(count);
    }, () => {});
    return () => { unsubTL(); unsubEx(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const companiesAssigned = user?.assignedCompanyIds?.length || availableCompanies.length;

  const goTo = (screen: string, params: Record<string, any> = {}) => {
    navigation?.navigate(screen, params);
  };

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  const noCompanies = availableCompanies.length === 0;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHero
        name={user?.name || 'Executive'}
        roleLabel="Executive"
        subtitle={noCompanies
          ? "You don't have any companies assigned to your account."
          : "Here's an overview of your assigned companies today."}
        stats={[
          { label: 'Present', value: stats.presentToday, color: '#10b981' },
          { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
          { label: 'Leaves', value: stats.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
        ]}
      />

      {noCompanies && (
        <View style={s.zeroState}>
          <Icon name="business-outline" size={40} color={colors.textTertiary} />
          <Text style={s.zeroTitle}>No Company Assigned</Text>
          <Text style={s.zeroText}>You don't have any companies assigned to your account. Contact your administrator to get access.</Text>
        </View>
      )}

      <View style={s.sectionHeader}>
        <Icon name="people-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Executive Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Peer Executives" value={peerCount} icon="ribbon-outline" color="#8b5cf6" onClick={() => goTo('Executives')} />
        <StatCard label="Companies Assigned" value={viewAll ? companiesAssigned : 1} icon="business-outline" color="#FF6600" onClick={() => goTo('ExecutiveCompanies')} />
        <StatCard label="Team Leaders Reporting" value={reportingTLCount} icon="people-outline" color="#06b6d4" onClick={() => goTo('ExecutiveTeamLeaders')} />
        <StatCard label="Departments" value={stats.activeDepartments} icon="git-network-outline" color="#10b981" onClick={() => goTo('Departments')} />
      </StatsGrid>

      {availableCompanies.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TouchableOpacity
            onPress={() => { setViewAll(true); setSelectedCompanyId(''); }}
            style={[s.chip, { backgroundColor: viewAll ? colors.accent : '#F3F4F6' }]}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: viewAll ? '#fff' : '#1F2937' }}>All Companies</Text>
          </TouchableOpacity>
          {availableCompanies.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => { setViewAll(false); setSelectedCompanyId(c.id); }}
              style={[s.chip, { backgroundColor: !viewAll && c.id === effectiveCompanyId ? colors.accent : '#F3F4F6' }]}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: !viewAll && c.id === effectiveCompanyId ? '#fff' : '#1F2937' }}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={s.sectionHeader}>
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Actions</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
        {QUICK_ACTIONS.filter((q) => !q.perm || hasPermission(q.perm)).map((q) => (
          <TouchableOpacity key={q.key} style={[s.quickCard, { backgroundColor: `${q.color}10` }]} onPress={() => navigation?.navigate(q.key)}>
            <Icon name={q.icon} size={20} color={q.color} />
            <Text style={[s.quickLabel, { color: q.color }]}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.sectionHeader}>
        <Icon name="stats-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Employees" value={stats.totalEmployees} icon="people-outline" color="#3b82f6" onClick={() => goTo('Employees')} />
        <StatCard label="Active" value={stats.activeEmployees} icon="checkmark-circle-outline" color="#10b981" onClick={() => goTo('Employees', { status: 'Active' })} />
        <StatCard label="Inactive" value={stats.inactiveEmployees} icon="close-circle-outline" color="#ef4444" onClick={() => goTo('Employees', { status: 'Inactive' })} />
        <StatCard label="Present" value={stats.presentToday} icon="checkmark-circle-outline" color="#10b981" onClick={() => goTo('AttendanceOverview', { status: 'Present' })} />
        <StatCard label="Absent" value={stats.absentToday} icon="close-circle-outline" color="#dc2626" onClick={() => goTo('AttendanceOverview', { status: 'Absent' })} />
        <StatCard label="Late" value={stats.lateToday} icon="time-outline" color="#eab308" onClick={() => goTo('AttendanceOverview', { status: 'Late' })} />
        <StatCard label="On Leave" value={stats.onLeaveToday} icon="umbrella-outline" color="#3b82f6" onClick={() => goTo('Employees', { status: 'On Leave' })} />
        <StatCard label="Miss Punch" value={stats.missPunchToday} icon="alert-circle-outline" color="#8b5cf6" onClick={() => goTo('AttendanceOverview', { status: 'Miss Punch' })} />
        <StatCard label="Approved Att." value={stats.approvedAttendanceToday} icon="checkmark-done-outline" color="#10b981" onClick={() => goTo('AttendanceOverview', { status: 'Approved' })} />
        <StatCard label="Attendance Rate" value={stats.attendanceRate === null ? '—' : `${stats.attendanceRate}%`} icon="pie-chart-outline" color="#10b981" onClick={() => goTo('AttendanceOverview')} />
        <StatCard label="Task Status" value={`${stats.completedTasks}/${stats.pendingTasks + stats.completedTasks}`} icon="checkmark-done-outline" color="#ec4899" onClick={() => goTo('TaskManagement')} />
      </StatsGrid>

      {/* Leave queue: Eye view + Approve/Reject at this role's tier (matches web) */}
      <LeaveApprovalsPanel />

      <View style={s.sectionHeader}>
        <Icon name="clipboard-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Summary</Text>
      </View>
      <StatsGrid>
        <StatCard label="Pending Leaves" value={stats.pendingLeaves} icon="umbrella-outline" color="#eab308" onClick={() => goTo('LeaveManagement', { status: 'Pending' })} />
        <StatCard label="Total Leaves" value={stats.totalLeaveRequests} icon="document-text-outline" color="#3b82f6" onClick={() => goTo('LeaveManagement', { status: 'All' })} />
        <StatCard label="Approved Leaves" value={stats.approvedLeaves} icon="checkmark-circle-outline" color="#10b981" onClick={() => goTo('LeaveManagement', { status: 'Approved' })} />
        <StatCard label="Rejected Leaves" value={stats.rejectedLeaves} icon="close-circle-outline" color="#dc2626" onClick={() => goTo('LeaveManagement', { status: 'Rejected' })} />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon="checkmark-circle-outline" color="#ec4899" onClick={() => goTo('TaskManagement', { status: 'Pending' })} />
        <StatCard label="Departments" value={stats.activeDepartments} icon="business-outline" color="#06b6d4" onClick={() => goTo('Departments')} />
        <StatCard label="Upcoming Holidays" value={stats.upcomingHolidays} icon="calendar-outline" color="#FF6600" onClick={() => goTo('HolidayCalendar')} />
        <StatCard label="Announcements" value={stats.totalAnnouncements} icon="megaphone-outline" color="#8b5cf6" onClick={() => goTo('Notifications')} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="grid-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Management</Text>
      </View>
      <View style={s.moduleGrid}>
        {MANAGEMENT_MODULES.filter((mod) => !mod.perm || hasPermission(mod.perm)).map((mod) => (
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
    </ScrollView>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  zeroState: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 32, gap: 10 },
  zeroTitle: { fontSize: 17, fontWeight: '700' as const, color: c.text },
  zeroText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
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
