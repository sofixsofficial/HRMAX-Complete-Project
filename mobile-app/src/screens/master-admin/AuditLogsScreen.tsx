import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../aws/clients';
import { collection, getDocs, query, orderBy, limit, startAfter } from '../../aws/firestore-compat';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { ACTION_MODULES, ACTION_TYPES, STATUS_OPTIONS, actionLabel, statusBadge } from '../../services/auditLogService';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';

const PAGE_SIZES = [5, 10, 20, 50];

const ACTION_ICONS: Record<string, string> = {
  create: '＋', update: '✎', delete: '✕', approve: '✓', reject: '✗',
  assign: '→', transfer: '⇄', login: '→', logout: '←', export: '↓',
};

export const AuditLogsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [moduleFilter, setModuleFilter] = useState('All');
  const [actionFilter, setActionFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showFilters, setShowFilters] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  const buildQuery = useCallback((last?: any) => {
    const constraints: any[] = [orderBy('timestamp', 'desc')];
    if (last) constraints.push(startAfter(last));
    constraints.push(limit(pageSize));
    return query(collection(db, 'audit_logs'), ...constraints);
  }, [pageSize]);

  const fetchLogs = useCallback(async () => {
    try {
      const snap = await getDocs(buildQuery());
      const docs = snap.docs;
      setLogs(docs.map((d) => ({ id: d.id, ...d.data() })));
      setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      setHasMore(docs.length === pageSize);
    } catch (err) { console.error('Failed to fetch audit logs:', err); }
  }, [buildQuery, pageSize]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const onRefresh = async () => { setRefreshing(true); await fetchLogs(); setRefreshing(false); };

  const loadMore = async () => {
    if (loadingMore || !hasMore || !lastDoc) return;
    setLoadingMore(true);
    try {
      const snap = await getDocs(buildQuery(lastDoc));
      const docs = snap.docs;
      setLogs((prev) => [...prev, ...docs.map((d) => ({ id: d.id, ...d.data() }))]);
      setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      setHasMore(docs.length === pageSize);
    } catch (err) { console.error(err); }
    setLoadingMore(false);
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Date,User,Role,Module,Action,Status,Target,Details'];
      const rows = filtered.map(log => `${formatDate(log.timestamp)},${log.userName || ''},${log.userRole || ''},${log.module || log.entity || ''},${actionLabel((log.actionType || log.action || '').toLowerCase())},${log.status || 'success'},${log.targetEntity || log.entity || ''},${((log.details || log.description) || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'audit_logs_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const filtered = logs.filter((log) => {
    const action = (log.actionType || log.action || '').toLowerCase();
    if (actionFilter !== 'All' && action !== actionFilter.toLowerCase()) return false;
    const module = log.module || log.entity || '';
    if (moduleFilter !== 'All' && module !== moduleFilter) return false;
    const status = log.status || 'success';
    if (statusFilter !== 'All' && status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return action.includes(q) ||
      (log.userName?.toLowerCase() || '').includes(q) ||
      (log.targetEntity?.toLowerCase() || '').includes(q) ||
      ((log.details || log.description || '').toLowerCase()).includes(q) ||
      module.toLowerCase().includes(q);
  });

  return (
    <View style={s.container}>
      <ScreenHeader title="Audit Logs" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Audit Logs</Text>
          <Text style={s.count}>{filtered.length} entries</Text>
        </View>

        <View style={s.searchContainer}>
          <View style={s.searchRow}>
            <View style={s.searchInputWrap}>
              <Icon name="search-outline" size={18} color={colors.textTertiary} />
              <TextInput style={s.searchInput} placeholder="Search logs..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
              {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
            </View>
            <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
              {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.filterToggle} onPress={() => setShowFilters(!showFilters)}>
            <Text style={s.filterToggleText}>{showFilters ? '▲' : '▼'} Filters</Text>
          </TouchableOpacity>
        </View>

        {showFilters && (
          <View style={s.filterPanel}>
            <Text style={s.filterLabel}>Module</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterChips}>
              {ACTION_MODULES.map((m) => (
                <TouchableOpacity key={m} style={[s.chip, moduleFilter === m && s.chipActive]} onPress={() => setModuleFilter(m)}>
                  <Text style={[s.chipText, moduleFilter === m && s.chipTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.filterLabel}>Action</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterChips}>
              {ACTION_TYPES.map((a) => (
                <TouchableOpacity key={a} style={[s.chip, actionFilter === a && s.chipActive]} onPress={() => setActionFilter(a)}>
                  <Text style={[s.chipText, actionFilter === a && s.chipTextActive]}>{a}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.filterLabel}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterChips}>
              {STATUS_OPTIONS.map((st) => (
                <TouchableOpacity key={st} style={[s.chip, statusFilter === st && s.chipActive]} onPress={() => setStatusFilter(st)}>
                  <Text style={[s.chipText, statusFilter === st && s.chipTextActive]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No audit logs found</Text>
          ) : (
            filtered.map((log) => {
              const badge = statusBadge(log.status);
              const entity = log.entity || log.targetEntity || '';
              const entityId = log.entityId || log.targetId || '';
              return (
                <View key={log.id} style={s.card}>
                  <View style={s.cardRow}>
                    <View style={[s.actionIcon, { backgroundColor: `${badge.bg}` }]}>
                      <Text style={[s.actionIconText, { color: badge.text }]}>{ACTION_ICONS[(log.actionType || log.action || '').toLowerCase()] || '•'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={s.cardHeader}>
                        {/* Web shows the descriptive action ("Checked in", "Sent email ...");
                            showing only the type label threw that detail away. */}
                        <Text style={s.action} numberOfLines={2}>
                          {log.action || actionLabel((log.actionType || '').toLowerCase())}
                        </Text>
                        <Text style={s.date}>{formatDate(log.timestamp)}</Text>
                      </View>
                      <Text style={s.user}>{log.userName} ({log.userRole})</Text>
                      <Text style={s.entity}>{entity}{entityId ? ` #${entityId.substring(0, 8)}` : ''}</Text>
                      <View style={s.metaRow}>
                        <View style={[s.statusDot, { backgroundColor: badge.text }]} />
                        <Text style={[s.statusText, { color: badge.text }]}>{log.status || 'success'}</Text>
                        {log.actionType && log.action ? (
                          <Text style={s.typeChip}>{actionLabel(log.actionType.toLowerCase())}</Text>
                        ) : null}
                      </View>
                      {(log.details || log.description) && <Text style={s.details}>{log.details || log.description}</Text>}
                    </View>
                  </View>
                </View>
              );
            })
          )}
          {hasMore && filtered.length > 0 && (
            <TouchableOpacity style={s.loadMore} onPress={loadMore} disabled={loadingMore}>
              <Text style={s.loadMoreText}>{loadingMore ? 'Loading...' : 'Load More'}</Text>
            </TouchableOpacity>
          )}
          <View style={s.paginationRow}>
            <Text style={s.pageSizeText}>Show:</Text>
            <TouchableOpacity
              style={s.pageSizeBtn}
              onPress={() => { const idx = PAGE_SIZES.indexOf(pageSize); const next = PAGE_SIZES[(idx + 1) % PAGE_SIZES.length]; setPageSize(next); }}
            >
              <Text style={s.pageSizeBtnText}>{pageSize}</Text>
            </TouchableOpacity>
            <Text style={s.pageInfo}>{filtered.length} entries</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  searchContainer: { paddingHorizontal: 20, marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  filterToggle: { alignSelf: 'flex-end' },
  filterToggleText: { color: '#FF6600', fontSize: 13, fontWeight: '600' },
  filterPanel: { paddingHorizontal: 20, marginBottom: 12 },
  filterLabel: { color: c.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  filterChips: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 12, marginBottom: 8 },
  cardRow: { flexDirection: 'row', gap: 10 },
  actionIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  actionIconText: { fontSize: 14, fontWeight: 'bold' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  action: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },
  date: { color: c.textTertiary, fontSize: 11 },
  user: { color: '#FF6600', fontSize: 12, marginBottom: 1 },
  entity: { color: c.textSecondary, fontSize: 12, marginBottom: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  typeChip: { fontSize: 10, fontWeight: '700', color: c.textTertiary, marginLeft: 4 },
  details: { color: c.textTertiary, fontSize: 11, marginTop: 2 },
  loadMore: { paddingVertical: 14, alignItems: 'center', backgroundColor: c.card, borderRadius: 10, marginTop: 4 },
  loadMoreText: { color: '#FF6600', fontWeight: '600', fontSize: 14 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageSizeText: { color: c.textSecondary, fontSize: 12 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  pageInfo: { color: c.textSecondary, fontSize: 12 },
});
