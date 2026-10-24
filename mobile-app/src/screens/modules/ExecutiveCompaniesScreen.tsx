import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { collection, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { Company } from '../../types/user';
import { EmptyStateView } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

const STATUS_OPTIONS = ['All', 'Active', 'Inactive', 'Suspended'];
const STATUS_COLORS: Record<string, string> = { Active: '#10b981', Inactive: '#ef4444', Suspended: '#dc2626', Pending: '#FF6600' };

export const ExecutiveCompaniesScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const assignedIds = useMemo(() => {
    const ids = user?.assignedCompanyIds || [];
    if (ids.length > 0) return ids;
    if (user?.companyId) return [user.companyId];
    return [];
  }, [user]);

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, 'companies'));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Company));
      const filtered = assignedIds.length > 0 ? all.filter((c) => assignedIds.includes(c.id)) : [];
      setCompanies(filtered);
    } catch { /* keep existing */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [assignedIds.length]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return `${c.name} ${c.code || ''} ${c.adminName || ''} ${c.adminEmail || ''}`.toLowerCase().includes(q);
    });
  }, [companies, search, statusFilter]);

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScreenHeader title="Assigned Companies" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
          {STATUS_OPTIONS.map((st) => (
            <TouchableOpacity key={st} style={[s.chip, statusFilter === st && s.chipActive]} onPress={() => setStatusFilter(st)}>
              <Text style={[s.chipText, statusFilter === st && { color: '#fff' }]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.searchWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search companies..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>

        {filtered.length === 0 ? (
          <EmptyStateView icon="business-outline" title="No companies assigned" subtitle={assignedIds.length === 0 ? 'No companies have been assigned to you yet.' : 'No companies match your filters.'} />
        ) : (
          filtered.map((company) => (
            <TouchableOpacity key={company.id} style={s.card} onPress={() => navigation?.navigate('CompanyDetailsView', { companyId: company.id })}>
              <View style={[s.logo, { backgroundColor: company.logoColor || colors.accent }]}>
                <Text style={s.logoText}>{(company.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={s.info}>
                <View style={s.titleRow}>
                  <Text style={s.name} numberOfLines={1}>{company.name}</Text>
                  <View style={[s.badge, { backgroundColor: `${STATUS_COLORS[company.status] || colors.textTertiary}20` }]}>
                    <Text style={[s.badgeText, { color: STATUS_COLORS[company.status] || colors.textTertiary }]}>{company.status}</Text>
                  </View>
                </View>
                <Text style={s.code}>{company.code || '—'} · {company.domain || '—'}</Text>
                <Text style={s.admin} numberOfLines={1}>{company.adminName || 'Admin'} {company.adminEmail ? `· ${company.adminEmail}` : ''}</Text>
              </View>
              <Icon name="chevron-forward-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  chipRow: { paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 10 },
  logo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  code: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  admin: { fontSize: 12, color: c.textTertiary, marginTop: 2 },
});
