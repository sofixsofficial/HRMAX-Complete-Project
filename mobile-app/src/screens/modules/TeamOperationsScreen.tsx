import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { useCompany } from '../../context/CompanyContext';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { HeroBanner } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

const OPERATIONS = [
  { key: 'TaskManagement', label: 'Task Assignment & Tracking', desc: 'Create, assign and track daily deliverables for your team.', icon: 'document-text-outline', color: '#ec4899' },
  { key: 'AttendanceOverview', label: 'Attendance Logs Review', desc: 'Review check-in/out logs, geofence compliance and shift adherence.', icon: 'clipboard-outline', color: '#06b6d4' },
  { key: 'LeaveManagement', label: 'Initial Leave Review', desc: 'Review employee leave applications before final sign-off.', icon: 'umbrella-outline', color: '#eab308' },
];

export const TeamOperationsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const { loading, ...stats } = useDashboardStats(effectiveCompanyId);
  const s = useMemo(() => createStyles(colors), [colors]);
  const contingency = !!(user as any)?.contingencyAccess;

  if (loading) return <DashboardSkeleton />;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Team Operations" onBack={() => navigation.goBack()} />
      <ScrollView style={s.container}>
      <HeroBanner
        greeting="Operations Center"
        name={user?.name || 'Team Leader'}
        subtitle="Manage your team's daily tasks, attendance and leave reviews."
        stats={[
          { label: 'Present', value: stats.presentToday, color: '#10b981' },
          { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
          { label: 'Leaves', value: stats.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
        ]}
      />

      <View style={s.sectionHeader}>
        <Icon name="settings-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Operations</Text>
      </View>
      <View style={s.moduleGrid}>
        {OPERATIONS.map((mod) => (
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
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Contingency & Team Status</Text>
      </View>
      <StatsGrid>
        <StatCard label="Contingency Access" value={contingency ? 'Active' : 'Off'} icon="flash-outline" color={contingency ? '#ef4444' : '#64748b'} />
        <StatCard label="Team Present" value={stats.presentToday} icon="checkmark-circle-outline" color="#10b981" />
        <StatCard label="On Leave" value={stats.pendingLeaves} icon="umbrella-outline" color="#3b82f6" onClick={() => navigation?.navigate('LeaveManagement')} />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon="checkmark-circle-outline" color="#ec4899" onClick={() => navigation?.navigate('TaskManagement')} />
        <StatCard label="Late Today" value={stats.lateToday} icon="time-outline" color="#eab308" />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="information-circle-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Operational Note</Text>
      </View>
      <View style={s.noteCard}>
        <Text style={s.noteText}>
          {contingency
            ? 'You have contingency access and can operate across companies when the assigned team is unavailable.'
            : 'Standard access is enabled. Contingency access (across-company operations) is currently disabled for your profile.'}
        </Text>
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  sectionHeader: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const, color: c.text },
  moduleGrid: { paddingHorizontal: 16, gap: 8 },
  moduleCard: {
    flexDirection: 'row' as const, alignItems: 'center',
    backgroundColor: c.card, padding: 14,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  moduleIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  moduleInfo: { flex: 1, marginLeft: 12 },
  moduleLabel: { fontSize: 14, fontWeight: '600' as const, color: c.text },
  moduleDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  noteCard: { marginHorizontal: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16 },
  noteText: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
});
