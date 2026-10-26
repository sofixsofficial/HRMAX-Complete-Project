import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, Modal, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { db } from '../../aws/clients';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc, updateDoc } from '../../aws/firestore-compat';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { HeroBanner } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { isWithinAttendanceCorrectionWindow, parseWeekendDays, toDateKey } from '../../utils/workingDays';
import { TIER_ORDER, TIER_LABELS, getEffectiveTiers, getLiveTiers, isAwaitingMasterAdmin, computeLeaveBalance, resolveEmployeeLeaveEntitlementsFull } from '../../services/leaveService';
import { logAudit } from '../../services/auditLogService';
import type { ApprovalTier, LeaveRequest, LeaveType, ApprovalLevel } from '../../types/user';

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

const STATUS_COLORS: Record<string, string> = {
  Pending: '#eab308', Approved: '#10b981', Rejected: '#ef4444', Cancelled: '#64748b',
};

const LEVEL_COLORS: Record<string, string> = {
  Approved: '#16a34a', Rejected: '#ef4444', Pending: '#d97706',
};

const MA_LABEL = 'Master Admin';

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  return null;
};

/** Compute approval progress respecting effective tiers + Master Admin gate.
 *  Only LIVE tiers count: skipped ones have no approver, and counting them
 *  left the counter stuck (e.g. 2/4) even after the request was Approved. */
const approvalProgressOf = (l: LeaveRequest) => {
  const tiers = getLiveTiers(l);
  if (l.masterAdminRequired) {
    const total = tiers.length + 1;
    const done =
      tiers.filter((t) => l.approvalStatus?.[t] === 'Approved').length +
      (l.masterAdminApproveStatus === 'Approved' || l.masterAdminApproveStatus === 'Rejected' ? 1 : 0);
    return { label: `${done}/${total}`, pct: total ? (done / total) * 100 : 100, total, done };
  }
  const resolved = tiers.filter((t) => l.approvalStatus?.[t] === 'Approved').length;
  if (tiers.length === 0) {
    // No live approver → every tier was skipped and the server auto-approved.
    return { label: '1/1', pct: 100, total: 1, done: 1 };
  }
  return { label: `${resolved}/${tiers.length}`, pct: (resolved / tiers.length) * 100, total: tiers.length, done: resolved };
};

/** Build approval steps for a leave request (matches web's getApprovalSteps) */
const getApprovalSteps = (leave: LeaveRequest) => {
  const steps: Array<{ key: string; label: string; status: string; approvedByName?: string; note?: string }> =
    getEffectiveTiers(leave.applicantRole).map((tier) => ({
      key: tier,
      label: TIER_LABELS[tier],
      status: leave.approvalStatus?.[tier] || 'Pending',
      approvedByName: leave.approvalLog?.find((e) => e.tier === tier)?.approvedByName,
    }));
  if (leave.masterAdminRequired) {
    steps.push({
      key: 'masterAdmin',
      label: MA_LABEL,
      status: leave.masterAdminApproveStatus || 'Pending',
      approvedByName: leave.masterAdminApprovedByName,
      note: leave.masterAdminNote,
    });
  }
  return steps;
};

export const LeaveScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [viewModal, setViewModal] = useState<any>(null);
  const s = useMemo(() => createStyles(colors), [colors]);

  // ── Re-submit rejected leave (2-working-day window, matches web) ──
  // Employees manage everything here after the "My Leaves & Attendance"
  // subsection was removed from their drawer/dashboard — the window logic is
  // ported from MyLeavesAttendanceScreen (company weekends + holidays).
  const [resubmitWeekends, setResubmitWeekends] = useState<number[]>([0, 6]);
  const [resubmitHolidays, setResubmitHolidays] = useState<string[]>([]);

  useEffect(() => {
    const companyId = user?.companyId || '';
    if (!companyId) return;
    (async () => {
      try {
        const compSnap = await getDoc(doc(db, 'companies', companyId)).catch(() => null);
        const weekendsRaw = (compSnap?.data() as any)?.payrollSettings?.weekends;
        if (Array.isArray(weekendsRaw)) setResubmitWeekends(parseWeekendDays(weekendsRaw));
        const holSnap = await getDocs(query(collection(db, 'holidays'), where('companyId', 'in', [companyId, null])))
          .catch(() => null);
        const keys = (holSnap?.docs || [])
          .map((d) => {
            const dt = (d.data() as any)?.date;
            return dt ? toDateKey(dt?.toDate ? dt.toDate() : new Date(dt)) : '';
          })
          .filter(Boolean);
        setResubmitHolidays(keys);
      } catch {}
    })();
  }, [user?.companyId]);

  const canResubmit = (leave: LeaveRequest): boolean => {
    // Web fallback order: rejectedAt → reviewedOn → appliedOn
    const from = toDate(leave.rejectedAt) || toDate((leave as any).reviewedOn) || toDate(leave.appliedOn);
    if (!from) return false;
    return isWithinAttendanceCorrectionWindow(from, new Date(), resubmitWeekends, resubmitHolidays);
  };

  const handleResubmit = (leave: LeaveRequest) => {
    const toInput = (d: any): string => {
      const dt = toDate(d);
      if (!dt) return '';
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${dt.getFullYear()}-${m}-${day}`;
    };
    // ApplyLeave lives in the DashboardRouter (Home) stack — navigate through
    // the nested navigator (same pattern as MyLeavesAttendanceScreen).
    navigation.navigate('Home', {
      screen: 'ApplyLeave',
      params: {
        reSubmit: true,
        leaveType: leave.leaveType,
        startDate: toInput(leave.startDate),
        endDate: toInput(leave.endDate),
        reason: leave.reason,
        totalDays: leave.totalDays,
      },
    });
  };

  // Who may file a new leave request from this screen (mirrors
  // APPLY_LEAVE_ROLES in DashboardRouter — Company Admin is verify-only).
  const canApplyLeave =
    !!user && ['master-admin', 'executive', 'team-leader', 'reporting-manager', 'employee'].includes(user.role);

  // Leave balance state
  const [allowances, setAllowances] = useState<Record<string, number>>({});
  const [joinDate, setJoinDate] = useState<Date | null | undefined>(undefined);
  const [balanceConfig, setBalanceConfig] = useState<{ encashable: LeaveType[]; paid: LeaveType[] } | undefined>(undefined);
  const [skipProration, setSkipProration] = useState(false);

  const fetchLeaves = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'leaveRequests'), where('userId', '==', user.id), orderBy('appliedOn', 'desc'), limit(50))
      );
      setLeaves(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) { console.error('Failed to fetch leaves:', err); }
  };

  const fetchBalance = async () => {
    if (!user) return;
    try {
      const empSnap = await getDocs(query(collection(db, 'employees'), where('userId', '==', user.id)));
      if (!empSnap.empty) {
        const emp = empSnap.docs[0].data();
        // Extract join date for proration
        const jd = emp.joinDate?.toDate ? emp.joinDate.toDate() : emp.joinDate ? new Date(emp.joinDate) : null;
        setJoinDate(jd);
        // Resolve entitlements exactly like the web LeaveBalanceCard:
        // employee monthly/yearly fields → company leave policy → defaults.
        const cfgs = await resolveEmployeeLeaveEntitlementsFull(emp, user.companyId || (emp.companyId as string) || '');
        const yearly: Record<string, number> = {};
        const encashable: LeaveType[] = [];
        const paid: LeaveType[] = [];
        for (const t of LEAVE_TYPES) {
          const c = cfgs[t];
          yearly[t] = c?.yearly ?? 0;
          if (c?.encashable) encashable.push(t);
          if (c?.paid) paid.push(t);
        }
        setAllowances(yearly);
        setBalanceConfig({ encashable, paid });
        // Employee-level entitlement fields are already full-year amounts → no
        // join-date proration (web's skipJoinProration path); company-policy and
        // default fallbacks are prorated by join date.
        setSkipProration(!!(
          emp.monthlyLeaveEntitlements || emp.leaveMonthlyEntitlements || emp.monthlyEntitlements ||
          emp.leaveAllowances || emp.yearlyEntitlements || emp.leaveYearlyEntitlements
        ));
      }
    } catch (err) { console.error('Failed to fetch leave balance:', err); }
  };

  useEffect(() => { fetchLeaves(); fetchBalance(); }, []);

  const onRefresh = async () => { setRefreshing(true); await Promise.all([fetchLeaves(), fetchBalance()]); setRefreshing(false); };

  const handleCancel = (id: string) => {
    Alert.alert('Cancel Leave', 'Are you sure you want to cancel this request?', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
        try {
          await updateDoc(doc(db, 'leaveRequests', id), { status: 'Cancelled' });
          setLeaves((prev) => prev.map((l) => (l.id === id ? { ...l, status: 'Cancelled' } : l)));
          logAudit({
            userId: user?.id || '', userName: user?.name || 'Employee', userRole: user?.role || 'employee',
            action: 'Cancelled leave request', actionType: 'update', module: 'Leave',
            targetEntity: id, status: 'success',
          }).catch(() => {});
        } catch { Alert.alert('Error', 'Failed to cancel leave'); }
      }},
    ]);
  };

  // Compute leave balances per type (centralized, with join-date proration)
  const leaveBalance = useMemo(() => {
    return computeLeaveBalance(allowances, leaves, user?.id || '', new Date().getFullYear(), skipProration ? undefined : joinDate, balanceConfig, skipProration);
  }, [leaves, allowances, user?.id, joinDate, balanceConfig, skipProration]);

  const hasBalances = Object.keys(leaveBalance).length > 0;

  const stats = useMemo(() => ({
    total: leaves.length, pending: leaves.filter(l => l.status === 'Pending').length,
    approved: leaves.filter(l => l.status === 'Approved').length,
    rejected: leaves.filter(l => l.status === 'Rejected').length,
  }), [leaves]);

  const filtered = (filter === 'All' ? leaves : leaves.filter(l => l.status === filter)).filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.leaveType || '').toLowerCase().includes(q) || (l.status || '').toLowerCase().includes(q) || (l.reason || '').toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [search, filter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Leave Type,Status,Start Date,End Date,Days,Paid,Reason'];
      const rows = filtered.map(l => `${(l.leaveType || '').replace(/,/g, ';')},${l.status || ''},${formatDate(l.startDate)},${formatDate(l.endDate)},${l.totalDays || 0},${l.isPaid ? 'Yes' : 'No'},${(l.reason || '').replace(/,/g, ';')}`);
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

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatDateShort = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const formatDateTime = (d: any) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  /** Render tier approval progress chips for a leave card */
  const renderTierChips = (leave: any) => {
    if (!leave.approvalStatus) return null;
    const steps = getApprovalSteps(leave);
    const progress = approvalProgressOf(leave);
    return (
      <View style={s.tierProgressWrap}>
        <View style={s.tierChipsRow}>
          {steps.map((step) => {
            const dotColor = LEVEL_COLORS[step.status] || '#d97706';
            return (
              <View key={step.key} style={[s.tierChip, { backgroundColor: `${dotColor}15` }]}>
                <View style={[s.tierChipDot, { backgroundColor: dotColor }]} />
                <Text style={[s.tierChipText, { color: dotColor }]}>
                  {step.label.split(' ')[0]}: {step.status}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={s.tierBarRow}>
          <View style={s.tierBar}>
            <View style={[s.tierBarFill, {
              width: `${progress.pct}%`,
              backgroundColor: leave.status === 'Rejected' ? '#ef4444' : '#FF6600',
            }]} />
          </View>
          <Text style={s.tierCount}>{progress.label}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <ScreenHeader
        title="Leaves"
        right={
          canApplyLeave ? (
            <TouchableOpacity
              style={s.applyBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Home', { screen: 'ApplyLeave' })}
            >
              <Icon name="add-circle-outline" size={15} color="#fff" />
              <Text style={s.applyBtnText}>Apply Leave</Text>
            </TouchableOpacity>
          ) : null
        }
      />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner
          greeting="Leaves"
          name="Leave Management"
          stats={[
            { label: 'Total', value: stats.total, color: '#3b82f6' },
            { label: 'Pending', value: stats.pending, color: '#eab308' },
            { label: 'Approved', value: stats.approved, color: '#10b981' },
            { label: 'Rejected', value: stats.rejected, color: '#ef4444' },
          ]}
        />

        <View style={s.header}>
          <Text style={s.title}>My Leaves</Text>
          <View style={s.headerRight}>
            <Text style={s.count}>{filtered.length} total</Text>
            {canApplyLeave && (
              <TouchableOpacity
                style={s.applyBtnSm}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Home', { screen: 'ApplyLeave' })}
              >
                <Icon name="add-outline" size={14} color="#fff" />
                <Text style={s.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Leave Balance Cards */}
        {hasBalances && (
          <View style={s.balanceSection}>
            <View style={s.balanceHeader}>
              <Icon name="wallet-outline" size={16} color={colors.purple || '#7c3aed'} />
              <Text style={s.balanceTitle}>Leave Balances · {new Date().getFullYear()}</Text>
              {stats.pending > 0 && (
                <Text style={s.balancePending}>{stats.pending} pending</Text>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.balanceRow}>
              {LEAVE_TYPES.map((t) => {
                const entry = leaveBalance[t];
                if (!entry) return null;
                return (
                  <View key={t} style={s.balanceCard}>
                    <Text style={s.balanceType}>{t}</Text>
                    <Text style={s.balanceValue}>
                      {entry.available}<Text style={s.balanceUnit}> left</Text>
                    </Text>
                    <Text style={s.balanceDetail}>{entry.used} used / {entry.allowance} yearly</Text>
                    {entry.pending > 0 && <Text style={s.balancePendingDetail}>+{entry.pending} pending</Text>}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={s.statsRow}>
          {[
            { label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Pending', value: stats.pending, color: '#eab308' },
            { label: 'Approved', value: stats.approved, color: '#10b981' },
            { label: 'Rejected', value: stats.rejected, color: '#ef4444' },
          ].map((st) => (
            <TouchableOpacity key={st.label} style={[s.statCard, { borderLeftColor: st.color }]} onPress={() => setFilter(st.label === 'Total' ? 'All' : st.label)}>
              <Text style={s.statNum}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'].map((f) => (
            <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterText, filter === f && s.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.emptyText}>No leave requests found</Text>
          ) : (
            paginated.map((leave) => (
              <TouchableOpacity key={leave.id} onPress={() => setViewModal(leave)}>
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={s.cardTypeRow}>
                        <Text style={s.leaveType}>{leave.leaveType}</Text>
                        <Text style={[s.paidBadge, { color: leave.isPaid !== false ? '#10b981' : '#9ca3af' }]}>
                          {leave.isPaid !== false ? '(Paid)' : '(Unpaid)'}
                        </Text>
                      </View>
                      <Text style={s.dateRange}>{formatDateShort(leave.startDate)} — {formatDateShort(leave.endDate)}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[leave.status]}20` }]}>
                      <Text style={[s.status, { color: STATUS_COLORS[leave.status] }]}>{leave.status}</Text>
                    </View>
                    {/* Eye → approval-chain view (matches web's row View action) */}
                    <TouchableOpacity
                      style={{ marginLeft: 8, padding: 4 }}
                      onPress={() => setViewModal(leave)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="eye-outline" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  <Text style={s.days}>{leave.totalDays || 0} day(s)</Text>
                  {leave.reason && <Text style={s.reason} numberOfLines={2}>{leave.reason}</Text>}

                  {/* Awaiting Master Admin badge */}
                  {isAwaitingMasterAdmin(leave.approvalStatus, leave.masterAdminRequired, leave.masterAdminApproveStatus) && (
                    <View style={s.maPendingBadge}>
                      <Text style={s.maPendingText}>Awaiting {MA_LABEL}</Text>
                    </View>
                  )}

                  {/* Tier approval progress with chips */}
                  {renderTierChips(leave)}

                  {leave.approvedByName && (
                    <Text style={s.reviewed}>Reviewed by {leave.approvedByName}{leave.reviewedOn ? ` on ${formatDateTime(leave.reviewedOn)}` : ''}</Text>
                  )}

                  {/* Management self-application notice */}
                  {(leave.applicantRole === 'executive' || leave.applicantRole === 'team-leader') && (
                    <View style={s.selfAppNotice}>
                      <Icon name="information-circle-outline" size={12} color="#9a3412" />
                      <Text style={s.selfAppNoticeText}>Management self-application — routes to Master Admin</Text>
                    </View>
                  )}

                  {leave.status === 'Pending' && (
                    <TouchableOpacity style={s.cancelBtn} onPress={() => handleCancel(leave.id)}>
                      <Text style={s.cancelText}>Cancel Request</Text>
                    </TouchableOpacity>
                  )}
                  {/* Re-submit rejected leave inside the 2-working-day window
                      (web parity — flow preserved after the My Leaves &
                      Attendance subsection removal). */}
                  {leave.status === 'Rejected' && canResubmit(leave) && (
                    <TouchableOpacity style={s.resubmitBtn} onPress={() => handleResubmit(leave)}>
                      <Text style={s.resubmitText}>Re-submit Application</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
        {renderPagination()}
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={!!viewModal} transparent animationType="fade" onRequestClose={() => setViewModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setViewModal(null)}>
          <View style={s.detailModal}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Header */}
              <View style={s.detailHeader}>
                <Text style={s.detailTitle}>{viewModal?.leaveType} Request</Text>
                <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[viewModal?.status]}20` }]}>
                  <Text style={[s.status, { color: STATUS_COLORS[viewModal?.status] }]}>{viewModal?.status}</Text>
                </View>
              </View>

              <Text style={s.detailSubtitle}>
                {formatDate(viewModal?.startDate)} — {formatDate(viewModal?.endDate)} · {viewModal?.totalDays || 0} day(s)
              </Text>
              {!viewModal?.isPaid && <Text style={s.detailUnpaid}>Unpaid</Text>}

              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Reason:</Text>
                <Text style={s.detailValue}>{viewModal?.reason || '—'}</Text>
              </View>
              {viewModal?.appliedOn && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Applied:</Text>
                  <Text style={s.detailValue}>{formatDateTime(viewModal.appliedOn)}</Text>
                </View>
              )}

              {/* Approval Chain */}
              {viewModal?.approvalStatus && (
                <View style={s.chainSection}>
                  <Text style={s.chainTitle}>Approval Chain</Text>
                  {getApprovalSteps(viewModal).map((step, i) => {
                    const dotColor = LEVEL_COLORS[step.status] || '#d97706';
                    return (
                      <View key={step.key} style={s.chainStep}>
                        <Text style={s.chainStepLabel}>{step.label}</Text>
                        <View style={[s.chainStepDot, { backgroundColor: dotColor }]} />
                        <Text style={[s.chainStepStatus, { color: dotColor }]}>{step.status}</Text>
                        {step.approvedByName && <Text style={s.chainStepBy}>by {step.approvedByName}</Text>}
                        {step.note ? <Text style={s.chainStepNote}>· {step.note}</Text> : null}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Master Admin badge */}
              {viewModal?.masterAdminRequired && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Master Admin:</Text>
                  <Text style={[s.detailValue, {
                    color: viewModal.masterAdminApproveStatus === 'Approved' ? '#16a34a'
                      : viewModal.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#d97706',
                  }]}>
                    {viewModal.masterAdminApproveStatus || 'Pending'}
                  </Text>
                </View>
              )}

              {/* Approval Log */}
              {viewModal?.approvalLog && viewModal.approvalLog.length > 0 && (
                <View style={s.approvalLogSection}>
                  <Text style={s.approvalLogTitle}>Audit Log</Text>
                  {viewModal.approvalLog.map((entry: any, idx: number) => (
                    <View key={idx} style={s.approvalLogEntry}>
                      <View style={[s.logDot, { backgroundColor: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }]} />
                      <Text style={s.logText}>
                        <Text style={[s.logBold, { color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }]}>{entry.status}</Text>
                        {' '}<Text style={s.logBold}>{TIER_LABELS[entry.tier as ApprovalTier] || entry.tier}</Text>
                        {' by '}{entry.approvedByName}
                        {entry.note ? ` — "${entry.note}"` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {viewModal?.reviewedByName && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Reviewed By:</Text>
                  <Text style={s.detailValue}>{viewModal.reviewedByName}</Text>
                </View>
              )}
              {viewModal?.reviewNote && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Review Note:</Text>
                  <Text style={s.detailValue}>{viewModal.reviewNote}</Text>
                </View>
              )}

              <TouchableOpacity style={s.closeModalBtn} onPress={() => setViewModal(null)}>
                <Text style={s.closeModalBtnText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FF6600', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20,
  },
  applyBtnSm: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FF6600', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16,
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // ── Leave Balance Section ──
  balanceSection: { paddingHorizontal: 20, marginBottom: 16 },
  balanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  balanceTitle: { fontSize: 13, fontWeight: '700', color: c.text, flex: 1 },
  balancePending: { fontSize: 12, color: '#d97706', fontWeight: '600' },
  balanceRow: { gap: 10, paddingVertical: 2 },
  balanceCard: { minWidth: 120, padding: 12, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight },
  balanceType: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  balanceValue: { fontSize: 20, fontWeight: '700', color: c.text, marginTop: 2 },
  balanceUnit: { fontSize: 12, fontWeight: '400', color: c.textTertiary },
  balanceDetail: { fontSize: 11, color: c.textTertiary, marginTop: 2 },
  balancePendingDetail: { fontSize: 11, color: '#6366f1', marginTop: 2 },

  // ── Stats ──
  statsRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, width: '31.5%', height: 95, justifyContent: 'center' },
  statNum: { fontSize: 22, fontWeight: 'bold', color: c.text },
  statLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },

  // ── Filters ──
  filterRow: { paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: '#FF6600' },
  filterText: { color: '#1F2937', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#fff' },

  // ── Search & Export ──
  searchRow: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // ── List ──
  list: { padding: 20 },
  emptyText: { color: c.textTertiary, fontSize: 14 },

  // ── Card ──
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cardTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaveType: { color: c.textPrimary, fontSize: 16, fontWeight: '600' },
  paidBadge: { fontSize: 12, fontWeight: '500' },
  dateRange: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  status: { fontSize: 13, fontWeight: '600' },
  days: { color: '#FF6600', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  reason: { color: c.textTertiary, fontSize: 12, marginBottom: 4 },
  reviewed: { color: c.textTertiary, fontSize: 11, fontStyle: 'italic', marginTop: 4 },
  cancelBtn: { marginTop: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' },
  cancelText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  resubmitBtn: { marginTop: 8, paddingVertical: 9, borderRadius: 8, backgroundColor: '#f97316', alignItems: 'center' },
  resubmitText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Awaiting Master Admin ──
  maPendingBadge: { marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#fff7ed', alignSelf: 'flex-start' },
  maPendingText: { fontSize: 11, fontWeight: '600', color: '#9a3412' },

  // ── Tier Progress ──
  tierProgressWrap: { marginTop: 8 },
  tierChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  tierChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  tierChipDot: { width: 5, height: 5, borderRadius: 3 },
  tierChipText: { fontSize: 10, fontWeight: '600' },
  tierBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierBar: { flex: 1, height: 5, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  tierBarFill: { height: '100%', borderRadius: 3 },
  tierCount: { color: c.textTertiary, fontSize: 10, fontWeight: '600', minWidth: 30, textAlign: 'right' },

  // ── Self-Application Notice ──
  selfAppNotice: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#fff7ed' },
  selfAppNoticeText: { fontSize: 10, fontWeight: '600', color: '#9a3412' },

  // ── Detail Modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  detailModal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24, maxHeight: '85%' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  detailTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, flex: 1 },
  detailSubtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 4 },
  detailUnpaid: { fontSize: 12, color: c.textTertiary, marginBottom: 8 },
  detailRow: { flexDirection: 'row', marginBottom: 8 },
  detailLabel: { color: c.textSecondary, fontSize: 13, flex: 1 },
  detailValue: { color: c.textPrimary, fontSize: 13, fontWeight: '600', flex: 2, textAlign: 'right' },

  // ── Approval Chain (detail modal) ──
  chainSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
  chainTitle: { fontSize: 12, fontWeight: '700', color: c.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  chainStep: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.surface || c.background, marginBottom: 6, borderWidth: 1, borderColor: c.borderLight },
  chainStepLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, minWidth: 100 },
  chainStepDot: { width: 8, height: 8, borderRadius: 4 },
  chainStepStatus: { fontSize: 13, fontWeight: '600' },
  chainStepBy: { fontSize: 11, color: c.textTertiary },
  chainStepNote: { fontSize: 11, color: c.textTertiary, fontStyle: 'italic' },

  // ── Approval Log (detail modal) ──
  approvalLogSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
  approvalLogTitle: { fontSize: 12, fontWeight: '700', color: c.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  approvalLogEntry: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logText: { fontSize: 12, color: c.textSecondary, flex: 1 },
  logBold: { fontWeight: '600', color: c.text },

  // ── Pagination ──
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },

  // ── Close Button ──
  closeModalBtn: { marginTop: 18, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  closeModalBtnText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
});
