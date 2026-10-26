import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { doc, getDoc, collection, query, where, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { dayKey } from '../../utils/attendanceDate';
import { Employee, AttendanceRecord } from '../../types/user';
import { HeroBanner, PremiumCard, ShimmerLoader, AnimatedStatCard } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';

export const EmployeeProfileScreen: React.FC<{ route: any; navigation: any }> = ({ route }) => {
  const { employeeId } = route?.params || {};
  const navigation = useNavigation();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [attendanceStats, setAttendanceStats] = useState({ present: 0, absent: 0, late: 0, total: 0 });
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!employeeId) return;
    try {
      const snap = await getDoc(doc(db, 'employees', employeeId));
      if (snap.exists()) setEmployee({ id: snap.id, ...snap.data() } as Employee);

      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const emp = snap.exists() ? ({ id: snap.id, ...snap.data() } as Employee) : null;
      const personId = emp?.userId || employeeId;

      const attSnap = await getDocs(
        // day keys, not Dates/Timestamps — see utils/attendanceDate.ts
        query(collection(db, 'attendance'), where('userId', '==', personId), where('date', '>=', dayKey(monthStart)), where('date', '<', dayKey(tomorrow)))
      );
      const records = attSnap.docs.map(d => d.data() as AttendanceRecord);
      setAttendanceStats({
        present: records.filter(r => r.status === 'Present' || r.status === 'Late').length,
        absent: records.filter(r => r.status === 'Absent').length,
        late: records.filter(r => r.status === 'Late').length,
        total: records.length,
      });

      const taskSnap = await getDocs(
        query(collection(db, 'tasks'), where('assignedToId', '==', personId))
      );
      const taskData = taskSnap.docs.map(d => d.data());
      setTaskStats({
        total: taskData.length,
        completed: taskData.filter(t => t.status === 'Completed').length,
      });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [employeeId]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  if (loading) return <ShimmerLoader count={5} height={80} style={{ padding: 16 }} />;
  if (!employee) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textTertiary }}>Employee not found</Text></View>;

  const statusColor = employee.status === 'Active' ? '#10b981' : employee.status === 'On Leave' ? '#f59e0b' : '#ef4444';
  const infoRows = [
    { label: 'Email', value: employee.email, icon: 'mail-outline' },
    { label: 'Phone', value: employee.phone || 'Not set', icon: 'call-outline' },
    { label: 'Department', value: employee.department, icon: 'business-outline' },
    { label: 'Designation', value: employee.designation, icon: 'briefcase-outline' },
    { label: 'Employee ID', value: employee.employeeId, icon: 'hash-outline' },
    { label: 'Employment Type', value: employee.employmentType, icon: 'briefcase-outline' },
    { label: 'Join Date', value: employee.joinDate ? new Date(employee.joinDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A', icon: 'calendar-outline' },
    { label: 'Shift', value: employee.shiftType || 'N/A', icon: 'time-outline' },
    { label: 'Reporting Manager', value: employee.reportingManagerName || 'N/A', icon: 'people-outline' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Employee Profile" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <HeroBanner
        greeting="Employee Profile"
        name={employee.name}
        subtitle={employee.designation}
        stats={[
          { label: 'Status', value: employee.status, color: statusColor },
        ]}
      />

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 }}>
        <AnimatedStatCard icon="checkmark-circle-outline" label="Present" value={attendanceStats.present} color="#10b981" delay={0} />
        <AnimatedStatCard icon="time-outline" label="Late" value={attendanceStats.late} color="#eab308" delay={100} />
        <AnimatedStatCard icon="close-circle-outline" label="Absent" value={attendanceStats.absent} color="#ef4444" delay={200} />
      </View>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }} accentColor="#3b82f6">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Task Completion</Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
            {taskStats.completed}/{taskStats.total}
          </Text>
        </View>
        <View style={{ height: 8, backgroundColor: colors.background, borderRadius: 4, overflow: 'hidden' }}>
          <View
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: taskStats.total > 0 && taskStats.completed === taskStats.total ? '#10b981' : '#3b82f6',
              width: `${taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0}%`,
            }}
          />
        </View>
        <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 6 }}>
          {taskStats.total > 0
            ? `${Math.round((taskStats.completed / taskStats.total) * 100)}% of assigned tasks completed`
            : 'No tasks assigned yet'}
        </Text>
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Details</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: statusColor }}>{employee.status}</Text>
        </View>
        {infoRows.map((row, i) => (
          <View key={row.label} style={[s.infoRow, i < infoRows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
            <Icon name={row.icon} size={16} color={colors.textTertiary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 11, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 }}>{row.label}</Text>
              <Text style={{ fontSize: 14, color: colors.text, fontWeight: '500', marginTop: 1 }}>{row.value || 'N/A'}</Text>
            </View>
          </View>
        ))}
      </PremiumCard>

      {employee.salary && (
        <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }} accentColor="#FF6600">
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Salary</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.accent }}>₹{(employee.monthlyGrossSalary || employee.salary)?.toLocaleString()}</Text>
        </PremiumCard>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
