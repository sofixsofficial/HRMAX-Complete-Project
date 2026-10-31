import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, Platform } from 'react-native';
import { collection, query, where, onSnapshot } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { DashboardHero } from '../../components/DashboardHero';
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel';
import { subscribeToAdminAlerts, markAdminAlertAsRead, markAllAdminAlertsAsRead } from '../../services/notificationService';

const linkToScreen = (link?: string): string | undefined => {
  if (!link) return undefined;
  const map: Record<string, string> = {
    '/leaves': 'LeaveManagement',
    '/leaves?status=Pending': 'LeaveManagement',
    '/employees': 'Employees',
    '/company-admin-approvals': 'CompanyApprovals',
    '/company-admin-approvals?status=Pending': 'CompanyApprovals',
    '/companies': 'Companies',
    '/tasks': 'TaskManagement',
    '/attendance': 'AttendanceOverview',
    '/holidays': 'HolidayCalendar',
    '/birthdays': 'Birthdays',
    '/executives': 'Executives',
    '/team-leaders': 'TeamLeaders',
    '/payroll': 'RunPayroll',
    '/salary-slips': 'SalarySlips',
    '/departments': 'Departments',
    '/announcements': 'Announcements',
    '/assets': 'Assets',
    '/reports': 'Reports',
    '/notifications': 'Notifications',
  };
  return map[link] || undefined;
};

interface HubModule {
  key: string;
  label: string;
  desc: string;
  icon: string;
  color: string;
}

interface HubSection {
  title: string;
  icon: string;
  modules: HubModule[];
}

const HUB_SECTIONS: HubSection[] = [
  {
    title: 'Organization',
    icon: 'business-outline',
    modules: [
      { key: 'Companies', label: 'Companies', desc: 'Add & configure companies, PAN/GST, locations', icon: 'business-outline', color: '#FF6600' },
      { key: 'Departments', label: 'Departments', desc: 'Create departments & assign managers', icon: 'git-network-outline', color: '#10b981' },
      { key: 'AccessManagement', label: 'Access Management', desc: 'Roles, permissions & access control', icon: 'lock-closed-outline', color: '#64748b' },
    ],
  },
  {
    title: 'People',
    icon: 'people-outline',
    modules: [
      { key: 'Employees', label: 'Employees', desc: 'Add employees, salary & documents', icon: 'people-outline', color: '#3b82f6' },
      { key: 'Executives', label: 'Executives', desc: 'Top-level executives & permissions', icon: 'ribbon-outline', color: '#8b5cf6' },
      { key: 'TeamLeaders', label: 'Team Leaders', desc: 'Create & link team leaders', icon: 'person-add-outline', color: '#06b6d4' },
    ],
  },
  {
    title: 'Operations',
    icon: 'clipboard-outline',
    modules: [
      { key: 'AttendanceOverview', label: 'Attendance', desc: 'Geofencing, selfie check-ins, logs', icon: 'clipboard-outline', color: '#06b6d4' },
      { key: 'LeaveManagement', label: 'Leaves', desc: 'View, approve or reject leave requests', icon: 'umbrella-outline', color: '#eab308' },
    ],
  },
  {
    title: 'Payroll & Finance',
    icon: 'wallet-outline',
    modules: [
      { key: 'RunPayroll', label: 'Run Payroll', desc: 'Salary calculations & disbursements', icon: 'calculator-outline', color: '#8b5cf6' },
      { key: 'PayrollHistory', label: 'Payroll History', desc: 'Past payroll runs & payment logs', icon: 'time-outline', color: '#FF6600' },
      { key: 'SalarySlips', label: 'Salary Slips', desc: 'Generate & share salary slips', icon: 'document-text-outline', color: '#10b981' },
    ],
  },
  {
    title: 'Tasks & Time Off',
    icon: 'checkmark-circle-outline',
    modules: [
      { key: 'TaskManagement', label: 'Tasks', desc: 'Assign & track org-wide tasks', icon: 'checkmark-circle-outline', color: '#ec4899' },
      { key: 'HolidayCalendar', label: 'Holidays', desc: 'Company holiday calendar', icon: 'calendar-outline', color: '#FF6600' },
      { key: 'Birthdays', label: 'Birthdays', desc: 'Upcoming employee birthdays', icon: 'gift-outline', color: '#eab308' },
    ],
  },
  {
    title: 'Resources & Communication',
    icon: 'chatbubbles-outline',
    modules: [
      { key: 'AddressBook', label: 'Address Book', desc: 'Internal contacts directory', icon: 'book-outline', color: '#3b82f6' },
      { key: 'EmailCenter', label: 'Emails', desc: 'Official email notifications & broadcasts', icon: 'mail-outline', color: '#ef4444' },
      { key: 'Announcements', label: 'Announcements', desc: 'Publish company announcements', icon: 'megaphone-outline', color: '#FF6600' },
      { key: 'CalendarCenter', label: 'Calendar', desc: 'Organization events & schedules', icon: 'calendar-outline', color: '#8b5cf6' },
    ],
  },
  {
    title: 'Analytics & Administration',
    icon: 'stats-chart-outline',
    modules: [
      { key: 'Reports', label: 'Reports', desc: 'Analytics & performance reports', icon: 'bar-chart-outline', color: '#10b981' },
      { key: 'ExecutiveOversight', label: 'Executive Oversight', desc: 'Monitor executive activity', icon: 'eye-outline', color: '#8b5cf6' },
      { key: 'DocumentsManagement', label: 'Document Management', desc: 'Legal & agreement documents', icon: 'folder-outline', color: '#FF6600' },
      { key: 'TransferManagement', label: 'Transfer Management', desc: 'Employee & department transfers', icon: 'swap-horizontal-outline', color: '#06b6d4' },
      { key: 'AuditLogs', label: 'Audit Logs', desc: 'Security & system audit logs', icon: 'document-text-outline', color: '#64748b' },
      { key: 'Settings', label: 'Settings', desc: 'System configuration', icon: 'settings-outline', color: '#3b82f6' },
      { key: 'Support', label: 'Support', desc: 'Support tickets & resolution', icon: 'headset-outline', color: '#eab308' },
    ],
  },
];

const QUICK_ACTIONS = [
  { key: 'Employees', label: 'Add Employee', icon: 'person-add-outline', color: '#FF6600', params: { action: 'create' } },
  { key: 'Companies', label: 'Companies', icon: 'business-outline', color: '#FF6600' },
  { key: 'Departments', label: 'Departments', icon: 'git-network-outline', color: '#10b981' },
  { key: 'AuditLogs', label: 'Audit Logs', icon: 'document-text-outline', color: '#64748b' },
  { key: 'Settings', label: 'Global Settings', icon: 'settings-outline', color: '#3b82f6' },
  { key: 'LeaveManagement', label: 'Approve Leaves', icon: 'umbrella-outline', color: '#eab308' },
  { key: 'AttendanceOverview', label: "Today's Attendance", icon: 'clipboard-outline', color: '#06b6d4' },
  { key: 'CompanyApprovals', label: 'Pending Approvals', icon: 'checkmark-circle-outline', color: '#8b5cf6' },
  { key: 'TaskManagement', label: 'Manage Tasks', icon: 'document-text-outline', color: '#ec4899' },
  { key: 'RunPayroll', label: 'Run Payroll', icon: 'calculator-outline', color: '#8b5cf6' },
  { key: 'Executives', label: 'Executives', icon: 'ribbon-outline', color: '#8b5cf6' },
  { key: 'TeamLeaders', label: 'Team Leaders', icon: 'people-outline', color: '#06b6d4' },
];

export const MasterAdminDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const { loading, ...stats } = useDashboardStats(null, refreshKey);
  const [refreshing, setRefreshing] = useState(false);
  const [companyCounts, setCompanyCounts] = useState({ active: 0, inactive: 0 });
  const [adminAlerts, setAdminAlerts] = useState<any[]>([]);
  const [pendingAdminApprovals, setPendingAdminApprovals] = useState(0);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [hFilterCompany, setHFilterCompany] = useState('');
  const [hFilterExecutive, setHFilterExecutive] = useState('');
  const [hFilterTL, setHFilterTL] = useState('');
  const s = useMemo(() => createStyles(colors), [colors]);

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  // Quick Actions is a horizontal row. Touch devices swipe it natively, but a
  // desktop mouse wheel only produces vertical deltas — bridge them to
  // horizontal scrolling on web so the row actually scrolls in the browser.
  const quickRowRef = React.useRef<ScrollView>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node: any = (quickRowRef.current as any)?.getScrollableNode?.();
    if (!node || typeof node.addEventListener !== 'function') return;
    const onWheel = (e: { deltaY: number; deltaX: number; preventDefault: () => void }) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // native horizontal gesture
      const max = node.scrollWidth - node.clientWidth;
      if (max <= 0) return;
      const next = node.scrollLeft + e.deltaY;
      if (next < 0 || next > max) return; // at the ends, let the page scroll
      e.preventDefault();
      node.scrollLeft = next;
    };
    node.addEventListener('wheel', onWheel, { passive: false } as any);
    return () => node.removeEventListener('wheel', onWheel as any);
  }, []);

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  useEffect(() => {
    const unsubCompanies = onSnapshot(
      collection(db, 'companies'),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllCompanies(docs);
        setCompanyCounts({
          active: docs.filter((c: any) => c.status === 'Active').length,
          inactive: docs.filter((c: any) => c.status !== 'Active').length,
        });
      },
      () => {}
    );
    return () => { unsubCompanies(); };
  }, []);

  useEffect(() => {
    const unsubAlerts = subscribeToAdminAlerts((alerts) => setAdminAlerts(alerts.slice(0, 8)));
    return unsubAlerts;
  }, []);

  useEffect(() => {
    const unsubAdmins = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'company-admin')),
      (snap) => {
        setPendingAdminApprovals(snap.docs.filter((d) => {
          const data = d.data();
          return data.status === 'Pending' || data.isApproved === false;
        }).length);
      },
      () => {}
    );
    return () => { unsubAdmins(); };
  }, []);

  useEffect(() => {
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => { unsubUsers(); };
  }, []);

  const handleAlertClick = async (a: any) => {
    if (!a.read) await markAdminAlertAsRead(a.id);
    const screen = linkToScreen(a.link);
    if (screen) navigation?.navigate(screen);
  };

  const handleMarkAllAlertsRead = async () => {
    await markAllAdminAlertsAsRead();
    Alert.alert('Admin Alerts', 'All alerts marked as read.');
  };

  const executives = allUsers.filter((u) => u.role === 'executive' && u.isActive !== false);
  const teamLeaders = allUsers.filter((u) => u.role === 'team-leader' && u.isActive !== false);

  const hierarchy = allCompanies
    .map((comp) => ({
      company: comp,
      executives: executives
        .filter((e) => (e.assignedCompanyIds || []).includes(comp.id))
        .map((exec) => ({
          executive: exec,
          teamLeaders: teamLeaders.filter((tl) => {
            const linked = tl.linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
            return linked.includes(exec.id);
          }),
        })),
    }))
    .filter((h) => h.executives.length > 0);

  const filteredHierarchy = hierarchy.filter((h) => {
    if (hFilterCompany && h.company.id !== hFilterCompany) return false;
    if (hFilterExecutive && !h.executives.some((e) => e.executive.id === hFilterExecutive)) return false;
    if (hFilterTL && !h.executives.some((e) => e.teamLeaders.some((tl) => tl.id === hFilterTL))) return false;
    return true;
  });

  const unreadAlerts = adminAlerts.filter((a) => !a.read).length;

  if (loading && !refreshing) return <DashboardSkeleton />;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHero
        name={user?.name || 'Master Admin'}
        roleLabel="Master Admin"
        subtitle="Here's what's happening across your organisation today."
        showAttendance={false}
        stats={[
          { label: 'Present', value: stats.presentToday, color: '#10b981' },
          { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
          { label: 'Leaves', value: stats.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
        ]}
      />

      {adminAlerts.length > 0 && (
        <View style={s.alertsSection}>
          <View style={s.alertsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="notifications-outline" size={16} color="#f97316" />
              <Text style={s.sectionTitle}>Admin Alerts</Text>
              {unreadAlerts > 0 && (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadBadgeText}>{unreadAlerts}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={handleMarkAllAlertsRead} style={s.markAllBtn}>
              <Icon name="checkmark-done-outline" size={14} color="#f97316" />
              <Text style={s.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          </View>
          <View style={s.alertsList}>
            {adminAlerts.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[s.alertItem, a.read && s.alertItemRead, a.priority === 'high' && s.alertItemHigh]}
                onPress={() => handleAlertClick(a)}
              >
                <View style={s.alertInfo}>
                  <Text style={[s.alertTitle, !a.read && s.alertTitleUnread]} numberOfLines={1}>{a.title}</Text>
                  <Text style={s.alertBody} numberOfLines={1}>{a.body}</Text>
                </View>
                <Text style={s.alertDate}>
                  {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString() : new Date(a.createdAt || Date.now()).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={s.sectionHeader}>
        <Icon name="stats-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Global Metrics</Text>
      </View>
      <StatsGrid>
        <StatCard label="Companies" value={stats.totalCompanies} icon="business-outline" color="#FF6600" onClick={() => navigation?.navigate('Companies')} />
        <StatCard label="Employees" value={stats.totalEmployees} icon="people-outline" color="#3b82f6" onClick={() => navigation?.navigate('Employees')} />
        <StatCard label="Executives" value={executives.length} icon="ribbon-outline" color="#8b5cf6" onClick={() => navigation?.navigate('Executives')} />
        <StatCard label="Team Leaders" value={teamLeaders.length} icon="person-add-outline" color="#06b6d4" onClick={() => navigation?.navigate('TeamLeaders')} />
      </StatsGrid>
      <Text style={s.breakdownText}>
        {companyCounts.active} Active · {companyCounts.inactive} Inactive/Suspended companies
      </Text>

      <View style={s.sectionHeader}>
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Actions</Text>
      </View>
      <ScrollView ref={quickRowRef} horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
        {QUICK_ACTIONS.map((q) => (
          <TouchableOpacity key={q.key} style={[s.quickCard, { backgroundColor: `${q.color}10` }]} onPress={() => navigation?.navigate(q.key, q.params)}>
            <Icon name={q.icon} size={20} color={q.color} />
            <Text style={[s.quickLabel, { color: q.color }]}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.sectionHeader}>
        <Icon name="business-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Organization Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Active Companies" value={companyCounts.active} icon="checkmark-circle-outline" color="#10b981" onClick={() => navigation?.navigate('Companies')} />
        <StatCard label="Inactive/Suspended" value={companyCounts.inactive} icon="alert-circle-outline" color="#dc2626" onClick={() => navigation?.navigate('Companies')} />
        <StatCard label="Departments" value={stats.activeDepartments} icon="git-network-outline" color="#06b6d4" onClick={() => navigation?.navigate('Departments')} />
        <StatCard label="Active Employees" value={stats.activeEmployees} icon="people-outline" color="#3b82f6" onClick={() => navigation?.navigate('Employees')} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="alert-circle-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>People & Approvals</Text>
      </View>
      <StatsGrid>
        <StatCard label="Pending Admin Approvals" value={pendingAdminApprovals} icon="checkmark-circle-outline" color="#8b5cf6" onClick={() => navigation?.navigate('CompanyApprovals')} />
        <StatCard label="Inactive Employees" value={stats.inactiveEmployees} icon="close-circle-outline" color="#ef4444" onClick={() => navigation?.navigate('Employees')} />
        <StatCard label="Today's Birthdays" value={stats.todayBirthdays} icon="gift-outline" color="#ec4899" onClick={() => navigation?.navigate('Birthdays')} />
        <StatCard label="Miss Punch Today" value={stats.missPunchToday} icon="time-outline" color="#eab308" onClick={() => navigation?.navigate('AttendanceOverview')} />
      </StatsGrid>

      {/* Final-gate queue: leaves + missed punches awaiting Master Admin (matches web) */}
      <LeaveApprovalsPanel mode="masterAdmin" />

      <View style={s.sectionHeader}>
        <Icon name="calendar-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Today's Operations</Text>
      </View>
      <StatsGrid>
        <StatCard label="Present" value={stats.presentToday} icon="checkmark-circle-outline" color="#10b981" />
        <StatCard label="Absent" value={stats.absentToday} icon="close-circle-outline" color="#dc2626" />
        <StatCard label="Pending Leaves" value={stats.pendingLeaves} icon="umbrella-outline" color="#eab308" onClick={() => navigation?.navigate('LeaveManagement')} />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon="checkmark-circle-outline" color="#ec4899" onClick={() => navigation?.navigate('TaskManagement')} />
      </StatsGrid>

      {HUB_SECTIONS.map((section) => (
        <View key={section.title}>
          <View style={s.sectionHeader}>
            <Icon name={section.icon} size={16} color={colors.accent} />
            <Text style={s.sectionTitle}>{section.title}</Text>
          </View>
          <View style={s.moduleGrid}>
            {section.modules.map((mod) => (
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
        </View>
      ))}

      <View style={s.sectionHeader}>
        <Icon name="git-network-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Hierarchy Matrix</Text>
      </View>
      <View style={s.hFilterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {[
            { label: 'All Companies', value: '', set: setHFilterCompany, active: hFilterCompany },
            ...allCompanies.map((c) => ({ label: c.name, value: c.id, set: setHFilterCompany, active: hFilterCompany })),
          ].map((f, i) => (
            <TouchableOpacity
              key={`hc-${i}`}
              style={[s.hChip, f.active === f.value && s.hChipActive]}
              onPress={() => { setHFilterExecutive(''); setHFilterTL(''); f.set(f.active === f.value ? '' : f.value); }}
            >
              <Text style={[s.hChipText, f.active === f.value && s.hChipTextActive]} numberOfLines={1}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {filteredHierarchy.length === 0 ? (
        <View style={s.hEmpty}>
          <Icon name="git-network-outline" size={28} color={colors.textTertiary} />
          <Text style={s.hEmptyText}>No hierarchy relationships found for the selected filters.</Text>
        </View>
      ) : (
        filteredHierarchy.map((h) => (
          <View key={h.company.id} style={s.hCompanyCard}>
            <View style={s.hCompanyHead}>
              <Icon name="business-outline" size={15} color="#FF6600" />
              <Text style={s.hCompanyName} numberOfLines={1}>{h.company.name}</Text>
              <Text style={s.hCompanyCount}>{h.executives.length} exec{h.executives.length !== 1 ? 's' : ''}</Text>
            </View>
            {h.executives.map(({ executive: exec, teamLeaders: tls }) => (
              <View key={exec.id} style={s.hExecBlock}>
                <View style={s.hExecRow}>
                  <Icon name="ribbon-outline" size={14} color="#8b5cf6" />
                  <Text style={s.hExecName} numberOfLines={1}>{exec.name}</Text>
                  <Text style={s.hExecTitle} numberOfLines={1}>{exec.executiveTitle || 'Executive'}</Text>
                  <Text style={s.hExecCount}>{tls.length} TL{tls.length !== 1 ? 's' : ''}</Text>
                </View>
                {tls.length > 0 ? tls.map((tl: any) => (
                  <View key={tl.id} style={s.hTlRow}>
                    <Icon name="person-add-outline" size={13} color="#f59e0b" />
                    <Text style={s.hTlName} numberOfLines={1}>{tl.name}</Text>
                    {tl.contingencyAccess && (
                      <View style={s.hContingencyBadge}>
                        <Text style={s.hContingencyText}>Contingency</Text>
                      </View>
                    )}
                  </View>
                )) : (
                  <Text style={s.hNoTl}>No team leaders assigned</Text>
                )}
              </View>
            ))}
          </View>
        ))
      )}

      <View style={s.sectionHeader}>
        <Icon name="receipt-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Summary</Text>
      </View>
      <StatsGrid>
        <StatCard label="Salary Slips" value={stats.salaryGenerated} icon="wallet-outline" color="#8b5cf6" />
        <StatCard label="Completed Tasks" value={stats.completedTasks} icon="checkmark-circle-outline" color="#10b981" />
        <StatCard label="Upcoming Holidays" value={stats.upcomingHolidays} icon="calendar-outline" color="#FF6600" onClick={() => navigation?.navigate('HolidayCalendar')} />
        <StatCard label="Assets" value={stats.totalAssets} icon="laptop-outline" color="#3b82f6" onClick={() => navigation?.navigate('Assets')} />
      </StatsGrid>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const, color: c.text },
  quickRow: { paddingLeft: 20, marginBottom: 16 },
  quickCard: {
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 10,
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  quickLabel: { fontSize: 13, fontWeight: '600' as const },
  breakdownText: { fontSize: 12, color: c.textSecondary, paddingHorizontal: 20, paddingTop: 6 },
  statsGrid: { paddingHorizontal: 16, gap: 12 },
  moduleGrid: { paddingHorizontal: 16, gap: 8 },
  alertsSection: { paddingHorizontal: 16, paddingTop: 16 },
  alertsHeader: { flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 10 },
  markAllBtn: { flexDirection: 'row' as const, alignItems: 'center', gap: 4 },
  markAllText: { fontSize: 12, color: '#f97316', fontWeight: '600' as const },
  unreadBadge: { backgroundColor: '#ef4444', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' as const },
  alertsList: { gap: 8 },
  alertItem: {
    flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: 12, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: 'transparent',
  },
  alertItemRead: { backgroundColor: c.card, borderColor: c.borderLight },
  alertItemHigh: { borderColor: '#fee2e2' },
  alertInfo: { flex: 1, minWidth: 0 },
  alertTitle: { fontSize: 13, fontWeight: '400' as const, color: c.text },
  alertTitleUnread: { fontWeight: '700' as const },
  alertBody: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  alertDate: { fontSize: 11, color: c.textTertiary },
  hFilterRow: { paddingHorizontal: 16, marginBottom: 8 },
  hChip: {
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
    backgroundColor: '#F3F4F6', borderRadius: 20,
    maxWidth: 160,
  },
  hChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  hChipText: { fontSize: 12, fontWeight: '600' as const, color: '#1F2937' },
  hChipTextActive: { color: '#fff' },
  hEmpty: { alignItems: 'center', paddingVertical: 28, gap: 8, paddingHorizontal: 20 },
  hEmptyText: { fontSize: 13, color: c.textTertiary, textAlign: 'center' },
  hCompanyCard: { marginHorizontal: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, overflow: 'hidden' },
  hCompanyHead: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderLight,
  },
  hCompanyName: { fontSize: 13, fontWeight: '600' as const, color: c.text, flex: 1 },
  hCompanyCount: { fontSize: 11, color: c.textSecondary },
  hExecBlock: { borderBottomWidth: 1, borderBottomColor: c.borderLight },
  hExecRow: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, paddingLeft: 26, backgroundColor: c.background,
  },
  hExecName: { fontSize: 13, fontWeight: '500' as const, color: c.text, flexShrink: 1 },
  hExecTitle: { fontSize: 11, color: c.textTertiary, flexShrink: 1 },
  hExecCount: { fontSize: 11, color: c.textSecondary, marginLeft: 'auto' },
  hTlRow: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 6, paddingLeft: 44,
  },
  hTlName: { fontSize: 12, color: c.textSecondary, flexShrink: 1 },
  hContingencyBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 100, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  hContingencyText: { fontSize: 10, fontWeight: '500' as const, color: '#c2410c' },
  hNoTl: { fontSize: 12, color: c.textTertiary, fontStyle: 'italic', paddingHorizontal: 44, paddingVertical: 6 },
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
