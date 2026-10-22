import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { useCompany } from '../../context/CompanyContext';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { DashboardHero } from '../../components/DashboardHero';
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel';

const QUICK_ACTIONS = [
  { key: 'Employees', label: 'Employees', icon: 'people-outline', color: '#3b82f6' },
  { key: 'Departments', label: 'Departments', icon: 'git-network-outline', color: '#06b6d4' },
  { key: 'AttendanceOverview', label: "Today's Attendance", icon: 'clipboard-outline', color: '#10b981' },
  { key: 'HolidayCalendar', label: 'Holidays', icon: 'calendar-outline', color: '#eab308' },
  { key: 'CompanyProfile', label: 'Company Info', icon: 'settings-outline', color: '#8b5cf6' },
];

const MANAGEMENT_MODULES = [
  { key: 'Employees', label: 'Employees', desc: 'View employees', icon: 'people-outline', color: '#3b82f6' },
  { key: 'Departments', label: 'Departments', desc: 'View departments', icon: 'business-outline', color: '#10b981' },
  { key: 'AttendanceOverview', label: 'Attendance', desc: "Today's attendance", icon: 'clipboard-outline', color: '#06b6d4' },
  { key: 'LeaveManagement', label: 'Leaves', desc: 'View leave requests', icon: 'umbrella-outline', color: '#eab308' },
  { key: 'HolidayCalendar', label: 'Holidays', desc: 'View holidays', icon: 'calendar-outline', color: '#FF6600' },
  { key: 'Reports', label: 'Reports', desc: 'Company analytics', icon: 'bar-chart-outline', color: '#8b5cf6' },
];

const COMPANY_CONTROLS = [
  { key: 'CompanyProfile', label: 'Company Info', desc: 'Company profile & operational details', icon: 'shield-checkmark-outline', color: '#FF6600' },
  { key: 'PayrollHistory', label: 'Payroll History', desc: 'View past payroll execution logs', icon: 'time-outline', color: '#8b5cf6' },
];

export const CompanyDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, selectedCompanyName } = useCompany();
  const [refreshKey, setRefreshKey] = useState(0);
  const { loading, ...stats } = useDashboardStats(effectiveCompanyId, refreshKey);
  const [refreshing, setRefreshing] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  if (loading && !refreshing) return <DashboardSkeleton />;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHero
        name={user?.name || 'Admin'}
        roleLabel={selectedCompanyName || 'Company Admin'}
        subtitle={selectedCompanyName ? 'Internal Head · Managing your company operations' : "Here's your company's overview today."}
        showAttendance={false}
        stats={[
          { label: 'Present', value: stats.presentToday, color: '#10b981' },
          { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
          { label: 'Leaves', value: stats.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
        ]}
      />

      <View style={s.sectionHeader}>
        <Icon name="business-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Company Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Total Employees" value={stats.totalEmployees} icon="people-outline" color="#3b82f6" onClick={() => navigation?.navigate('Employees')} />
        <StatCard label="Active Employees" value={stats.activeEmployees} icon="checkmark-circle-outline" color="#10b981" />
        <StatCard label="Inactive" value={stats.inactiveEmployees} icon="close-circle-outline" color="#ef4444" />
        <StatCard label="On Leave" value={stats.onLeaveToday} icon="umbrella-outline" color="#eab308" />
        <StatCard label="Departments" value={stats.activeDepartments} icon="business-outline" color="#06b6d4" onClick={() => navigation?.navigate('Departments')} />
        <StatCard label="Today's Check-ins" value={stats.presentToday} icon="clipboard-outline" color="#10b981" onClick={() => navigation?.navigate('AttendanceOverview')} />
        <StatCard label="Pending Leaves" value={stats.pendingLeaves} icon="umbrella-outline" color="#eab308" onClick={() => navigation?.navigate('LeaveManagement')} />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon="checkmark-circle-outline" color="#ec4899" />
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

      <View style={s.sectionHeader}>
        <Icon name="stats-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Today's Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Present" value={stats.presentToday} icon="checkmark-circle-outline" color="#10b981" />
        <StatCard label="Absent" value={stats.absentToday} icon="close-circle-outline" color="#dc2626" />
        <StatCard label="Late" value={stats.lateToday} icon="time-outline" color="#eab308" />
        <StatCard label="On Leave" value={stats.onLeaveToday} icon="umbrella-outline" color="#3b82f6" />
        <StatCard label="Miss Punch" value={stats.missPunchToday} icon="alert-circle-outline" color="#8b5cf6" />
        <StatCard label="Attendance Rate" value={stats.attendanceRate === null ? '—' : `${stats.attendanceRate}%`} icon="pie-chart-outline" color="#10b981" />
      </StatsGrid>

      {/* Leave queue: Eye view + Approve/Reject at this role's tier (matches web) */}
      <LeaveApprovalsPanel />

      <View style={s.sectionHeader}>
        <Icon name="calendar-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Upcoming & Celebrations</Text>
      </View>
      <StatsGrid>
        <StatCard label="Today's Birthdays" value={stats.todayBirthdays} icon="gift-outline" color="#ec4899" onClick={() => navigation?.navigate('Birthdays')} />
        <StatCard label="Upcoming Holidays" value={stats.upcomingHolidays} icon="calendar-outline" color="#FF6600" onClick={() => navigation?.navigate('HolidayCalendar')} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="checkmark-circle-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Tasks & Payroll</Text>
      </View>
      <View style={s.moduleGrid}>
        {[
          { key: 'TaskManagement', label: 'Tasks', desc: `${stats.pendingTasks} pending · ${stats.completedTasks} completed · ${stats.inProgressTasks} in progress`, icon: 'checkmark-circle-outline', color: '#ec4899' },
          { key: 'RunPayroll', label: 'Payroll', desc: `${stats.salaryGenerated} salary record${stats.salaryGenerated === 1 ? '' : 's'} generated`, icon: 'wallet-outline', color: '#8b5cf6' },
        ].map((mod) => (
          <TouchableOpacity key={mod.key} style={s.moduleCard} onPress={() => mod.key === 'RunPayroll' && navigation?.navigate('SalarySlips')}>
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

      <View style={s.sectionHeader}>
        <Icon name="receipt-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Payroll & Operations</Text>
      </View>
      <View style={s.moduleGrid}>
        {COMPANY_CONTROLS.map((mod) => (
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

      <View style={s.sectionHeader}>
        <Icon name="wallet-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Financial Summary</Text>
      </View>
      <StatsGrid>
        <StatCard label="Salary Generated" value={stats.salaryGenerated} icon="wallet-outline" color="#8b5cf6" onClick={() => navigation?.navigate('PayrollHistory')} />
        <StatCard label="Assets" value={stats.totalAssets} icon="laptop-outline" color="#10b981" />
        <StatCard label="Announcements" value={stats.totalAnnouncements} icon="megaphone-outline" color="#8b5cf6" onClick={() => navigation?.navigate('Notifications')} />
      </StatsGrid>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center', gap: 8,
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
