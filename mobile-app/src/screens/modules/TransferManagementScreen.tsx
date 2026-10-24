import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, addDoc, getDocs, getDoc, doc, updateDoc, serverTimestamp, query, orderBy } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { getAllCompanies } from '../../services/companyService';
import { subscribeEmployees } from '../../services/employeeService';
import { HeroBanner, PremiumCard, PremiumSearchBar, StatusBadge, EmptyStateView, PremiumBottomSheet, FloatingActionButton } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

export default function TransferManagementScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [employees, setEmployees] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [targetCompany, setTargetCompany] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [companies, transSnap] = await Promise.all([
        getAllCompanies(),
        getDocs(query(collection(db, 'transfers'), orderBy('createdAt', 'desc'))),
      ]);
      setCompanies(companies);
      setTransfers(transSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Transfer load error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    const unsub = subscribeEmployees(null, (emps) => setEmployees(emps));
    return unsub;
  }, []);

  const handleTransfer = async () => {
    if (!selectedEmp || !targetCompany) {
      Alert.alert('Required', 'Select employee and target company');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'transfers'), {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name,
        employeeEmail: selectedEmp.email,
        fromCompanyId: selectedEmp.companyId,
        fromCompanyName: companies.find(c => c.id === selectedEmp.companyId)?.name || 'Unknown',
        toCompanyId: targetCompany,
        toCompanyName: companies.find(c => c.id === targetCompany)?.name || 'Unknown',
        status: 'Pending',
        requestedBy: user?.name || '',
        requestedById: user?.id || '',
        createdAt: serverTimestamp(),
      });
      Alert.alert('Success', 'Transfer request created');
      setShowTransfer(false);
      setSelectedEmp(null);
      setTargetCompany('');
      loadData();
    } catch {
      Alert.alert('Error', 'Failed to create transfer');
    }
    setSubmitting(false);
  };

  const approveTransfer = async (transfer: any) => {
    Alert.alert('Approve Transfer', `Approve transfer of ${transfer.employeeName} to ${transfer.toCompanyName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        try {
          const empSnap = await getDoc(doc(db, 'employees', transfer.employeeId));
          const empData = empSnap.exists() ? empSnap.data() : null;
          const uid = empData?.userId || transfer.employeeUserId;
          if (uid) {
            await updateDoc(doc(db, 'users', uid), { companyId: transfer.toCompanyId }).catch(() => {});
          }
          await updateDoc(doc(db, 'employees', transfer.employeeId), { companyId: transfer.toCompanyId });
          await updateDoc(doc(db, 'transfers', transfer.id), {
            status: 'Approved',
            approvedAt: serverTimestamp(),
            approvedBy: user?.name || '',
            approvedById: user?.id || '',
          });
          loadData();
        } catch {
          Alert.alert('Error', 'Failed to approve transfer');
        }
      }},
    ]);
  };

  const filteredEmployees = useMemo(() => employees.filter((e: any) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return e.name?.toLowerCase().includes(s) || e.email?.toLowerCase().includes(s);
  }), [employees, searchTerm]);

  const filtered = transfers;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Employee,From Company,To Company,Status,Requested By,Created At'];
      const rows = filtered.map(t => `${(t.employeeName || '').replace(/,/g, ';')},${(t.fromCompanyName || '').replace(/,/g, ';')},${(t.toCompanyName || '').replace(/,/g, ';')},${t.status || ''},${(t.requestedBy || '').replace(/,/g, ';')},${t.createdAt?.toDate?.()?.toLocaleDateString() || ''}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'transfer_management_export.csv');
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
        <TouchableOpacity style={[styles.pageBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }, currentPage === 1 && styles.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.pageInfo, { color: colors.text }]}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[styles.pageBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }, currentPage === totalPages && styles.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.pageSizeText, { color: colors.textSecondary }]}>Show:</Text>
        <TouchableOpacity style={[styles.pageSizeBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }]} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={[styles.pageSizeBtnText, { color: colors.text }]}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Transfer Management" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Transfer Management" name={`${transfers.length} total`} subtitle="arrow-redo-outline"
        stats={[
          { label: 'Total', value: transfers.length, color: '#3b82f6' },
          { label: 'Pending', value: transfers.filter((t: any) => t.status === 'Pending').length, color: '#eab308' },
          { label: 'Approved', value: transfers.filter((t: any) => t.status === 'Approved').length, color: '#10b981' },
        ]}
      />

      <View style={styles.searchRow}>
        <PremiumSearchBar style={styles.searchBar} value={searchTerm} onChangeText={setSearchTerm} placeholder="Search employees..." />
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
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Recent Transfers</Text>
          }
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <EmptyStateView icon="arrow-redo-outline" title="No transfers" subtitle="No transfer requests found" />
            </View>
          }
          renderItem={({ item }: { item: any }) => (
            <PremiumCard style={styles.transferCard}>
              <View style={styles.transferHeader}>
                <Text style={[styles.transferEmp, { color: colors.text }]}>{item.employeeName}</Text>
                <StatusBadge
                  status={item.status}
                  color={item.status === 'Approved' ? '#22c55e' : '#f59e0b'}
                />
              </View>
              <Text style={[styles.transferPath, { color: colors.textSecondary }]}>
                {item.fromCompanyName} → {item.toCompanyName}
              </Text>
              <Text style={[styles.transferDate, { color: colors.textSecondary }]}>
                {item.createdAt?.toDate?.()?.toLocaleDateString() || 'N/A'}
              </Text>
              {item.status === 'Pending' && (
                <TouchableOpacity style={styles.approveBtn} onPress={() => approveTransfer(item)}>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <Text style={styles.approveBtnText}>Approve Transfer</Text>
                </TouchableOpacity>
              )}
            </PremiumCard>
          )}
          ListFooterComponent={renderPagination}
        />
      )}

      <FloatingActionButton icon="git-branch-outline" onPress={() => setShowTransfer(true)} />

      <PremiumBottomSheet visible={showTransfer} onClose={() => setShowTransfer(false)} title="New Transfer">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Select Employee</Text>
        <FlatList
          data={filteredEmployees}
          keyExtractor={item => item.id}
          style={{ maxHeight: 200 }}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={[styles.empOption, selectedEmp?.id === item.id && { backgroundColor: 'rgba(59,130,246,0.1)' }]}
              onPress={() => setSelectedEmp(item)}
            >
              <Text style={[styles.empOptionName, { color: colors.text }]}>{item.name}</Text>
              <Text style={[styles.empOptionDept, { color: colors.textSecondary }]}>{item.department}</Text>
            </TouchableOpacity>
          )}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 12 }]}>Target Company</Text>
        {companies.filter(c => c.id !== selectedEmp?.companyId).map(c => (
          <TouchableOpacity
            key={c.id}
            style={[styles.companyOption, targetCompany === c.id && { backgroundColor: 'rgba(59,130,246,0.1)' }]}
            onPress={() => setTargetCompany(c.id)}
          >
            <View style={[styles.companyDot, { backgroundColor: c.logoColor || colors.accent }]} />
            <Text style={[styles.companyOptionName, { color: colors.text }]}>{c.name}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.accent }]} onPress={handleTransfer} disabled={submitting}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitBtnText}>Create Transfer Request</Text>}
        </TouchableOpacity>
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 80 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  searchBar: { flex: 1, marginHorizontal: 0, marginBottom: 0 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  pageSizeBtnText: { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, textTransform: 'uppercase' },
  transferCard: { marginHorizontal: 16, marginBottom: 10, padding: 14 },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transferEmp: { fontSize: 15, fontWeight: '600' },
  transferPath: { fontSize: 13, marginTop: 4 },
  transferDate: { fontSize: 12, marginTop: 2 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#f0fdf4', borderRadius: 8, alignSelf: 'flex-start' },
  approveBtnText: { color: '#22c55e', fontSize: 13, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  empOption: { padding: 10, borderRadius: 8, marginBottom: 4 },
  empOptionName: { fontSize: 14, fontWeight: '500' },
  empOptionDept: { fontSize: 12 },
  companyOption: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, marginBottom: 4 },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyOptionName: { fontSize: 14, fontWeight: '500' },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
