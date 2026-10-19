import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { subscribeEmployees, subscribeEmployeesScoped } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { HeroBanner, PremiumSearchBar, PremiumCard, EmptyStateView } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function BirthdaysScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();

  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState(String(new Date().getMonth()));
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

  const birthdayEmployees = useMemo(() => {
    return employees
      .filter(e => e.birthDate)
      .map(e => {
        const dob = e.birthDate?.toDate?.() || new Date(e.birthDate);
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const thisYearBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        const nextBday = thisYearBday >= todayStart
          ? thisYearBday
          : new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
        const diff = nextBday.getTime() - todayStart.getTime();
        const daysUntil = Math.ceil(diff / (1000 * 60 * 60 * 24));
        const currentAge = today.getFullYear() - dob.getFullYear() - (todayStart < thisYearBday ? 1 : 0);
        const turnsAge = nextBday.getFullYear() - dob.getFullYear();
        return {
          ...e,
          birthMonth: dob.getMonth(),
          birthDay: dob.getDate(),
          age: currentAge,
          turnsAge,
          daysUntil,
          birthDateObj: dob,
        };
      })
      .filter(e => {
        if (monthFilter === 'all') return true;
        return String(e.birthMonth) === monthFilter;
      })
      .filter(e => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return e.name?.toLowerCase().includes(s) || e.department?.toLowerCase().includes(s);
      })
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [employees, monthFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(birthdayEmployees.length / pageSize));
  const paginated = useMemo(() => birthdayEmployees.slice((currentPage - 1) * pageSize, currentPage * pageSize), [birthdayEmployees, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, monthFilter]);

  const stats = useMemo(() => {
    const today = new Date();
    const thisMonth = today.getMonth();
    return {
      thisMonth: birthdayEmployees.filter(e => e.birthMonth === thisMonth).length,
      today: birthdayEmployees.filter(e => e.daysUntil === 0).length,
      total: birthdayEmployees.length,
    };
  }, [birthdayEmployees]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Department,Birthday,Age,In Days'];
      const rows = birthdayEmployees.map(e => `${e.name || ''},${(e.department || e.designation || '').replace(/,/g, ';')},${MONTHS[e.birthMonth] || ''} ${e.birthDay || ''},${e.age || ''},${e.daysUntil}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'birthdays_export.csv');
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
    if (birthdayEmployees.length <= pageSize) return null;
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

  const renderBirthday = ({ item }: { item: any }) => (
    <PremiumCard style={styles.bdayCard}>
      <View style={styles.bdayRow}>
        <View style={[styles.avatar, { backgroundColor: item.departmentColor || '#db2777' }]}>
          <Text style={styles.avatarText}>{item.name?.charAt(0)?.toUpperCase() || '?'}</Text>
        </View>
        <View style={styles.bdayInfo}>
          <Text style={[styles.bdayName, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.bdayDept, { color: colors.textSecondary }]}>{item.department || item.designation || ''}</Text>
          <View style={styles.bdayDateRow}>
            <Ionicons name="gift-outline" size={14} color="#db2777" />
            <Text style={styles.bdayDate}>
              {MONTHS[item.birthMonth]} {item.birthDay} {item.turnsAge ? `· Turns ${item.turnsAge}` : ''}
            </Text>
          </View>
        </View>
        {item.daysUntil === 0 && (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>Today!</Text>
          </View>
        )}
        {item.daysUntil > 0 && item.daysUntil <= 7 && (
          <View style={styles.upcomingBadge}>
            <Text style={styles.upcomingBadgeText}>{item.daysUntil}d</Text>
          </View>
        )}
      </View>
    </PremiumCard>
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
      <ScreenHeader title="Birthdays" onBack={() => navigation.goBack()} />
      <HeroBanner
        greeting="Birthdays"
        name={`${stats.today} today · ${stats.thisMonth} this month`}
        subtitle={`${birthdayEmployees.length} total`}
        stats={[
          { label: 'Total', value: stats.total, color: '#3b82f6' },
          { label: 'Today', value: stats.today, color: '#FF6600' },
        ]}
      />

      <View style={styles.statsRow}>
        {[
          { label: 'Today', value: stats.today, color: '#db2777' },
          { label: 'This Month', value: stats.thisMonth, color: '#f59e0b' },
          { label: 'Total', value: stats.total, color: '#3b82f6' },
        ].map((s, i) => (
          <View key={i} style={[styles.statBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <ScrollableMonthFilter
        months={MONTHS}
        selected={monthFilter}
        onSelect={setMonthFilter}
        colors={colors}
      />

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <PremiumSearchBar value={searchTerm} onChangeText={setSearchTerm} placeholder="Search by name or department..." />
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={paginated}
        keyExtractor={item => item.id}
        renderItem={renderBirthday}
        contentContainerStyle={birthdayEmployees.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<EmptyStateView icon="gift-outline" title="No birthdays" subtitle="No birthdays found for the selected filter" />}
        ListFooterComponent={renderPagination()}
      />
    </View>
  );
}

function ScrollableMonthFilter({ months, selected, onSelect, colors }: any) {
  return (
    <View style={styles.monthScroll}>
      {[{ label: 'All', value: 'all' }, ...months.map((m: string, i: number) => ({ label: m.substring(0, 3), value: String(i) }))].map((m: any) => (
        <TouchableOpacity
          key={m.value}
          style={[styles.monthChip, selected === m.value && { backgroundColor: '#db2777' }]}
          onPress={() => onSelect(m.value)}
        >
          <Text style={[styles.monthChipText, { color: selected === m.value ? '#fff' : colors.textSecondary }]}>{m.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start' },
  exportBtn: { marginLeft: 10, marginRight: 16, backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: '#111827', fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: '#64748b', fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  pageSizeBtnText: { color: '#111827', fontSize: 13, fontWeight: '600' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 12 },
  statBox: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', elevation: 1 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, marginTop: 2 },
  monthScroll: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, flexWrap: 'wrap', gap: 6 },
  monthChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  monthChipText: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  bdayCard: { marginBottom: 10 },
  bdayRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  bdayInfo: { flex: 1, marginLeft: 12 },
  bdayName: { fontSize: 15, fontWeight: '600' },
  bdayDept: { fontSize: 12, marginTop: 1 },
  bdayDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  bdayDate: { fontSize: 12, color: '#6b7280' },
  todayBadge: { backgroundColor: '#db2777', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  todayBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  upcomingBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  upcomingBadgeText: { color: '#f59e0b', fontSize: 11, fontWeight: '700' },
});
