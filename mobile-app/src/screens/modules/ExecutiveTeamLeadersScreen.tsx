import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { collection, query, where, onSnapshot, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { User } from '../../types/user';
import { EmptyStateView } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

export const ExecutiveTeamLeadersScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [teamLeaders, setTeamLeaders] = useState<User[]>([]);
  const [executives, setExecutives] = useState<User[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => setTeamLeaders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User))), () => setLoading(false));
    const qEx = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubEx = onSnapshot(qEx, (snap) => setExecutives(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User))), () => {});
    getDocs(collection(db, 'companies')).then((snap) => setCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    setLoading(false);
    return () => { unsubTL(); unsubEx(); };
  }, []);

  const onRefresh = async () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 300); };

  const getCompanyName = (id: string) => companies.find((c) => c.id === id)?.name || id || '—';

  const isLinked = (tl: User) => {
    const linked = (tl as any).linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
    return linked.includes(user?.id);
  };

  const filtered = useMemo(() => {
    return teamLeaders.filter((tl) => {
      if (!isLinked(tl)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return tl.name?.toLowerCase().includes(q) || tl.email?.toLowerCase().includes(q);
    });
  }, [teamLeaders, search, user?.id]);

  const getExecNames = (tl: User) => {
    const linked: string[] = (tl as any).linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
    return linked.map((id) => executives.find((e) => e.id === id)?.name).filter(Boolean).join(', ');
  };

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScreenHeader title="My Team Leaders" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.searchWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search team leaders..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>

        {filtered.length === 0 ? (
          <EmptyStateView icon="people-outline" title="No team leaders" subtitle="No team leaders are currently reporting to you." />
        ) : (
          filtered.map((tl) => {
            const contingency = !!(tl as any).contingencyAccess;
            const active = (tl as any).isActive !== false && (tl as any).status !== 'Inactive';
            const company = getCompanyName((tl as any).companyId || executives.find((e) => e.id === tl.reportingExecutiveId)?.companyId);
            return (
              <TouchableOpacity key={tl.id} style={s.card} onPress={() => navigation?.navigate('TeamLeaderProfile', { teamLeader: tl.id })}>
                <View style={[s.avatar, { backgroundColor: contingency ? colors.accent : colors.cyan }]}>
                  <Text style={s.avatarText}>{(tl.name || '?').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={s.info}>
                  <View style={s.titleRow}>
                    <Text style={s.name} numberOfLines={1}>{tl.name}</Text>
                    <View style={[s.badge, { backgroundColor: active ? '#10b98120' : '#ef444420' }]}>
                      <Text style={[s.badgeText, { color: active ? '#10b981' : '#ef4444' }]}>{active ? 'Active' : 'Inactive'}</Text>
                    </View>
                  </View>
                  <Text style={s.sub} numberOfLines={1}>{tl.email}</Text>
                  <View style={s.metaRow}>
                    <Icon name="business-outline" size={12} color={colors.textTertiary} />
                    <Text style={s.metaText} numberOfLines={1}>{company}</Text>
                  </View>
                  {getExecNames(tl) ? (
                    <View style={s.metaRow}>
                      <Icon name="ribbon-outline" size={12} color={colors.textTertiary} />
                      <Text style={s.metaText} numberOfLines={1}>Reporting to: {getExecNames(tl)}</Text>
                    </View>
                  ) : null}
                  <View style={[s.tag, { backgroundColor: contingency ? `${colors.accent}18` : colors.surface }]}>
                    <Icon name={contingency ? 'flash-outline' : 'close-circle-outline'} size={11} color={contingency ? colors.accent : colors.textTertiary} />
                    <Text style={[s.tagText, { color: contingency ? colors.accent : colors.textTertiary }]}>{contingency ? 'Contingency Access' : 'Contingency Disabled'}</Text>
                  </View>
                </View>
                <Icon name="chevron-forward-outline" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, marginBottom: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  sub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { fontSize: 12, color: c.textTertiary, flex: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 6 },
  tagText: { fontSize: 11, fontWeight: '600' },
});
