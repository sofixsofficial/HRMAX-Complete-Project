import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { HeroBanner, PremiumCard, AnimatedStatCard } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';

export default function HRMSDashboardScreen({ navigation }: { navigation?: any }) {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    companies: 0, employees: 0, activeEmployees: 0,
    tickets: 0, tasks: 0, departments: 0,
    totalSalary: 0, pendingApprovals: 0,
  });

  useEffect(() => {
    loadStats();
  }, [user?.id, user?.companyId]);

  const loadStats = async () => {
    try {
      const scoped = (name: string) =>
        user?.companyId
          ? query(collection(db, name), where('companyId', '==', user.companyId))
          : collection(db, name);

      const [compSnap, empSnap, ticketSnap, taskSnap, salarySnap] = await Promise.all([
        getDocs(scoped('companies')),
        getDocs(scoped('employees')),
        getDocs(scoped('tickets')),
        getDocs(scoped('tasks')),
        getDocs(scoped('salarySlips')),
      ]);
      const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const depts = new Set(employees.map((e: any) => e.department).filter(Boolean)).size;
      const totalSalary = salarySnap.docs.reduce((sum, d) => sum + (d.data().netSalary || 0), 0);
      const pending = ticketSnap.docs.filter(d => d.data().status === 'Open').length;

      setStats({
        companies: compSnap.size,
        employees: employees.length,
        activeEmployees: employees.filter((e: any) => e.status === 'Active').length,
        tickets: ticketSnap.size,
        tasks: taskSnap.size,
        departments: depts,
        totalSalary,
        pendingApprovals: pending + taskSnap.docs.filter(d => d.data().status !== 'Completed').length,
      });
    } catch (err) {
      console.error('HRMS Dashboard error:', err);
    }
    setLoading(false);
  };

  const quickLinks = [
    { icon: 'business-outline', label: 'Companies', color: '#3b82f6', screen: 'Companies' },
    { icon: 'people-outline', label: 'Employees', color: '#22c55e', screen: 'Employees' },
    { icon: 'chatbubbles-outline', label: 'Tickets', color: '#f59e0b', screen: 'SupportTickets' },
    { icon: 'lock-closed-outline', label: 'Access', color: '#ec4899', screen: 'AccessManagement' },
    { icon: 'arrow-redo-outline', label: 'Transfers', color: '#06b6d4', screen: 'TransferManagement' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="HRMS Dashboard" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="HRMS Dashboard" name="Master Admin Overview" subtitle="shield-outline"
        stats={[
          { label: 'Companies', value: stats.companies, color: '#3b82f6' },
          { label: 'Employees', value: stats.employees, color: '#10b981' },
          { label: 'Departments', value: stats.departments, color: '#FF6600' },
        ]}
      />

      <ScrollView>
        <View style={styles.statsGrid}>
          <AnimatedStatCard icon="business-outline" label="Companies" value={stats.companies} color="#3b82f6" />
          <AnimatedStatCard icon="people-outline" label="Employees" value={stats.employees} color="#22c55e" />
          <AnimatedStatCard icon="checkmark-circle-outline" label="Active" value={stats.activeEmployees} color="#8b5cf6" />
          <AnimatedStatCard icon="business-outline" label="Departments" value={stats.departments} color="#f59e0b" />
          <AnimatedStatCard icon="chatbubbles-outline" label="Tickets" value={stats.tickets} color="#ec4899" />
          <AnimatedStatCard icon="list-outline" label="Tasks" value={stats.tasks} color="#06b6d4" />
          <AnimatedStatCard icon="cash-outline" label="Total Salary" value={`₹${(stats.totalSalary / 100000).toFixed(1)}L`} color="#FF6600" />
          <AnimatedStatCard icon="alert-circle-outline" label="Pending" value={stats.pendingApprovals} color="#ef4444" />
        </View>

        <PremiumCard style={styles.quickCard}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            {quickLinks.map((link, i) => (
              <TouchableOpacity key={i} style={styles.quickItem} onPress={() => navigation?.navigate(link.screen)}>
                <View style={[styles.quickIcon, { backgroundColor: link.color + '20' }]}>
                  <Ionicons name={link.icon as any} size={24} color={link.color} />
                </View>
                <Text style={[styles.quickLabel, { color: colors.text }]}>{link.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </PremiumCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  quickCard: { marginHorizontal: 16, marginBottom: 16, padding: 16 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quickItem: { width: '30%' as any, minWidth: 90, alignItems: 'center' },
  quickIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  quickLabel: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
});
