import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { User, Company } from '../../types/user';
import { EmptyStateView } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

const MAX_VISIBLE = 3;

export const HandledCompaniesScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [teamLeaders, setTeamLeaders] = useState<User[]>([]);
  const [executives, setExecutives] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => setTeamLeaders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User))), () => setLoading(false));
    const qEx = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubEx = onSnapshot(qEx, (snap) => setExecutives(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User))), () => setLoading(false));
    const unsubCo = onSnapshot(collection(db, 'companies'), (snap) => setCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Company))), () => setLoading(false));
    setLoading(false);
    return () => { unsubTL(); unsubEx(); unsubCo(); };
  }, []);

  const onRefresh = async () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 300); };

  const getCompanyName = (id?: string) => companies.find((c) => c.id === id)?.name || id || '—';
  const getExecNames = (tl: User) => {
    const linked: string[] = (tl as any).linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
    return linked.map((id) => executives.find((e) => e.id === id)?.name).filter(Boolean).join(', ') || 'Unassigned';
  };

  const linkedExecIds = useMemo(() => {
    const ids = (user as any).linkedExecutiveIds || (user?.reportingExecutiveId ? [user.reportingExecutiveId] : []);
    return (ids as string[]).filter(Boolean);
  }, [user]);
  const linkedExecs = useMemo(() => executives.filter((e) => linkedExecIds.includes(e.id)), [executives, linkedExecIds]);

  const handledCompanyIds = useMemo(() => {
    const ids = new Set<string>();
    linkedExecs.forEach((e) => { if (e.companyId) ids.add(e.companyId); });
    if (user?.companyId) ids.add(user.companyId);
    (user?.assignedCompanyIds || []).forEach((id) => ids.add(id));
    return Array.from(ids);
  }, [linkedExecs, user]);

  const handledCompanies = useMemo(() => companies.filter((c) => handledCompanyIds.includes(c.id)), [companies, handledCompanyIds]);

  const peers = useMemo(() => teamLeaders.filter((tl) => {
    if (tl.id === user?.id) return false;
    const tlLinked: string[] = (tl as any).linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
    const sharedExec = tlLinked.some((id) => linkedExecIds.includes(id));
    const sameCompany = !!tl.companyId && !!user?.companyId && tl.companyId === user.companyId;
    return sharedExec || sameCompany;
  }), [teamLeaders, user, linkedExecIds]);

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScreenHeader title="Handled Companies" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <Text style={s.sectionTitle}>My Assignment</Text>
        <View style={s.card}>
          <View style={s.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={s.empName}>{user?.name || 'Team Leader'}</Text>
              <Text style={s.roleText}>{(user as any)?.designation || 'Team Leader'} • {user?.email}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: (user as any)?.contingencyAccess ? '#ef444420' : '#64748b20' }]}>
              <Text style={[s.badgeText, { color: (user as any)?.contingencyAccess ? '#ef4444' : '#64748b' }]}>
                {(user as any)?.contingencyAccess ? 'Contingency' : 'Standard'}
              </Text>
            </View>
          </View>

          {linkedExecIds.length > 0 ? (
            <View style={s.tagBlock}>
              <Text style={s.tagLabel}>Assigned Executive</Text>
              <View style={s.tagRow}>
                {linkedExecs.slice(0, MAX_VISIBLE).map((e) => (
                  <Text key={e.id} style={[s.tag, s.tagExecutive]}>{e.name}</Text>
                ))}
                {linkedExecIds.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{linkedExecIds.length - MAX_VISIBLE}</Text>}
              </View>
            </View>
          ) : null}

          {handledCompanies.length > 0 ? (
            <View style={s.tagBlock}>
              <Text style={s.tagLabel}>Companies Handled</Text>
              <View style={s.tagRow}>
                {handledCompanies.slice(0, MAX_VISIBLE).map((c) => (
                  <Text key={c.id} style={[s.tag, s.tagCompany]}>{c.name}</Text>
                ))}
                {handledCompanies.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{handledCompanies.length - MAX_VISIBLE}</Text>}
              </View>
            </View>
          ) : null}
        </View>

        <Text style={s.sectionTitle}>Handled Companies</Text>
        {handledCompanies.length === 0 ? (
          <EmptyStateView icon="business-outline" title="No companies handled" subtitle="Your handled companies will appear here once assigned." />
        ) : (
          handledCompanies.map((company) => (
            <TouchableOpacity key={company.id} style={s.companyCard} onPress={() => navigation?.navigate('CompanyDetailsView', { companyId: company.id })}>
              <View style={[s.logo, { backgroundColor: company.logoColor || colors.accent }]}>
                <Text style={s.logoText}>{(company.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={s.info}>
                <Text style={s.name} numberOfLines={1}>{company.name}</Text>
                <Text style={s.code} numberOfLines={1}>{company.code || '—'} • {company.domain || '—'}</Text>
                <Text style={s.admin} numberOfLines={1}>{company.adminName || 'Admin'}</Text>
              </View>
              <Icon name="chevron-forward-outline" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))
        )}

        <Text style={s.sectionTitle}>Peer Team Leaders</Text>
        {peers.length === 0 ? (
          <EmptyStateView icon="people-outline" title="No peer team leaders" subtitle="Other team leaders linked to your executives will appear here." />
        ) : (
          peers.map((tl) => {
            const contingency = !!(tl as any).contingencyAccess;
            const active = (tl as any).isActive !== false && (tl as any).status !== 'Inactive';
            const peerLinkedExecIds: string[] = (tl as any).linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
            const compNames = Array.from(new Set<string>([
              ...peerLinkedExecIds.map((id: string) => executives.find((e) => e.id === id)?.companyId).filter(Boolean) as string[],
              ...((tl as any).assignedCompanyIds || []),
              ...(tl.companyId ? [tl.companyId] : []),
            ])).map((id: string) => getCompanyName(id)).filter((n) => n && n !== '—');
            return (
              <TouchableOpacity key={tl.id} style={s.card} onPress={() => navigation?.navigate('TeamLeaderProfile', { teamLeader: tl.id })}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.empName}>{tl.name}</Text>
                    <Text style={s.roleText}>{(tl as any).designation || 'Team Leader'} • {tl.email}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: active ? '#10b98120' : '#ef444420' }]}>
                    <Text style={[s.badgeText, { color: active ? '#10b981' : '#ef4444' }]}>{active ? 'Active' : 'Inactive'}</Text>
                  </View>
                </View>
                <View style={s.tagBlock}>
                  <Text style={s.tagLabel}>Assigned Executive</Text>
                  <View style={s.tagRow}>
                    <Text style={[s.tag, s.tagExecutive]}>{getExecNames(tl)}</Text>
                  </View>
                </View>
                {compNames.length > 0 ? (
                  <View style={s.tagBlock}>
                    <Text style={s.tagLabel}>Companies Handled</Text>
                    <View style={s.tagRow}>
                      {compNames.slice(0, MAX_VISIBLE).map((n) => (
                        <Text key={n} style={[s.tag, s.tagCompany]}>{n}</Text>
                      ))}
                      {compNames.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{compNames.length - MAX_VISIBLE}</Text>}
                    </View>
                  </View>
                ) : null}
                <View style={s.tagBlock}>
                  <Text style={s.tagLabel}>Contingency Access</Text>
                  <View style={s.tagRow}>
                    <Text style={[s.tag, contingency ? s.tagContingencyOn : s.tagContingencyOff]}>
                      {contingency ? 'Enabled' : 'Disabled'}
                    </Text>
                  </View>
                </View>
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginHorizontal: 16, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, padding: 16, marginHorizontal: 16, marginBottom: 8 },
  companyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  empName: { fontSize: 16, fontWeight: '600', color: c.text },
  roleText: { color: c.accent, fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  tagBlock: { marginTop: 8 },
  tagLabel: { fontSize: 11, color: c.textTertiary, textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
  tagExecutive: { backgroundColor: '#fef3c7', color: '#d97706' },
  tagCompany: { backgroundColor: '#eff6ff', color: '#2563eb' },
  tagMore: { backgroundColor: '#f1f5f9', color: '#64748b' },
  tagContingencyOn: { backgroundColor: '#ef4444', color: '#fff' },
  tagContingencyOff: { backgroundColor: '#f1f5f9', color: '#64748b' },
  logo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  name: { fontSize: 15, fontWeight: '700', color: c.text },
  code: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  admin: { fontSize: 12, color: c.textTertiary, marginTop: 2 },
});
