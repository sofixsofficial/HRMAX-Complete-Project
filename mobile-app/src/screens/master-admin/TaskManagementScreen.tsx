import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../aws/clients';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, Timestamp } from '../../aws/firestore-compat';
import { useCompany } from '../../context/CompanyContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useReportingTeamScope } from '../../hooks/useReportingTeamScope';
import { getAllTasks, getTasksByCompany } from '../../services/taskService';
import { getAllEmployees, getEmployeesByCompany } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PermissionGate } from '../../components/PermissionGate';
import { ScreenHeader } from '../../components/ScreenHeader';
import { createNotification, notifyTLAction } from '../../services/notificationService';
import { Icon } from '../../utils/icons';

interface FormData { title: string; description: string; assignedToId: string; assignedToName: string; priority: 'High' | 'Medium' | 'Low'; dueDate: string; }
const EMPTY_FORM: FormData = { title: '', description: '', assignedToId: '', assignedToName: '', priority: 'Medium', dueDate: '' };

const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Medium: '#eab308', Low: '#10b981' };
const STATUS_COLORS: Record<string, string> = { 'Completed': '#10b981', 'In Progress': '#3b82f6', 'Pending': '#64748b' };

export const TaskManagementScreen: React.FC<{ route?: any }> = ({ route }) => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { user } = useAuth();
  const isRM = user?.role === 'reporting-manager';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scope = useReportingTeamScope(user?.id, effectiveCompanyId, isRM);
  // Active scope: selected company, or every authorized company in "All" mode.
  // Empty array = unrestricted role (master-admin) keeps legacy unfiltered view.
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );
  const [tasks, setTasks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [detailModal, setDetailModal] = useState<any>(null);
  const [stats, setStats] = useState({ total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 });
  const [editingProgress, setEditingProgress] = useState<string | null>(null);
  const [progressVal, setProgressVal] = useState(0);
  const s = useMemo(() => createStyles(colors), [colors]);

  const fetchTasks = useCallback(async () => {
    try {
      if (scopeIds.length === 0) {
        if (isRestrictedScope) {
          setTasks([]);
          setStats({ total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 });
          return;
        }
        const all = await getAllTasks();
        setTasks(all as any[]);
        setStats({
          total: all.length,
          completed: all.filter((t: any) => t.status === 'Completed').length,
          inProgress: all.filter((t: any) => t.status === 'In Progress').length,
          pending: all.filter((t: any) => t.status === 'Pending').length,
          overdue: all.filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Completed').length,
        });
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) => getTasksByCompany(id).catch(() => [] as any[]))
      );
      const toMs = (t: any) => (t?.createdAt?.toDate ? t.createdAt.toDate().getTime() : new Date(t?.createdAt || 0).getTime());
      const data = results.flat().sort((a, b) => toMs(b) - toMs(a));
      setTasks(data);
      setStats({
        total: data.length,
        completed: data.filter((t: any) => t.status === 'Completed').length,
        inProgress: data.filter((t: any) => t.status === 'In Progress').length,
        pending: data.filter((t: any) => t.status === 'Pending').length,
        overdue: data.filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Completed').length,
      });
    } catch (err) { console.error(err); }
  }, [scopeIds, isRestrictedScope]);

  // Deep-link status filter from dashboard cards (e.g. Pending / Completed / In Progress)
  useEffect(() => {
    const st = route?.params?.status as string | undefined;
    if (!st) return;
    const valid = ['All', 'Pending', 'In Progress', 'Completed'].includes(st);
    setFilter(valid ? st : 'All');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.status]);

  const fetchEmployees = useCallback(async () => {
    try {
      if (scopeIds.length === 0) {
        if (isRestrictedScope) { setEmployees([]); return; }
        const all = await getAllEmployees();
        setEmployees(all.map((d: any) => ({ id: d.userId || d.id, name: d.name || '', ...d })));
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) => getEmployeesByCompany(id).catch(() => [] as any[]))
      );
      setEmployees(results.flat().map((d: any) => ({ id: d.userId || d.id, name: d.name || '', ...d })));
    } catch (err) { console.error(err); }
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => { fetchTasks(); fetchEmployees(); }, [fetchTasks, fetchEmployees]);

  const onRefresh = async () => { setRefreshing(true); await fetchTasks(); setRefreshing(false); };

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true); };

  const openEdit = (t: any) => {
    setEditing(t.id);
    const dd = t.dueDate?.toDate ? t.dueDate.toDate() : t.dueDate ? new Date(t.dueDate) : new Date();
    setForm({
      title: t.title || '', description: t.description || '',
      assignedToId: t.assignedToId || '', assignedToName: t.assignedToName || t.assignedTo || '',
      priority: t.priority || 'Medium', dueDate: dd.toISOString().split('T')[0],
    });
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.title || !form.assignedToId) { Alert.alert('Validation', 'Title and assigned employee required'); return; }
    try {
      // In "All Companies" mode, tag the task to the assignee's company
      const assignee = employees.find((e: any) => e.id === form.assignedToId || e.userId === form.assignedToId);
      const taskCompanyId = effectiveCompanyId || (assignee as any)?.companyId || '';
      const payload = {
        ...form, companyId: taskCompanyId,
        dueDate: Timestamp.fromDate(new Date(form.dueDate)),
        updatedAt: Timestamp.now(),
        assignedTo: form.assignedToName,
      };
      if (editing) {
        await updateDoc(doc(db, 'tasks', editing), payload);
      } else {
        await addDoc(collection(db, 'tasks'), {
          ...payload, status: 'Pending', progress: 0,
          createdAt: Timestamp.now(),
        });
      }
      setModal(false); await fetchTasks();
      const assigneeId = form.assignedToId;
      if (assigneeId && assigneeId !== user?.id) {
        try {
          await createNotification(
            assigneeId,
            'task_assigned',
            editing ? 'Task Updated' : 'New Task Assigned',
            `${user?.name || 'Your manager'} ${editing ? 'updated' : 'assigned'} task "${form.title}" to you.`,
            '/tasks',
            effectiveCompanyId || undefined
          );
        } catch {}
      }
      if (user?.role === 'team-leader') {
        await notifyTLAction(
          user.id,
          editing ? 'task_updated_by_tl' : 'task_created_by_tl',
          editing ? 'Task Updated by Team Leader' : 'Task Created by Team Leader',
          `${user?.name || 'A team leader'} ${editing ? 'updated' : 'created'} task "${form.title}".`,
          effectiveCompanyId
        );
      }
    } catch (err) { Alert.alert('Error', 'Failed to save task'); }
  };

  const handleDelete = (id: string, title: string) => {
    Alert.alert('Delete Task', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteDoc(doc(db, 'tasks', id));
          if (user?.role === 'team-leader') {
            await notifyTLAction(
              user.id,
              'task_deleted_by_tl',
              'Task Deleted by Team Leader',
              `${user?.name || 'A team leader'} deleted task "${title}".`,
              effectiveCompanyId
            );
          }
          await fetchTasks();
        },
      },
    ]);
  };

  const handleProgressUpdate = async () => {
    if (!editingProgress) return;
    try {
      const status = progressVal === 100 ? 'Completed' : progressVal > 0 ? 'In Progress' : 'Pending';
      await updateDoc(doc(db, 'tasks', editingProgress), { progress: progressVal, status, updatedAt: Timestamp.now() });
      setEditingProgress(null);
      await fetchTasks();
    } catch (err) { Alert.alert('Error', 'Failed to update progress'); }
  };

  const filtered = useMemo(() => {
    const base = isRM ? tasks.filter((t) => scope.userIds.has(t.assignedToId)) : tasks;
    return base.filter((t) => {
      if (filter !== 'All' && t.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.title?.toLowerCase().includes(q) && !(t.assignedToName || t.assignedTo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, isRM, scope.userIds, filter, search]);

  const assigneeOptions = useMemo(
    () => (isRM ? employees.filter((e) => scope.userIds.has(e.id)) : employees),
    [employees, isRM, scope.userIds]
  );

  const displayStats = useMemo(() => {
    if (!isRM) return stats;
    const team = tasks.filter((t) => scope.userIds.has(t.assignedToId));
    return {
      total: team.length,
      completed: team.filter((t) => t.status === 'Completed').length,
      inProgress: team.filter((t) => t.status === 'In Progress').length,
      pending: team.filter((t) => t.status === 'Pending').length,
      overdue: team.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Completed').length,
    };
  }, [isRM, stats, tasks, scope.userIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Title,Assigned To,Priority,Status,Progress,Due Date,Description'];
      const rows = filtered.map(t => `${t.title.replace(/,/g, ';')},${t.assignedToName || t.assignedTo || ''},${t.priority || ''},${t.status || ''},${t.progress || 0}%,${formatDate(t.dueDate)},${(t.description || '').replace(/,/g, ';')}`);
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

  const formatDate = (d: any) => d?.toDate ? d.toDate().toLocaleDateString('en-IN') : d ? new Date(d).toLocaleDateString('en-IN') : 'N/A';
  const isOverdue = (task: any) => {
    if (task.status === 'Completed') return false;
    const due = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    return due < new Date();
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Task Management" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Task Management</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search tasks..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
          <PermissionGate module="tasks" action="manage">
            <TouchableOpacity style={s.addBtn} onPress={openCreate}>
              <Icon name="add-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </PermissionGate>
        </View>

        <View style={s.statsRow}>
          {[
            { label: 'Total', value: displayStats.total, color: '#FF6600' },
            { label: 'Completed', value: displayStats.completed, color: '#10b981' },
            { label: 'In Progress', value: displayStats.inProgress, color: '#3b82f6' },
            { label: 'Pending', value: displayStats.pending, color: '#64748b' },
            { label: 'Overdue', value: displayStats.overdue, color: '#ef4444' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label === 'Overdue' ? 'All' : st.label === 'In Progress' ? 'In Progress' : st.label)}>
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

        <View style={s.list}>
          {filtered.length === 0 ? <Text style={s.emptyText}>No tasks found</Text> : (
            paginated.map((task) => (
              <TouchableOpacity key={task.id} onPress={() => setDetailModal(task)}>
                <View style={[s.card, isOverdue(task) && s.cardOverdue]}>
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.taskTitle}>{task.title}</Text>
                      <Text style={s.assignedTo}>Assigned to: {task.assignedToName || task.assignedTo}</Text>
                    </View>
                    <PermissionGate module="tasks" action="manage">
                      <TouchableOpacity onPress={() => handleDelete(task.id, task.title)}><Text style={s.delBtn}>✕</Text></TouchableOpacity>
                    </PermissionGate>
                  </View>
                  <View style={s.metaRow}>
                    <View style={[s.prioBadge, { backgroundColor: `${PRIORITY_COLORS[task.priority]}20` }]}>
                      <Text style={[s.prioText, { color: PRIORITY_COLORS[task.priority] }]}>{task.priority}</Text>
                    </View>
                    <View style={[s.statusBadgeSm, { backgroundColor: `${STATUS_COLORS[task.status] || '#64748b'}20` }]}>
                      <Text style={[s.statusTextSm, { color: STATUS_COLORS[task.status] || '#64748b' }]}>{task.status}</Text>
                    </View>
                    <Text style={s.dueDate}>Due: {formatDate(task.dueDate)}</Text>
                    {isOverdue(task) && <Text style={s.overdueTag}>OVERDUE</Text>}
                  </View>
                  {task.description && <Text style={s.desc} numberOfLines={2}>{task.description}</Text>}
                  <TouchableOpacity onPress={() => { setEditingProgress(task.id); setProgressVal(task.progress || 0); }}>
                    <View style={s.progressBar}>
                      <View style={[s.progressFill, { width: `${task.progress || 0}%`, backgroundColor: task.progress === 100 ? '#10b981' : '#FF6600' }]} />
                    </View>
                    <Text style={s.progressText}>{task.progress || 0}% complete</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll}>
            <View style={s.modal}>
              <Text style={s.modalTitle}>{editing ? 'Edit Task' : 'New Task'}</Text>
              <TextInput style={s.modalInput} placeholder="Task Title" placeholderTextColor={colors.textTertiary} value={form.title} onChangeText={(t) => setForm({...form, title: t})} />
              <TextInput style={[s.modalInput, s.textArea]} placeholder="Description" placeholderTextColor={colors.textTertiary} value={form.description} onChangeText={(t) => setForm({...form, description: t})} multiline numberOfLines={3} />

              <Text style={s.fieldLabel}>Assign To:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.empRow}>
                {assigneeOptions.map((emp) => (
                  <TouchableOpacity key={emp.id} style={[s.empChip, form.assignedToId === emp.id ? s.empChipActive : null]}
                    onPress={() => setForm({...form, assignedToId: emp.id, assignedToName: emp.name})}>
                    <Text style={[s.empChipText, form.assignedToId === emp.id && { color: '#fff' }]}>{emp.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={[s.fieldLabel, { marginTop: 12 }]}>Priority:</Text>
              <View style={s.prioRow}>
                {(['High', 'Medium', 'Low'] as const).map((p) => (
                  <TouchableOpacity key={p} style={[s.prioOption, form.priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] }]}
                    onPress={() => setForm({...form, priority: p})}>
                    <Text style={[s.prioOptionText, form.priority === p && { color: '#fff' }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput style={s.modalInput} placeholder="Due Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.dueDate} onChangeText={(t) => setForm({...form, dueDate: t})} />

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={s.saveBtn} onPress={handleSave}><Text style={s.saveBtnText}>{editing ? 'Update' : 'Create'}</Text></TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!detailModal} transparent animationType="fade" onRequestClose={() => setDetailModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailModal(null)}>
          <View style={s.detailModal}>
            <Text style={s.detailTitle}>{detailModal?.title}</Text>
            {detailModal?.description && <Text style={s.detailDesc}>{detailModal.description}</Text>}
            <View style={s.detailRow}><Text style={s.sDetailLabel}>Assigned To:</Text><Text style={s.detailValue}>{detailModal?.assignedToName || detailModal?.assignedTo}</Text></View>
            <View style={s.detailRow}><Text style={s.sDetailLabel}>Priority:</Text><Text style={[s.detailValue, { color: PRIORITY_COLORS[detailModal?.priority] }]}>{detailModal?.priority}</Text></View>
            <View style={s.detailRow}><Text style={s.sDetailLabel}>Status:</Text><Text style={[s.detailValue, { color: STATUS_COLORS[detailModal?.status] }]}>{detailModal?.status}</Text></View>
            <View style={s.detailRow}><Text style={s.sDetailLabel}>Due Date:</Text><Text style={s.detailValue}>{formatDate(detailModal?.dueDate)}</Text></View>
            <View style={s.detailRow}><Text style={s.sDetailLabel}>Progress:</Text><Text style={s.detailValue}>{detailModal?.progress || 0}%</Text></View>
            <View style={s.detailActions}>
              <TouchableOpacity style={s.editDetailBtn} onPress={() => { setDetailModal(null); openEdit(detailModal); }}>
                <Text style={s.editDetailText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!editingProgress} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.progressModal}>
            <Text style={s.modalTitle}>Update Progress</Text>
            <Text style={s.progressPct}>{progressVal}%</Text>
            <View style={s.sliderRow}>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                <TouchableOpacity key={v} style={[s.sliderBtn, progressVal === v && s.sliderBtnActive]} onPress={() => setProgressVal(v)}>
                  <Text style={[s.sliderBtnText, progressVal === v && { color: '#fff' }]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingProgress(null)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
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
  filterRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  taskTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '600', flex: 1 },
  delBtn: { color: '#ef4444', fontSize: 16, marginLeft: 8 },
  assignedTo: { color: '#FF6600', fontSize: 13, marginBottom: 4 },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' },
  prioBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  prioText: { fontSize: 11, fontWeight: '600' },
  statusBadgeSm: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTextSm: { fontSize: 11, fontWeight: '600' },
  dueDate: { color: c.textSecondary, fontSize: 12 },
  overdueTag: { backgroundColor: '#ef444420', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, color: '#ef4444', fontSize: 10, fontWeight: 'bold' },
  desc: { color: c.textTertiary, fontSize: 12, marginBottom: 8 },
  progressBar: { height: 6, backgroundColor: c.background, borderRadius: 3, marginBottom: 4 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { color: c.textTertiary, fontSize: 11 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center' },
  modalScroll: { padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 20 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8 },
  empRow: { flexDirection: 'row', marginBottom: 8 },
  empChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8, marginBottom: 4 },
  empChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  empChipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  prioRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  prioOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  prioOptionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  detailModal: { width: '90%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  detailTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  detailDesc: { color: c.textTertiary, fontSize: 14, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sDetailLabel: { color: c.textSecondary, fontSize: 14, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },
  detailActions: { flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
  editDetailBtn: { flex: 1, backgroundColor: '#FF660020', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  editDetailText: { color: '#FF6600', fontWeight: 'bold' },
  progressModal: { backgroundColor: c.card, borderRadius: 16, padding: 24, marginHorizontal: 20 },
  progressPct: { fontSize: 36, fontWeight: 'bold', color: '#FF6600', textAlign: 'center', marginBottom: 16 },
  sliderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 16 },
  sliderBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
  sliderBtnActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  sliderBtnText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
});
