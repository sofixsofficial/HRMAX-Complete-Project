import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Linking, TextInput, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, orderBy, serverTimestamp } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { HeroBanner, PremiumCard, PremiumSearchBar, StatusBadge, EmptyStateView, PremiumBottomSheet, FloatingActionButton } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';

const CATEGORIES = ['Policy', 'HR', 'Payroll', 'Legal', 'Contract', 'Report', 'Form', 'Training', 'Other'];

export default function DocumentsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();

  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showUpload, setShowUpload] = useState(false);
  const [docName, setDocName] = useState('');
  const [docCategory, setDocCategory] = useState('HR');
  const [docUrl, setDocUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    loadDocs();
  }, [scopeIds]);

  const loadDocs = async () => {
    try {
      if (scopeIds.length === 0) {
        if (isRestrictedScope) { setDocuments([]); setLoading(false); return; }
        const snap = await getDocs(query(collection(db, 'documents'), orderBy('createdAt', 'desc')));
        setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) =>
          getDocs(query(collection(db, 'documents'), where('companyId', '==', id), orderBy('createdAt', 'desc')))
            .catch(() => ({ docs: [] as any[] }))
        )
      );
      const toMs = (d: any) => (d?.createdAt?.toDate ? d.createdAt.toDate().getTime() : new Date(d?.createdAt || 0).getTime());
      const data = results
        .flatMap((snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() })))
        .sort((a: any, b: any) => toMs(b) - toMs(a));
      setDocuments(data);
    } catch (err) {
      console.error('Docs load error:', err);
    }
    setLoading(false);
  };

  const filtered = documents.filter((d: any) => {
    if (categoryFilter !== 'All' && d.category !== categoryFilter) return false;
    if (!searchTerm) return true;
    return d.name?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, categoryFilter]);

  const handleUpload = async () => {
    if (!docName.trim() || !docUrl.trim()) {
      Alert.alert('Required', 'Name and URL are required');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'documents'), {
        name: docName.trim(), category: docCategory, url: docUrl.trim(),
        uploadedBy: user?.name || '', uploadedById: user?.id || '',
        companyId: effectiveCompanyId || '', createdAt: serverTimestamp(),
      });
      setShowUpload(false);
      resetForm();
      loadDocs();
    } catch {
      Alert.alert('Error', 'Failed to add document');
    }
    setSubmitting(false);
  };

  const resetForm = () => { setDocName(''); setDocUrl(''); setDocCategory('HR'); };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'Policy': return '#3b82f6';
      case 'HR': return '#8b5cf6';
      case 'Payroll': return '#22c55e';
      case 'Legal': return '#f59e0b';
      case 'Training': return '#ec4899';
      default: return '#6b7280';
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Category,URL,Uploaded By'];
      const rows = filtered.map((d: any) => `${d.name || ''},${d.category || ''},${(d.url || '').replace(/,/g, ';')},${(d.uploadedBy || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'documents_export.csv');
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
      <View style={styles.paginationRow}>
        <TouchableOpacity style={[styles.pageBtn, { backgroundColor: colors.card, borderColor: colors.border }, currentPage === 1 && styles.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.pageInfo, { color: colors.text }]}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[styles.pageBtn, { backgroundColor: colors.card, borderColor: colors.border }, currentPage === totalPages && styles.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={styles.pageSizeText}>Show:</Text>
        <TouchableOpacity style={[styles.pageSizeBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={[styles.pageSizeBtnText, { color: colors.text }]}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderDoc = ({ item }: { item: any }) => (
    <PremiumCard style={styles.docCard}>
      <TouchableOpacity onPress={() => item.url && Linking.openURL(item.url)}>
        <View style={styles.docRow}>
          <View style={[styles.docIcon, { backgroundColor: getCategoryColor(item.category) + '20' }]}>
            <Ionicons name="document-text-outline" size={24} color={getCategoryColor(item.category)} />
          </View>
          <View style={styles.docInfo}>
            <Text style={[styles.docName, { color: colors.text }]}>{item.name}</Text>
            <StatusBadge status={item.category || 'Other'} color="#3b82f6" />
          </View>
          <TouchableOpacity onPress={() => {
            Alert.alert('Delete', 'Delete this document?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'documents', item.id)).then(loadDocs) },
            ]);
          }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.docMeta, { color: colors.textSecondary }]}>
          {item.uploadedBy} · {item.createdAt?.toDate?.()?.toLocaleDateString() || ''}
        </Text>
      </TouchableOpacity>
    </PremiumCard>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Documents" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Documents" name={`${filtered.length} total`}
        stats={[
          { label: 'Total', value: documents.length, color: '#3b82f6' },
          { label: 'HR', value: documents.filter((d: any) => d.category === 'HR').length, color: '#10b981' },
          { label: 'Policy', value: documents.filter((d: any) => d.category === 'Policy').length, color: '#64748b' },
        ]}
      />

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['All', ...CATEGORIES].map(c => (
            <TouchableOpacity key={c} style={[styles.filterChip, categoryFilter === c && { backgroundColor: colors.accent }]} onPress={() => setCategoryFilter(c)}>
              <Text style={[styles.filterChipText, { color: categoryFilter === c ? '#fff' : colors.textSecondary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <PremiumSearchBar value={searchTerm} onChangeText={setSearchTerm} placeholder="Search documents..." />
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={paginated}
          keyExtractor={item => item.id}
          renderItem={renderDoc}
          contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={<EmptyStateView icon="folder-open-outline" title="No documents" subtitle="No documents uploaded yet" />}
          ListFooterComponent={renderPagination()}
        />
      )}

      <FloatingActionButton icon="add" onPress={() => setShowUpload(true)} />

      <PremiumBottomSheet visible={showUpload} onClose={() => setShowUpload(false)} title="Upload Document">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
          value={docName} onChangeText={setDocName} placeholder="Document name" placeholderTextColor={colors.textSecondary} />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map(c => (
            <TouchableOpacity key={c} style={[styles.chip, docCategory === c && { backgroundColor: colors.accent }]} onPress={() => setDocCategory(c)}>
              <Text style={[styles.chipText, { color: docCategory === c ? '#fff' : colors.textSecondary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>URL</Text>
        <TextInput
          style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
          value={docUrl} onChangeText={setDocUrl} placeholder="https://..." placeholderTextColor={colors.textSecondary} autoCapitalize="none" />

        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.accent }]} onPress={handleUpload} disabled={submitting}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitBtnText}>Upload</Text>}
        </TouchableOpacity>
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start' },
  exportBtn: { marginLeft: 10, marginRight: 16, backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: '#111827', fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: '#64748b', fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  pageSizeBtnText: { color: '#111827', fontSize: 13, fontWeight: '600' },
  docCard: { marginHorizontal: 16, marginBottom: 10, padding: 14 },
  docRow: { flexDirection: 'row', alignItems: 'center' },
  docIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  docInfo: { flex: 1, marginLeft: 12 },
  docName: { fontSize: 15, fontWeight: '600' },
  docMeta: { fontSize: 12, marginTop: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4, marginTop: 12 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e2e8f0' },
  chipText: { fontSize: 12, fontWeight: '500' },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
