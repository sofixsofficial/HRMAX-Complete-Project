import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { HeroBanner, PremiumCard, StatusBadge } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { formatDateSafe } from '../../utils/dateUtils';

export default function ExecutiveProfileScreen({ route }: any) {
  const { executive } = route?.params || {};
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const execId = executive?.id || executive?.userId || executive;

  useEffect(() => {
    if (!execId) { setLoading(false); return; }
    loadData();
  }, [execId]);

  const loadData = async () => {
    try {
      const [userSnap, companySnap, ticketSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'executive'))),
        getDocs(collection(db, 'companies')),
        getDocs(query(collection(db, 'tickets'), where('executiveId', '==', execId))),
      ]);
      setUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCompanies(companySnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTickets(ticketSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Executive profile error:', err);
    }
    setLoading(false);
  };

  const execUser = users.find((u: any) => u.id === execId);
  const assignedCompanies = (execUser?.assignedCompanyIds || []).map((cid: string) => companies.find(c => c.id === cid)).filter(Boolean);
  const openTickets = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress');

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Executive Profile" onBack={() => navigation.goBack()} />
      <HeroBanner greeting={execUser?.name || 'Executive Profile'} name="Master Admin View" />
      <ScrollView>
        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Details</Text>
          {[
            { icon: 'mail-outline', label: 'Email', value: execUser?.email || 'N/A' },
            { icon: 'shield-outline', label: 'Role', value: execUser?.role || 'executive' },
            { icon: 'checkmark-circle-outline', label: 'Status', value: execUser?.isActive ? 'Active' : 'Inactive' },
            { icon: 'calendar-outline', label: 'Created', value: formatDateSafe(execUser?.createdAt) },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Assigned Companies ({assignedCompanies.length})</Text>
          {assignedCompanies.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>No companies assigned</Text>
          ) : assignedCompanies.map((c: any) => (
            <View key={c.id} style={styles.companyRow}>
              <View style={[styles.companyDot, { backgroundColor: c.logoColor || colors.accent }]} />
              <Text style={[styles.companyName, { color: colors.text }]}>{c.name}</Text>
            </View>
          ))}
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Support Tickets ({openTickets.length} open)</Text>
          {openTickets.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>No open tickets</Text>
          ) : openTickets.slice(0, 5).map((t: any) => (
            <View key={t.id} style={styles.ticketRow}>
              <Text style={[styles.ticketTitle, { color: colors.text }]} numberOfLines={1}>{t.title}</Text>
              <StatusBadge status={t.status} color={t.status === 'Open' ? '#3b82f6' : t.status === 'In Progress' ? '#f59e0b' : t.status === 'Resolved' ? '#22c55e' : '#6b7280'} />
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
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyName: { fontSize: 14, fontWeight: '500' },
  ticketRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  ticketTitle: { fontSize: 14, flex: 1, marginRight: 8 },
});
