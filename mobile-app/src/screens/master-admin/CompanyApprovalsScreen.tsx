import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { subscribeCompanyAdmins, approveCompanyAdmin, rejectCompanyAdmin, suspendCompanyAdmin, reactivateCompanyAdmin, deleteCompanyAdmin } from '../../services/companyAdminApprovalService';
import type { User } from '../../types/user';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';

const STATUS_COLORS: Record<string, string> = {
  Pending: '#eab308', Approved: '#10b981', Rejected: '#ef4444', Suspended: '#64748b',
};

export const CompanyApprovalsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [admins, setAdmins] = useState<User[]>([]);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ admin: User } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [detailModal, setDetailModal] = useState<User | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const s = useMemo(() => createStyles(colors), [colors]);

  const loadAdmins = useCallback(() => {
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeCompanyAdmins(setAdmins);
  }, []);

  useEffect(() => {
    loadAdmins();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [loadAdmins]);

  const stats = useMemo(() => ({
    total: admins.length,
    pending: admins.filter(a => (a.status || 'Pending') === 'Pending').length,
    approved: admins.filter(a => a.status === 'Approved').length,
    rejected: admins.filter(a => a.status === 'Rejected').length,
    suspended: admins.filter(a => a.status === 'Suspended').length,
  }), [admins]);

  const filtered = useMemo(() => {
    return admins.filter(a => {
      if (filter !== 'All' && (a.status || 'Pending') !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.name?.toLowerCase().includes(q) && !a.email?.toLowerCase().includes(q) && !(a.companyName || a.companyId || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [admins, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filter]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadAdmins();
    setTimeout(() => setRefreshing(false), 500);
  }, [loadAdmins]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Role,Status,Company,Requested On'];
      const rows = filtered.map(a => `${a.name || ''},${a.email || ''},${a.role || ''},${a.status || 'Pending'},${a.companyName || a.companyId || ''},${formatDate(a.createdAt)}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'admin_approvals_export.csv');
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

  const handleApprove = (admin: User) => {
    Alert.alert('Approve Admin', `Approve "${admin.name}" as Company Admin?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        try { await approveCompanyAdmin(admin.id); } catch (err: any) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectReason.trim()) { Alert.alert('Required', 'Please provide a rejection reason'); return; }
    try {
      await rejectCompanyAdmin(rejectModal.admin.id, rejectReason.trim());
      setRejectModal(null);
      setRejectReason('');
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleSuspend = (admin: User) => {
    Alert.alert('Suspend Admin', `Suspend "${admin.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Suspend', style: 'destructive', onPress: async () => {
        try { await suspendCompanyAdmin(admin.id); } catch (err: any) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const handleReactivate = (admin: User) => {
    Alert.alert('Reactivate Admin', `Reactivate "${admin.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reactivate', onPress: async () => {
        try { await reactivateCompanyAdmin(admin.id); } catch (err: any) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const handleDelete = (admin: User) => {
    Alert.alert('Delete Admin', `Permanently delete "${admin.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteCompanyAdmin(admin.id); } catch (err: any) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Admin Approvals" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Admin Approvals</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search admins..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          {[
            { label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Pending', value: stats.pending, color: '#eab308' },
            { label: 'Approved', value: stats.approved, color: '#10b981' },
            { label: 'Rejected', value: stats.rejected, color: '#ef4444' },
            { label: 'Suspended', value: stats.suspended, color: '#64748b' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {['All', 'Pending', 'Approved', 'Rejected', 'Suspended'].map((f) => (
            <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterText, filter === f && s.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No admins found</Text>
          ) : (
            paginated.map((admin) => (
              <TouchableOpacity key={admin.id} onPress={() => setDetailModal(admin)}>
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{admin.name}</Text>
                      <Text style={s.email}>{admin.email}</Text>
                      <Text style={s.companyText}>Company: {admin.companyName || admin.companyId || 'N/A'}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[admin.status || 'Pending']}20` }]}>
                      <Text style={[s.statusText, { color: STATUS_COLORS[admin.status || 'Pending'] }]}>{admin.status || 'Pending'}</Text>
                    </View>
                  </View>
                  {admin.createdAt && <Text style={s.date}>Requested: {formatDate(admin.createdAt)}</Text>}
                  <View style={s.actions}>
                    {(admin.status === 'Pending' || admin.status === undefined) && (
                      <>
                        <TouchableOpacity style={s.approveBtn} onPress={() => handleApprove(admin)}>
                          <Text style={s.approveText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.rejectBtn} onPress={() => setRejectModal({ admin })}>
                          <Text style={s.rejectText}>Reject</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {admin.status === 'Approved' && (
                      <TouchableOpacity style={s.suspendBtn} onPress={() => handleSuspend(admin)}>
                        <Text style={s.suspendText}>Suspend</Text>
                      </TouchableOpacity>
                    )}
                    {(admin.status === 'Suspended' || admin.status === 'Rejected') && (
                      <TouchableOpacity style={s.reactivateBtn} onPress={() => handleReactivate(admin)}>
                        <Text style={s.reactivateText}>Reactivate</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(admin)}>
                      <Text style={s.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={!!rejectModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Reject Admin</Text>
            <Text style={s.modalSubtitle}>Reason for rejecting {rejectModal?.admin.name}</Text>
            <TextInput style={s.modalInput} placeholder="Enter rejection reason..." placeholderTextColor={colors.textTertiary} value={rejectReason} onChangeText={setRejectReason} multiline numberOfLines={3} />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setRejectModal(null); setRejectReason(''); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.rejectConfirmBtn} onPress={handleReject}>
                <Text style={s.rejectConfirmText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!detailModal} transparent animationType="fade" onRequestClose={() => setDetailModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailModal(null)}>
          <View style={s.detailModal}>
            <Text style={s.detailName}>{detailModal?.name}</Text>
            <View style={s.detailRow}><Text style={s.detailLabel}>Email:</Text><Text style={s.detailValue}>{detailModal?.email}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Role:</Text><Text style={s.detailValue}>{detailModal?.role}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Status:</Text><Text style={[s.detailValue, { color: STATUS_COLORS[detailModal?.status || 'Pending'] }]}>{detailModal?.status || 'Pending'}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Company:</Text><Text style={s.detailValue}>{detailModal?.companyName || detailModal?.companyId || 'N/A'}</Text></View>
            {detailModal?.createdAt && <View style={s.detailRow}><Text style={s.detailLabel}>Requested:</Text><Text style={s.detailValue}>{formatDate(detailModal.createdAt)}</Text></View>}
            {detailModal?.rejectionReason && (
              <View style={s.detailRow}><Text style={s.detailLabel}>Rejection:</Text><Text style={[s.detailValue, { color: '#ef4444' }]}>{detailModal.rejectionReason}</Text></View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  searchRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statsRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 22, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  filterRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  name: { color: c.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  email: { color: '#FF6600', fontSize: 13, marginBottom: 2 },
  companyText: { color: c.textSecondary, fontSize: 12, marginBottom: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '600' },
  date: { color: c.textTertiary, fontSize: 12, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, flexWrap: 'wrap' },
  approveBtn: { flex: 1, backgroundColor: '#10b98120', borderRadius: 8, paddingVertical: 8, alignItems: 'center', minWidth: 60 },
  approveText: { color: '#10b981', fontWeight: 'bold', fontSize: 13 },
  rejectBtn: { flex: 1, backgroundColor: '#ef444420', borderRadius: 8, paddingVertical: 8, alignItems: 'center', minWidth: 60 },
  rejectText: { color: '#ef4444', fontWeight: 'bold', fontSize: 13 },
  suspendBtn: { flex: 1, backgroundColor: '#eab30820', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  suspendText: { color: '#eab308', fontWeight: 'bold', fontSize: 13 },
  reactivateBtn: { flex: 1, backgroundColor: '#3b82f620', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  reactivateText: { color: '#3b82f6', fontWeight: 'bold', fontSize: 13 },
  deleteBtn: { backgroundColor: '#ef444420', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  deleteText: { color: '#ef4444', fontWeight: 'bold', fontSize: 13 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  modalSubtitle: { color: c.textSecondary, fontSize: 14, marginBottom: 16 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 16, minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  rejectConfirmBtn: { flex: 1, backgroundColor: '#ef4444', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  rejectConfirmText: { color: '#fff', fontWeight: 'bold' },
  detailModal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  detailName: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { color: c.textSecondary, fontSize: 14, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 2, textAlign: 'right' },
});
