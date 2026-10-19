import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { formatDateSafe } from '../../utils/dateUtils';
import { PayrollRun } from '../../types/user';
import { getAllPayrollRuns } from '../../services/payrollService';
import { HeroBanner, PremiumCard, ShimmerLoader, EmptyStateView, StatusBadge } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const STATUS_OPTIONS = ['All', 'Draft', 'Calculated', 'Approved', 'Disbursed'];
const STATUS_COLORS: Record<string, string> = { Draft: '#64748b', Calculated: '#3b82f6', Approved: '#f59e0b', Disbursed: '#10b981' };

export const PayrollHistoryScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, selectedCompanyName } = useCompany();
  const s = useMemo(() => createStyles(colors), [colors]);
  const isMaster = user?.role === 'master-admin';
  const scopedCompanyId = isMaster ? null : effectiveCompanyId || user?.companyId || null;
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [companyFilter, setCompanyFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    try {
      const [runData, compSnap] = await Promise.all([getAllPayrollRuns(), getDocs(collection(db, 'companies'))]);
      const scoped = scopedCompanyId ? runData.filter((r) => r.companyId === scopedCompanyId) : runData;
      setRuns(scoped);
      const map: Record<string, string> = {};
      compSnap.docs.forEach((d) => { map[d.id] = d.data().name || d.data().companyName || 'Unknown Company'; });
      setCompanies(map);
    } catch { /* keep existing */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [scopedCompanyId]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const companyNames = useMemo(() => Object.values(companies).filter((n, i, a) => a.indexOf(n) === i).sort(), [companies]);

  const filtered = useMemo(() => {
    return runs.filter(r => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (companyFilter !== 'All' && companies[r.companyId] !== companyFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      const company = companies[r.companyId] || '';
      return `${r.month || ''} ${r.year || ''} ${r.status || ''} ${company}`.toLowerCase().includes(q);
    });
  }, [runs, companies, search, statusFilter, companyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, companyFilter]);

  const metrics = useMemo(() => {
    const disbursed = runs.filter(r => r.status === 'Disbursed');
    return {
      total: runs.length,
      disbursed: disbursed.length,
      amount: disbursed.reduce((sum, r) => sum + (r.totalNet || 0), 0),
    };
  }, [runs]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Company,Month,Year,Status,Employees,WorkingDays,NetTotal'];
      const rows = filtered.map(r => `${(companies[r.companyId] || 'Unknown').replace(/,/g, '')},${r.month || ''},${r.year || ''},${r.status || ''},${r.totalEmployees || 0},${r.workingDays || 0},${r.totalNet || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'payroll_history_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toCurrency = (n: number) => `₹${(n || 0).toLocaleString()}`;

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

  if (loading) return <ShimmerLoader count={4} height={100} style={{ padding: 16 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Payroll History" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner greeting="Payroll History" name={isMaster ? 'All Companies' : selectedCompanyName || 'My Company'} subtitle={isMaster ? 'Organization-wide payroll runs & disbursement logs' : 'Payroll execution history for your company'}
          stats={[
            { label: 'Total Runs', value: metrics.total, color: '#3b82f6' },
            { label: 'Disbursed', value: metrics.disbursed, color: '#10b981' },
            { label: 'Disbursed Amount', value: toCurrency(metrics.amount), color: '#FF6600' },
          ]}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
          {STATUS_OPTIONS.map((st) => (
            <TouchableOpacity key={st} style={[s.chip, statusFilter === st && s.chipActive]} onPress={() => setStatusFilter(st)}>
              <Text style={[s.chipText, statusFilter === st && { color: '#fff' }]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {isMaster && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
            <TouchableOpacity style={[s.chip, companyFilter === 'All' && s.chipActive]} onPress={() => setCompanyFilter('All')}>
              <Text style={[s.chipText, companyFilter === 'All' && { color: '#fff' }]}>All Companies</Text>
            </TouchableOpacity>
            {companyNames.map((name) => (
              <TouchableOpacity key={name} style={[s.chip, companyFilter === name && s.chipActive]} onPress={() => setCompanyFilter(name)}>
                <Text style={[s.chipText, companyFilter === name && { color: '#fff' }]}>{name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search company, month, status..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        {filtered.length === 0 ? <EmptyStateView icon="time-outline" title="No payroll runs" subtitle={search || statusFilter !== 'All' || companyFilter !== 'All' ? 'No payroll runs match your filters.' : 'Payroll runs will appear here once payroll is executed.'} /> :
        paginated.map((run) => {
          const company = companies[run.companyId] || 'Unknown Company';
          const expanded = expandedId === run.id;
          return (
            <PremiumCard key={run.id} style={{ marginHorizontal: 16, marginBottom: 10, padding: 16 }} onPress={() => setExpandedId(expanded ? null : run.id)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{run.month} {run.year}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Icon name="business-outline" size={12} color={colors.textTertiary} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}>{company}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 1 }}>{run.totalEmployees} employees · {run.workingDays} working days</Text>
                </View>
                <StatusBadge status={run.status} color={STATUS_COLORS[run.status] || '#64748b'} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.accent, marginTop: 8 }}>{toCurrency(run.totalNet)}</Text>

              {expanded && (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.borderLight, marginTop: 10, paddingTop: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>Created</Text>
                    <Text style={{ fontSize: 12, color: colors.text }}>{formatDateSafe(run.createdAt, undefined, { dateStyle: 'short', timeStyle: 'short' } as any)}</Text>
                  </View>
                  {run.disbursedOn && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>Disbursed</Text>
                      <Text style={{ fontSize: 12, color: colors.text }}>{formatDateSafe(run.disbursedOn, undefined, { dateStyle: 'short', timeStyle: 'short' } as any)}</Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 6 }}>Employees</Text>
                  {run.items.map((item) => (
                    <View key={item.userId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{item.employeeName}</Text>
                        <Text style={{ fontSize: 11, color: colors.textTertiary }}>{item.department} · {item.presentDays}/{item.workingDays}d</Text>
                      </View>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{toCurrency(item.netSalary)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </PremiumCard>
          );
        })}
        {renderPagination()}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  chipRow: { paddingHorizontal: 16, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
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
