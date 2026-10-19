import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SalaryStructure } from '../../types/user';
import { getSalaryStructuresByCompany, createSalaryStructure, updateSalaryStructure, deleteSalaryStructure, computeGross } from '../../services/salaryStructureService';
import { HeroBanner, PremiumCard, ShimmerLoader, EmptyStateView, PremiumModal } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';

export const SalaryStructureScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', basicSalary: '', hra: '', da: '', conveyance: '', medical: '',
    specialAllowance: '', pf: '', professionalTax: '', overtimeRate: '',
  });
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    if (!effectiveCompanyId) return;
    const data = await getSalaryStructuresByCompany(effectiveCompanyId);
    setStructures(data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [effectiveCompanyId]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const resetForm = () => setForm({ name: '', description: '', basicSalary: '', hra: '', da: '', conveyance: '', medical: '', specialAllowance: '', pf: '', professionalTax: '', overtimeRate: '' });

  const openEdit = (st: SalaryStructure) => {
    setEditId(st.id);
    setForm({ name: st.name, description: st.description || '', basicSalary: String(st.basicSalary), hra: String(st.hra), da: String(st.da), conveyance: String(st.conveyance), medical: String(st.medical), specialAllowance: String(st.specialAllowance), pf: String(st.pf), professionalTax: String(st.professionalTax), overtimeRate: String(st.overtimeRate) });
    setAddModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Required', 'Name is required'); return; }
    const nums = { basicSalary: Number(form.basicSalary) || 0, hra: Number(form.hra) || 0, da: Number(form.da) || 0, conveyance: Number(form.conveyance) || 0, medical: Number(form.medical) || 0, specialAllowance: Number(form.specialAllowance) || 0, pf: Number(form.pf) || 0, professionalTax: Number(form.professionalTax) || 0, overtimeRate: Number(form.overtimeRate) || 0 };
    try {
      if (editId) await updateSalaryStructure(editId, { ...nums, name: form.name.trim(), description: form.description.trim() });
      else await createSalaryStructure({ ...nums, name: form.name.trim(), description: form.description.trim(), companyId: effectiveCompanyId || '' });
      setAddModal(false); resetForm(); setEditId(null); await fetchData();
    } catch { Alert.alert('Error', 'Failed to save'); }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete', 'Delete this structure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteSalaryStructure(id); await fetchData(); } catch { Alert.alert('Error', 'Failed'); } }},
    ]);
  };

  const toCurrency = (n: number) => `₹${n.toLocaleString()}`;

  const filtered = useMemo(() => {
    return structures.filter(st => {
      if (search) {
        const q = search.toLowerCase();
        if (!st.name.toLowerCase().includes(q) && !(st.description || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [structures, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Description,Basic,HRA,DA,Conveyance,Medical,SpecialAllowance,PF,ProfessionalTax,OvertimeRate,Gross'];
      const rows = filtered.map(st => `${st.name.replace(/,/g, ';')},${(st.description || '').replace(/,/g, ';')},${st.basicSalary},${st.hra},${st.da},${st.conveyance},${st.medical},${st.specialAllowance},${st.pf},${st.professionalTax},${st.overtimeRate},${st.grossSalary}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'salary_structures_export.csv');
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

  if (loading) return <ShimmerLoader count={4} height={120} style={{ padding: 16 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Salary Structures" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner greeting="Compensation" name="Salary Structures" subtitle="Salary templates for your team"
          stats={[{ label: 'Templates', value: structures.length, color: '#FF6600' }]} />
        <Text style={s.count}>{filtered.length} total</Text>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search structures..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        {structures.length === 0 ? <EmptyStateView icon="wallet-outline" title="No structures" subtitle="Create your first salary template" /> :
        paginated.map((st) => (
          <PremiumCard key={st.id} style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{st.name}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => openEdit(st)}><Icon name="create-outline" size={18} color={colors.textSecondary} /></TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(st.id)}><Icon name="trash-outline" size={18} color={colors.danger} /></TouchableOpacity>
              </View>
            </View>
            {st.description ? <Text style={{ fontSize: 12, color: colors.textTertiary, marginBottom: 10 }}>{st.description}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {[
                { l: 'Basic', v: st.basicSalary }, { l: 'HRA', v: st.hra }, { l: 'DA', v: st.da },
                { l: 'Conveyance', v: st.conveyance }, { l: 'Medical', v: st.medical }, { l: 'Special', v: st.specialAllowance },
                { l: 'PF', v: st.pf }, { l: 'Prof Tax', v: st.professionalTax },
              ].map(f => (
                <View key={f.l} style={{ minWidth: '22%' }}>
                  <Text style={{ fontSize: 10, color: colors.textTertiary, textTransform: 'uppercase' }}>{f.l}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{toCurrency(f.v)}</Text>
                </View>
              ))}
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '600' }}>Gross Salary</Text>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.accent }}>{toCurrency(st.grossSalary)}</Text>
            </View>
          </PremiumCard>
        ))}
        {renderPagination()}
        <View style={{ height: 80 }} />
      </ScrollView>

      <TouchableOpacity style={[s.fab, { backgroundColor: colors.accent }]} onPress={() => { resetForm(); setEditId(null); setAddModal(true); }}>
        <Icon name="add-outline" size={24} color="#fff" />
      </TouchableOpacity>

      <PremiumModal visible={addModal} onClose={() => { setAddModal(false); resetForm(); setEditId(null); }} title={editId ? 'Edit Structure' : 'New Structure'}>
        <TextInput style={[s.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          placeholder="Template name" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm(f => ({ ...f, name: t }))} />
        <TextInput style={[s.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          placeholder="Description (optional)" placeholderTextColor={colors.textTertiary} value={form.description} onChangeText={(t) => setForm(f => ({ ...f, description: t }))} />
        {[{ key: 'basicSalary', label: 'Basic Salary' }, { key: 'hra', label: 'HRA' }, { key: 'da', label: 'DA' }, { key: 'conveyance', label: 'Conveyance' }, { key: 'medical', label: 'Medical' }, { key: 'specialAllowance', label: 'Special Allowance' }, { key: 'pf', label: 'PF (Employer)' }, { key: 'professionalTax', label: 'Professional Tax' }, { key: 'overtimeRate', label: 'Overtime Rate/hr' }].map(f => (
          <View key={f.key}>
            <Text style={[s.label, { color: colors.textSecondary }]}>{f.label}</Text>
            <TextInput style={[s.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
              placeholder="0" keyboardType="decimal-pad" placeholderTextColor={colors.textTertiary}
              value={(form as any)[f.key]} onChangeText={(t) => setForm(fm => ({ ...fm, [f.key]: t }))} />
          </View>
        ))}
        {(form.basicSalary || form.hra || form.da || form.conveyance || form.medical || form.specialAllowance) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>Gross</Text>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.accent }}>₹{computeGross({
              basicSalary: Number(form.basicSalary) || 0, hra: Number(form.hra) || 0, da: Number(form.da) || 0,
              conveyance: Number(form.conveyance) || 0, medical: Number(form.medical) || 0, specialAllowance: Number(form.specialAllowance) || 0,
            }).toLocaleString()}</Text>
          </View>
        ) : null}
        <TouchableOpacity style={{ backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12 }}
          onPress={handleSave}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{editId ? 'Update' : 'Create'} Structure</Text>
        </TouchableOpacity>
      </PremiumModal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 4 },
  count: { color: c.textSecondary, fontSize: 13, marginHorizontal: 16, marginBottom: 8, textAlign: 'right' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
});
