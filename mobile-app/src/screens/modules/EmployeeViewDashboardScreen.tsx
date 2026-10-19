import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { HeroBanner, PremiumCard } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { getDepartmentsByCompany } from '../../services/departmentService';

const STAT_CARDS = [
  { key: 'total', icon: 'people-outline', label: 'Total Employees', color: '#FF6600', bg: '#fff7ed' },
  { key: 'active', icon: 'checkmark-circle-outline', label: 'Active Employees', color: '#10b981', bg: '#ecfdf5' },
  { key: 'inactive', icon: 'close-circle-outline', label: 'Inactive Employees', color: '#ef4444', bg: '#fef2f2' },
  { key: 'newHires', icon: 'person-add-outline', label: 'New This Month', color: '#3b82f6', bg: '#eff6ff' },
  { key: 'departments', icon: 'business-outline', label: 'Departments', color: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'roles', icon: 'shield-checkmark-outline', label: 'Roles Assigned', color: '#06b6d4', bg: '#ecfeff' },
];

function getDateValue(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value === 'string') return new Date(value);
  return null;
}

export default function EmployeeViewDashboardScreen({ navigation }: { navigation: any }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => createStyles(colors), [colors]);
  const stats = useDashboardStats(user?.companyId);

  const [newHires, setNewHires] = useState(0);
  const [deptCount, setDeptCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const empsQuery = user?.companyId
      ? query(collection(db, 'employees'), where('companyId', '==', user.companyId))
      : collection(db, 'employees');

    const unsubEmps = onSnapshot(empsQuery, (snap) => {
      const newThisMonth = snap.docs.filter(d => {
        const data = d.data();
        const joinDate = getDateValue(data.joinDate || data.joiningDate);
        return joinDate && joinDate >= firstOfMonth;
      }).length;
      setNewHires(newThisMonth);
      setLoading(false);
    }, () => setLoading(false));

    (user?.companyId ? getDepartmentsByCompany(user.companyId) : Promise.resolve([])).then(depts => {
      setDeptCount(depts.length);
    }).catch(() => {});

    return () => unsubEmps();
  }, [user?.companyId]);

  const displayStats = {
    total: stats.totalEmployees,
    active: stats.activeEmployees,
    inactive: stats.inactiveEmployees,
    newHires,
    departments: deptCount || stats.activeDepartments,
    roles: stats.totalRoles,
  };

  if (loading && stats.loading) {
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
      <ScreenHeader title="Employee Dashboard" onBack={() => navigation.goBack()} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <HeroBanner greeting="Employee" name="Dashboard" subtitle="Overview of employee statistics and metrics"
          stats={[
            { label: 'Total', value: stats.totalEmployees, color: '#3b82f6' },
            { label: 'Active', value: stats.activeEmployees, color: '#10b981' },
            { label: 'Inactive', value: stats.inactiveEmployees, color: '#ef4444' },
          ]}
        />

        <View style={s.statsGrid}>
          {STAT_CARDS.map(card => {
            const value = displayStats[card.key as keyof typeof displayStats] ?? 0;
            return (
              <TouchableOpacity
                key={card.key}
                style={[s.statCard, { backgroundColor: colors.card }]}
                onPress={() => {
                  if (card.key === 'departments') navigation.navigate('Home', { screen: 'Departments' });
                  else if (card.key === 'roles') navigation.navigate('Home', { screen: 'AccessManagement' });
                  else navigation.navigate('Home', { screen: 'Employees' });
                }}
              >
                <View style={[s.statIcon, { backgroundColor: card.bg }]}>
                  <Ionicons name={card.icon as any} size={22} color={card.color} />
                </View>
                <Text style={s.statValue}>{value}</Text>
                <Text style={s.statLabel}>{card.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.bottomSection}>
          <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, flex: 1 }}>
            <View style={s.cardHeader}>
              <Ionicons name="flash-outline" size={16} color={colors.accent} />
              <Text style={s.cardTitle}>Quick Actions</Text>
            </View>
            <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Home', { screen: 'Employees' })}>
              <Ionicons name="person-add-outline" size={18} color="#10b981" />
              <Text style={s.actionText}>Add New Employee</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Home', { screen: 'Employees' })}>
              <Ionicons name="people-outline" size={18} color="#3b82f6" />
              <Text style={s.actionText}>View All Employees</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Home', { screen: 'AccessManagement' })}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#8b5cf6" />
              <Text style={s.actionText}>Manage Roles</Text>
            </TouchableOpacity>
          </PremiumCard>

          <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, flex: 1 }}>
            <View style={s.cardHeader}>
              <Ionicons name="business-outline" size={16} color={colors.accent} />
              <Text style={s.cardTitle}>Department Summary</Text>
            </View>
            {[
              { label: 'Total Departments', value: displayStats.departments },
              { label: 'Total Employees', value: displayStats.total },
              { label: 'Active Ratio', value: displayStats.total > 0 ? `${Math.round((displayStats.active / displayStats.total) * 100)}%` : '0%' },
              { label: 'Roles', value: displayStats.roles },
            ].map(item => (
              <View key={item.label} style={s.summaryRow}>
                <Text style={s.summaryLabel}>{item.label}</Text>
                <Text style={s.summaryValue}>{item.value}</Text>
              </View>
            ))}
          </PremiumCard>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, marginBottom: 16 },
  statCard: { width: '30%', flexGrow: 1, minWidth: '28%', padding: 14, borderRadius: 12 },
  statIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 22, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  bottomSection: { flexDirection: 'row', flexWrap: 'wrap' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  actionText: { fontSize: 14, color: c.text },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  summaryLabel: { fontSize: 14, color: c.textSecondary },
  summaryValue: { fontSize: 14, fontWeight: '600', color: c.text },
});
