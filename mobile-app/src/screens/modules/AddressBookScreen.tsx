import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, SectionList, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { subscribeEmployees, subscribeEmployeesScoped } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { HeroBanner, PremiumSearchBar, EmptyStateView, PremiumBottomSheet } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

export default function AddressBookScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();

  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    if (scopeIds.length === 0) {
      if (isRestrictedScope) { setEmployees([]); setLoading(false); return; }
      const unsubAll = subscribeEmployees(null, (emps) => {
        setEmployees(emps);
        setLoading(false);
      });
      return unsubAll;
    }
    const unsub = subscribeEmployeesScoped(scopeIds, (emps) => {
      setEmployees(emps);
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  const filtered = employees.filter(e => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      e.name?.toLowerCase().includes(s) ||
      e.email?.toLowerCase().includes(s) ||
      e.department?.toLowerCase().includes(s) ||
      e.designation?.toLowerCase().includes(s) ||
      e.phone?.toLowerCase().includes(s)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const sections = Array.from(
    new Set(paginated.map(e => (e.department?.charAt(0)?.toUpperCase() || '#') as string))
  ).sort().map(letter => ({
    title: letter,
    data: paginated.filter(e => (e.department?.charAt(0)?.toUpperCase() || '#') === letter),
  }));

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Department,Designation,Phone,EmployeeID'];
      const rows = filtered.map(e => `${(e.name || '').replace(/,/g, ';')},${(e.email || '').replace(/,/g, ';')},${(e.department || '').replace(/,/g, ';')},${(e.designation || '').replace(/,/g, ';')},${(e.phone || '').replace(/,/g, ';')},${(e.employeeId || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'address_book_export.csv');
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

  const renderContact = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.contactItem, { backgroundColor: colors.card }]}
      onPress={() => { setSelected(item); setShowDetail(true); }}
    >
      <View style={[styles.avatar, { backgroundColor: item.departmentColor || colors.accent }]}>
        <Text style={styles.avatarText}>{item.name?.charAt(0)?.toUpperCase() || '?'}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={[styles.contactName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.contactDept, { color: colors.textSecondary }]}>
          {item.designation || item.department} {item.department ? `· ${item.department}` : ''}
        </Text>
        <Text style={[styles.contactEmail, { color: colors.textSecondary }]}>{item.email}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Address Book" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Address Book" name={`${filtered.length} total`}
        stats={[
          { label: 'Total Contacts', value: employees.length, color: '#3b82f6' },
        ]}
      />

      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <PremiumSearchBar value={searchTerm} onChangeText={setSearchTerm} placeholder="Search by name, email, department..." />
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={renderContact}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{section.title}</Text>
        )}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<EmptyStateView icon="book-outline" title="No contacts" subtitle="No employees found" />}
        ListFooterComponent={renderPagination}
      />

      <PremiumBottomSheet visible={showDetail} onClose={() => setShowDetail(false)} title={selected?.name || ''}>
        {selected && (
          <View style={styles.detailContent}>
            <View style={styles.detailAvatarRow}>
              <View style={[styles.detailAvatar, { backgroundColor: selected.departmentColor || colors.accent }]}>
                <Text style={styles.detailAvatarText}>{selected.name?.charAt(0)?.toUpperCase()}</Text>
              </View>
              <View>
                <Text style={[styles.detailName, { color: colors.text }]}>{selected.name}</Text>
                <Text style={[styles.detailRole, { color: colors.textSecondary }]}>{selected.designation}</Text>
              </View>
            </View>
            <View style={styles.detailInfo}>
              {[
                { icon: 'mail-outline', label: 'Email', value: selected.email },
                { icon: 'call-outline', label: 'Phone', value: selected.phone || 'N/A' },
                { icon: 'business-outline', label: 'Department', value: selected.department || 'N/A' },
                { icon: 'location-outline', label: 'Address', value: selected.address || 'N/A' },
                { icon: 'id-card-outline', label: 'Employee ID', value: selected.employeeId || 'N/A' },
              ].map((item, idx) => (
                <View key={idx} style={styles.detailRow}>
                  <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingBottom: 80 },
  emptyList: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  searchWrap: { flex: 1 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  pageSizeBtnText: { fontSize: 13, fontWeight: '600' },
  sectionHeader: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, textTransform: 'uppercase' },
  contactItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, marginHorizontal: 16, marginBottom: 6, borderRadius: 12, elevation: 1 },
  avatar: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  contactInfo: { flex: 1, marginLeft: 12 },
  contactName: { fontSize: 15, fontWeight: '600' },
  contactDept: { fontSize: 12, marginTop: 2 },
  contactEmail: { fontSize: 12, marginTop: 1 },
  detailContent: { paddingBottom: 20 },
  detailAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  detailAvatar: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  detailAvatarText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  detailName: { fontSize: 18, fontWeight: '700' },
  detailRole: { fontSize: 14 },
  detailInfo: { gap: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { fontSize: 13, width: 90 },
  detailValue: { fontSize: 14, fontWeight: '500', flex: 1 },
});
