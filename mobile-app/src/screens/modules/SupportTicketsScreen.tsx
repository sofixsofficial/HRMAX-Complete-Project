import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { subscribeTickets, subscribeTicketsByUser, updateTicketStatus, addTicketMessage } from '../../services/supportService';
import { HeroBanner, PremiumCard, PremiumSearchBar, StatusBadge, EmptyStateView, FloatingActionButton, PremiumBottomSheet, PremiumModal } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import type { SupportTicket, TicketMessage } from '../../types/user';
import { formatDateSafe } from '../../utils/dateUtils';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

const PRIORITY_OPTIONS = ['High', 'Medium', 'Low', 'Urgent'];
const STATUS_OPTIONS = ['Open', 'In Progress', 'Resolved', 'Closed'];
const CATEGORY_OPTIONS = ['IT Support', 'HR', 'Finance', 'General', 'Technical', 'Access Request'];

const STATUS_COLORS: Record<string, string> = {
  Open: '#3b82f6', 'In Progress': '#f59e0b', Resolved: '#22c55e', Closed: '#6b7280',
};
const PRIORITY_COLORS: Record<string, string> = {
  Low: '#6b7280', Medium: '#f59e0b', High: '#ef4444', Urgent: '#dc2626',
};

export default function SupportTicketsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [newPriority, setNewPriority] = useState('Medium');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const unsub = effectiveCompanyId
      ? subscribeTickets(effectiveCompanyId, (data) => { setTickets(data); setLoading(false); })
      : subscribeTicketsByUser(user?.id || '', (data) => { setTickets(data); setLoading(false); });
    return unsub;
  }, [effectiveCompanyId, user?.id]);

  const filtered = useMemo(() => tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return t.title.toLowerCase().includes(s) || t.description.toLowerCase().includes(s) || t.createdBy.toLowerCase().includes(s);
    }
    return true;
  }), [tickets, statusFilter, priorityFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, priorityFilter]);

  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === 'Open').length,
    inProgress: tickets.filter(t => t.status === 'In Progress').length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
    closed: tickets.filter(t => t.status === 'Closed').length,
  };

  const syncSelected = (tickets: SupportTicket[]) => {
    setSelectedTicket(prev => {
      if (!prev) return prev;
      return tickets.find(t => t.id === prev.id) || prev;
    });
  };

  useEffect(() => {
    syncSelected(tickets);
  }, [tickets]);

  const handleStatusChange = async (id: string, status: SupportTicket['status']) => {
    try {
      await updateTicketStatus(id, status);
    } catch {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const handleAddMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;
    setSendingMsg(true);
    try {
      await addTicketMessage(selectedTicket.id, {
        userId: user?.id || '', userName: user?.name || '',
        message: newMessage.trim(),
      });
      setNewMessage('');
    } catch {
      Alert.alert('Error', 'Failed to send message');
    }
    setSendingMsg(false);
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !newDesc.trim()) {
      Alert.alert('Required', 'Title and description are required');
      return;
    }
    setCreating(true);
    try {
      const { createTicket } = require('../../services/supportService');
      await createTicket({
        title: newTitle, description: newDesc, status: 'Open',
        priority: newPriority as any, category: newCategory,
        createdBy: user?.name || '', createdById: user?.id || '',
        companyId: effectiveCompanyId || '', companyName: '',
      });
      setShowCreate(false);
      resetCreateForm();
    } catch {
      Alert.alert('Error', 'Failed to create ticket');
    }
    setCreating(false);
  };

  const resetCreateForm = () => {
    setNewTitle(''); setNewDesc(''); setNewCategory('General'); setNewPriority('Medium');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Title,Description,Created By,Status,Priority,Category,Created At'];
      const rows = filtered.map(t => `${t.title.replace(/,/g, ';')},${t.description.replace(/,/g, ';')},${t.createdBy.replace(/,/g, ';')},${t.status},${t.priority},${t.category || ''},${formatDateSafe(t.createdAt)}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'support_tickets_export.csv');
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

  const renderTicket = ({ item }: { item: SupportTicket }) => (
    <TouchableOpacity
      style={[styles.ticketItem, { backgroundColor: colors.card }]}
      onPress={() => { setSelectedTicket(item); setShowDetail(true); }}
    >
      <View style={styles.ticketHeader}>
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] || '#6b7280' }]} />
        <Text style={[styles.ticketTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        <StatusBadge status={item.status} color={STATUS_COLORS[item.status] || '#6b7280'} />
      </View>
      <Text style={[styles.ticketDesc, { color: colors.textSecondary }]} numberOfLines={2}>{item.description}</Text>
      <View style={styles.ticketMeta}>
        <Text style={[styles.ticketMetaText, { color: colors.textSecondary }]}>
          {item.createdBy} · {formatDateSafe(item.createdAt)}
        </Text>
        <Text style={[styles.ticketCategory, { color: PRIORITY_COLORS[item.priority] }]}>{item.priority}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Support Tickets" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Support Tickets" name="Support Tickets" stats={[
        { label: 'Open', value: stats.open, color: '#3b82f6' },
        { label: 'In Progress', value: stats.inProgress, color: '#eab308' },
        { label: 'Resolved', value: stats.resolved, color: '#10b981' },
        { label: 'Total', value: stats.total, color: '#8b5cf6' },
      ]} />

      <View style={styles.statsRow}>
        {[
          { label: 'Open', value: stats.open, color: '#3b82f6' },
          { label: 'In Progress', value: stats.inProgress, color: '#f59e0b' },
          { label: 'Resolved', value: stats.resolved, color: '#22c55e' },
          { label: 'Total', value: stats.total, color: '#8b5cf6' },
        ].map((s, i) => (
          <View key={i} style={[styles.statBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.filterRow}>
        <ScrollableFilter
          options={['All', ...STATUS_OPTIONS]}
          selected={statusFilter}
          onSelect={setStatusFilter}
          colors={colors}
        />
      </View>
      <View style={styles.filterRow}>
        <ScrollableFilter
          options={['All', ...PRIORITY_OPTIONS]}
          selected={priorityFilter}
          onSelect={setPriorityFilter}
          colors={colors}
        />
      </View>

      <View style={styles.searchRow}>
        <PremiumSearchBar style={styles.searchBar} value={searchTerm} onChangeText={setSearchTerm} placeholder="Search tickets..." />
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={paginated}
        keyExtractor={item => item.id}
        renderItem={renderTicket}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<EmptyStateView icon="chatbubbles-outline" title="No tickets" subtitle="No support tickets found" />}
        ListFooterComponent={renderPagination}
      />

      <FloatingActionButton icon="add" onPress={() => setShowCreate(true)} label="Create support ticket" />

      <PremiumModal visible={showDetail} onClose={() => setShowDetail(false)} title={selectedTicket?.title || ''}>
        {selectedTicket && (
          <View style={styles.detailContent}>
            <View style={styles.detailMeta}>
              <StatusBadge status={selectedTicket.status} color={STATUS_COLORS[selectedTicket.status] || '#6b7280'} />
              <Text style={[styles.detailCategory, { color: PRIORITY_COLORS[selectedTicket.priority] }]}>{selectedTicket.priority} · {selectedTicket.category}</Text>
            </View>
            <Text style={[styles.detailDesc, { color: colors.text }]}>{selectedTicket.description}</Text>
            <Text style={[styles.detailUser, { color: colors.textSecondary }]}>
              Created by {selectedTicket.createdBy} on {formatDateSafe(selectedTicket.createdAt, undefined, { dateStyle: 'short', timeStyle: 'short' } as any)}
            </Text>

            {selectedTicket.status !== 'Closed' && selectedTicket.status !== 'Resolved' && (
              <View style={styles.statusActions}>
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusBtn, selectedTicket.status === s && { backgroundColor: STATUS_COLORS[s] }]}
                    onPress={() => handleStatusChange(selectedTicket.id, s as SupportTicket['status'])}
                  >
                    <Text style={[styles.statusBtnText, { color: selectedTicket.status === s ? '#fff' : colors.textSecondary }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(selectedTicket.conversation || []).length > 0 && (
              <View style={styles.conversation}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Conversation</Text>
                {(selectedTicket.conversation || []).map((msg: TicketMessage) => (
                  <View key={msg.id} style={[styles.msgBubble, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }, msg.userId === user?.id && styles.myMsg]}>
                    <Text style={[styles.msgAuthor, { color: colors.textSecondary }]}>{msg.userName}</Text>
                    <Text style={[styles.msgText, { color: colors.text }]}>{msg.message}</Text>
                    <Text style={styles.msgTime}>{formatDateSafe(msg.timestamp, undefined, { dateStyle: 'short', timeStyle: 'short' } as any)}</Text>
                  </View>
                ))}
              </View>
            )}

            {selectedTicket.status !== 'Closed' && (
              <View style={styles.replyRow}>
                <TextInput
                  style={[styles.replyInput, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
                  value={newMessage}
                  onChangeText={setNewMessage}
                  placeholder="Type a message..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
                <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.accent }]} onPress={handleAddMessage} disabled={sendingMsg}>
                  {sendingMsg ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </PremiumModal>

      <PremiumBottomSheet visible={showCreate} onClose={() => setShowCreate(false)} title="New Ticket">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Title</Text>
        <TextInput style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]} value={newTitle} onChangeText={setNewTitle} placeholder="Ticket title" placeholderTextColor={colors.textSecondary} />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORY_OPTIONS.map(c => (
            <TouchableOpacity key={c} style={[styles.chip, newCategory === c && { backgroundColor: colors.accent }]} onPress={() => setNewCategory(c)}>
              <Text style={[styles.chipText, { color: newCategory === c ? '#fff' : colors.textSecondary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Priority</Text>
        <View style={styles.chipRow}>
          {PRIORITY_OPTIONS.map(p => (
            <TouchableOpacity key={p} style={[styles.chip, newPriority === p && { backgroundColor: '#f59e0b' }]} onPress={() => setNewPriority(p)}>
              <Text style={[styles.chipText, { color: newPriority === p ? '#fff' : colors.textSecondary }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
        <TextInput style={[styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]} value={newDesc} onChangeText={setNewDesc} placeholder="Describe the issue..." placeholderTextColor={colors.textSecondary} multiline textAlignVertical="top" />

        <TouchableOpacity style={[styles.createBtn, creating && { opacity: 0.6 }]} onPress={handleCreate} disabled={creating}>
          {creating ? <ActivityIndicator size="small" color="#fff" /> : <><Ionicons name="add-circle" size={18} color="#fff" /><Text style={styles.createBtnText}>Create Ticket</Text></>}
        </TouchableOpacity>
      </PremiumBottomSheet>
    </View>
  );
}

function ScrollableFilter({ options, selected, onSelect, colors }: any) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 6 }}>
      {options.map((o: string) => (
        <TouchableOpacity key={o} style={[styles.filterChip, selected === o && { backgroundColor: colors.accent }]} onPress={() => onSelect(o)}>
          <Text style={[styles.filterChipText, { color: selected === o ? '#fff' : colors.textSecondary }]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 80 },
  emptyList: { flex: 1 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  statBox: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center', elevation: 1 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11 },
  filterRow: { paddingHorizontal: 16, marginBottom: 6 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  filterChipText: { fontSize: 11, fontWeight: '600', color: '#1F2937' },
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
  ticketItem: { padding: 14, borderRadius: 14, marginBottom: 10, elevation: 1 },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  ticketTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  ticketDesc: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  ticketMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  ticketMetaText: { fontSize: 12 },
  ticketCategory: { fontSize: 12, fontWeight: '600' },
  detailContent: { gap: 12, paddingBottom: 20 },
  detailMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailCategory: { fontSize: 13, fontWeight: '500' },
  detailDesc: { fontSize: 14, lineHeight: 22 },
  detailUser: { fontSize: 12 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  statusBtnText: { fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  conversation: { marginTop: 8 },
  msgBubble: { padding: 10, borderRadius: 10, marginBottom: 8, backgroundColor: '#f1f5f9' },
  myMsg: { backgroundColor: 'rgba(59,130,246,0.1)', alignSelf: 'flex-end' },
  msgAuthor: { fontSize: 11, fontWeight: '600' },
  msgText: { fontSize: 14, marginTop: 2 },
  msgTime: { fontSize: 10, color: '#6b7280', marginTop: 4, textAlign: 'right' },
  replyRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-end' },
  replyInput: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 80, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e2e8f0' },
  chipText: { fontSize: 12, fontWeight: '500' },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  textArea: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 80, borderWidth: 1 },
  createBtn: { backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
