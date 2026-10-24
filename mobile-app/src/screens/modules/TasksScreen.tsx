import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, Modal, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { db } from '../../aws/clients';
import { collection, query, where, getDocs, orderBy, limit, doc, updateDoc, Timestamp } from '../../aws/firestore-compat';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { HeroBanner } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { logAudit } from '../../services/auditLogService';

const STATUS_CYCLE = ['Pending', 'In Progress', 'Completed'];
const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Medium: '#eab308', Low: '#10b981' };
const STATUS_COLORS: Record<string, string> = { 'Completed': '#10b981', 'In Progress': '#3b82f6', 'Pending': '#eab308' };

export const TasksScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [tasks, setTasks] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [detailModal, setDetailModal] = useState<any>(null);
  const [progressModal, setProgressModal] = useState<{ id: string; progress: number } | null>(null);
  const s = useMemo(() => createStyles(colors), [colors]);

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'tasks'), where('assignedToId', '==', user.id), orderBy('createdAt', 'desc'), limit(30))
      );
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) { console.error('Failed to fetch tasks:', err); }
  }, [user?.id]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const onRefresh = async () => { setRefreshing(true); await fetchTasks(); setRefreshing(false); };

  const cycleStatus = async (task: any) => {
    const currentIdx = STATUS_CYCLE.indexOf(task.status);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
    const newProgress = nextStatus === 'Completed' ? 100 : nextStatus === 'In Progress' ? Math.max(task.progress || 0, 50) : task.progress || 0;
    try {
      await updateDoc(doc(db, 'tasks', task.id), { status: nextStatus, progress: newProgress, updatedAt: Timestamp.now() });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus, progress: newProgress } : t)));
      logAudit({
        userId: user?.id || '', userName: user?.name || 'Employee', userRole: user?.role || 'employee',
        action: `Changed task "${task.title}" to ${nextStatus}`, actionType: 'update', module: 'Tasks',
        targetEntity: task.title || '', status: 'success',
      }).catch(() => {});
    } catch { Alert.alert('Error', 'Failed to update status'); }
  };

  const handleProgressUpdate = async () => {
    if (!progressModal) return;
    try {
      const status = progressModal.progress === 100 ? 'Completed' : progressModal.progress > 0 ? 'In Progress' : 'Pending';
      await updateDoc(doc(db, 'tasks', progressModal.id), { progress: progressModal.progress, status, updatedAt: Timestamp.now() });
      setTasks((prev) => prev.map((t) => (t.id === progressModal.id ? { ...t, progress: progressModal.progress, status } : t)));
      setProgressModal(null);
    } catch { Alert.alert('Error', 'Failed to update progress'); }
  };

  const stats = useMemo(() => ({
    total: tasks.length, completed: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    pending: tasks.filter(t => t.status === 'Pending').length,
    overdue: tasks.filter(t => t.dueDate && new Date(t.dueDate.toDate ? t.dueDate.toDate() : t.dueDate) < new Date() && t.status !== 'Completed').length,
  }), [tasks]);

  const filtered = (filter === 'All' ? tasks : filter === 'Overdue' ? tasks.filter(t => t.dueDate && new Date(t.dueDate.toDate ? t.dueDate.toDate() : t.dueDate) < new Date() && t.status !== 'Completed') : tasks.filter(t => t.status === filter)).filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q) || (t.priority || '').toLowerCase().includes(q) || (t.status || '').toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [search, filter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Title,Status,Priority,Due Date,Progress'];
      const rows = filtered.map(t => `${(t.title || '').replace(/,/g, ';')},${t.status || ''},${t.priority || ''},${formatDate(t.dueDate)},${t.progress || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'tasks_export.csv');
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

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const isOverdue = (task: any) => {
    if (task.status === 'Completed') return false;
    const due = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    return due < new Date();
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Tasks" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner
          greeting="Tasks"
          name="My Tasks"
          stats={[
            { label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Pending', value: stats.pending, color: '#eab308' },
            { label: 'In Progress', value: stats.inProgress, color: '#3b82f6' },
            { label: 'Completed', value: stats.completed, color: '#10b981' },
            { label: 'Overdue', value: stats.overdue, color: '#ef4444' },
          ]}
        />

        <View style={s.header}>
          <Text style={s.title}>My Tasks</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.statsRow}>
          {[
            { label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Pending', value: stats.pending, color: '#eab308' },
            { label: 'In Progress', value: stats.inProgress, color: '#3b82f6' },
            { label: 'Completed', value: stats.completed, color: '#10b981' },
            { label: 'Overdue', value: stats.overdue, color: '#ef4444' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {['All', 'Pending', 'In Progress', 'Completed'].map((f) => (
            <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterText, filter === f && s.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search tasks..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No tasks assigned</Text>
          ) : (
            paginated.map((task) => (
              <TouchableOpacity key={task.id} onPress={() => setDetailModal(task)}>
                <View style={[s.card, isOverdue(task) && s.cardOverdue]}>
                  <View style={s.cardHeader}>
                    <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
                    <TouchableOpacity style={[s.badge, { backgroundColor: `${STATUS_COLORS[task.status]}20` }]} onPress={() => cycleStatus(task)}>
                      <Text style={[s.badgeText, { color: STATUS_COLORS[task.status] }]}>{task.status}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={s.description} numberOfLines={2}>{task.description}</Text>
                  <View style={s.footer}>
                    <View style={[s.priorityBadge, { backgroundColor: `${PRIORITY_COLORS[task.priority]}20` }]}>
                      <Text style={[s.priorityText, { color: PRIORITY_COLORS[task.priority] }]}>{task.priority}</Text>
                    </View>
                    <Text style={[s.dueDate, isOverdue(task) && s.overdueDate]}>Due: {formatDate(task.dueDate)}</Text>
                    {isOverdue(task) && <Text style={s.overdueTag}>OVERDUE</Text>}
                  </View>
                  <TouchableOpacity onPress={() => setProgressModal({ id: task.id, progress: task.progress || 0 })}>
                    <View style={s.progressContainer}>
                      <View style={s.progressBar}>
                        <View style={[s.progressFill, { width: `${task.progress || 0}%`, backgroundColor: task.progress === 100 ? '#10b981' : '#FF6600' }]} />
                      </View>
                      <Text style={s.progressText}>{task.progress || 0}%</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={s.tapHint}>Tap status to cycle • Tap progress to adjust</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
        {renderPagination()}
      </ScrollView>

      <Modal visible={!!detailModal} transparent animationType="fade" onRequestClose={() => setDetailModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailModal(null)}>
          <View style={s.detailModal}>
            <Text style={s.detailTitle}>{detailModal?.title}</Text>
            {detailModal?.description && <Text style={s.detailDesc}>{detailModal.description}</Text>}
            <View style={s.detailRow}><Text style={s.detailLabel}>Priority:</Text><Text style={[s.detailValue, { color: PRIORITY_COLORS[detailModal?.priority] }]}>{detailModal?.priority}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Status:</Text><Text style={[s.detailValue, { color: STATUS_COLORS[detailModal?.status] }]}>{detailModal?.status}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Due:</Text><Text style={s.detailValue}>{formatDate(detailModal?.dueDate)}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Progress:</Text><Text style={s.detailValue}>{detailModal?.progress || 0}%</Text></View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!progressModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.progressModalContainer}>
            <Text style={s.modalTitle}>Update Progress</Text>
            <Text style={s.progressPct}>{progressModal?.progress || 0}%</Text>
            <View style={s.sliderRow}>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                <TouchableOpacity key={v} style={[s.sliderBtn, progressModal?.progress === v && s.sliderBtnActive]} onPress={() => setProgressModal(prev => prev ? { ...prev, progress: v } : null)}>
                  <Text style={[s.sliderBtnText, progressModal?.progress === v && { color: '#fff' }]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setProgressModal(null)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={handleProgressUpdate}><Text style={s.saveBtnText}>Update</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  statsRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 22, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  filterRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14 },
  searchRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  taskTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  description: { color: c.textSecondary, fontSize: 13, marginBottom: 8, lineHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  priorityBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  priorityText: { fontSize: 12, fontWeight: '600' },
  dueDate: { color: c.textTertiary, fontSize: 12 },
  overdueDate: { color: '#ef4444', fontWeight: '600' },
  overdueTag: { backgroundColor: '#ef444420', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, color: '#ef4444', fontSize: 10, fontWeight: 'bold' },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  progressBar: { flex: 1, height: 6, backgroundColor: c.border, borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { color: c.textSecondary, fontSize: 12, width: 36 },
  tapHint: { color: c.textMuted, fontSize: 9, textAlign: 'center', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  modal: { padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 16 },
  detailModal: { width: '90%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  detailTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  detailDesc: { color: c.textTertiary, fontSize: 14, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { color: c.textSecondary, fontSize: 14, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
  progressModalContainer: { width: '90%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  progressPct: { fontSize: 36, fontWeight: 'bold', color: '#FF6600', textAlign: 'center', marginBottom: 16 },
  sliderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 16 },
  sliderBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
  sliderBtnActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  sliderBtnText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
});
