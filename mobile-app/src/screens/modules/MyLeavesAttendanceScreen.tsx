import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { useEmployeePersonalStats } from '../../hooks/useEmployeePersonalStats';
import { db } from '../../aws/clients';
import {
  collection, query, where, getDocs, orderBy, limit, doc, getDoc,
  updateDoc, onSnapshot,
} from '../../aws/firestore-compat';
import { requestPunchRectification, getRecordEffectiveMissedPunchTiers } from '../../services/attendanceApi';
import { notifyPunchRectificationRequested } from '../../services/notificationService';
import { isActiveMissedPunchRecord } from '../../utils/attendanceStatus';
import { isWithinAttendanceCorrectionWindow, parseWeekendDays, toDateKey } from '../../utils/workingDays';
import { Icon } from '../../utils/icons';
import { TIER_ORDER, TIER_LABELS, getEffectiveTiers, getLiveTiers, isAwaitingMasterAdmin, computeLeaveBalance, resolveEmployeeLeaveEntitlementsFull } from '../../services/leaveService';
import type { ApprovalTier, LeaveRequest, LeaveType } from '../../types/user';
import {
  HeroBanner, PremiumCard, ShimmerLoader,
  StatusBadge, EmptyStateView,
} from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

const STATUS_COLORS: Record<string, string> = {
  Pending: '#eab308',
  Approved: '#10b981',
  Rejected: '#ef4444',
  Cancelled: '#64748b',
};

const ATTENDANCE_COLORS: Record<string, string> = {
  Present: '#10b981',
  Late: '#eab308',
  Absent: '#ef4444',
  'On Leave': '#3b82f6',
  'Miss Punch': '#8b5cf6',
};

const LEAVE_STATUS_COLOR = (s?: string) => {
  switch (s) {
    case 'Approved': return '#10b981';
    case 'Rejected': return '#ef4444';
    case 'Cancelled': return '#64748b';
    default: return '#eab308';
  }
};

const LEVEL_COLOR = (s?: string) => {
  switch (s) {
    case 'Approved': return '#10b981';
    case 'Rejected': return '#ef4444';
    default: return '#eab308';
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  return null;
};

const fmtTime = (v: any): string => {
  const d = toDate(v);
  if (!d) return '--';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const fmtDate = (v: any): string => {
  const d = toDate(v);
  if (!d) return '--';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtShortDate = (v: any): string => {
  const d = toDate(v);
  if (!d) return '--';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveBalanceEntry {
  allowance: number;
  used: number;
  pending: number;
  available: number;
}

interface ApprovalStep {
  key: string;
  label: string;
  status: string;
  approvedByName?: string;
  note?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MyLeavesAttendanceScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const personal = useEmployeePersonalStats();
  const s = useMemo(() => createStyles(colors), [colors]);

  // ── State ──
  const [tab, setTab] = useState<'leaves' | 'attendance' | 'missed'>('leaves');
  const [leaveFilter, setLeaveFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([]);
  const [allowances, setAllowances] = useState<Record<string, number>>({});
  const [joinDate, setJoinDate] = useState<Date | null | undefined>(undefined);
  const [balanceConfig, setBalanceConfig] = useState<{ encashable: LeaveType[]; paid: LeaveType[] } | undefined>(undefined);
  const [skipProration, setSkipProration] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Rectify
  const [rectifyModal, setRectifyModal] = useState<any>(null);
  const [rectifyTime, setRectifyTime] = useState('');
  const [rectifyRemark, setRectifyRemark] = useState('');
  const [submittingRectify, setSubmittingRectify] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // View modals
  const [viewLeave, setViewLeave] = useState<LeaveRequest | null>(null);
  const [viewAttendance, setViewAttendance] = useState<any>(null);

  const userId = user?.id || '';
  const companyId = effectiveCompanyId || user?.companyId || '';

  // ── Fetch leaves ──
  useEffect(() => {
    if (!userId) { setMyLeaves([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'leaveRequests'), where('userId', '==', userId)),
      (snap) => {
        const docs = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            ...data,
            id: d.id,
            // Backend stores the type under `type` — normalize for display.
            leaveType: data.leaveType || data.type || 'Casual',
            startDate: toDate(data.startDate),
            endDate: toDate(data.endDate),
            appliedOn: toDate(data.appliedOn),
          } as LeaveRequest;
        });
        docs.sort((a, b) =>
          (toDate(b.appliedOn)?.getTime() || 0) - (toDate(a.appliedOn)?.getTime() || 0)
        );
        setMyLeaves(docs);
        setLoading(false);
      },
      () => { setMyLeaves([]); setLoading(false); }
    );
    return () => unsub();
  }, [userId]);

  // ── Fetch employee allowances & joinDate ──
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const empSnap = await getDoc(doc(db, 'employees', userId));
        if (cancelled || !empSnap.exists()) return;
        const emp = empSnap.data();
        // joinDate
        const jd = emp.joinDate?.toDate ? emp.joinDate.toDate() : emp.joinDate ? new Date(emp.joinDate) : null;
        if (!cancelled) setJoinDate(jd);
        // Leave allowances resolved exactly like the web LeaveBalanceCard:
        // employee monthly/yearly fields → company leave policy → defaults.
        const cfgs = await resolveEmployeeLeaveEntitlementsFull(emp, user?.companyId || (emp.companyId as string) || '');
        const empAllowances: Record<string, number> = {};
        const encashable: LeaveType[] = [];
        const paid: LeaveType[] = [];
        for (const t of LEAVE_TYPES) {
          const c = cfgs[t];
          empAllowances[t] = c?.yearly ?? 0;
          if (c?.encashable) encashable.push(t);
          if (c?.paid) paid.push(t);
        }
        const hasEmpFields = !!(
          emp.monthlyLeaveEntitlements || emp.leaveMonthlyEntitlements || emp.monthlyEntitlements ||
          emp.leaveAllowances || emp.yearlyEntitlements || emp.leaveYearlyEntitlements
        );
        if (!cancelled) {
          setAllowances(empAllowances);
          setBalanceConfig({ encashable, paid });
          setSkipProration(hasEmpFields);
        }
      } catch {
        if (!cancelled) setAllowances({});
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Managers list (for rectification notifications) ──
  const [managers, setManagers] = useState<string[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', 'in', ['company-admin', 'executive', 'team-leader'])),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const scoped = user?.companyId
          ? list.filter((u: any) => u.companyId === user.companyId || (u.assignedCompanyIds || []).includes(user.companyId))
          : list;
        setManagers(scoped.map((u: any) => u.id));
      },
      () => {}
    );
    return () => unsub();
  }, [user?.companyId]);

  // ── Derived data ──
  const sortedRecords = useMemo(
    () => [...personal.monthRecords].sort(
      (a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)
    ),
    [personal.monthRecords]
  );

  const unresolvedMissPunches = useMemo(
    () => sortedRecords.filter((r) => isActiveMissedPunchRecord(r)),
    [sortedRecords]
  );

  const pendingCount = myLeaves.filter((l) => l.status === 'Pending').length;

  const filteredLeaves = useMemo(() => {
    if (leaveFilter === 'All') return myLeaves;
    return myLeaves.filter((l) => l.status === leaveFilter);
  }, [myLeaves, leaveFilter]);

  // ── Leave balance computation (centralized, with join-date proration) ──
  const leaveBalance = useMemo(() => {
    return computeLeaveBalance(allowances, myLeaves, userId, new Date().getFullYear(), skipProration ? undefined : joinDate, balanceConfig, skipProration);
  }, [allowances, myLeaves, userId, joinDate, balanceConfig, skipProration]);

  const hasBalances = Object.keys(leaveBalance).length > 0;

  // ── Today ──
  const todayRecord = personal.todayRecord;
  const todayCompleted = !!todayRecord?.checkIn && !!todayRecord?.checkOut;
  const todayStatus = todayCompleted
    ? 'Completed'
    : todayRecord?.status || (todayRecord ? 'Checked In' : 'Not Checked In');

  const monthStats = personal.monthStats;

  // ── Re-submit rejected leave (2-working-day window, matches web) ──
  const [resubmitWeekends, setResubmitWeekends] = useState<number[]>([0, 6]);
  const [resubmitHolidays, setResubmitHolidays] = useState<string[]>([]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        // Company weekends from payroll settings
        const compSnap = await getDoc(doc(db, 'companies', companyId)).catch(() => null);
        const weekendsRaw = (compSnap?.data() as any)?.payrollSettings?.weekends;
        if (Array.isArray(weekendsRaw)) setResubmitWeekends(parseWeekendDays(weekendsRaw));

        // Company holidays (company-specific + global null-company)
        const holSnap = await getDocs(query(collection(db, 'holidays'), where('companyId', 'in', [companyId, null])))
          .catch(() => null);
        const keys = (holSnap?.docs || [])
          .map((d) => toDateKey((d.data() as any)?.date ? ((d.data() as any).date?.toDate ? (d.data() as any).date.toDate() : new Date((d.data() as any).date)) : null))
          .filter(Boolean);
        setResubmitHolidays(keys);
      } catch {}
    })();
    return () => unsub?.();
  }, [companyId]);

  const canResubmit = (leave: LeaveRequest): boolean => {
    // Web fallback order: rejectedAt → reviewedOn → appliedOn
    const from = toDate(leave.rejectedAt) || toDate((leave as any).reviewedOn) || toDate(leave.appliedOn);
    if (!from) return false;
    // TRUE 2-working-day window using company weekends + holidays (matches web exactly)
    return isWithinAttendanceCorrectionWindow(from, new Date(), resubmitWeekends, resubmitHolidays);
  };

  /** 2-working-day rectification window for a missed-punch record (matches web). */
  const rectificationWindowOpen = (rec: any): boolean => {
    const recDate = toDate(rec?.date);
    if (!recDate) return false;
    return isWithinAttendanceCorrectionWindow(recDate, new Date(), resubmitWeekends, resubmitHolidays);
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
    // the drawer's nested navigator, otherwise the route is not found when this
    // screen is opened from the drawer menu.
    navigation.navigate('Home', {
      screen: 'ApplyLeave',
      params: {
        reSubmit: true,
        leaveType: leave.leaveType || (leave as any).type || 'Casual',
        startDate: toInput(leave.startDate),
        endDate: toInput(leave.endDate),
        reason: leave.reason,
        totalDays: leave.totalDays,
      },
    });
  };

  // ── Handlers ──
  const onRefresh = async () => {
    setRefreshing(true);
    // Re-trigger stats
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  };

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return;
    // 2-working-day correction window guard (matches web's assertWithinAttendanceCorrectionWindow)
    if (!rectificationWindowOpen(rectifyModal)) {
      setActionMsg({ type: 'error', text: 'The 2-working-day correction window for this day has closed. Changes can no longer be made to this attendance record.' });
      return;
    }
    setSubmittingRectify(true);
    try {
      const [h, m] = rectifyTime.split(':').map(Number);
      const corrected = new Date(toDate(rectifyModal.date) || new Date());
      corrected.setHours(h, m, 0, 0);
      await requestPunchRectification(rectifyModal.id, corrected, { employeeRemark: rectifyRemark || undefined });
      await notifyPunchRectificationRequested(
        user.id, user.name || 'Employee',
        new Date(rectifyModal.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        rectifyModal.companyId || user.companyId || '',
        managers
      );
      setActionMsg({ type: 'success', text: 'Rectification request submitted for review.' });
      setRectifyModal(null);
      setRectifyTime('');
      setRectifyRemark('');
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Failed to submit rectification' });
    } finally {
      setSubmittingRectify(false);
    }
  };

  const getApprovalSteps = (leave: LeaveRequest): ApprovalStep[] => {
    const effective = getEffectiveTiers(leave.applicantRole);
    const steps: ApprovalStep[] = effective.map((tier) => ({
      key: tier,
      label: TIER_LABELS[tier],
      status: leave.approvalStatus?.[tier] || 'Pending',
      approvedByName: leave.approvalLog?.find((e: any) => e.tier === tier)?.approvedByName,
    }));
    if (leave.masterAdminRequired) {
      steps.push({
        key: 'masterAdmin',
        label: 'Master Admin',
        status: leave.masterAdminApproveStatus || 'Pending',
        approvedByName: leave.masterAdminApprovedByName,
        note: leave.masterAdminNote,
      });
    }
    return steps;
  };

  // ── Render helpers ──
  const stepPill = (step: ApprovalStep) => {
    const color = LEVEL_COLOR(step.status);
    return (
      <View key={step.key} style={[s.stepPill, { backgroundColor: `${color}18` }]}>
        <View style={[s.stepDot, { backgroundColor: color }]} />
        <Text style={[s.stepPillText, { color }]}>
          {step.label.split(' ')[0]}: {step.status}
        </Text>
      </View>
    );
  };

  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="My Leaves & Attendance" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Header */}
        <HeroBanner
          greeting="Self Service"
          name="My Leaves & Attendance"
          subtitle={`${myLeaves.length} leaves · ${monthStats.present} present · ${monthStats.absent} absent`}
          stats={[
            { label: 'Total', value: myLeaves.length, color: '#FF6600' },
            { label: 'Pending', value: pendingCount, color: '#eab308' },
            { label: 'Approved', value: myLeaves.filter((l) => l.status === 'Approved').length, color: '#10b981' },
            { label: 'Present', value: monthStats.present, color: '#3b82f6' },
          ]}
        />

        {/* Action message */}
        {actionMsg && (
          <View style={[s.actionBanner, {
            backgroundColor: actionMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
            borderColor: actionMsg.type === 'success' ? '#bbf7d0' : '#fecaca',
          }]}>
            <Icon
              name={actionMsg.type === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={16}
              color={actionMsg.type === 'success' ? '#16a34a' : '#ef4444'}
            />
            <Text style={[s.actionText, { color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444' }]}>
              {actionMsg.text}
            </Text>
            <TouchableOpacity onPress={() => setActionMsg(null)}>
              <Icon name="close-outline" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        )}

        {/* Quick actions — Company Admin & Master Admin never create leave
            (verify-only roles; web LeaveManagement excludes its Apply button
            for both). HR is a regular requester. */}
        <View style={s.quickActionsRow}>
          {user?.role !== 'company-admin' && user?.role !== 'master-admin' && (
            <TouchableOpacity
              style={[s.quickActionBtn, { backgroundColor: '#7c3aed' }]}
              onPress={() => navigation?.navigate('Home', { screen: 'ApplyLeave' })}
            >
              <Icon name="add-circle-outline" size={16} color="#fff" />
              <Text style={s.quickActionText}>Apply Leave</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Today strip */}
        <PremiumCard style={s.todayCard}>
          <View style={s.todayRow}>
            <View style={s.todayLeft}>
              <View style={[s.todayDot, { backgroundColor: (todayRecord?.status ? ATTENDANCE_COLORS[todayRecord.status] : undefined) || '#FF6600' }]} />
              <View>
                <Text style={s.todayLabel}>TODAY</Text>
                <Text style={[s.todayStatus, { color: (todayRecord?.status ? ATTENDANCE_COLORS[todayRecord.status] : undefined) || colors.text }]}>
                  {todayStatus}
                </Text>
                <Text style={s.todayTime}>
                  {todayRecord?.checkIn ? `In ${fmtTime(todayRecord.checkIn)}` : 'No check-in'}
                  {todayRecord?.checkOut ? ` · Out ${fmtTime(todayRecord.checkOut)}` : ''}
                </Text>
              </View>
            </View>
            <View style={s.todayStats}>
              {[
                { label: 'Present', value: monthStats.present, color: '#10b981' },
                { label: 'Late', value: monthStats.late, color: '#eab308' },
                { label: 'Absent', value: monthStats.absent, color: '#ef4444' },
                { label: 'Leave', value: monthStats.onLeave, color: '#3b82f6' },
                { label: 'Open', value: unresolvedMissPunches.length, color: '#8b5cf6' },
              ].map((st) => (
                <View key={st.label} style={s.todayStatItem}>
                  <Text style={[s.todayStatValue, { color: st.color }]}>{st.value}</Text>
                  <Text style={s.todayStatLabel}>{st.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </PremiumCard>

        {/* Leave Balances */}
        {hasBalances && (
          <PremiumCard style={s.balanceCard}>
            <View style={s.balanceHeader}>
              <Icon name="wallet-outline" size={16} color="#7c3aed" />
              <Text style={s.balanceTitle}>Leave Balances · {new Date().getFullYear()}</Text>
              {pendingCount > 0 && (
                <Text style={s.pendingBadge}>{pendingCount} pending</Text>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.balanceGrid}>
              {LEAVE_TYPES.map((t) => {
                const entry = leaveBalance[t];
                if (!entry) return null;
                return (
                  <View key={t} style={s.balanceItem}>
                    <Text style={s.balanceType}>{t}</Text>
                    <Text style={s.balanceValue}>
                      {entry.available}
                      <Text style={s.balanceLeft}> left</Text>
                    </Text>
                    <Text style={s.balanceDetail}>
                      {entry.used} used / {entry.allowance} yearly
                    </Text>
                    {entry.pending > 0 && (
                      <Text style={s.balancePending}>+{entry.pending} pending</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </PremiumCard>
        )}

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
          {([
            { key: 'leaves' as const, label: 'My Leaves', count: myLeaves.length },
            { key: 'attendance' as const, label: 'Attendance', count: sortedRecords.length },
            { key: 'missed' as const, label: 'Missed Punches', count: unresolvedMissPunches.length, accent: unresolvedMissPunches.length > 0 },
          ]).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
              <View style={[s.tabBadge, tab === t.key ? s.tabBadgeActive : t.accent ? s.tabBadgeAccent : {}]}>
                <Text style={[s.tabBadgeText, tab === t.key ? s.tabBadgeTextActive : t.accent ? s.tabBadgeTextAccent : {}]}>
                  {t.count}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── LEAVES TAB ── */}
        {tab === 'leaves' && (
          <PremiumCard style={s.tabContent}>
            {/* Filter row */}
            <View style={s.filterRow}>
              <Text style={s.sectionLabel}>My Leave Requests</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={s.filterPills}>
                {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[s.filterPill, leaveFilter === f && s.filterPillActive]}
                    onPress={() => setLeaveFilter(f)}
                  >
                    <Text style={[s.filterPillText, leaveFilter === f && s.filterPillTextActive]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {loading ? (
              <ShimmerLoader count={3} height={80} style={{ padding: 16 }} />
            ) : filteredLeaves.length === 0 ? (
              <EmptyStateView
                icon="calendar-outline"
                title="No leave requests"
                subtitle={myLeaves.length === 0 ? 'Use "Apply Leave" to request time off.' : `No ${leaveFilter.toLowerCase()} leaves.`}
              />
            ) : (
              filteredLeaves.map((leave) => (
                <TouchableOpacity key={leave.id} style={s.leaveCard} onPress={() => setViewLeave(leave)}>
                  <View style={s.leaveCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.leaveType}>{leave.leaveType || 'Other'}</Text>
                      <Text style={s.leaveDates}>
                        {fmtShortDate(leave.startDate)} – {fmtShortDate(leave.endDate)}
                      </Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: `${LEAVE_STATUS_COLOR(leave.status)}18` }]}>
                      <Text style={[s.statusText, { color: LEAVE_STATUS_COLOR(leave.status) }]}>{leave.status}</Text>
                    </View>
                    {/* Eye → approval-chain view (matches web's row View action) */}
                    <TouchableOpacity
                      style={{ marginLeft: 8, padding: 4 }}
                      onPress={() => setViewLeave(leave)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="eye-outline" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  <View style={s.leaveMeta}>
                    <Text style={s.leaveDays}>{leave.totalDays || 1} day(s)</Text>
                    {!leave.isPaid && <Text style={s.unpaidTag}>Unpaid</Text>}
                    <Text style={s.appliedOn}>Applied {fmtShortDate(leave.appliedOn)}</Text>
                  </View>

                  {/* Tier progress */}
                  {leave.approvalStatus && (() => {
                    // Live tiers only (web approvalProgressOf parity): a Skipped
                    // tier has no approver, so counting it left the bar stuck
                    // below 100% forever.
                    const effective = getLiveTiers(leave);
                    const effectiveCount = effective.length;
                    const resolved = effective.filter((t: ApprovalTier) => leave.approvalStatus?.[t] === 'Approved').length;
                    const maStep = leave.masterAdminRequired ? 1 : 0;
                    const total = effectiveCount + maStep;
                    const done = resolved + (leave.masterAdminRequired && leave.masterAdminApproveStatus && leave.masterAdminApproveStatus !== 'Pending' ? 1 : 0);
                    return (
                      <View style={s.tierProgress}>
                        <View style={s.tierBar}>
                          <View style={[s.tierBarFill, {
                            width: `${total > 0 ? (done / total) * 100 : 0}%`,
                            backgroundColor: leave.status === 'Rejected' ? '#ef4444' : '#FF6600',
                          }]} />
                        </View>
                        <Text style={s.tierCount}>
                          {done}/{total} approved
                        </Text>
                      </View>
                    );
                  })()}

                  {/* Re-submit rejected leave */}
                  {leave.status === 'Rejected' && canResubmit(leave) && (
                    <TouchableOpacity
                      onPress={() => handleResubmit(leave)}
                      style={s.resubmitBtn}
                    >
                      <Icon name="refresh-outline" size={14} color="#fff" />
                      <Text style={s.resubmitBtnText}>Re-submit Application</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))
            )}
          </PremiumCard>
        )}

        {/* ── ATTENDANCE TAB ── */}
        {tab === 'attendance' && (
          <PremiumCard style={s.tabContent}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>
                Attendance · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </Text>
            </View>
            {sortedRecords.length === 0 ? (
              <EmptyStateView icon="clipboard-outline" title="No records" subtitle="No attendance records this month yet." />
            ) : (
              sortedRecords.map((rec) => (
                <TouchableOpacity
                  key={rec.id}
                  style={s.attendanceCard}
                  onPress={() => setViewAttendance(rec)}
                >
                  <View style={[s.attDot, { backgroundColor: ATTENDANCE_COLORS[rec.status] || '#64748b' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.attDate}>{fmtDate(rec.date)}</Text>
                    <View style={s.attTimes}>
                      <Text style={s.attTime}>In: {fmtTime(rec.checkIn)}</Text>
                      <Text style={s.attTime}>Out: {fmtTime(rec.checkOut)}</Text>
                    </View>
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: `${ATTENDANCE_COLORS[rec.status] || '#64748b'}18` }]}>
                    <Text style={[s.statusText, { color: ATTENDANCE_COLORS[rec.status] || '#64748b' }]}>{rec.status}</Text>
                  </View>
                  {/* Eye → record details (matches web's row View action) */}
                  <TouchableOpacity
                    style={{ padding: 4 }}
                    onPress={() => setViewAttendance(rec)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="eye-outline" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                  {/* Web parity: Rectify stays available while a chain is active
                      (re-submission inside the 2-working-day window). */}
                  {isActiveMissedPunchRecord(rec) && rectificationWindowOpen(rec) && (
                    <TouchableOpacity
                      style={s.rectifyBtn}
                      onPress={() => setRectifyModal(rec)}
                    >
                      <Icon name="create-outline" size={14} color="#7c3aed" />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))
            )}
          </PremiumCard>
        )}

        {/* ── MISSED PUNCHES TAB ── */}
        {tab === 'missed' && (
          <PremiumCard style={s.tabContent}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>Missed Punches</Text>
            </View>
            {unresolvedMissPunches.length === 0 ? (
              <EmptyStateView icon="checkmark-circle-outline" title="All clear" subtitle="No unresolved missed punches." />
            ) : (
              unresolvedMissPunches.map((rec) => {
                const requested = rec.missedPunchRectification?.requested;
                return (
                  <TouchableOpacity
                    key={rec.id}
                    style={s.missedCard}
                    onPress={() => setViewAttendance(rec)}
                  >
                    <View style={[s.missDot, { backgroundColor: requested ? '#eab308' : '#7c3aed' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.missedDate}>{fmtDate(rec.date)}</Text>
                      <Text style={s.missedDetail}>
                        {requested
                          ? 'Rectification submitted · pending review'
                          : `Checked in at ${fmtTime(rec.checkIn)} · check-out missing`}
                      </Text>
                    </View>
                    {/* Eye → record details (matches web's row View action) */}
                    <TouchableOpacity
                      style={{ padding: 4 }}
                      onPress={() => setViewAttendance(rec)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="eye-outline" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                    {/* Re-submit allowed while a chain is active (web parity —
                        no `!requested` lock). */}
                    {rectificationWindowOpen(rec) && (
                      <TouchableOpacity
                        style={s.rectifyApplyBtn}
                        onPress={() => setRectifyModal(rec)}
                      >
                        <Icon name="create-outline" size={14} color="#fff" />
                        <Text style={s.rectifyApplyText}>Apply</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </PremiumCard>
        )}
      </ScrollView>

      {/* ── RECTIFY MODAL ── */}
      <Modal visible={!!rectifyModal} transparent animationType="fade" onRequestClose={() => !submittingRectify && setRectifyModal(null)}>
        <View style={[s.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={s.modalTitle}>Rectify Missed Punch</Text>
            <Text style={s.modalDesc}>
              You missed your checkout on <Text style={{ fontWeight: '700' }}>{fmtDate(rectifyModal?.date)}</Text>.
            </Text>
            <Text style={[s.modalDesc, { marginTop: 4 }]}>
              Checked in at {fmtTime(rectifyModal?.checkIn)}. Enter your actual checkout time.
            </Text>
            <Text style={[s.modalDesc, { color: colors.textSecondary, marginTop: 12, fontWeight: '600' }]}>
              Correct Check-Out Time (HH:MM)
            </Text>
            <TextInput
              style={[s.timeInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
              value={rectifyTime}
              onChangeText={setRectifyTime}
              placeholder="e.g. 18:30"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            <Text style={[s.modalDesc, { color: colors.textSecondary, marginTop: 12, fontWeight: '600' }]}>
              Remark (Optional)
            </Text>
            <TextInput
              style={[s.remarkInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
              value={rectifyRemark}
              onChangeText={setRectifyRemark}
              placeholder="Add a note for the approver..."
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={[s.modalBtn, { borderColor: colors.border }]}
                onPress={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark(''); }}
                disabled={submittingRectify}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: '#7c3aed', opacity: rectifyTime ? 1 : 0.5 }]}
                onPress={handleRectifyRequest}
                disabled={!rectifyTime || submittingRectify}
              >
                {submittingRectify ? (
                  <ActivityIndicator size={16} color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Submit for Review</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── VIEW LEAVE MODAL ── */}
      <Modal visible={!!viewLeave} transparent animationType="fade" onRequestClose={() => setViewLeave(null)}>
        <View style={[s.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <ScrollView contentContainerStyle={s.modalScrollContent}>
            <View style={[s.modalCard, { backgroundColor: colors.card }]}>
              <Text style={s.modalTitle}>{viewLeave?.leaveType || 'Leave'} Request</Text>
              <View style={[s.statusBadge, { backgroundColor: `${LEAVE_STATUS_COLOR(viewLeave?.status)}18`, alignSelf: 'flex-start' }]}>
                <Text style={[s.statusText, { color: LEAVE_STATUS_COLOR(viewLeave?.status) }]}>{viewLeave?.status}</Text>
              </View>
              <Text style={[s.modalDesc, { marginTop: 10 }]}>
                {fmtDate(viewLeave?.startDate)} – {fmtDate(viewLeave?.endDate)} · {viewLeave?.totalDays || 1} day(s)
              </Text>
              {viewLeave?.reason && (
                <Text style={[s.modalDesc, { marginTop: 8 }]}>
                  <Text style={{ color: '#9ca3af' }}>Reason: </Text>{viewLeave.reason}
                </Text>
              )}
              {viewLeave?.appliedOn && (
                <Text style={[s.modalDesc, { color: '#9ca3af', marginTop: 4 }]}>
                  Applied on {fmtDate(viewLeave.appliedOn)}
                </Text>
              )}

              {/* Approval chain */}
              <Text style={s.modalSectionTitle}>Approval Chain</Text>
              {viewLeave && getApprovalSteps(viewLeave).map((step, i) => (
                <View key={step.key} style={s.stepRow}>
                  <Text style={s.stepLabel}>{step.label}</Text>
                  <View style={[s.stepDotSmall, { backgroundColor: LEVEL_COLOR(step.status) }]} />
                  <Text style={[s.stepStatus, { color: LEVEL_COLOR(step.status) }]}>{step.status}</Text>
                  {step.approvedByName && <Text style={s.stepByName}>by {step.approvedByName}</Text>}
                  {step.note ? <Text style={s.stepNote}>· {step.note}</Text> : null}
                </View>
              ))}

              {/* Awaiting Master Admin badge */}
              {viewLeave && viewLeave.approvalStatus && isAwaitingMasterAdmin(viewLeave.approvalStatus, viewLeave.masterAdminRequired, viewLeave.masterAdminApproveStatus) && (
                <View style={{ marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#fff7ed', alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#9a3412' }}>Awaiting Master Admin</Text>
                </View>
              )}

              {/* Master Admin note */}
              {viewLeave?.masterAdminNote && (
                <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#f0f2f5' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#6b7280', marginBottom: 2 }}>Master Admin Note</Text>
                  <Text style={{ fontSize: 12, color: '#374151' }}>{viewLeave.masterAdminNote}</Text>
                </View>
              )}

              {/* Audit log */}
              {viewLeave?.approvalLog && viewLeave.approvalLog.length > 0 && (
                <>
                  <Text style={s.modalSectionTitle}>Audit Log</Text>
                  {viewLeave.approvalLog.map((entry: any, i: number) => (
                    <View key={i} style={s.logEntry}>
                      <Text style={[s.logStatus, { color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }]}>
                        {entry.status}
                      </Text>
                      <Text style={s.logText}>{entry.approvedByName}</Text>
                      <Text style={s.logDate}>· {fmtDate(entry.approvedOn)}</Text>
                    </View>
                  ))}
                </>
              )}

              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.background, marginTop: 16 }]} onPress={() => setViewLeave(null)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── VIEW ATTENDANCE MODAL ── */}
      <Modal visible={!!viewAttendance} transparent animationType="fade" onRequestClose={() => setViewAttendance(null)}>
        <View style={[s.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <ScrollView contentContainerStyle={s.modalScrollContent}>
            <View style={[s.modalCard, { backgroundColor: colors.card }]}>
              <Text style={s.modalTitle}>Attendance Detail</Text>
              <Text style={s.modalDesc}>{fmtDate(viewAttendance?.date)} · {viewAttendance?.status}</Text>
              <View style={s.detailGrid}>
                <View style={s.detailBox}>
                  <Text style={s.detailLabel}>Check-In</Text>
                  <Text style={s.detailValue}>{fmtTime(viewAttendance?.checkIn)}</Text>
                </View>
                <View style={s.detailBox}>
                  <Text style={s.detailLabel}>Check-Out</Text>
                  <Text style={s.detailValue}>{fmtTime(viewAttendance?.checkOut)}</Text>
                </View>
              </View>
              {viewAttendance?.workHours != null && (
                <Text style={[s.modalDesc, { marginTop: 10 }]}>
                  Worked <Text style={{ fontWeight: '700' }}>{Number(viewAttendance.workHours).toFixed(1)} hours</Text>
                </Text>
              )}

              {/* Missed punch rectification progress */}
              {viewAttendance?.missedPunchRectification?.requested && (() => {
                const mp = viewAttendance.missedPunchRectification;
                // Web parity: attendance docs store the role at
                // missedPunchRectification.applicantRole — reading the (absent)
                // top-level applicantRole always fell back to the employee
                // chain, and leave's getEffectiveTiers didn't trim the phantom RM tier.
                const effective = getRecordEffectiveMissedPunchTiers(mp);
                const done = effective.filter((t: ApprovalTier) =>
                  mp.approvalStatus?.[t] === 'Approved' || mp.approvalStatus?.[t] === 'Rejected'
                ).length;
                const total = effective.length + (mp.masterAdminRequired ? 1 : 0);
                const chip = (st: string) => st === 'Approved' ? { bg: '#dcfce7', c: '#16a34a' } : st === 'Rejected' ? { bg: '#fee2e2', c: '#ef4444' } : { bg: '#fef3c7', c: '#b45309' };
                return (
                  <View style={{ marginTop: 12 }}>
                    <Text style={s.modalSectionTitle}>Rectification Progress</Text>
                    <Text style={[s.modalDesc, { marginBottom: 8 }]}>
                      Progress <Text style={{ fontWeight: '700' }}>{Math.min(done, total)}</Text>/{total}
                    </Text>
                    {effective.map((t) => {
                      const st = mp.approvalStatus?.[t] || 'Pending';
                      const c = chip(st);
                      return (
                        <View key={t} style={[s.stepRow, { backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 6 }]}>
                          <Text style={s.stepLabel}>{TIER_LABELS[t]}</Text>
                          <View style={[s.stepDotSmall, { backgroundColor: c.c }]} />
                          <Text style={[s.stepStatus, { color: c.c }]}>{st}</Text>
                        </View>
                      );
                    })}
                    {mp.masterAdminRequired && (
                      <View style={[s.stepRow, { backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 6 }]}>
                        <Text style={s.stepLabel}>Master Admin</Text>
                        <View style={[s.stepDotSmall, { backgroundColor: chip(mp.masterAdminApproveStatus || 'Pending').c }]} />
                        <Text style={[s.stepStatus, { color: chip(mp.masterAdminApproveStatus || 'Pending').c }]}>
                          {mp.masterAdminApproveStatus || 'Pending'}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.background, marginTop: 16 }]} onPress={() => setViewAttendance(null)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (c: ThemeColors) => StyleSheet.create({
  header: { padding: 20, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },

  // Action banner
  actionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, padding: 12,
    borderWidth: 1, borderRadius: 12,
  },
  actionText: { flex: 1, fontSize: 13, fontWeight: '600' },

  // Quick actions
  quickActionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14, marginBottom: 4 },
  quickActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
  },
  quickActionText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Today card
  todayCard: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  todayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 180 },
  todayDot: { width: 12, height: 12, borderRadius: 6 },
  todayLabel: { fontSize: 11, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  todayStatus: { fontSize: 18, fontWeight: '700', marginTop: 1 },
  todayTime: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  todayStats: { flexDirection: 'row', gap: 16, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' },
  todayStatItem: { alignItems: 'center', minWidth: 44 },
  todayStatValue: { fontSize: 18, fontWeight: '700' },
  todayStatLabel: { fontSize: 11, color: c.textTertiary },

  // Balances
  balanceCard: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  balanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  balanceTitle: { fontSize: 14, fontWeight: '700', color: c.text, flex: 1 },
  pendingBadge: { fontSize: 12, color: '#d97706', fontWeight: '600' },
  balanceGrid: { flexDirection: 'row', gap: 10, paddingRight: 16, paddingBottom: 4 },
  balanceItem: {
    flex: 1, minWidth: 110, padding: 10, borderRadius: 10,
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#f0f2f5',
  },
  balanceType: { fontSize: 12, fontWeight: '600', color: '#374151' },
  balanceValue: { fontSize: 20, fontWeight: '700', color: c.text, marginTop: 2 },
  balanceLeft: { fontSize: 12, fontWeight: '400', color: c.textTertiary },
  balanceDetail: { fontSize: 11, color: c.textTertiary, marginTop: 2 },
  balancePending: { fontSize: 11, color: '#6366f1', marginTop: 2 },

  // Tabs
  tabRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginTop: 18, marginBottom: 8,
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 2 },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: c.text },
  tabBadge: {
    paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999,
    backgroundColor: '#eef0f3',
  },
  tabBadgeActive: { backgroundColor: '#7c3aed18' },
  tabBadgeAccent: { backgroundColor: '#f3e8ff' },
  tabBadgeText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  tabBadgeTextActive: { color: '#7c3aed' },
  tabBadgeTextAccent: { color: '#7c3aed' },

  // Tab content
  tabContent: { marginHorizontal: 16, padding: 0, overflow: 'hidden' },
  sectionHeader: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: c.text },

  // Filter row
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  filterPills: { flexDirection: 'row', gap: 6 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  filterPillActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  filterPillText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  filterPillTextActive: { color: '#fff' },

  // Leave cards
  leaveCard: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  leaveCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  leaveType: { fontSize: 15, fontWeight: '600', color: c.text },
  leaveDates: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '600' },
  leaveMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  leaveDays: { fontSize: 13, fontWeight: '600', color: '#FF6600' },
  unpaidTag: { fontSize: 11, color: c.textTertiary },
  appliedOn: { fontSize: 11, color: c.textTertiary },

  // Re-submit button
  resubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#f97316', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 16, marginTop: 8,
  },
  resubmitBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Tier progress
  tierProgress: { marginTop: 8 },
  tierBar: { height: 5, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 2 },
  tierBarFill: { height: '100%', borderRadius: 3 },
  tierCount: { fontSize: 10, color: '#6b7280', textAlign: 'right' },

  // Step pill
  stepPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
  },
  stepDot: { width: 6, height: 6, borderRadius: 3 },
  stepPillText: { fontSize: 11, fontWeight: '600' },

  // Attendance cards
  attendanceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  attDot: { width: 8, height: 8, borderRadius: 4 },
  attDate: { fontSize: 14, fontWeight: '600', color: c.text },
  attTimes: { flexDirection: 'row', gap: 14, marginTop: 2 },
  attTime: { fontSize: 12, color: c.textSecondary },
  rectifyBtn: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f3e8ff',
  },

  // Missed punches
  missedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  missDot: { width: 10, height: 10, borderRadius: 5 },
  missedDate: { fontSize: 14, fontWeight: '600', color: c.text },
  missedDetail: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  rectifyApplyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#7c3aed',
  },
  rectifyApplyText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'center', padding: 20 },
  modalScrollContent: { justifyContent: 'center', paddingVertical: 40 },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#00000012' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 10 },
  modalDesc: { fontSize: 13, color: c.textSecondary },
  modalSectionTitle: {
    fontSize: 12, fontWeight: '700', color: c.text,
    textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16, marginBottom: 8,
  },
  timeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, marginTop: 8, fontWeight: '600',
  },
  remarkInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, marginTop: 8, minHeight: 70, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderRadius: 10 },

  // Detail modal
  detailGrid: { flexDirection: 'row', gap: 10, marginTop: 12 },
  detailBox: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#f0f2f5',
  },
  detailLabel: { fontSize: 11, color: c.textTertiary },
  detailValue: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 2 },

  // Approval steps in modal
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10, backgroundColor: '#f9fafb',
    borderWidth: 1, borderColor: '#f0f2f5', marginBottom: 6,
  },
  stepLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, minWidth: 100 },
  stepDotSmall: { width: 8, height: 8, borderRadius: 4 },
  stepStatus: { fontSize: 13, fontWeight: '600' },
  stepByName: { fontSize: 12, color: c.textTertiary },
  stepNote: { fontSize: 12, color: c.textTertiary },

  // Log entries
  logEntry: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 4 },
  logStatus: { fontSize: 12, fontWeight: '600' },
  logText: { fontSize: 12, color: '#374151', fontWeight: '500' },
  logDate: { fontSize: 11, color: '#9ca3af' },
});
