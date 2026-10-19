import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../config/firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, Timestamp } from 'firebase/firestore';
import { useCompany } from '../../context/CompanyContext';
import { useAuth } from '../../context/AuthContext';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PermissionGate } from '../../components/PermissionGate';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../utils/icons';

interface FormData { name: string; date: string; type: string; description: string; }
const EMPTY_FORM: FormData = { name: '', date: '', type: 'Public', description: '' };

const TYPE_COLORS: Record<string, string> = { Public: '#FF6600', Company: '#3b82f6', Optional: '#10b981' };

const YEARS = ['2024', '2025', '2026', '2027', '2028'];

export const HolidayCalendarScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [holidays, setHolidays] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [typeFilter, setTypeFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [viewModal, setViewModal] = useState<any>(null);
  const s = useMemo(() => createStyles(colors), [colors]);

  // Active scope: selected company, or every authorized company in "All" mode.
  // Empty array = unrestricted role (master-admin) keeps legacy unfiltered view.
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  const fetchHolidays = useCallback(async () => {
    try {
      const start = Timestamp.fromDate(new Date(parseInt(year), 0, 1));
      const end = Timestamp.fromDate(new Date(parseInt(year), 11, 31, 23, 59, 59));
      const base: any[] = [
        where('date', '>=', start),
        where('date', '<=', end),
      ];
      let docs;
      if (scopeIds.length === 0) {
        if (user?.role === 'executive' || user?.role === 'team-leader') { setHolidays([]); return; }
        docs = (await getDocs(query(collection(db, 'holidays'), ...base))).docs;
      } else if (effectiveCompanyId) {
        const [globalSnap, companySnap] = await Promise.all([
          getDocs(query(collection(db, 'holidays'), ...base, where('companyId', '==', null))),
          getDocs(query(collection(db, 'holidays'), ...base, where('companyId', '==', effectiveCompanyId))),
        ]);
        docs = [...globalSnap.docs, ...companySnap.docs];
      } else {
        // All Companies mode: global holidays + each authorized company's
        const globalSnap = await getDocs(query(collection(db, 'holidays'), ...base, where('companyId', '==', null)));
        const companySnaps = await Promise.all(
          scopeIds.map((id) =>
            getDocs(query(collection(db, 'holidays'), ...base, where('companyId', '==', id))).catch(() => ({ docs: [] as any[] }))
          )
        );
        docs = [...globalSnap.docs, ...companySnaps.flatMap((s: any) => s.docs)];
      }
      const seen = new Map<string, any>();
      for (const d of docs) seen.set(d.id, { id: d.id, ...d.data() });
      setHolidays([...seen.values()]);
    } catch (err) { console.error(err); }
  }, [scopeIds, effectiveCompanyId, user?.role, year]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const onRefresh = async () => { setRefreshing(true); await fetchHolidays(); setRefreshing(false); };

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };

  const openEdit = (h: any) => {
    setEditing(h.id);
    const d = h.date?.toDate ? h.date.toDate() : new Date(h.date);
    setForm({ name: h.name || '', date: d.toISOString().split('T')[0], type: h.type || 'Public', description: h.description || '' });
    setModal(true);
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete Holiday', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteDoc(doc(db, 'holidays', id)); await fetchHolidays(); }},
    ]);
  };

  const handleSave = async () => {
    if (!form.name || !form.date) { Alert.alert('Validation', 'Name and date required'); return; }
    try {
      const payload = { ...form, companyId: effectiveCompanyId, date: Timestamp.fromDate(new Date(form.date)) };
      if (editing) {
        await updateDoc(doc(db, 'holidays', editing), payload);
      } else {
        await addDoc(collection(db, 'holidays'), { ...payload, createdAt: Timestamp.now() });
      }
      setModal(false); await fetchHolidays();
    } catch (err) { Alert.alert('Error', 'Failed to save holiday'); }
  };

  const formatDate = (d: any) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const stats = useMemo(() => ({
    total: holidays.length,
    public: holidays.filter(h => h.type === 'Public').length,
    company: holidays.filter(h => h.type === 'Company').length,
    optional: holidays.filter(h => h.type === 'Optional').length,
  }), [holidays]);

  const filtered = useMemo(() => {
    return holidays.filter(h => {
      if (typeFilter !== 'All' && h.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!h.name?.toLowerCase().includes(q) && !(h.description || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [holidays, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, typeFilter, year]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Date,Type,Description'];
      const rows = filtered.map(h => `${h.name || ''},${formatDate(h.date)},${h.type || ''},${(h.description || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'holidays_export.csv');
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

  const holidaysByMonth: Record<string, any[]> = {};
  paginated.forEach((h) => {
    const d = h.date?.toDate ? h.date.toDate() : new Date(h.date);
    const key = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    if (!holidaysByMonth[key]) holidaysByMonth[key] = [];
    holidaysByMonth[key].push(h);
  });

  return (
    <View style={s.container}>
      <ScreenHeader title="Holiday Calendar" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Holiday Calendar</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search holidays..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
          <PermissionGate module="holidays" action="create">
            <TouchableOpacity style={s.addBtn} onPress={openCreate}>
              <Icon name="add-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </PermissionGate>
        </View>

        <View style={s.statsRow}>
          {[{ label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Public', value: stats.public, color: '#3b82f6' },
            { label: 'Company', value: stats.company, color: '#10b981' },
            { label: 'Optional', value: stats.optional, color: '#8b5cf6' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setTypeFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.yearRow}>
          {YEARS.map((y) => (
            <TouchableOpacity key={y} style={[s.yearBtn, year === y && s.yearBtnActive]} onPress={() => setYear(y)}>
              <Text style={[s.yearText, year === y && s.yearTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.list}>
          {Object.keys(holidaysByMonth).length === 0 ? (
            <Text style={s.emptyText}>No holidays found for {year}</Text>
          ) : (
            Object.entries(holidaysByMonth).map(([month, monthHolidays]) => (
              <View key={month}>
                <Text style={s.monthTitle}>{month} ({monthHolidays.length})</Text>
                {monthHolidays.map((h) => (
                  <TouchableOpacity key={h.id} onPress={() => setViewModal(h)}>
                    <View style={s.card}>
                      <View style={s.cardHeader}>
                        <View style={[s.typeDot, { backgroundColor: TYPE_COLORS[h.type] || '#FF6600' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.holidayName}>{h.name}</Text>
                          <Text style={s.holidayDate}>{formatDate(h.date)}</Text>
                        </View>
                        <View style={s.cardActions}>
                          <PermissionGate module="holidays" action="edit">
                            <TouchableOpacity onPress={() => openEdit(h)}><Text style={s.editBtn}>Edit</Text></TouchableOpacity>
                          </PermissionGate>
                          <PermissionGate module="holidays" action="delete">
                            <TouchableOpacity onPress={() => handleDelete(h.id, h.name)}><Text style={s.delBtn}>Del</Text></TouchableOpacity>
                          </PermissionGate>
                        </View>
                      </View>
                      {h.description ? <Text style={s.desc}>{h.description}</Text> : null}
                      <View style={[s.typeBadge, { backgroundColor: `${TYPE_COLORS[h.type] || '#FF6600'}20` }]}>
                        <Text style={[s.typeText, { color: TYPE_COLORS[h.type] || '#FF6600' }]}>{h.type}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={!!viewModal} transparent animationType="fade" onRequestClose={() => setViewModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setViewModal(null)}>
          <View style={s.viewModal}>
            <Text style={s.viewTitle}>{viewModal?.name}</Text>
            <Text style={s.viewDate}>{viewModal ? formatDate(viewModal.date) : ''}</Text>
            <View style={[s.typeBadge, { backgroundColor: `${TYPE_COLORS[viewModal?.type] || '#FF6600'}20`, alignSelf: 'flex-start' }]}>
              <Text style={[s.typeText, { color: TYPE_COLORS[viewModal?.type] || '#FF6600' }]}>{viewModal?.type}</Text>
            </View>
            {viewModal?.description ? <Text style={s.viewDesc}>{viewModal.description}</Text> : null}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{editing ? 'Edit Holiday' : 'Add Holiday'}</Text>
            <TextInput style={s.modalInput} placeholder="Holiday Name" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
            <TextInput style={s.modalInput} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.date} onChangeText={(t) => setForm({...form, date: t})} />
            <View style={s.typeRow}>
              {['Public', 'Company', 'Optional'].map((t) => (
                <TouchableOpacity key={t} style={[s.typeOption, form.type === t && { backgroundColor: TYPE_COLORS[t], borderColor: TYPE_COLORS[t] }]} onPress={() => setForm({...form, type: t})}>
                  <Text style={[s.typeOptionText, form.type === t && { color: '#fff' }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={[s.modalInput, { minHeight: 60 }]} placeholder="Description (optional)" placeholderTextColor={colors.textTertiary} value={form.description} onChangeText={(t) => setForm({...form, description: t})} multiline />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={handleSave}><Text style={s.saveBtnText}>{editing ? 'Update' : 'Create'}</Text></TouchableOpacity>
            </View>
          </View>
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
  statCard: { backgroundColor: c.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 22, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  yearRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  yearBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  yearBtnActive: { backgroundColor: '#FF6600' },
  yearText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  yearTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  monthTitle: { color: '#FF6600', fontSize: 18, fontWeight: 'bold', marginBottom: 12, marginTop: 8 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeDot: { width: 10, height: 10, borderRadius: 5 },
  holidayName: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
  holidayDate: { color: c.textSecondary, fontSize: 12, marginTop: 1 },
  cardActions: { flexDirection: 'row', gap: 8 },
  editBtn: { color: '#3b82f6', fontWeight: '600', fontSize: 12 },
  delBtn: { color: '#ef4444', fontWeight: '600', fontSize: 12 },
  desc: { color: c.textTertiary, fontSize: 12, marginTop: 4 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  typeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 6 },
  typeText: { fontSize: 11, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 20 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 12 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  typeOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  typeOptionText: { color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  viewModal: { backgroundColor: c.card, borderRadius: 16, padding: 24 },
  viewTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 8 },
  viewDate: { color: c.textSecondary, fontSize: 15, marginBottom: 8 },
  viewDesc: { color: c.textTertiary, fontSize: 14, marginTop: 12 },
});
