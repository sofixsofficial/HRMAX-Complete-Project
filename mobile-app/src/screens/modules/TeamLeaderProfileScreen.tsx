import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { HeroBanner, PremiumCard, StatusBadge } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';

export default function TeamLeaderProfileScreen({ route }: any) {
  const { teamLeader } = route?.params || {};
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();

  const [users, setUsers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const tlId = teamLeader?.id || teamLeader?.userId || teamLeader;

  useEffect(() => {
    if (!tlId) { setLoading(false); return; }
    loadData();
  }, [tlId]);

  const loadData = async () => {
    try {
      const [userSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'team-leader'))),
      ]);
      const allUsers = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(allUsers);

      const empSnapshot = await getDocs(query(collection(db, 'employees'), where('reportingManagerId', '==', tlId)));
      setMembers(empSnapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('TL profile error:', err);
    }
    setLoading(false);
  };

  const tlUser = users.find((u: any) => u.id === tlId);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Team Leader Profile" onBack={() => navigation.goBack()} />
      <HeroBanner greeting={tlUser?.name || 'Team Leader Profile'} name="Master Admin View" />
      <ScrollView>
        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Details</Text>
          {[
            { icon: 'mail-outline', label: 'Email', value: tlUser?.email || 'N/A' },
            { icon: 'shield-outline', label: 'Role', value: 'team-leader' },
            { icon: 'people-outline', label: 'Team Size', value: String(members.length) },
            { icon: 'checkmark-circle-outline', label: 'Status', value: tlUser?.isActive ? 'Active' : 'Inactive' },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Team Members ({members.length})</Text>
          {members.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>No team members</Text>
          ) : members.map((m: any) => (
            <View key={m.id} style={styles.memberRow}>
              <View style={[styles.avatar, { backgroundColor: m.departmentColor || colors.accent }]}>
                <Text style={styles.avatarText}>{m.name?.charAt(0)?.toUpperCase()}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.text }]}>{m.name}</Text>
                <Text style={[styles.memberDept, { color: colors.textSecondary }]}>{m.designation || m.department}</Text>
              </View>
              <StatusBadge status={m.status || 'Active'} color={m.status === 'Active' ? '#22c55e' : '#f59e0b'} />
            </View>
          ))}
        </PremiumCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 5 },
  infoLabel: { fontSize: 13, width: 90 },
  infoValue: { fontSize: 14, fontWeight: '500', flex: 1 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '600' },
  memberDept: { fontSize: 12 },
});
