import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { getEmployeesByCompany, getAllEmployees } from '../../services/employeeService';
import { getAllCompanies, getCompanyStats } from '../../services/companyService';
import { getTicketsByCompany, getAllTickets } from '../../services/supportService';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { HeroBanner, PremiumCard, AnimatedStatCard, EmptyStateView, PremiumSearchBar } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';

const TIME_RANGES = ['This Week', 'This Month', 'This Quarter', 'This Year'];
const REPORT_TYPES = ['All Types', 'Attendance', 'Payroll', 'Performance', 'Analytics', 'HR'];

export default function ReportsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState('This Month');
  const [reportType, setReportType] = useState('All Types');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const [empCount, setEmpCount] = useState(0);
  const [deptCount, setDeptCount] = useState(0);
  const [ticketCount, setTicketCount] = useState(0);
  const [companyCount, setCompanyCount] = useState(0);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  const fetchData = async () => {
    try {
      const isMaster = user?.role === 'master-admin';
      let emps: any[] = [];
      if (scopeIds.length > 0) {
        const results = await Promise.all(scopeIds.map((id) => getEmployeesByCompany(id).catch(() => [] as any[])));
        emps = results.flat();
      } else if (!isRestrictedScope) {
        emps = await getAllEmployees();
      }
      const depts = new Set(emps.map((e: any) => e.department).filter(Boolean)).size;
      let tickets: any[] = [];
      if (scopeIds.length > 0) {
        const results = await Promise.all(scopeIds.map((id) => getTicketsByCompany(id).catch(() => [] as any[])));
        tickets = results.flat();
      } else if (!isRestrictedScope) {
        tickets = await getAllTickets();
      }
      const companies = isMaster ? await getAllCompanies().catch(() => []) : availableCompanies;

      setEmpCount(emps.length);
      setDeptCount(depts);
      setTicketCount(tickets.length);
      setCompanyCount(companies.length);
    } catch (err) {
      console.error('Reports fetch error:', err);
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchData(); }, [effectiveCompanyId]);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const filtered = [
    { id: '1', name: 'Employee Directory', type: 'HR', desc: 'Complete employee listing', icon: 'people-outline', color: '#3b82f6' },
    { id: '2', name: 'Attendance Summary', type: 'Attendance', desc: 'Monthly attendance overview', icon: 'calendar-outline', color: '#22c55e' },
    { id: '3', name: 'Payroll Summary', type: 'Payroll', desc: 'Salary and payroll breakdown', icon: 'cash-outline', color: '#f59e0b' },
    { id: '4', name: 'Department Stats', type: 'Analytics', desc: 'Department-wise headcount', icon: 'business-outline', color: '#8b5cf6' },
    { id: '5', name: 'Leave Analysis', type: 'HR', desc: 'Leave utilization report', icon: 'umbrella-outline', color: '#ec4899' },
    { id: '6', name: 'Ticket Report', type: 'Analytics', desc: 'Support ticket metrics', icon: 'chatbubbles-outline', color: '#ef4444' },
  ].filter(r => reportType === 'All Types' || r.type === reportType)
   .filter(r => !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, reportType]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Metric,Value'];
      const rows = [`Employees,${empCount}`, `Departments,${deptCount}`, `Tickets,${ticketCount}`, `Companies,${companyCount}`];
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'reports_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleGenerate = async (report: any) => {
    setExporting(true);
    try {
      const fmtDate = (x: any) => x?.toDate ? x.toDate().toLocaleDateString('en-IN') : (x ? new Date(x).toLocaleDateString('en-IN') : '');
      const fmtTime = (x: any) => x?.toDate ? x.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--';
      let headers: string[] = [];
      let rows: string[][] = [];
      const all = async (name: string) => (await getDocs(collection(db, name))).docs.map(d => d.data() as any);
      switch (report.id) {
        case '1': {
          const emps = await all('employees');
          headers = ['Name', 'Email', 'Department', 'Designation', 'Status'];
          rows = emps.map(e => [e.name || '', e.email || '', e.department || '', e.designation || '', e.status || '']);
          break;
        }
        case '2': {
          const att = await all('attendance');
          headers = ['Name', 'Date', 'Status', 'Check In', 'Check Out', 'Hours'];
          rows = att.map(a => [a.name || '', fmtDate(a.date), a.status || '', fmtTime(a.checkIn), fmtTime(a.checkOut), String(a.workHours ?? 0)]);
          break;
        }
        case '3': {
          const runs = await all('payrollRuns');
          headers = ['Month', 'Year', 'Status', 'Employees', 'Net Total'];
          rows = runs.map(p => [p.month || '', String(p.year || ''), p.status || '', String(p.totalEmployees ?? 0), String(p.totalNet ?? 0)]);
          break;
        }
        case '4': {
          const depts = await all('departments');
          headers = ['Department', 'Head', 'Employees'];
          rows = depts.map(d => [d.name || '', d.headName || d.managerName || '', String(d.employeeCount ?? '')]);
          break;
        }
        case '5': {
          const leaves = await all('leaveRequests');
          headers = ['Employee', 'Type', 'From', 'To', 'Days', 'Status'];
          rows = leaves.map(l => [l.employeeName || '', l.leaveType || '', fmtDate(l.startDate), fmtDate(l.endDate), String(l.totalDays ?? ''), l.status || '']);
          break;
        }
        case '6': {
          const tickets = await all('tickets');
          headers = ['Subject', 'Status', 'Priority', 'Category'];
          rows = tickets.map(t => [t.subject || t.title || '', t.status || '', t.priority || '', t.category || '']);
          break;
        }
      }
      const csv = [headers.join(','), ...rows.map(r => r.map(x => (x || '').replace(/,/g, ';')).join(','))].join('\n');
      const file = new File(Paths.cache, `report_${report.id}_${Date.now()}.csv`);
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to generate report');
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

  return (
    <View style={s.container}>
      <ScreenHeader title="Reports" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Reports" name="Generate and view reports" subtitle={`${filtered.length} total`}
        stats={[
          { label: 'Total Reports', value: filtered.length, color: '#FF6600' },
          { label: 'Employees', value: empCount, color: '#10b981' },
          { label: 'Departments', value: deptCount, color: '#3b82f6' },
          { label: 'Tickets', value: ticketCount, color: '#eab308' },
        ]}
      />

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={s.statsRow}>
          <AnimatedStatCard icon="people-outline" label="Employees" value={empCount} color="#3b82f6" />
          <AnimatedStatCard icon="business-outline" label="Departments" value={deptCount} color="#22c55e" />
          <AnimatedStatCard icon="chatbubbles-outline" label="Tickets" value={ticketCount} color="#f59e0b" />
          <AnimatedStatCard icon="building-outline" label="Companies" value={companyCount} color="#8b5cf6" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          {TIME_RANGES.map(tr => (
            <TouchableOpacity
              key={tr}
              style={[s.filterChip, timeRange === tr && s.filterChipActive]}
              onPress={() => setTimeRange(tr)}
            >
              <Text style={[s.filterChipText, timeRange === tr && s.filterChipTextActive]}>{tr}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          {REPORT_TYPES.map(rt => (
            <TouchableOpacity
              key={rt}
              style={[s.filterChip, reportType === rt && s.filterChipActive]}
              onPress={() => setReportType(rt)}
            >
              <Text style={[s.filterChipText, reportType === rt && s.filterChipTextActive]}>{rt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.searchRow}>
          <View style={s.searchFlexWrap}>
            <PremiumSearchBar value={searchTerm} onChangeText={setSearchTerm} placeholder="Search reports..." />
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.reportsGrid}>
          {paginated.map(r => (
            <PremiumCard key={r.id} style={s.reportCard}>
              <View style={[s.reportIcon, { backgroundColor: r.color + '20' }]}>
                <Ionicons name={r.icon as any} size={24} color={r.color} />
              </View>
              <Text style={s.reportName}>{r.name}</Text>
              <Text style={s.reportDesc}>{r.desc}</Text>
              <TouchableOpacity style={[s.genBtn, { backgroundColor: r.color }]} onPress={() => handleGenerate(r)} disabled={exporting}>
                <Ionicons name="download-outline" size={16} color="#fff" />
                <Text style={s.genBtnText}>{exporting ? 'Generating...' : 'Generate'}</Text>
              </TouchableOpacity>
            </PremiumCard>
          ))}
        </View>
        {renderPagination()}
      </ScrollView>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  filterRow: { paddingHorizontal: 16, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  filterChipActive: { backgroundColor: c.accent },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  filterChipTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, gap: 10 },
  searchFlexWrap: { flex: 1, marginHorizontal: -16 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  reportsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  reportCard: { width: '47%' as any, minWidth: 160 },
  reportIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  reportName: { fontSize: 14, fontWeight: '700', color: c.text },
  reportDesc: { fontSize: 12, marginTop: 2, marginBottom: 10, color: c.textSecondary },
  genBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8 },
  genBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
});
