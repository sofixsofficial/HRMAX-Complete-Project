import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs, doc, updateDoc } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { getAllCompanies } from '../../services/companyService';
import { HeroBanner, PremiumCard, PremiumSearchBar, StatusBadge, EmptyStateView, PremiumModal, PremiumBottomSheet } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

export default function ExecutiveOversightScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [executives, setExecutives] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userSnap, companies] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'executive'))),
        getAllCompanies(),
      ]);
      setExecutives(userSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setAllCompanies(companies);
    } catch (err) {
      console.error('Exec oversight error:', err);
    }
    setLoading(false);
  };

  const filtered = useMemo(() => executives.filter((e: any) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return e.name?.toLowerCase().includes(s) || e.email?.toLowerCase().includes(s);
  }), [executives, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages]);

  const getAssignedCompanies = (exec: any) =>
    (exec.assignedCompanyIds || []).map((cid: string) => allCompanies.find((c: any) => c.id === cid)).filter(Boolean);

  const handleAssign = async () => {
    if (!selected) return;
    try {
      await updateDoc(doc(db, 'users', selected.id), { assignedCompanyIds: selectedCompanies });
      Alert.alert('Success', 'Companies assigned');
      setShowAssign(false);
      loadData();
    } catch {
      Alert.alert('Error', 'Failed to assign companies');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Assigned Companies,Team Leaders,Status'];
      const rows = filtered.map((e: any) => `${(e.name || '').replace(/,/g, ';')},${(e.email || '').replace(/,/g, ';')},${(e.assignedCompanyIds || []).length},${(e.assignedTeamLeaderIds || []).length},${e.isActive ? 'Active' : 'Inactive'}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'executives_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const renderPagination = () => {
    if (filtered.length <= pageSize) return null;
    return (
      <View style={s.paginationRow}>
        <TouchableOpacity style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageSizeText}>Show:</Text>
        <TouchableOpacity style={s.pageSizeBtn} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={s.pageSizeBtnText}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderExecutive = ({ item }: { item: any }) => {
    const assigned = getAssignedCompanies(item);
    return (
      <TouchableOpacity
        style={s.execItem}
        onPress={() => { setSelected(item); setShowDetail(true); }}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>{item.name?.charAt(0)?.toUpperCase() || 'E'}</Text>
        </View>
        <View style={s.execInfo}>
          <Text style={s.execName}>{item.name}</Text>
          <Text style={s.execEmail}>{item.email}</Text>
          <Text style={s.execCompanies}>
            {assigned.length} companies · {item.assignedTeamLeaderIds?.length || 0} team leaders
          </Text>
        </View>
        <View>
          <StatusBadge status={item.isActive ? 'Active' : 'Inactive'} color={item.isActive ? '#22c55e' : '#f59e0b'} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Executive Oversight" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Executive Oversight" name={`${filtered.length} total`}
        stats={[
          { label: 'Total', value: executives.length, color: '#3b82f6' },
          { label: 'Active', value: executives.filter((e: any) => e.isActive).length, color: '#10b981' },
          { label: 'Inactive', value: executives.filter((e: any) => !e.isActive).length, color: '#ef4444' },
        ]}
      />

      <View style={s.searchRow}>
        <View style={s.searchFlexWrap}>
          <PremiumSearchBar value={searchTerm} onChangeText={setSearchTerm} placeholder="Search executives..." />
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={paginated}
        keyExtractor={item => item.id}
        renderItem={renderExecutive}
        contentContainerStyle={filtered.length === 0 ? s.emptyList : s.list}
        ListEmptyComponent={<EmptyStateView icon="ribbon-outline" title="No executives" subtitle="No executives found" />}
        ListFooterComponent={renderPagination}
      />

      <PremiumModal visible={showDetail} onClose={() => setShowDetail(false)} title={selected?.name || ''}>
        {selected && (
          <View style={s.detailContent}>
            <Text style={s.detailEmail}>{selected.email}</Text>
            <Text style={[s.detailStatus, { color: selected.isActive ? '#22c55e' : '#ef4444' }]}>
              {selected.isActive ? 'Active' : 'Inactive'}
            </Text>

            <PremiumCard style={{ marginTop: 16, padding: 12 }}>
              <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Assigned Companies</Text>
              {getAssignedCompanies(selected).map((c: any) => (
                <Text key={c.id} style={s.companyItem}>{c.name}</Text>
              ))}
              {getAssignedCompanies(selected).length === 0 && (
                <Text style={{ color: colors.textSecondary }}>No companies assigned</Text>
              )}
            </PremiumCard>

            <TouchableOpacity style={s.assignBtn} onPress={() => { setSelectedCompanies(selected.assignedCompanyIds || []); setShowAssign(true); }}>
              <Ionicons name="business-outline" size={18} color="#fff" />
              <Text style={s.assignBtnText}>Manage Company Assignments</Text>
            </TouchableOpacity>
          </View>
        )}
      </PremiumModal>

      <PremiumBottomSheet visible={showAssign} onClose={() => setShowAssign(false)} title="Assign Companies">
        <Text style={s.assignLabel}>Select companies for {selected?.name}</Text>
        {allCompanies.map((c: any) => {
          const isSelected = selectedCompanies.includes(c.id);
          return (
            <TouchableOpacity
              key={c.id}
              style={[s.companyOption, isSelected && s.companyOptionSelected]}
              onPress={() => {
                setSelectedCompanies(prev =>
                  isSelected ? prev.filter(id => id !== c.id) : [...prev, c.id]
                );
              }}
            >
              <View style={[s.companyDot, { backgroundColor: c.logoColor || colors.accent }]} />
              <Text style={s.companyOptionText}>{c.name}</Text>
              {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={s.saveBtn} onPress={handleAssign}>
          <Text style={s.saveBtnText}>Save Assignments</Text>
        </TouchableOpacity>
      </PremiumBottomSheet>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, gap: 10 },
  searchFlexWrap: { flex: 1, marginHorizontal: -16 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  execItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 10, elevation: 1, backgroundColor: c.card },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: '#8b5cf6' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  execInfo: { flex: 1, marginLeft: 12 },
  execName: { fontSize: 15, fontWeight: '600', color: c.text },
  execEmail: { fontSize: 13, color: c.textSecondary },
  execCompanies: { fontSize: 12, marginTop: 2, color: c.textSecondary },
  detailContent: { paddingBottom: 20 },
  detailEmail: { fontSize: 14, marginBottom: 4, color: c.textSecondary },
  detailStatus: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  companyItem: { fontSize: 14, paddingVertical: 2, color: c.text },
  assignBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 16, backgroundColor: c.accent },
  assignBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  assignLabel: { fontSize: 14, marginBottom: 12, color: c.textSecondary },
  companyOption: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 6, gap: 10, backgroundColor: c.card },
  companyOptionSelected: { backgroundColor: 'rgba(59,130,246,0.1)' },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyOptionText: { fontSize: 14, fontWeight: '500', flex: 1, color: c.text },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 12, backgroundColor: c.accent },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
