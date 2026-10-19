import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useReportingTeamScope } from '../../hooks/useReportingTeamScope';
import { HeroBanner, PremiumSearchBar, EmptyStateView } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function MyTeamScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();

  const isRM = user?.role === 'reporting-manager';
  const scope = useReportingTeamScope(user?.id, effectiveCompanyId, isRM);

  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isRM) { setEmployees([]); setLoading(false); return; }
    setLoading(scope.loading);
    setEmployees(scope.members);
  }, [scope.loading, scope.members, isRM]);

  const filtered = useMemo(() => employees.filter(e => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return e.name?.toLowerCase().includes(s) || e.email?.toLowerCase().includes(s) || e.department?.toLowerCase().includes(s);
  }), [employees, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Department,Designation,Status,Phone,Employee ID'];
      const rows = filtered.map(e => `${e.name || ''},${e.email || ''},${(e.department || '').replace(/,/g, ';')},${(e.designation || '').replace(/,/g, ';')},${e.status || ''},${e.phone || ''},${e.employeeId || ''}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'my_team_export.csv');
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

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'Active': return '#22c55e';
      case 'Inactive': return '#ef4444';
      case 'On Leave': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const renderEmployee = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.empItem, { backgroundColor: colors.card }]}
      onPress={() => navigation?.navigate('EmployeeProfile', { employeeId: item.id })}
    >
      <View style={[styles.avatar, { backgroundColor: item.departmentColor || colors.accent }]}>
        <Text style={styles.avatarText}>{item.name?.charAt(0)?.toUpperCase() || '?'}</Text>
      </View>
      <View style={styles.empInfo}>
        <Text style={[styles.empName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.empDesignation, { color: colors.textSecondary }]}>{item.designation || 'Employee'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <View style={[styles.deptBadge, { backgroundColor: `${item.departmentColor || colors.accent}18` }]}>
            <Text style={[styles.deptBadgeText, { color: item.departmentColor || colors.accent }]}>{item.department || 'General'}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
          <Text style={[styles.empStatus, { color: colors.textSecondary }]}>{item.status || 'Active'}</Text>
        </View>
        {item.phone ? <Text style={[styles.empPhone, { color: colors.textTertiary }]}>{item.phone}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
      <ScreenHeader title="My Team" onBack={() => navigation.goBack()} />
      <HeroBanner
        greeting="My Team"
        name={`${filtered.length} total`}
        stats={[
          { label: 'Team Members', value: employees.length, color: '#3b82f6' },
          { label: 'Active', value: employees.filter((e: any) => e.status === 'Active').length, color: '#10b981' },
        ]}
      />

      <View style={styles.searchRow}>
        <PremiumSearchBar style={styles.searchBar} value={searchTerm} onChangeText={setSearchTerm} placeholder="Search team members..." />
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={paginated}
        keyExtractor={item => item.id}
        renderItem={renderEmployee}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<EmptyStateView icon="people-outline" title="No team members" subtitle="You don't have any team members assigned" />}
        ListFooterComponent={renderPagination}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
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
  empItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 10, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empInfo: { flex: 1, marginLeft: 12 },
  empName: { fontSize: 15, fontWeight: '600' },
  empDesignation: { fontSize: 13, marginTop: 2 },
  deptBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  deptBadgeText: { fontSize: 11, fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  empStatus: { fontSize: 12 },
  empPhone: { fontSize: 12, marginTop: 3 },
});
