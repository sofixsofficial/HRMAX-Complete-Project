import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { HeroBanner, PremiumCard, AnimatedStatCard, EmptyStateView } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function AnalyticsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalAttendance: 0, avgWorkHours: 0, completionRate: 0,
    leaveUtilization: 0, totalTasks: 0, departmentHeadcount: 0,
    present: 0, absent: 0, late: 0, onLeave: 0,
  });
  const [deptData, setDeptData] = useState<{ label: string; value: number }[]>([]);

  const companyId = effectiveCompanyId || user?.companyId || '';
  const isTeamLeader = user?.role === 'team-leader';
  const departmentId = user?.departmentId;

  useEffect(() => {
    loadAnalytics();
  }, [companyId, departmentId]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      if (!companyId) { setLoading(false); return; }

      let employeeIds: string[] = [];
      let employees: any[] = [];
      let tasks: any[] = [];
      let records: any[] = [];
      let leaves: any[] = [];

      if (isTeamLeader && departmentId) {
        const [empSnap, taskSnap] = await Promise.all([
          getDocs(query(collection(db, 'employees'), where('departmentId', '==', departmentId))),
          getDocs(query(collection(db, 'tasks'), where('departmentId', '==', departmentId))),
        ]);
        employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        employeeIds = employees.map((e: any) => e.userId || e.id);

        if (employeeIds.length > 0) {
          const [attSnap, leaveSnap] = await Promise.all([
            getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId))),
            getDocs(query(collection(db, 'leaveRequests'), where('companyId', '==', companyId))),
          ]);
          const allRecords = attSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const allLeaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          records = allRecords.filter((r: any) => employeeIds.includes(r.userId));
          leaves = allLeaves.filter((l: any) => employeeIds.includes(l.userId));
        }
      } else {
        const [attSnap, taskSnap, leaveSnap, empSnap] = await Promise.all([
          getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'tasks'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'leaveRequests'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'employees'), where('companyId', '==', companyId))),
        ]);
        records = attSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        leaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        employeeIds = employees.map((e: any) => e.userId || e.id);
      }

      const completed = tasks.filter((t: any) => t.status === 'Completed' || t.status === 'done').length;
      const total = tasks.length;
      const workHours = records.reduce((sum: number, r: any) => sum + (r.workHours || 0), 0);
      const usedLeaves = leaves.filter((l: any) => l.status === 'Approved').length;
      const present = records.filter((r: any) => r.status === 'Present').length;
      const absent = records.filter((r: any) => r.status === 'Absent').length;
      const late = records.filter((r: any) => r.status === 'Late').length;
      const onLeave = records.filter((r: any) => r.status === 'On Leave').length;

      setMetrics({
        totalAttendance: records.length,
        avgWorkHours: records.length > 0 ? Math.round(workHours / records.length * 10) / 10 : 0,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        leaveUtilization: employeeIds.length > 0 ? Math.round((usedLeaves / employeeIds.length) * 100) : 0,
        totalTasks: total,
        departmentHeadcount: employees.length,
        present, absent, late, onLeave,
      });

      const deptMap: Record<string, number> = {};
      employees.forEach((e: any) => {
        const d = e.department || 'Unassigned';
        deptMap[d] = (deptMap[d] || 0) + 1;
      });
      setDeptData(Object.entries(deptMap).map(([label, value]) => ({ label, value })));
    } catch (err) {
      console.error('Analytics error:', err);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Analytics" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Analytics" name="Key metrics at a glance" subtitle="trending-up-outline"
        stats={[
          { label: 'Present', value: metrics.present, color: '#10b981' },
          { label: 'Absent', value: metrics.absent, color: '#ef4444' },
          { label: 'Late', value: metrics.late, color: '#eab308' },
          { label: 'Tasks', value: metrics.totalTasks, color: '#3b82f6' },
        ]}
      />

      <ScrollView>
        <View style={styles.statsGrid}>
          <AnimatedStatCard icon="calendar-outline" label="Attendance" value={metrics.totalAttendance} color="#3b82f6" />
          <AnimatedStatCard icon="time-outline" label="Avg Hours" value={metrics.avgWorkHours} color="#22c55e" />
          <AnimatedStatCard icon="checkmark-done-outline" label="Completion" value={`${metrics.completionRate}%`} color="#8b5cf6" />
          <AnimatedStatCard icon="umbrella-outline" label="Leave Rate" value={`${metrics.leaveUtilization}%`} color="#f59e0b" />
          <AnimatedStatCard icon="list-outline" label="Tasks" value={metrics.totalTasks} color="#ec4899" />
          <AnimatedStatCard icon="people-outline" label="Headcount" value={metrics.departmentHeadcount} color="#06b6d4" />
        </View>

        <PremiumCard style={styles.chartCard}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Attendance Breakdown</Text>
          {[
            { label: 'Present', value: metrics.present, color: '#22c55e' },
            { label: 'Absent', value: metrics.absent, color: '#ef4444' },
            { label: 'Late', value: metrics.late, color: '#f59e0b' },
            { label: 'On Leave', value: metrics.onLeave, color: '#3b82f6' },
          ].map((item, i) => {
            const total = metrics.present + metrics.absent + metrics.late + metrics.onLeave;
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <View key={i} style={styles.barRow}>
                <View style={[styles.barDot, { backgroundColor: item.color }]} />
                <Text style={[styles.barLabel, { color: colors.text }]}>{item.label}</Text>
                <View style={[styles.barTrack, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
                  <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: item.color }]} />
                </View>
                <Text style={[styles.barValue, { color: colors.textSecondary }]}>{item.value}</Text>
              </View>
            );
          })}
        </PremiumCard>

        <PremiumCard style={styles.chartCard}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Department Headcount</Text>
          {deptData.map((d, i) => {
            const maxVal = Math.max(...deptData.map(x => x.value), 1);
            const pct = (d.value / maxVal) * 100;
            return (
              <View key={i} style={styles.deptRow}>
                <Text style={[styles.deptLabel, { color: colors.text }]} numberOfLines={1}>{d.label}</Text>
                <View style={[styles.deptBar, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
                  <View style={[styles.deptFill, { width: `${pct}%`, backgroundColor: '#3b82f6' }]} />
                </View>
                <Text style={[styles.deptValue, { color: colors.textSecondary }]}>{d.value}</Text>
              </View>
            );
          })}
        </PremiumCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  chartCard: { marginHorizontal: 16, marginBottom: 16, padding: 16 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4, gap: 8 },
  barDot: { width: 10, height: 10, borderRadius: 5 },
  barLabel: { fontSize: 13, width: 70 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { fontSize: 13, fontWeight: '600', width: 36, textAlign: 'right' },
  deptRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4, gap: 8 },
  deptLabel: { fontSize: 13, width: 90 },
  deptBar: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  deptFill: { height: '100%', borderRadius: 5 },
  deptValue: { fontSize: 13, fontWeight: '600', width: 30, textAlign: 'right' },
});
