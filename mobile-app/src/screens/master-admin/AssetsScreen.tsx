import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../aws/clients';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, Timestamp } from '../../aws/firestore-compat';
import { useCompany } from '../../context/CompanyContext';
import { useAuth } from '../../context/AuthContext';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';

const CATEGORIES = ['Laptop', 'Mobile', 'Vehicle', 'Furniture', 'Equipment', 'Software', 'Other'];
const STATUSES = ['Assigned', 'Available', 'Maintenance', 'Damaged', 'Retired'];

const STATUS_COLORS: Record<string, string> = {
  Assigned: '#3b82f6', Available: '#10b981', Maintenance: '#eab308', Damaged: '#ef4444', Retired: '#64748b',
};

interface FormData { name: string; category: string; serial: string; status: string; assignedToName: string; notes: string; companyId: string; }
const EMPTY_FORM: FormData = { name: '', category: 'Laptop', serial: '', status: 'Available', assignedToName: '', notes: '', companyId: '' };

export const AssetsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { user } = useAuth();
  const [assets, setAssets] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [filter, setFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [viewAsset, setViewAsset] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const s = useMemo(() => createStyles(colors), [colors]);

  const isMasterAdmin = user?.role === 'master-admin';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const showCompanyPicker = !effectiveCompanyId && (isMasterAdmin || isRestrictedScope);

  useEffect(() => {
    if (isMasterAdmin) {
      getDocs(collection(db, 'companies')).then(snap => {
        setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }).catch(() => {});
    } else if (availableCompanies.length > 0) {
      setCompanies(availableCompanies.map(c => ({ id: c.id, name: c.name })));
    }
  }, [isMasterAdmin, availableCompanies]);

  const getCompanyName = (id?: string) => companies.find(c => c.id === id)?.name || '';

  // Active scope: selected company, or every authorized company in "All" mode.
  // Empty array = unrestricted role (master-admin) keeps legacy unfiltered view.
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  const fetchAssets = useCallback(async () => {
    try {
      if (scopeIds.length === 0) {
        if (user?.role === 'executive' || user?.role === 'team-leader') { setAssets([]); return; }
        const snap = await getDocs(collection(db, 'assets'));
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) =>
          getDocs(query(collection(db, 'assets'), where('companyId', '==', id))).catch(() => ({ docs: [] as any[] }))
        )
      );
      const data = results.flatMap((snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setAssets(data);
    } catch (err) { console.error(err); }
  }, [scopeIds, user?.role]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const onRefresh = async () => { setRefreshing(true); await fetchAssets(); setRefreshing(false); };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM, companyId: effectiveCompanyId || availableCompanies[0]?.id || '' }); setModal(true); };

  const openEdit = (a: any) => {
    setEditing(a.id);
    setForm({ name: a.name || '', category: a.category || 'Laptop', serial: a.serial || '', status: a.status || 'Available', assignedToName: a.assignedToName || '', notes: a.notes || '', companyId: a.companyId || effectiveCompanyId || '' });
    setModal(true);
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete Asset', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteDoc(doc(db, 'assets', id)); await fetchAssets(); }},
    ]);
  };

  const handleSave = async () => {
    if (!form.name) { Alert.alert('Validation', 'Asset name required'); return; }
    const targetCompanyId = form.companyId || effectiveCompanyId || availableCompanies[0]?.id || '';
    if (!targetCompanyId) { Alert.alert('Validation', 'Please select a company'); return; }
    try {
      const payload = { ...form, companyId: targetCompanyId, updatedAt: Timestamp.now() };
      if (editing) {
        await updateDoc(doc(db, 'assets', editing), payload);
      } else {
        await addDoc(collection(db, 'assets'), { ...payload, createdAt: Timestamp.now() });
      }
      setModal(false); await fetchAssets();
    } catch (err) { Alert.alert('Error', 'Failed to save asset'); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: assets.length, Available: 0, Assigned: 0, Maintenance: 0, Damaged: 0, Retired: 0 };
    assets.forEach(a => { if (c[a.status] !== undefined) c[a.status]++; });
    return c;
  }, [assets]);

  const filtered = useMemo(() => assets.filter(a => {
    if (filter !== 'All' && a.status !== filter) return false;
    if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.name?.toLowerCase().includes(q) && !(a.serial || '').toLowerCase().includes(q) && !(a.assignedToName || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [assets, filter, categoryFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filter, categoryFilter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Category,Serial,Status,Assigned To,Notes'];
      const rows = filtered.map(a => `${a.name || ''},${a.category || ''},${a.serial || ''},${a.status || ''},${a.assignedToName || ''},${(a.notes || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'assets_export.csv');
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

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN');
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Assets" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Assets</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search assets..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <Icon name="add-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          {['All', 'Available', 'Assigned', 'Maintenance', 'Damaged'].map((st) => (
            <TouchableOpacity key={st} style={[s.statCard, filter === st && { borderLeftColor: '#FF6600' }]} onPress={() => setFilter(st)}>
              <Text style={s.statNum}>{counts[st] || 0}</Text>
              <Text style={s.statLabel}>{st}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          {['All', ...CATEGORIES].map((c) => (
            <TouchableOpacity key={c} style={[s.filterBtn, categoryFilter === c && s.filterBtnActive]} onPress={() => setCategoryFilter(c)}>
              <Text style={[s.filterText, categoryFilter === c && s.filterTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.list}>
          {filtered.length === 0 ? <Text style={s.emptyText}>No assets found</Text> : (
            paginated.map((asset) => (
              <TouchableOpacity key={asset.id} onPress={() => setViewAsset(asset)}>
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.assetName}>{asset.name}</Text>
                      <Text style={s.category}>{asset.category}{asset.serial ? ` • ${asset.serial}` : ''}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[asset.status] || '#64748b'}20` }]}>
                      <Text style={[s.statusText, { color: STATUS_COLORS[asset.status] || '#64748b' }]}>{asset.status}</Text>
                    </View>
                  </View>
                  {asset.assignedToName ? <Text style={s.assigned}>Assigned to: {asset.assignedToName}</Text> : null}
                  {getCompanyName(asset.companyId) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Icon name="business-outline" size={13} color={colors.textTertiary} />
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 4 }} numberOfLines={1}>{getCompanyName(asset.companyId)}</Text>
                    </View>
                  ) : null}
                  {asset.notes ? <Text style={s.notes}>{asset.notes}</Text> : null}
                  <View style={s.cardActions}>
                    <TouchableOpacity onPress={() => openEdit(asset)}><Text style={s.editBtn}>Edit</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(asset.id, asset.name)}><Text style={s.delBtn}>Delete</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={!!viewAsset} transparent animationType="fade" onRequestClose={() => setViewAsset(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setViewAsset(null)}>
            <View style={s.viewModal}>
              <Text style={s.viewTitle}>{viewAsset?.name}</Text>
              <View style={s.viewRow}><Text style={s.viewLabel}>Company:</Text><Text style={s.viewValue}>{getCompanyName(viewAsset?.companyId) || '—'}</Text></View>
              <View style={s.viewRow}><Text style={s.viewLabel}>Category:</Text><Text style={s.viewValue}>{viewAsset?.category}</Text></View>
            {viewAsset?.serial ? <View style={s.viewRow}><Text style={s.viewLabel}>Serial:</Text><Text style={s.viewValue}>{viewAsset.serial}</Text></View> : null}
            <View style={s.viewRow}><Text style={s.viewLabel}>Status:</Text><Text style={[s.viewValue, { color: STATUS_COLORS[viewAsset?.status] || '#64748b' }]}>{viewAsset?.status}</Text></View>
            {viewAsset?.assignedToName ? <View style={s.viewRow}><Text style={s.viewLabel}>Assigned To:</Text><Text style={s.viewValue}>{viewAsset.assignedToName}</Text></View> : null}
            {viewAsset?.notes ? <View style={s.viewRow}><Text style={s.viewLabel}>Notes:</Text><Text style={s.viewValue}>{viewAsset.notes}</Text></View> : null}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll}>
            <View style={s.modal}>
              <Text style={s.modalTitle}>{editing ? 'Edit Asset' : 'Add Asset'}</Text>
              <TextInput style={s.modalInput} placeholder="Asset Name" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              {showCompanyPicker && companies.length > 0 && (
                <>
                  <Text style={s.fieldLabel}>Company:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {companies.map((c) => (
                      <TouchableOpacity key={c.id} style={[s.pickerBtn, form.companyId === c.id && s.pickerBtnActive]} onPress={() => setForm({...form, companyId: c.id})}>
                        <Text style={[s.pickerText, form.companyId === c.id && { color: '#fff' }]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <Text style={s.fieldLabel}>Category:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pickerRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity key={c} style={[s.pickerBtn, form.category === c && s.pickerBtnActive]} onPress={() => setForm({...form, category: c})}>
                    <Text style={[s.pickerText, form.category === c && { color: '#fff' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput style={s.modalInput} placeholder="Serial Number" placeholderTextColor={colors.textTertiary} value={form.serial} onChangeText={(t) => setForm({...form, serial: t})} />
              <Text style={s.fieldLabel}>Status:</Text>
              <View style={s.statusRow}>
                {STATUSES.map((s2) => (
                  <TouchableOpacity key={s2} style={[s.statusOption, form.status === s2 && s.statusOptionActive]} onPress={() => setForm({...form, status: s2})}>
                    <Text style={[s.statusOptionText, form.status === s2 && { color: '#fff' }]}>{s2}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={s.modalInput} placeholder="Assigned To (name)" placeholderTextColor={colors.textTertiary} value={form.assignedToName} onChangeText={(t) => setForm({...form, assignedToName: t})} />
              <TextInput style={[s.modalInput, { minHeight: 60 }]} placeholder="Notes (optional)" placeholderTextColor={colors.textTertiary} value={form.notes} onChangeText={(t) => setForm({...form, notes: t})} multiline />
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={s.saveBtn} onPress={handleSave}><Text style={s.saveBtnText}>{editing ? 'Update' : 'Create'}</Text></TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  searchRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statsRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: c.border, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 20, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  filterRow: { paddingLeft: 20, marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  assetName: { color: c.textPrimary, fontSize: 16, fontWeight: '600' },
  category: { color: c.textSecondary, fontSize: 12, marginTop: 1 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  assigned: { color: '#FF6600', fontSize: 13, marginBottom: 2 },
  notes: { color: c.textTertiary, fontSize: 12 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  editBtn: { color: '#3b82f6', fontWeight: '600', fontSize: 12 },
  delBtn: { color: '#ef4444', fontWeight: '600', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center' },
  modalScroll: { padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 20 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 12 },
  fieldLabel: { color: c.textSecondary, fontSize: 13, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', marginBottom: 12 },
  pickerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, marginRight: 8 },
  pickerBtnActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  pickerText: { color: c.textSecondary, fontSize: 13 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statusOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border },
  statusOptionActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  statusOptionText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  viewModal: { backgroundColor: c.card, borderRadius: 16, padding: 24 },
  viewTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 16 },
  viewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  viewLabel: { color: c.textSecondary, fontSize: 14 },
  viewValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
});
