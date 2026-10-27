import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../aws/clients';
import { collection, getDocs, query, where, orderBy, Timestamp } from '../../aws/firestore-compat';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useReportingTeamScope } from '../../hooks/useReportingTeamScope';
import { reviewTierLeaveRequest, reviewMasterAdminLeaveRequest, getLeaveRequestsByCompany, getAllLeaveRequests, TIER_ORDER, TIER_LABELS, isAwaitingMasterAdmin, getActionableLeaveTier, getEffectiveTiers, getLiveTiers } from '../../services/leaveService';
import type { ApprovalTier } from '../../types/user';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';

const STATUS_COLORS: Record<string, string> = {
  Pending: '#eab308', Approved: '#10b981', Rejected: '#ef4444', Cancelled: '#64748b',
};

const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

export const LeaveManagementScreen: React.FC<{ route?: any }> = ({ route }) => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const isRM = user?.role === 'reporting-manager';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scope = useReportingTeamScope(user?.id, effectiveCompanyId, isRM);
  // Active scope: selected company, or every authorized company in "All" mode.
  // Empty array = unrestricted role (master-admin) keeps legacy unfiltered view.
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );
  const [leaves, setLeaves] = useState<any[]>([]);
  const [filter, setFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 });
  const [reviewModal, setReviewModal] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewAction, setReviewAction] = useState<'Approved' | 'Rejected'>('Approved');
  const [detailModal, setDetailModal] = useState<any>(null);
  const s = useMemo(() => createStyles(colors), [colors]);
  // Web parity: this screen has NO permission-matrix gate — actionable-tier
  // routing alone governs who can act. The old strict `can('leave','approve')`
  // check hid every Approve/Reject button for roles whose saved matrix lacks
  // that flag (e.g. reporting-manager's default: apply/create/view/manage only),
  // breaking the RM/HR → CA → Exec → TL chain on mobile while web showed it.
  const canReview = true;

  const fetchLeaves = useCallback(async () => {
    try {
      if (scopeIds.length === 0) {
        if (isRestrictedScope) {
          setLeaves([]);
          setStats({ total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 });
          return;
        }
        const all = await getAllLeaveRequests();
        setLeaves(all as any[]);
        setStats({
          total: all.length,
          pending: all.filter((l: any) => l.status === 'Pending').length,
          approved: all.filter((l: any) => l.status === 'Approved').length,
          rejected: all.filter((l: any) => l.status === 'Rejected').length,
          cancelled: all.filter((l: any) => l.status === 'Cancelled').length,
        });
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) => getLeaveRequestsByCompany(id).catch(() => [] as any[]))
      );
      const toMs = (l: any) => (l?.createdAt?.toDate ? l.createdAt.toDate().getTime() : new Date(l?.createdAt || l?.appliedOn || 0).getTime());
      const data = results.flat().sort((a, b) => toMs(b) - toMs(a));
      setLeaves(data);
      setStats({
        total: data.length,
        pending: data.filter((l: any) => l.status === 'Pending').length,
        approved: data.filter((l: any) => l.status === 'Approved').length,
        rejected: data.filter((l: any) => l.status === 'Rejected').length,
        cancelled: data.filter((l: any) => l.status === 'Cancelled').length,
      });
    } catch (err) { console.error('Failed to fetch leaves:', err); }
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  // Deep-link status filter from dashboard cards (e.g. Pending / Approved / Rejected)
  useEffect(() => {
    const st = route?.params?.status as string | undefined;
    if (!st) return;
    const valid = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'].includes(st);
    setFilter(valid ? st : 'Pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.status]);

  const onRefresh = async () => { setRefreshing(true); await fetchLeaves(); setRefreshing(false); };

  const getNextPendingTier = (approvalStatus: any): ApprovalTier | null => {
    for (const tier of TIER_ORDER) {
      if (approvalStatus?.[tier] === 'Pending') return tier;
    }
    return null;
  };

  const handleReview = async (status: 'Approved' | 'Rejected', leave?: any, tier?: ApprovalTier) => {
    const target = leave || reviewModal;
    if (!target) return;
    // Web parity (LeaveManagement.handleReview): a remark is mandatory for EVERY
    // decision — Approve as well as Reject — not only the Master Admin gate.
    if (!reviewNote || !reviewNote.trim()) {
      Alert.alert('Remark required', 'A remark is required to complete this approval step.');
      return;
    }
    // Executive / Team Leader self-apps that cleared their tier chain route
    // through the Master Admin final gate instead of a next pending tier.
    if (isAwaitingMasterAdmin(target.approvalStatus, target.masterAdminRequired, target.masterAdminApproveStatus)) {
      if (!reviewNote || !reviewNote.trim()) { Alert.alert('Note required', 'A mandatory remark is required for the Master Admin final verification.'); return; }
      try {
        await reviewMasterAdminLeaveRequest(target.id, status, user?.id || '', user?.name || '', reviewNote.trim());
        setReviewModal(null);
        setReviewNote('');
        setReviewAction('Approved');
        await fetchLeaves();
      } catch (err: any) { Alert.alert('Error', err?.message || 'Failed to finalize leave'); }
      return;
    }
    const tierToAct = tier || getNextPendingTier(target.approvalStatus);
    if (!tierToAct) { Alert.alert('Info', 'All tiers have already been reviewed.'); return; }
    // Authorization: only the currently routed approver may act on this tier.
    const actionableTier = getActionableLeaveTier(target, user?.id || '', user?.role, scopeIds.length > 0 ? scopeIds : undefined);
    if (actionableTier !== tierToAct) {
      Alert.alert('Not your turn', 'This request is currently routed to another approver for this tier.');
      return;
    }
    try {
      await reviewTierLeaveRequest(target.id, tierToAct, status, user?.id || '', user?.name || '', reviewNote);
      setReviewModal(null);
      setReviewNote('');
      setReviewAction('Approved');
      await fetchLeaves();
    } catch (err: any) { Alert.alert('Error', err?.message || 'Failed to review leave'); }
  };

  const filtered = useMemo(() => {
    const base = isRM ? leaves.filter((l) => scope.userIds.has(l.userId)) : leaves;
    return base.filter((l) => {
      if (filter !== 'All' && l.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(l.employeeName || l.name || '').toLowerCase().includes(q) && !(l.leaveType || '').toLowerCase().includes(q) && !(l.department || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [leaves, isRM, scope.userIds, filter, search]);

  const displayStats = useMemo(() => {
    if (!isRM) return stats;
    const team = leaves.filter((l) => scope.userIds.has(l.userId));
    return {
      total: team.length,
      pending: team.filter((l) => l.status === 'Pending').length,
      approved: team.filter((l) => l.status === 'Approved').length,
      rejected: team.filter((l) => l.status === 'Rejected').length,
      cancelled: team.filter((l) => l.status === 'Cancelled').length,
    };
  }, [isRM, stats, leaves, scope.userIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Employee,Department,Leave Type,Start Date,End Date,Days,Status,Reason'];
      const rows = filtered.map(l => `${l.employeeName || l.name || ''},${l.department || ''},${l.leaveType || ''},${formatDate(l.startDate)},${formatDate(l.endDate)},${l.totalDays || 0},${l.status || ''},${(l.reason || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'leaves_export.csv');
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

  const formatDate = (d: any) => d?.toDate ? d.toDate().toLocaleDateString('en-IN') : new Date(d).toLocaleDateString('en-IN');
  const formatDateTime = (d: any) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const getDayOfWeek = (d: any) => {
    const date = d?.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('en-IN', { weekday: 'short' });
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Leave Management" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <View style={s.header}>
          <Text style={s.title}>Leave Management</Text>
          <Text style={s.count}>{filtered.length} request(s)</Text>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search leaves..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          {[{ label: 'Total', value: displayStats.total, color: '#FF6600' },
            { label: 'Pending', value: displayStats.pending, color: '#eab308' },
            { label: 'Approved', value: displayStats.approved, color: '#10b981' },
            { label: 'Rejected', value: displayStats.rejected, color: '#ef4444' },
            { label: 'Cancelled', value: displayStats.cancelled, color: '#64748b' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'].map((f) => (
            <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f as any)}>
              <Text style={[s.filterText, filter === f && s.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No leave requests found</Text>
          ) : (
            paginated.map((leave) => {
              const totalDays = leave.totalDays || 0;
              const start = formatDate(leave.startDate);
              const end = formatDate(leave.endDate);
              const startDow = getDayOfWeek(leave.startDate);
              const endDow = getDayOfWeek(leave.endDate);
              return (
                <TouchableOpacity key={leave.id} onPress={() => setDetailModal(leave)}>
                  <View style={s.card}>
                    <View style={s.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={s.empRow}>
                          <Text style={s.empName}>{leave.employeeName || leave.name}</Text>
                          {leave.department && <Text style={s.deptTag}>{leave.department}</Text>}
                        </View>
                        <Text style={s.leaveType}>{leave.leaveType}{leave.isPaid ? ' (Paid)' : ''}</Text>
                      </View>
                      <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[leave.status] || '#64748b'}20` }]}>
                        <Text style={[s.statusText, { color: STATUS_COLORS[leave.status] || '#64748b' }]}>{leave.status}</Text>
                      </View>
                      {/* Eye icon → read-only approval-chain view (matches web's row action) */}
                      <TouchableOpacity
                        style={{ marginLeft: 8, padding: 4 }}
                        onPress={() => setDetailModal(leave)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="eye-outline" size={17} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                    <View style={s.dateRow}>
                      <View style={s.dateBlock}>
                        <Text style={s.dateDow}>{startDow}</Text>
                        <Text style={s.dateVal}>{start}</Text>
                      </View>
                      <Text style={s.dateArrow}>→</Text>
                      <View style={s.dateBlock}>
                        <Text style={s.dateDow}>{endDow}</Text>
                        <Text style={s.dateVal}>{end}</Text>
                      </View>
                      <View style={s.daysBadge}>
                        <Text style={s.daysText}>{totalDays}d</Text>
                      </View>
                    </View>
                    {leave.reason && (
                      <Text style={s.reason} numberOfLines={2}>{leave.reason}</Text>
                    )}
                    {leave.status === 'Pending' && canReview && (() => {
                      const awaitingMA = isAwaitingMasterAdmin(leave.approvalStatus, leave.masterAdminRequired, leave.masterAdminApproveStatus);
                      const nextTier = awaitingMA ? null : getNextPendingTier(leave.approvalStatus);
                      if (!nextTier && !awaitingMA) return null;
                      // Approve/Reject only for the currently routed approver
                      // (matches the web panel's getActionableLeaveTier gate).
                      const actionableTier = getActionableLeaveTier(leave, user?.id || '', user?.role, scopeIds.length > 0 ? scopeIds : undefined);
                      // Web parity: any Master Admin may take the gate decision
                      // (role check). The old stamp condition blocked every MA
                      // except the one stamped at creation time.
                      const isMyMAGate = awaitingMA && user?.role === 'master-admin';
                      const canActNow = awaitingMA ? isMyMAGate : actionableTier === nextTier;
                      return (
                        <View style={s.actions}>
                          {canActNow && (
                            <>
                              {/* Web parity: row actions open the review modal where the
                                  mandatory remark is captured (no more direct fire with
                                  an empty note). */}
                              <TouchableOpacity style={s.approveBtn} onPress={() => { setReviewAction('Approved'); setReviewModal(leave); }}>
                                <Text style={s.approveText}>Approve</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={s.rejectBtn} onPress={() => { setReviewAction('Rejected'); setReviewModal(leave); }}>
                                <Text style={s.rejectText}>Reject</Text>
                              </TouchableOpacity>
                            </>
                          )}
                          <TouchableOpacity style={s.reviewBtn} onPress={() => { setReviewAction('Approved'); setReviewModal(leave); }}>
                            <Text style={s.reviewText}>Review</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })()}
                    {leave.approvalStatus && (() => {
                      // Web approvalProgressOf parity: LIVE tiers only (Skipped
                      // tiers have no approver; counting them left the counter
                      // stuck below 100% forever) + optional Master Admin gate.
                      // An exec self-app counts the managing TL + the Master Admin;
                      // a TL self-app counts only the Master Admin.
                      const effTiers = getLiveTiers(leave);
                      const total = effTiers.length + (leave.masterAdminRequired ? 1 : 0);
                      const done = effTiers.filter((t: ApprovalTier) => leave.approvalStatus[t] === 'Approved').length
                        + (leave.masterAdminRequired && leave.masterAdminApproveStatus && leave.masterAdminApproveStatus !== 'Pending' ? 1 : 0);
                      return (
                        <View style={s.tierProgress}>
                          <View style={s.tierBar}>
                            <View style={[s.tierBarFill, {
                              width: `${total > 0 ? (done / total) * 100 : 100}%`,
                              backgroundColor: leave.status === 'Rejected' ? '#ef4444' : '#FF6600',
                            }]} />
                          </View>
                          <Text style={s.tierCount}>{done}/{total} approved</Text>
                        </View>
                      );
                    })()}
                    {leave.reviewedByName && (
                      <Text style={s.reviewedBy}>Reviewed by: {leave.reviewedByName}{leave.reviewedOn ? ` on ${formatDateTime(leave.reviewedOn)}` : ''}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          {renderPagination()}
        </View>
      </ScrollView>

      <Modal visible={!!reviewModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{reviewAction === 'Approved' ? 'Approve' : 'Reject'} Leave</Text>
            <Text style={s.modalSubtitle}>{reviewModal?.employeeName} • {reviewModal?.leaveType} • {reviewModal?.totalDays} day(s)</Text>
            <Text style={s.reviewReason}>{reviewModal?.reason}</Text>
            {reviewModal?.approvalStatus && (
              <View style={s.tierBadgesRow}>
                {/* Effective tiers only (web parity): raw TIER_ORDER rendered the
                    full chain even for RM (HR → CA) / HR (CA) / Exec (TL)
                    self-apps, and the Master Admin gate was never shown as its
                    own chip. */}
                {getEffectiveTiers(reviewModal.applicantRole).map((tier) => {
                  const st = reviewModal.approvalStatus[tier];
                  const nextTier = getNextPendingTier(reviewModal.approvalStatus);
                  const isCurrent = tier === nextTier;
                  return (
                    <View key={tier} style={[s.tierBadge, {
                      backgroundColor: st === 'Approved' ? '#dcfce7' : st === 'Rejected' ? '#fee2e2' : isCurrent ? '#dbeafe' : '#f3f4f6',
                    }]}>
                      <Text style={[s.tierBadgeText, {
                        color: st === 'Approved' ? '#16a34a' : st === 'Rejected' ? '#ef4444' : isCurrent ? '#2563eb' : '#6b7280',
                      }]}>{TIER_LABELS[tier].split(' ')[0]}: {st}</Text>
                    </View>
                  );
                })}
                {reviewModal.masterAdminRequired && (() => {
                  const st = reviewModal.masterAdminApproveStatus || 'Pending';
                  return (
                    <View style={[s.tierBadge, { backgroundColor: st === 'Approved' ? '#dcfce7' : st === 'Rejected' ? '#fee2e2' : '#ede9fe' }]}>
                      <Text style={[s.tierBadgeText, { color: st === 'Approved' ? '#16a34a' : st === 'Rejected' ? '#ef4444' : '#7c3aed' }]}>
                        Master Admin: {st}
                      </Text>
                    </View>
                  );
                })()}
              </View>
            )}
            {reviewModal?.approvalLog && reviewModal.approvalLog.length > 0 && (
              <View style={s.approvalLogSection}>
                <Text style={s.approvalLogTitle}>Approval Log</Text>
                {reviewModal.approvalLog.map((entry: any, idx: number) => (
                  <View key={idx} style={s.approvalLogEntry}>
                    <View style={[s.logDot, { backgroundColor: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }]} />
                    <Text style={s.logText}>
                      <Text style={s.logBold}>{TIER_LABELS[entry.tier as ApprovalTier] || entry.tier}</Text> by {entry.approvedByName}
                      {entry.note ? ` (${entry.note})` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <TextInput style={s.modalInput} placeholder="Remark * (required)" placeholderTextColor={colors.textTertiary} value={reviewNote} onChangeText={setReviewNote} multiline numberOfLines={3} />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.rejectConfirmBtn} onPress={() => handleReview('Rejected')}>
                <Text style={s.rejectConfirmText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.approveConfirmBtn} onPress={() => handleReview('Approved')}>
                <Text style={s.approveConfirmText}>Approve</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.cancelReviewBtn} onPress={() => { setReviewModal(null); setReviewNote(''); setReviewAction('Approved'); }}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!detailModal} transparent animationType="fade" onRequestClose={() => setDetailModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailModal(null)}>
          <View style={s.detailModal}>
            <Text style={s.detailTitle}>{detailModal?.employeeName}</Text>
            <View style={s.detailRow}><Text style={s.detailLabel}>Leave Type:</Text><Text style={s.detailValue}>{detailModal?.leaveType}</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Duration:</Text><Text style={s.detailValue}>{formatDate(detailModal?.startDate)} → {formatDate(detailModal?.endDate)} ({detailModal?.totalDays} days)</Text></View>
            <View style={s.detailRow}><Text style={s.detailLabel}>Status:</Text><Text style={[s.detailValue, { color: STATUS_COLORS[detailModal?.status] || '#64748b' }]}>{detailModal?.status}</Text></View>
            {detailModal?.department && <View style={s.detailRow}><Text style={s.detailLabel}>Department:</Text><Text style={s.detailValue}>{detailModal.department}</Text></View>}
            {detailModal?.reason && <View style={s.detailRow}><Text style={s.detailLabel}>Reason:</Text><Text style={s.detailValue}>{detailModal.reason}</Text></View>}
            {detailModal?.approvalStatus && (
              <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Tier Approval Progress</Text>
                <View style={s.tierBadgesRow}>
                  {TIER_ORDER.map((tier) => {
                    const st = detailModal.approvalStatus[tier];
                    return (
                      <View key={tier} style={[s.tierBadge, {
                        backgroundColor: st === 'Approved' ? '#dcfce7' : st === 'Rejected' ? '#fee2e2' : '#f3f4f6',
                      }]}>
                        <Text style={[s.tierBadgeText, {
                          color: st === 'Approved' ? '#16a34a' : st === 'Rejected' ? '#ef4444' : '#6b7280',
                        }]}>{TIER_LABELS[tier].split(' ')[0]}: {st}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            {detailModal?.approvalLog && detailModal.approvalLog.length > 0 && (
              <View style={s.approvalLogSection}>
                <Text style={s.approvalLogTitle}>Approval Log</Text>
                {detailModal.approvalLog.map((entry: any, idx: number) => (
                  <View key={idx} style={s.approvalLogEntry}>
                    <View style={[s.logDot, { backgroundColor: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }]} />
                    <Text style={s.logText}>
                      <Text style={s.logBold}>{TIER_LABELS[entry.tier as ApprovalTier] || entry.tier}</Text> by {entry.approvedByName}
                      {entry.note ? ` (${entry.note})` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {detailModal?.reviewedByName && <View style={s.detailRow}><Text style={s.detailLabel}>Reviewed By:</Text><Text style={s.detailValue}>{detailModal.reviewedByName}</Text></View>}
            {detailModal?.reviewNote && <View style={s.detailRow}><Text style={s.detailLabel}>Review Note:</Text><Text style={s.detailValue}>{detailModal.reviewNote}</Text></View>}
            {detailModal?.appliedOn && <View style={s.detailRow}><Text style={s.detailLabel}>Applied On:</Text><Text style={s.detailValue}>{formatDateTime(detailModal.appliedOn)}</Text></View>}
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
  filterRow: { paddingLeft: 20, paddingRight: 20, flexDirection: 'row', gap: 8, paddingBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empName: { color: c.textPrimary, fontSize: 16, fontWeight: '600' },
  deptTag: { backgroundColor: '#FF660020', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, fontSize: 10, color: '#FF6600', fontWeight: '600' },
  leaveType: { color: '#FF6600', fontSize: 13, marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '600' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  dateBlock: { alignItems: 'center' },
  dateDow: { color: c.textTertiary, fontSize: 10 },
  dateVal: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  dateArrow: { color: c.textTertiary, fontSize: 14 },
  daysBadge: { backgroundColor: '#FF660020', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 'auto' },
  daysText: { color: '#FF6600', fontSize: 12, fontWeight: 'bold' },
  reason: { color: c.textTertiary, fontSize: 12, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
  approveBtn: { flex: 1, backgroundColor: '#10b98120', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  approveText: { color: '#10b981', fontWeight: 'bold', fontSize: 14 },
  rejectBtn: { flex: 1, backgroundColor: '#ef444420', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  rejectText: { color: '#ef4444', fontWeight: 'bold', fontSize: 14 },
  reviewBtn: { flex: 1, backgroundColor: '#FF660020', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  reviewText: { color: '#FF6600', fontWeight: 'bold', fontSize: 14 },
  reviewedBy: { color: c.textTertiary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
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
  modalSubtitle: { color: c.textSecondary, fontSize: 14, marginBottom: 12 },
  reviewReason: { color: c.textPrimary, fontSize: 14, marginBottom: 16, backgroundColor: c.background, padding: 12, borderRadius: 8 },
  modalInput: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 16, minHeight: 60, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  rejectConfirmBtn: { flex: 1, backgroundColor: '#ef444420', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  rejectConfirmText: { color: '#ef4444', fontWeight: 'bold', fontSize: 15 },
  approveConfirmBtn: { flex: 1, backgroundColor: '#10b98120', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  approveConfirmText: { color: '#10b981', fontWeight: 'bold', fontSize: 15 },
  cancelReviewBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  detailModal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  detailTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { color: c.textSecondary, fontSize: 14, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 14, fontWeight: '600', flex: 2, textAlign: 'right' },
  tierProgress: { marginTop: 6 },
  tierBar: { height: 5, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 2 },
  tierBarFill: { height: '100%', borderRadius: 3 },
  tierCount: { color: '#6b7280', fontSize: 10, textAlign: 'right' },
  tierBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  tierBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  tierBadgeText: { fontSize: 10, fontWeight: '600' },
  approvalLogSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 10 },
  approvalLogTitle: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  approvalLogEntry: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logText: { fontSize: 11, color: '#6b7280', flex: 1 },
  logBold: { fontWeight: '600', color: '#374151' },
});
