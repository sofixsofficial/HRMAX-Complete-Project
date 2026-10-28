import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert, Animated, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { useAttendanceGate } from '../../hooks/useAttendanceGate';
import { markCheckIn, markCheckOut, requestPunchRectification, reviewMissedPunchTier, reviewMasterAdminMissedPunch, getNextPendingMissedPunchTier, getActionableMissedPunchTier, getRecordEffectiveMissedPunchTiers, computeMissedPunchProgress, computeMissedPunchTotalTiers, MISSED_PUNCH_TIER_LABELS, MISSED_PUNCH_MASTER_ADMIN_LABEL, missedPunchTierLabel } from '../../services/attendanceApi';
import { SelfieCaptureModal } from '../../components/SelfieCaptureModal';
import { BranchQrModal } from '../../components/BranchQrModal';
import { ScreenHeader } from '../../components/ScreenHeader';
import { MonthAttendanceCalendar } from '../../components/MonthAttendanceCalendar';
import { dayKey } from '../../utils/attendanceDate';
import { db } from '../../aws/clients';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from '../../aws/firestore-compat';
import { Icon } from '../../utils/icons';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PremiumCard, ShimmerLoader, SegmentControl, EmptyStateView, StatusBadge, PremiumBottomSheet, PremiumModal } from '../../components/PremiumComponents';
import { isActiveMissedPunchRecord } from '../../utils/attendanceStatus';
import { isWithinAttendanceCorrectionWindow, parseWeekendDays, toDateKey } from '../../utils/workingDays';
import { notifyAttendanceCascade } from '../../services/notificationService';
import { logAudit } from '../../services/auditLogService';
import NetInfo from '@react-native-community/netinfo';

const STATUS_COLORS: Record<string, string> = {
  Present: '#10b981', Absent: '#ef4444', Late: '#eab308',
  'On Leave': '#3b82f6', 'Miss Punch': '#8b5cf6', 'Early Checkout': '#FF6600',
  Approved: '#10b981',
};

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  Present: { bg: '#dcfce7', text: '#16a34a' },
  Approved: { bg: '#dcfce7', text: '#16a34a' },
  Absent: { bg: '#fee2e2', text: '#ef4444' },
  Late: { bg: '#fef3c7', text: '#f59e0b' },
  'On Leave': { bg: '#eff6ff', text: '#2563eb' },
  'Miss Punch': { bg: '#f3e8ff', text: '#9333ea' },
};

const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

/** Role-specific routing description for missed punch rectification */
const getRoleRoutingNote = (role?: string): string | null => {
  if (role === 'team-leader' || role === 'executive') {
    return 'Missed punch and leave requests are routed directly to the Master Admin for final review.';
  }
  if (role === 'reporting-manager' || role === 'hr-manager') {
    // Reporting Manager's own tier is skipped — chain starts at HR.
    return 'Missed punch requests are routed through: HR → Company Admin.';
  }
  if (role === 'hr') {
    return 'Missed punch requests are routed through: Company Admin.';
  }
  return null;
};

export const AttendanceScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('my');
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [monthStats, setMonthStats] = useState({ present: 0, absent: 0, late: 0, total: 0 });
  const [monthRecords, setMonthRecords] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [rectifySheet, setRectifySheet] = useState(false);
  const [rectifyRecord, setRectifyRecord] = useState<any>(null);
  const [rectifyTime, setRectifyTime] = useState('');
  const [rectifyNote, setRectifyNote] = useState('');
  const [submittingRectify, setSubmittingRectify] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamRecords, setTeamRecords] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [showSelfieCapture, setShowSelfieCapture] = useState(false);
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const selfieUriRef = useRef<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Admin rectification review states
  const [adminRectifySheet, setAdminRectifySheet] = useState(false);
  const [adminRectifyRecord, setAdminRectifyRecord] = useState<any>(null);
  const [adminRectifyAction, setAdminRectifyAction] = useState<'approve' | 'reject'>('approve');
  const [adminRectifyRemark, setAdminRectifyRemark] = useState('');

  // 2-working-day rectification window (company weekends + holidays, matches web)
  const [rectifyWindow, setRectifyWindow] = useState<{ weekendDays: number[]; holidayKeys: string[] }>({ weekendDays: [0, 6], holidayKeys: [] });

  useEffect(() => {
    let active = true;
    (async () => {
      if (!effectiveCompanyId) return;
      let weekendDays: number[] = [0, 6];
      let holidayKeys: string[] = [];
      try {
        const compSnap = await getDoc(doc(db, 'companies', effectiveCompanyId)).catch(() => null);
        const weekends = (compSnap?.data() as any)?.payrollSettings?.weekends;
        if (Array.isArray(weekends)) weekendDays = parseWeekendDays(weekends);
      } catch {}
      try {
        const holSnap = await getDocs(query(collection(db, 'holidays'), where('companyId', 'in', [effectiveCompanyId, null]))).catch(() => null);
        holidayKeys = (holSnap?.docs || [])
          .map((d) => {
            const dt = (d.data() as any)?.date;
            return dt ? toDateKey(dt?.toDate ? dt.toDate() : new Date(dt)) : '';
          })
          .filter(Boolean);
      } catch {}
      if (active) setRectifyWindow({ weekendDays, holidayKeys });
    })();
    return () => { active = false; };
  }, [effectiveCompanyId]);

  const rectificationWindowOpen = (rec: any): boolean => {
    const recDate = rec?.date?.toDate ? rec.date.toDate() : rec?.date ? new Date(rec.date) : null;
    if (!recDate) return false;
    return isWithinAttendanceCorrectionWindow(recDate, new Date(), rectifyWindow.weekendDays, rectifyWindow.holidayKeys);
  };

  // Device context states (matching web's GPS/network chips)
  const [gpsStatus, setGpsStatus] = useState<{ lat: number; lon: number } | null>(null);
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<{ networkType: string | null; wifiSsid: string | null }>({ networkType: null, wifiSsid: null });

  // Monthly unresolved missed punch count
  const [unresolvedMissPunchCount, setUnresolvedMissPunchCount] = useState(0);

  // Web canManage parity: MA / CA / Exec / HR / TL all get the Team Overview
  // review surface — previously company-admin and hr-manager had NO missed-punch
  // review surface on mobile at all (web includes both in canManage). The new
  // 'hr' role reviews its own chain tier (HR → Company Admin).
  const isManager = ['executive', 'reporting-manager', 'hr-manager', 'hr', 'team-leader', 'company-admin', 'master-admin'].includes(user?.role || '');
  const isAdmin = user?.role === 'company-admin' || user?.role === 'master-admin';
  const isEmployeeRole = !user?.role || user?.role === 'employee';
  const { policy, validateCheckIn, validateCheckOut, myBranches } = useAttendanceGate();

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // GPS status on mount (matching web's GPS Locked / GPS Loading / GPS Unavailable)
  useEffect(() => {
    let mounted = true;
    setIsGpsLoading(true);
    (async () => {
      try {
        const { status } = await (await import('expo-location')).requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await (await import('expo-location')).getCurrentPositionAsync({ accuracy: (await import('expo-location')).Accuracy.Balanced });
          if (mounted) setGpsStatus({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        }
      } catch {}
      if (mounted) setIsGpsLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  // Network info refresh (matching web's network chip)
  useEffect(() => {
    const fetchNet = async () => {
      try {
        const state = await NetInfo.fetch();
        const networkType = state.type === 'wifi' ? 'wifi' : state.type === 'cellular' ? 'mobile' : state.type === 'other' ? 'other' : 'unknown';
        let wifiSsid: string | null = null;
        if (state.type === 'wifi' && state.details && 'ssid' in state.details) {
          wifiSsid = (state.details as any).ssid ?? null;
        }
        setNetworkInfo({ networkType, wifiSsid });
      } catch {}
    };
    fetchNet();
    const interval = setInterval(fetchNet, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchMyData = async () => {
    if (!user) return;
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const todaySnap = await getDocs(
        // day keys, not Dates — see utils/attendanceDate.ts
        query(collection(db, 'attendance'), where('userId', '==', user.id), where('date', '>=', dayKey(today)), where('date', '<', dayKey(tomorrow)))
      );
      if (!todaySnap.empty) {
        const data = todaySnap.docs[0].data() as any;
        setTodayRecord({ id: todaySnap.docs[0].id, ...data });
        setCheckedIn(!!data.checkIn && !data.checkOut);
      } else { setTodayRecord(null); setCheckedIn(false); }

      const historySnap = await getDocs(
        query(collection(db, 'attendance'), where('userId', '==', user.id), orderBy('date', 'desc'), limit(30))
      );
      const histData = historySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHistory(histData);

      // Count unresolved missed punches (matching web's "Unresolved" metric)
      const unresolved = histData.filter(r => isActiveMissedPunchRecord(r));
      setUnresolvedMissPunchCount(unresolved.length);

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthSnap = await getDocs(
        query(collection(db, 'attendance'), where('userId', '==', user.id), where('date', '>=', dayKey(monthStart)), where('date', '<', dayKey(tomorrow)))
      );
      const mData = monthSnap.docs.map((d) => d.data());
      setMonthRecords(mData);
      setMonthStats({
        total: mData.length, present: mData.filter((r: any) => r.status === 'Present' || r.status === 'Approved').length,
        absent: mData.filter((r: any) => r.status === 'Absent').length, late: mData.filter((r: any) => r.status === 'Late').length,
      });
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const fetchTeamData = async () => {
    if (!effectiveCompanyId) return;
    try {
      // Web parity: rolling 14-day window instead of TODAY-only. A rectification
      // submitted in the evening is reviewed the next morning — the day-scoped
      // query made pending rows vanish overnight, so Approve/Reject could never
      // be pressed on them (mobile's biggest tiers-broken symptom).
      const since = new Date();
      since.setDate(since.getDate() - 14);
      since.setHours(0, 0, 0, 0);
      const teamSnap = await getDocs(
        query(
          collection(db, 'attendance'),
          where('companyId', '==', effectiveCompanyId),
          where('date', '>=', dayKey(since)),
          orderBy('date', 'desc'),
          limit(300)
        )
      );
      setTeamRecords(teamSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchMyData(); }, []);
  useEffect(() => { if (tab === 'team') fetchTeamData(); }, [tab]);

  const onRefresh = async () => { setRefreshing(true); if (tab === 'my') await fetchMyData(); else await fetchTeamData(); setRefreshing(false); };

  // ────────────────────────────────────────────────────────────
  // CHECK-IN / CHECK-OUT — matching web's orange banner workflow
  // ────────────────────────────────────────────────────────────

  const handleCheckIn = async (picked?: { branchId?: string; qrToken?: string }) => {
    if (!user?.companyId) {
      Alert.alert('Error', 'No company assigned to your account.');
      return;
    }
    setCheckingIn(true);
    try {
      const res = await validateCheckIn({
        selfieUri: selfieUriRef.current || undefined,
        branchId: picked?.branchId,
        qrToken: picked?.qrToken,
      });
      if (!res.ok) {
        if (res.needsSelfie) {
          setShowSelfieCapture(true);
          setCheckingIn(false);
          return;
        }
        if (res.needsQr) {
          // QR-enabled company: collect the branch code before punching,
          // instead of letting the server reject it with QR_REQUIRED.
          setShowQrSheet(true);
          setCheckingIn(false);
          return;
        }
        Alert.alert('Check-in blocked', res.reason || 'Attendance policy not satisfied.');
        setCheckingIn(false);
        return;
      }
      const result = await markCheckIn(user.companyId, {
        selfieUri: selfieUriRef.current || undefined,
        branchId: picked?.branchId,
        qrToken: picked?.qrToken,
      });
      selfieUriRef.current = null;
      await fetchMyData();
      // Late check-in cascade notification (matching web's useAttendancePunch behaviour)
      if (result.lateMinutes && result.lateMinutes > 0) {
        notifyAttendanceCascade({
          id: result.id,
          userId: user.id,
          employeeName: user.name || 'Employee',
          companyId: user.companyId || '',
          date: new Date().toLocaleDateString('en-IN'),
          lateMinutes: result.lateMinutes,
        }, 'late-checkin').catch(() => {});
      }
      logAudit({
        userId: user.id, userName: user.name || 'Employee', userRole: user.role || 'employee',
        action: 'Checked in', actionType: 'create', module: 'Attendance',
        targetEntity: new Date().toLocaleDateString('en-IN'), status: 'success',
      }).catch(() => {});
      Alert.alert('Checked in', result.message || 'Your attendance has been marked.');
    } catch (err: any) {
      const msg = err?.message || 'Failed';
      Alert.alert('Check-in failed', msg.includes('Please check out') ? 'You have already checked in today.' : msg);
    } finally {
      setCheckingIn(false);
    }
  };

  const handleSelfieCaptured = (url: string) => {
    setShowSelfieCapture(false);
    selfieUriRef.current = url;
    handleCheckIn();
  };

  // QR sheet confirmed: close it and retry the punch with the branch + code.
  const handleQrPicked = (payload: { branchId: string; qrToken: string }) => {
    setShowQrSheet(false);
    handleCheckIn(payload);
  };

  const handleCheckOut = async () => {
    if (!user?.companyId || !todayRecord) return;
    setCheckingOut(true);
    try {
      const res = await validateCheckOut();
      if (!res.ok) {
        Alert.alert('Check-out blocked', res.reason || 'Attendance policy not satisfied.');
        setCheckingOut(false);
        return;
      }
      const result = await markCheckOut(user.companyId, todayRecord.id);
      await fetchMyData();
      logAudit({
        userId: user.id, userName: user.name || 'Employee', userRole: user.role || 'employee',
        action: 'Checked out', actionType: 'update', module: 'Attendance',
        targetEntity: new Date().toLocaleDateString('en-IN'), status: 'success',
      }).catch(() => {});
      Alert.alert('Checked out', result.message || 'See you tomorrow!');
    } catch (err: any) {
      Alert.alert('Check-out failed', err?.message || 'Failed');
    } finally {
      setCheckingOut(false);
    }
  };

  // ────────────────────────────────────────────────────────────
  // RECTIFICATION — matching web's SelfAttendanceCard + Attendance.tsx
  // ────────────────────────────────────────────────────────────

  /** Open the rectify sheet for any own record (today or historical) while the
   *  2-working-day correction window is open — matches the web's per-row Rectify. */
  const openRectify = (rec: any) => {
    if (!rec) return;
    setRectifyRecord(rec);
    setRectifyTime(formatTimeShort(rec.checkIn));
    setRectifyNote('');
    setRectifySheet(true);
  };

  const handleRectify = async () => {
    const rec = rectifyRecord;
    if (!rec) return;
    if (!rectifyTime.trim()) {
      Alert.alert('Required', 'Please enter the correct checkout time');
      return;
    }
    // 2-working-day correction window guard (matches web's assertWithinAttendanceCorrectionWindow)
    if (!rectificationWindowOpen(rec)) {
      Alert.alert('Window Closed', 'The 2-working-day correction window for this day has closed. Changes can no longer be made to this attendance record.');
      return;
    }
    setSubmittingRectify(true);
    try {
      const [h, m] = rectifyTime.split(':').map(Number);
      const base = rec.date?.toDate ? rec.date.toDate() : new Date(rec.date);
      const corrected = isNaN(base.getTime()) ? new Date() : base;
      corrected.setHours(h || 0, m || 0, 0, 0);
      await requestPunchRectification(rec.id, corrected, {
        companyId: rec.companyId || effectiveCompanyId || '',
        userId: user?.id || '',
        employeeRemark: rectifyNote.trim(),
      });
      // Send cascade notifications to approver tiers
      notifyAttendanceCascade({
        id: rec.id,
        userId: user?.id || '',
        employeeName: user?.name || 'Employee',
        companyId: rec.companyId || effectiveCompanyId || '',
        date: rec.date?.toDate ? rec.date.toDate().toLocaleDateString('en-IN') : new Date(rec.date).toLocaleDateString('en-IN'),
      }, 'rectification-requested').catch(() => {});
      logAudit({
        userId: user?.id || '', userName: user?.name || 'Employee', userRole: user?.role || 'employee',
        action: 'Submitted punch rectification', actionType: 'create', module: 'Attendance',
        targetEntity: rec.date?.toDate ? rec.date.toDate().toLocaleDateString('en-IN') : '', status: 'success',
      }).catch(() => {});
      setRectifySheet(false); setRectifyNote(''); setRectifyTime(''); setRectifyRecord(null);
      await fetchMyData();

      // Role-aware routing message (matching web's behavior)
      const role = user?.role || 'employee';
      const routingNote = MANAGEMENT_SELF_SERVICE_ROLES.has(role)
        ? 'Rectification routed to Master Admin for review.'
        : 'Rectification submitted for manager review.';
      Alert.alert('Submitted', routingNote);
    } catch (err: any) { Alert.alert('Error', err?.message || 'Failed'); }
    finally { setSubmittingRectify(false); }
  };

  const handleAdminRectify = async (record: any, action: 'approve' | 'reject') => {
    if (!record?.missedPunchRectification?.requested || record.missedPunchRectification.resolved) return;
    setAdminRectifyRecord(record);
    setAdminRectifyAction(action);
    setAdminRectifyRemark('');
    setAdminRectifySheet(true);
  };

  const submitAdminRectify = async () => {
    if (!adminRectifyRecord || !adminRectifyRemark.trim()) {
      Alert.alert('Remark required', 'Please add a mandatory remark before resolving this rectification.');
      return;
    }
    setSubmittingRectify(true);
    const action = adminRectifyAction;
    const mp = adminRectifyRecord.missedPunchRectification || {};
    // Use the single shared routing helper (web getMyMissedPunchTier parity):
    // stamped approver + master-admin + natural-role/legacy/company-scope
    // fallbacks. The old hand-rolled stamp matching rejected CA/TL whose stamp
    // was empty/stale with "Not your turn" where web would let them act.
    const myTier = getActionableMissedPunchTier(adminRectifyRecord, user?.id || '', user?.role);

    const awaitingMA = mp.masterAdminRequired
      && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending')
      && user?.role === 'master-admin'
      && getRecordEffectiveMissedPunchTiers(mp).every((t) => mp.approvalStatus?.[t] === 'Approved');
    try {
      if (awaitingMA) {
        await reviewMasterAdminMissedPunch(
          adminRectifyRecord.id,
          action === 'approve' ? 'Approved' : 'Rejected',
          user?.id || '',
          user?.name || '',
          adminRectifyRemark.trim()
        );
        // Send cascade notification to employee
        notifyAttendanceCascade({
          id: adminRectifyRecord.id,
          userId: adminRectifyRecord.userId || '',
          employeeName: adminRectifyRecord.name || 'Employee',
          companyId: adminRectifyRecord.companyId || effectiveCompanyId || '',
          date: adminRectifyRecord.date?.toDate ? adminRectifyRecord.date.toDate().toLocaleDateString('en-IN') : new Date(adminRectifyRecord.date).toLocaleDateString('en-IN'),
          rejectorName: action === 'reject' ? user?.name : undefined,
          note: action === 'reject' ? adminRectifyRemark.trim() : undefined,
        }, action === 'approve' ? 'rectification-resolved' : 'rectification-rejected').catch(() => {});
        setAdminRectifySheet(false); setAdminRectifyRemark(''); setAdminRectifyRecord(null);
        await fetchTeamData();
        Alert.alert(action === 'approve' ? 'Approved' : 'Rejected', 'Missed punch finalized as Master Admin.');
        setSubmittingRectify(false);
        return;
      }
      if (!myTier || getNextPendingMissedPunchTier(mp.approvalStatus || {}) !== myTier) {
        Alert.alert('Not your turn', 'Only the next assigned verification tier can act on this missed punch.');
        setSubmittingRectify(false);
        return;
      }
      await reviewMissedPunchTier(
        adminRectifyRecord.id,
        myTier,
        action === 'approve' ? 'Approved' : 'Rejected',
        user?.id || '',
        user?.name || '',
        adminRectifyRemark.trim()
      );
      // Send cascade notification to employee
      notifyAttendanceCascade({
        id: adminRectifyRecord.id,
        userId: adminRectifyRecord.userId || '',
        employeeName: adminRectifyRecord.name || 'Employee',
        companyId: adminRectifyRecord.companyId || effectiveCompanyId || '',
        date: adminRectifyRecord.date?.toDate ? adminRectifyRecord.date.toDate().toLocaleDateString('en-IN') : new Date(adminRectifyRecord.date).toLocaleDateString('en-IN'),
        rejectorName: action === 'reject' ? user?.name : undefined,
        note: action === 'reject' ? adminRectifyRemark.trim() : undefined,
      }, action === 'approve' ? 'rectification-resolved' : 'rectification-rejected').catch(() => {});
      logAudit({
        userId: user?.id || '', userName: user?.name || 'Admin', userRole: user?.role || '',
        action: `${action === 'approve' ? 'Approved' : 'Rejected'} missed punch rectification`,
        actionType: action === 'approve' ? 'approve' : 'reject',
        module: 'Attendance', targetEntity: adminRectifyRecord.name || '', status: 'success',
      }).catch(() => {});
      setAdminRectifySheet(false); setAdminRectifyRemark(''); setAdminRectifyRecord(null);
      await fetchTeamData();
      Alert.alert(action === 'approve' ? 'Approved' : 'Rejected', `Missed punch verification updated as ${myTier}.`);
    } catch (err: any) { Alert.alert('Error', err?.message || 'Failed'); }
    finally { setSubmittingRectify(false); }
  };

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  const formatTime = (date: any) => {
    if (!date) return '--';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatTimeShort = (date: any) => {
    if (!date) return '--:--';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateShort = (date: any) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatDuration = (hours: number) => {
    if (!hours && hours !== 0) return '--';
    const h = Math.floor(hours); const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const activeList = tab === 'team' ? teamRecords : history;
  const filtered = activeList.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.status || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q) || (r.employeeName || '').toLowerCase().includes(q) || (r.department || '').toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [search, tab]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Date,Status,Check In,Check Out,Hours'];
      const rows = filtered.map(r => `${(r.name || '').replace(/,/g, ';')},${r.date ? (r.date.toDate ? r.date.toDate().toLocaleDateString('en-IN') : new Date(r.date).toLocaleDateString('en-IN')) : 'N/A'},${r.status || ''},${formatTime(r.checkIn)},${formatTime(r.checkOut)},${r.workHours || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'attendance_export.csv');
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

  const needsRectify = todayRecord && isActiveMissedPunchRecord(todayRecord) && rectificationWindowOpen(todayRecord);
  const pendingRectifications = teamRecords.filter((r: any) => r.missedPunchRectification?.requested && !r.missedPunchRectification.resolved);

  // Which role-specific missed punch tier can the current user act on?
  // Single source of truth = getActionableMissedPunchTier (web parity: incl.
  // hr-manager, master-admin override, legacy empty-stamp + company-scope
  // fallbacks) — the old local copy missed hr-manager and scope checks.
  const getMyMissedPunchTier = (r: any) =>
    getActionableMissedPunchTier(r, user?.id || '', user?.role);

  // Is this record awaiting Master Admin final gate?
  const isMissedPunchMasterAdminPending = (r: any) => {
    const mp = r.missedPunchRectification;
    if (!mp?.requested || !mp?.approvalStatus) return false;
    return !!mp.masterAdminRequired
      && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending')
      && getRecordEffectiveMissedPunchTiers(mp).every((t: any) => mp.approvalStatus?.[t] === 'Approved');
  };

  if (loading) return <ShimmerLoader count={5} height={90} style={{ padding: 16 }} />;

  // Reference-style punch state: big status circle + headline + subline.
  const punchDone = !!(todayRecord?.checkIn && todayRecord?.checkOut);
  const punchStarted = !!todayRecord?.checkIn && !todayRecord?.checkOut;
  const punchHeadline = punchDone ? 'Day Complete' : punchStarted ? 'Checked In' : 'Not Checked In';
  const punchSub = punchStarted || punchDone ? 'You are all set for today!' : 'Mark your attendance for today';
  // Success states (checked in / day complete) are green; only the untouched
  // "not checked in" state uses the neutral slate.
  const punchCircleColor = punchStarted || punchDone ? '#10b981' : '#94a3b8';
  const punchCircleIcon = punchStarted ? 'checkmark' : punchDone ? 'checkmark-done' : 'time-outline';
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const punchTimeLabel = todayRecord
    ? `${formatTimeShort(todayRecord.checkIn)}${todayRecord.checkOut ? `  →  ${formatTimeShort(todayRecord.checkOut)}` : ''}`
    : '—';
  const officeLocation = policy?.officeLocation as { name?: string; address?: string } | undefined;
  const locationLabel = officeLocation?.name || officeLocation?.address || 'No office location configured';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Attendance" />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        {/* ── HERO PUNCH BANNER (matching web's AttendancePunchBanner) ──
            Web gates the punch hero with `canCheckInOut && isEmployee` — only
            employees punch here (Company Admin NEVER creates own attendance;
            managers punch from My Attendance self-service instead). */}
        {tab === 'my' && isEmployeeRole && (
          <View style={s.punchBanner}>
            {/* Reference layout: status circle + headline, then date / time /
                work-location rows above the punch controls. */}
            <View style={s.punchHeroRow}>
              <View style={[s.punchCircle, { backgroundColor: punchCircleColor }]}>
                <Icon name={punchCircleIcon} size={26} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.punchHeadline}>{punchHeadline}</Text>
                <Text style={s.punchHeadlineSub}>{punchSub}</Text>
              </View>
            </View>

            <View style={s.punchInfoBox}>
              <View style={s.punchInfoRow}>
                <Icon name="calendar-outline" size={15} color="#f59e0b" />
                <Text style={s.punchInfoText}>{todayLabel}</Text>
              </View>
              <View style={s.punchInfoRow}>
                <Icon name="time-outline" size={15} color="#f59e0b" />
                <Text style={s.punchInfoText}>{punchTimeLabel}</Text>
              </View>
              <View style={s.punchInfoRow}>
                <Icon name="location-outline" size={15} color="#10b981" />
                <Text style={[s.punchInfoText, { flex: 1 }]} numberOfLines={1}>{locationLabel}</Text>
                <Icon name="chevron-forward-outline" size={15} color="rgba(255,255,255,0.7)" />
              </View>
            </View>

            <View style={s.punchBannerContent}>
              <View style={{ flex: 1 }}>
                <Text style={s.punchBannerTitle}>
                  {todayRecord ? (todayRecord.checkOut ? 'Day Complete' : checkedIn ? 'Checked In' : 'Start Your Day') : 'Start Your Day'}
                </Text>
                <Text style={s.punchBannerSubtitle}>
                  {todayRecord
                    ? todayRecord.checkOut
                      ? `Checked out at ${formatTimeShort(todayRecord.checkOut)} · ${formatDuration(todayRecord.workHours)} worked`
                      : `Checked in at ${formatTimeShort(todayRecord.checkIn)} · awaiting check-out`
                    : 'Mark your attendance for today'}
                </Text>
                {todayRecord?.status === 'Late' && todayRecord.lateMinutes > 0 && (
                  <Text style={s.punchBannerLate}>
                    ⚠ {todayRecord.lateMinutes} min late · Auto-approved
                  </Text>
                )}
                {todayRecord?.isAutoApproved && todayRecord.checkOut && (
                  <Text style={s.punchBannerStatus}>✓ Auto-Approved</Text>
                )}
                {todayRecord?.status === 'Approved' && (
                  <Text style={s.punchBannerStatus}>✓ Approved by {todayRecord.approvedByName || 'System'}</Text>
                )}

                {/* Missed checkout inline alert (matching web's SelfAttendanceCard) */}
                {needsRectify && (
                  <TouchableOpacity style={s.missedPunchInline} onPress={() => openRectify(todayRecord)}>
                    <Icon name="warning-outline" size={14} color="#9333ea" />
                    <Text style={s.missedPunchInlineText}>Missed checkout detected</Text>
                    <View style={s.rectifyNowBtn}>
                      <Icon name="create-outline" size={12} color="#fff" />
                      <Text style={s.rectifyNowBtnText}>Rectify Now</Text>
                    </View>
                  </TouchableOpacity>
                )}

                {/* GPS & Network chips (matching web's AttendancePunchBanner) */}
                {!todayRecord?.checkIn && (
                  <View style={s.deviceChipsRow}>
                    {isGpsLoading ? (
                      <View style={s.deviceChip}>
                        <Icon name="location-outline" size={10} color="rgba(255,255,255,0.8)" />
                        <Text style={s.deviceChipText}>GPS Loading...</Text>
                      </View>
                    ) : gpsStatus ? (
                      <View style={s.deviceChip}>
                        <Icon name="location-outline" size={10} color="rgba(255,255,255,0.8)" />
                        <Text style={s.deviceChipText}>GPS Locked</Text>
                      </View>
                    ) : (
                      <View style={s.deviceChip}>
                        <Icon name="location-outline" size={10} color="rgba(255,255,255,0.8)" />
                        <Text style={s.deviceChipText}>GPS Unavailable</Text>
                      </View>
                    )}
                    <View style={s.deviceChip}>
                      <Icon name="wifi-outline" size={10} color="rgba(255,255,255,0.8)" />
                      <Text style={s.deviceChipText}>{networkInfo.networkType || 'unknown'}</Text>
                    </View>
                    {policy?.enableGeofence && (
                      <View style={s.deviceChip}>
                        <Icon name="globe-outline" size={10} color="rgba(255,255,255,0.8)" />
                        <Text style={s.deviceChipText}>Geofence {policy.mode?.replace(/-/g, ' ') || 'active'}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Check In / Check Out buttons (matching web's layout) */}
              <View style={s.punchButtonsCol}>
                {!todayRecord?.checkIn ? (
                  <TouchableOpacity
                    style={s.checkInBannerBtn}
                    onPress={() => handleCheckIn()}
                    disabled={checkingIn}
                    activeOpacity={0.8}>
                    {checkingIn ? <ActivityIndicator size={20} color="#fff" /> : <Icon name="enter-outline" size={20} color="#fff" />}
                    <Text style={s.checkInBannerBtnText}>Check In</Text>
                  </TouchableOpacity>
                ) : todayRecord.checkIn && !todayRecord.checkOut ? (
                  <TouchableOpacity
                    style={s.checkOutBannerBtn}
                    onPress={handleCheckOut}
                    disabled={checkingOut}
                    activeOpacity={0.8}>
                    {checkingOut ? <ActivityIndicator size={20} color="#ea580c" /> : <Icon name="exit-outline" size={20} color="#ea580c" />}
                    <Text style={s.checkOutBannerBtnText}>Check Out</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Policy chips (Wi-Fi, Geofence, Selfie requirements) */}
            {(policy?.wifiOnly || policy?.enableGeofence || policy?.requireSelfie || policy?.enableSelfie || policy?.requireQr) && (
              <View style={s.policyChipsRow}>
                {policy?.wifiOnly && (
                  <View style={s.policyChip}>
                    <Icon name="wifi-outline" size={10} color="#3b82f6" />
                    <Text style={[s.policyChipText, { color: '#3b82f6' }]}>Wi-Fi required</Text>
                  </View>
                )}
                {policy?.enableGeofence && policy?.officeLocation?.latitude ? (
                  <View style={s.policyChip}>
                    <Icon name="location-outline" size={10} color="#10b981" />
                    <Text style={[s.policyChipText, { color: '#10b981' }]}>Geofence {policy.officeLocation.radiusMeters || 100}m</Text>
                  </View>
                ) : null}
                {(policy?.requireSelfie || policy?.enableSelfie) && (
                  <View style={s.policyChip}>
                    <Icon name="camera-outline" size={10} color="#ec4899" />
                    <Text style={[s.policyChipText, { color: '#ec4899' }]}>Selfie required</Text>
                  </View>
                )}
                {policy?.requireQr && (
                  <View style={s.policyChip}>
                    <Icon name="qr-code-outline" size={10} color="#8b5cf6" />
                    <Text style={[s.policyChipText, { color: '#8b5cf6' }]}>Branch QR required</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── HEADER + TABS ── */}
        <View style={s.header}>
          <Text style={s.title}>Attendance</Text>
          <Text style={s.count}>{filtered.length} total</Text>
        </View>

        {isManager && <SegmentControl options={['My Attendance', 'Team Overview']} selected={tab === 'my' ? 'My Attendance' : 'Team Overview'} onSelect={(v) => setTab(v === 'My Attendance' ? 'my' : 'team')} />}

        {/* ── SEARCH + EXPORT ── */}
        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search attendance..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        {tab === 'my' ? (
          <>
            {/* ── TODAY'S STATUS CARD ── */}
            {todayRecord && (
              <PremiumCard style={{ marginHorizontal: 16, marginTop: 12, padding: 16 }} accentColor={STATUS_COLORS[todayRecord.status]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <StatusBadge status={todayRecord.status} color={STATUS_COLORS[todayRecord.status] || '#64748b'} />
                  {todayRecord.lateMinutes > 0 && (
                    <Text style={{ fontSize: 12, color: '#eab308', fontWeight: '600' }}>Late by {todayRecord.lateMinutes} min</Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 4 }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary }}>Check In</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{formatTime(todayRecord.checkIn)}</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary }}>Check Out</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{formatTime(todayRecord.checkOut)}</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary }}>Hours</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{formatDuration(todayRecord.workHours)}</Text>
                  </View>
                </View>

                {/* Missed Punch Verification Progress (for today's record) */}
                {todayRecord.missedPunchRectification?.requested && !todayRecord.missedPunchRectification.resolved && (
                  <View style={s.verificationCard}>
                    {(() => {
                      const mp = todayRecord.missedPunchRectification;
                      const tiers = getRecordEffectiveMissedPunchTiers(mp);
                      const progress = computeMissedPunchProgress(mp);
                      const total = computeMissedPunchTotalTiers(mp);
                      const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
                      const overall = mp.status || (mp.resolved ? 'Approved' : 'Pending');
                      return (
                        <>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                            <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                          </View>
                          <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                            <View style={{ width: `${pct}%`, height: '100%', backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 2 }} />
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                            {tiers.map((t) => {
                              const st = mp.approvalStatus?.[t] || 'Pending';
                              const conf: Record<string, { bg: string; tc: string }> = {
                                Approved: { bg: '#dcfce7', tc: '#16a34a' },
                                Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                                Pending: { bg: '#fef3c7', tc: '#b45309' },
                              };
                              const c = conf[st] || conf.Pending;
                              return (
                                <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                  <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{MISSED_PUNCH_TIER_LABELS[t]}: {st}</Text>
                                </View>
                              );
                            })}
                            {mp.masterAdminRequired && (
                              <View style={{ backgroundColor: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                <Text style={{ fontSize: 10, fontWeight: '600', color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                                  {MISSED_PUNCH_MASTER_ADMIN_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                                </Text>
                              </View>
                            )}
                          </View>
                        </>
                      );
                    })()}
                  </View>
                )}
              </PremiumCard>
            )}

            {/* ── MONTHLY SUMMARY STATS (matching web's SelfAttendanceCard) ── */}
            <View style={s.monthStatsRow}>
              <View style={[s.monthStatItem, { backgroundColor: '#10b9810d', borderColor: '#10b98122' }]}>
                <Text style={[s.monthStatValue, { color: '#10b981' }]}>{monthStats.present}</Text>
                <Text style={s.monthStatLabel}>Present</Text>
              </View>
              <View style={[s.monthStatItem, { backgroundColor: '#f59e0b0d', borderColor: '#f59e0b22' }]}>
                <Text style={[s.monthStatValue, { color: '#f59e0b' }]}>{monthStats.late}</Text>
                <Text style={s.monthStatLabel}>Late</Text>
              </View>
              <View style={[s.monthStatItem, { backgroundColor: '#ef44440d', borderColor: '#ef444422' }]}>
                <Text style={[s.monthStatValue, { color: '#ef4444' }]}>{monthStats.absent}</Text>
                <Text style={s.monthStatLabel}>Absent</Text>
              </View>
              {unresolvedMissPunchCount > 0 && (
                <TouchableOpacity
                  style={[s.monthStatItem, { backgroundColor: '#f3e8ff', borderColor: '#e9d5ff' }]}
                  onPress={() => setSearch('Miss Punch')}>
                  <Text style={[s.monthStatValue, { color: '#9333ea' }]}>{unresolvedMissPunchCount}</Text>
                  <Text style={s.monthStatLabel}>Unresolved</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── MONTHLY CALENDAR (per-day status from real records) ── */}
            <MonthAttendanceCalendar records={monthRecords} />

            {/* ── ROLE ROUTING INFO (matching web's SelfAttendanceCard) ── */}
            {getRoleRoutingNote(user?.role) && (
              <View style={s.routingInfoCard}>
                <Icon name="information-circle-outline" size={14} color="#1e40af" />
                <Text style={s.routingInfoText}>{getRoleRoutingNote(user?.role)}</Text>
              </View>
            )}

            {/* ── RECENT HISTORY ── */}
            <View style={{ paddingHorizontal: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 8 }}>Recent History</Text>

              {/* Status filter chips (matching web's stat cards) */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.statusFilterRow}>
                {[
                  { label: 'All', count: history.length, color: '#6b7280' },
                  { label: 'Present', count: history.filter(r => r.status === 'Present' || r.status === 'Approved').length, color: '#10b981' },
                  { label: 'Late', count: history.filter(r => r.status === 'Late').length, color: '#f59e0b' },
                  { label: 'Absent', count: history.filter(r => r.status === 'Absent').length, color: '#ef4444' },
                  { label: 'Miss Punch', count: history.filter(r => r.status === 'Miss Punch').length, color: '#9333ea' },
                  // Backend writes 'Early Checkout' on early check-outs (attendance.ts) but the
                  // mobile filter never offered it, so those days were unreachable by filter.
                  { label: 'Early Checkout', count: history.filter(r => r.status === 'Early Checkout').length, color: '#06b6d4' },
                ].map(chip => (
                  <TouchableOpacity
                    key={chip.label}
                    style={[s.statusFilterChip, search === (chip.label === 'All' ? '' : chip.label) && { borderColor: chip.color, backgroundColor: `${chip.color}15` }]}
                    onPress={() => setSearch(chip.label === 'All' ? '' : chip.label)}>
                    <Text style={[s.statusFilterChipText, { color: chip.color }]}>{chip.label}</Text>
                    <Text style={[s.statusFilterChipCount, { color: chip.color }]}>{chip.count}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {filtered.length === 0 ? (
                history.length === 0 ? <EmptyStateView icon="clipboard-outline" title="No records" subtitle="Your attendance history will appear here" /> : <Text style={s.emptyText}>No records match your search.</Text>
              ) :
              paginated.map((record) => {
                const sc = STATUS_STYLE[record.status] || { bg: '#f3f4f6', text: '#6b7280' };
                return (
                  <PremiumCard key={record.id} style={{ padding: 12, marginBottom: 8 }} onPress={() => setDetailRecord(record)}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                        {record.date?.toDate ? record.date.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'N/A'}
                      </Text>
                      <View style={[s.statusBadgeSmall, { backgroundColor: sc.bg }]}>
                        <Text style={[s.statusBadgeSmallText, { color: sc.text }]}>{record.status}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>In: {formatTime(record.checkIn)}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>Out: {formatTime(record.checkOut)}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>{formatDuration(record.workHours)}</Text>
                    </View>
                    {/* Rectification status indicator */}
                    {record.missedPunchRectification?.requested && !record.missedPunchRectification.resolved && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#9333ea' }} />
                        <Text style={{ fontSize: 11, color: '#9333ea', fontWeight: '600' }}>Rectification pending</Text>
                      </View>
                    )}
                    {record.missedPunchRectification?.resolved && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
                        <Text style={{ fontSize: 11, color: '#10b981', fontWeight: '600' }}>Rectified</Text>
                      </View>
                    )}
                    {/* Row actions (matches web's employee row: Eye View + Rectify) */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
                        onPress={() => setDetailRecord(record)}
                      >
                        <Icon name="eye-outline" size={13} color={colors.textSecondary} />
                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }}>View</Text>
                      </TouchableOpacity>
                      {/* Web parity: Rectify stays available while a chain is
                          active (re-submission inside the 2-working-day window) —
                          no more `!requested` lock that made rejected/in-flight
                          records permanently un-resubmittable. */}
                      {isActiveMissedPunchRecord(record) && rectificationWindowOpen(record) && (
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f3e8ff' }}
                          onPress={() => openRectify(record)}
                        >
                          <Icon name="create-outline" size={13} color="#9333ea" />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#9333ea' }}>Rectify</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </PremiumCard>
                );
              })}
            </View>
          </>
        ) : (
          /* ── TEAM OVERVIEW TAB ── */
          <>
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12, marginTop: 8 }}>
              {[
                { l: 'Present', v: teamRecords.filter((r: any) => r.status === 'Present' || r.status === 'Approved').length, c: '#10b981' },
                { l: 'Late', v: teamRecords.filter((r: any) => r.status === 'Late').length, c: '#eab308' },
                { l: 'Absent', v: teamRecords.filter((r: any) => r.status === 'Absent').length, c: '#ef4444' },
                { l: 'Miss', v: teamRecords.filter((r: any) => r.status === 'Miss Punch').length, c: '#8b5cf6' },
              ].map(st => (
                <View key={st.l} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 3, borderLeftColor: st.c }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{st.v}</Text>
                  <Text style={{ fontSize: 10, color: colors.textSecondary, textTransform: 'uppercase' }}>{st.l}</Text>
                </View>
              ))}
            </View>

            {filtered.length === 0 ? (
              teamRecords.length === 0 ? <EmptyStateView icon="clipboard-outline" title="No records" subtitle="No attendance marked today" /> : <Text style={s.emptyText}>No records match your search.</Text>
            ) :
            paginated.map((record: any) => {
              const pendingRect = record.missedPunchRectification?.requested && !record.missedPunchRectification.resolved;
              const myTier = pendingRect ? getMyMissedPunchTier(record) : null;
              const maPending = pendingRect && isMissedPunchMasterAdminPending(record) && user?.role === 'master-admin';

              return (
                <PremiumCard key={record.id} style={{ marginHorizontal: 16, padding: 14, marginBottom: 8 }} accentColor={pendingRect ? '#8b5cf6' : undefined}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{record.name || 'Unknown'}</Text>
                      <Text style={{ fontSize: 11, color: colors.textTertiary }}>{record.department || ''}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <StatusBadge status={record.status} color={STATUS_COLORS[record.status] || '#64748b'} />
                      {/* Eye → approval details modal (matches web's row View action) */}
                      <TouchableOpacity onPress={() => setDetailRecord(record)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Icon name="eye-outline" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>In: {formatTime(record.checkIn)}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>Out: {formatTime(record.checkOut)}</Text>
                  </View>

                  {/* Missed Punch Verification Progress (team cards) */}
                  {pendingRect && (() => {
                    const mp = record.missedPunchRectification;
                    const tiers = getRecordEffectiveMissedPunchTiers(mp);
                    const progress = computeMissedPunchProgress(mp);
                    const total = computeMissedPunchTotalTiers(mp);
                    const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
                    const overall = mp.status || (mp.resolved ? 'Approved' : 'Pending');
                    return (
                      <View style={s.verificationCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                          <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                        </View>
                        <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 2 }} />
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                          {tiers.map((t) => {
                            const st = mp.approvalStatus?.[t] || 'Pending';
                            const isMyTier = myTier === t;
                            const conf: Record<string, { bg: string; tc: string }> = {
                              Approved: { bg: '#dcfce7', tc: '#16a34a' },
                              Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                              Pending: { bg: '#fef3c7', tc: '#b45309' },
                            };
                            const c = conf[st] || conf.Pending;
                            return (
                              <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: isMyTier ? 1.5 : 0, borderColor: isMyTier ? '#9333ea' : 'transparent' }}>
                                <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>
                                  {MISSED_PUNCH_TIER_LABELS[t]}: {st}{isMyTier ? ' (You)' : ''}
                                </Text>
                              </View>
                            );
                          })}
                          {mp.masterAdminRequired && (
                            <View style={{ backgroundColor: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                                {MISSED_PUNCH_MASTER_ADMIN_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Action buttons for pending rects (matching web's team view) */}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                          {maPending && (
                            <TouchableOpacity
                              style={{ flex: 1, backgroundColor: '#c2410c', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                              onPress={() => { setAdminRectifyRecord(record); setAdminRectifyAction('approve'); setAdminRectifyRemark(''); setAdminRectifySheet(true); }}>
                              <Icon name="star-outline" size={12} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Master Admin Review</Text>
                            </TouchableOpacity>
                          )}
                          {pendingRect && overall === 'Pending' && myTier && (
                            <>
                              <TouchableOpacity
                                style={{ flex: 1, backgroundColor: '#10b981', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                                onPress={() => handleAdminRectify(record, 'approve')}>
                                <Icon name="checkmark-circle-outline" size={12} color="#fff" />
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Approve ({MISSED_PUNCH_TIER_LABELS[myTier].split(' ')[0]})</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={{ flex: 1, backgroundColor: '#ef4444', paddingVertical: 6, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                                onPress={() => handleAdminRectify(record, 'reject')}>
                                <Icon name="close-circle-outline" size={12} color="#fff" />
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Reject</Text>
                              </TouchableOpacity>
                            </>
                          )}
                          {pendingRect && overall === 'Pending' && !myTier && !isEmployeeRole && user?.role !== 'master-admin' && (
                            <View style={{ flex: 1, backgroundColor: '#e5e7eb', paddingVertical: 6, borderRadius: 8, alignItems: 'center' }}>
                              <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '600' }}>Awaiting Next Tier</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })()}
                </PremiumCard>
              );
            })}
          </>
        )}
        {renderPagination()}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── DETAIL MODAL (View-only, matching web's View Modal) ── */}
      <PremiumModal visible={!!detailRecord} onClose={() => setDetailRecord(null)} title="Attendance & Approval Details">
        {detailRecord && (
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{formatDateShort(detailRecord.date)}</Text>
              <StatusBadge status={detailRecord.status} color={STATUS_COLORS[detailRecord.status] || '#64748b'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>In: {formatTime(detailRecord.checkIn)}</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>Out: {formatTime(detailRecord.checkOut)}</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>{formatDuration(detailRecord.workHours)}</Text>
            </View>
            {detailRecord.lateMinutes > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: colors.textSecondary }}>Late By</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#eab308' }}>{detailRecord.lateMinutes} min</Text>
              </View>
            )}

            {/* Verification chain */}
            {detailRecord.missedPunchRectification?.requested && (() => {
              const mp = detailRecord.missedPunchRectification;
              const tiers = getRecordEffectiveMissedPunchTiers(mp);
              const progress = computeMissedPunchProgress(mp);
              const total = computeMissedPunchTotalTiers(mp);
              const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
              const overall = mp.status || (mp.resolved ? 'Approved' : 'Pending');
              return (
                <View style={s.verificationCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ fontSize: 12, color: '#6b21a8', fontWeight: '700' }}>Verification Progress</Text>
                    <Text style={{ fontSize: 12, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
                  </View>
                  <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 2 }} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {tiers.map((t) => {
                      const st = mp.approvalStatus?.[t] || 'Pending';
                      const conf: Record<string, { bg: string; tc: string }> = {
                        Approved: { bg: '#dcfce7', tc: '#16a34a' },
                        Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                        Pending: { bg: '#fef3c7', tc: '#b45309' },
                      };
                      const c = conf[st] || conf.Pending;
                      return (
                        <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{MISSED_PUNCH_TIER_LABELS[t]}: {st}</Text>
                        </View>
                      );
                    })}
                    {mp.masterAdminRequired && (
                      <View style={{ backgroundColor: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                          {MISSED_PUNCH_MASTER_ADMIN_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                        </Text>
                      </View>
                    )}
                  </View>
                  {overall === 'Approved' && (
                    <Text style={{ fontSize: 11, color: '#16a34a', fontWeight: '600' }}>
                      Approved by all verification steps
                      {(() => { const r = mp.applicantRole; return r === 'executive' ? ' (Team Leader & Master Admin)' : r === 'team-leader' ? ' (Master Admin)' : ''; })()}. Attendance has been updated.
                    </Text>
                  )}
                  {overall === 'Rejected' && (
                    <Text style={{ fontSize: 11, color: '#ef4444', fontWeight: '600' }}>Rejected during verification.</Text>
                  )}
                  {Array.isArray(mp.approvalLog) && mp.approvalLog.length > 0 && (
                    <View style={{ borderTopWidth: 1, borderTopColor: '#e9d5ff', marginTop: 8, paddingTop: 8 }}>
                      <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600', marginBottom: 4 }}>Audit Log</Text>
                      {mp.approvalLog.map((entry: any, idx: number) => (
                        <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3, backgroundColor: entry.status === 'Approved' ? '#dcfce7' : '#fee2e2' }}>
                            <Text style={{ fontSize: 10, fontWeight: '600', color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }}>
                              {entry.status === 'Approved' ? '✓' : '✗'}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                            <Text style={{ fontWeight: '600', color: colors.text }}>{missedPunchTierLabel(entry.tier)}</Text> by {entry.approvedByName}
                            {entry.note ? ` (${entry.note})` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}
            {!detailRecord.missedPunchRectification?.requested && (() => {
              const canRectify = isActiveMissedPunchRecord(detailRecord) && rectificationWindowOpen(detailRecord);
              return (
                <View>
                  <Text style={{ fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' }}>No verification chain active for this record.</Text>
                  {canRectify && (
                    <TouchableOpacity
                      style={{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f3e8ff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                      onPress={() => { const rec = detailRecord; setDetailRecord(null); openRectify(rec); }}
                    >
                      <Icon name="create-outline" size={14} color="#9333ea" />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#9333ea' }}>Rectify Missed Punch</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </View>
        )}
      </PremiumModal>

      {/* ── RECTIFY SHEET (employee self-rectification, matching web's SelfAttendanceCard modal) ── */}
      <PremiumBottomSheet visible={rectifySheet} onClose={() => { setRectifySheet(false); setRectifyNote(''); setRectifyTime(''); setRectifyRecord(null); }} title="Rectify Missed Punch">
        <Text style={{ fontSize: 14, color: colors.text, marginBottom: 4 }}>
          You missed your checkout on <Text style={{ fontWeight: '600' }}>{rectifyRecord?.date ? formatDateShort(rectifyRecord.date) : 'today'}</Text>.
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
          Checked in at {formatTime(rectifyRecord?.checkIn)}. Please enter your actual checkout time.
        </Text>

        {/* Role routing notice (matching web's SelfAttendanceCard) */}
        {(user?.role === 'team-leader' || user?.role === 'executive') && (
          <View style={s.routingNoticeWarn}>
            <Icon name="information-circle-outline" size={13} color="#92400e" />
            <Text style={s.routingNoticeWarnText}>
              This rectification will be routed directly to the Master Admin for review.
            </Text>
          </View>
        )}
        {user?.role === 'reporting-manager' && (
          <View style={s.routingNoticeWarn}>
            <Icon name="information-circle-outline" size={13} color="#92400e" />
            <Text style={s.routingNoticeWarnText}>
              This rectification will be routed: Company Admin → Executive → Team Leader.
            </Text>
          </View>
        )}

        {/* Correct Check-Out Time (matching web's time input) */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6 }}>Correct Check-Out Time</Text>
          <TextInput
            style={[s.timeInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
            placeholder="HH:MM (e.g. 18:30)"
            placeholderTextColor={colors.textTertiary}
            value={rectifyTime}
            onChangeText={setRectifyTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>

        {/* Remark (matching web's textarea) */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6 }}>
            Reason for Missed Checkout
          </Text>
          <TextInput style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top' }}
            placeholder="Explain why you missed checkout..." placeholderTextColor={colors.textTertiary} value={rectifyNote} onChangeText={setRectifyNote} multiline />
        </View>

        <TouchableOpacity
          style={[s.submitBtn, { backgroundColor: (!rectifyTime.trim() || submittingRectify) ? '#d1d5db' : '#8b5cf6' }]}
          disabled={!rectifyTime.trim() || submittingRectify}
          onPress={handleRectify}>
          {submittingRectify ? (
            <ActivityIndicator size={16} color="#fff" />
          ) : null}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
            {submittingRectify ? 'Submitting...' : 'Submit for Verification'}
          </Text>
        </TouchableOpacity>
      </PremiumBottomSheet>

      {/* ── ADMIN RECTIFY SHEET (tier review, matching web's missed punch review modal) ── */}
      <PremiumBottomSheet
        visible={adminRectifySheet}
        onClose={() => { setAdminRectifySheet(false); setAdminRectifyRemark(''); }}
        title={adminRectifyAction === 'approve' ? 'Approve Rectification' : 'Reject Rectification'}>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
          {adminRectifyRecord?.name} requested rectification for a missed punch.
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          A mandatory remark is required to <Text style={{ fontWeight: '700', color: adminRectifyAction === 'approve' ? '#10b981' : '#ef4444' }}>{adminRectifyAction}</Text>.
        </Text>

        {/* Verification chain preview (matching web's modal) */}
        {adminRectifyRecord?.missedPunchRectification && (() => {
          const mp = adminRectifyRecord.missedPunchRectification;
          const tiers = getRecordEffectiveMissedPunchTiers(mp);
          const progress = computeMissedPunchProgress(mp);
          const total = computeMissedPunchTotalTiers(mp);
          const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
          return (
            <View style={s.verificationCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '600' }}>Verification Progress</Text>
                <Text style={{ fontSize: 11, color: '#6b21a8', fontWeight: '700' }}>{Math.min(progress, total)}/{total}</Text>
              </View>
              <View style={{ height: 4, backgroundColor: '#e9d5ff', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: '#9333ea', borderRadius: 2 }} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {tiers.map((t) => {
                  const st = mp.approvalStatus?.[t] || 'Pending';
                  const conf: Record<string, { bg: string; tc: string }> = {
                    Approved: { bg: '#dcfce7', tc: '#16a34a' },
                    Rejected: { bg: '#fee2e2', tc: '#ef4444' },
                    Pending: { bg: '#fef3c7', tc: '#b45309' },
                  };
                  const c = conf[st] || conf.Pending;
                  return (
                    <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{MISSED_PUNCH_TIER_LABELS[t]}: {st}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

        <View style={{ fontSize: 14 } as any}>
          <TextInput style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top' }}
            placeholder="Enter mandatory remark..." placeholderTextColor={colors.textTertiary} value={adminRectifyRemark} onChangeText={setAdminRectifyRemark} multiline />
        </View>
        <TouchableOpacity
          style={{ backgroundColor: adminRectifyAction === 'approve' ? '#10b981' : '#ef4444', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 16, opacity: (adminRectifyRemark.trim() && !submittingRectify) ? 1 : 0.5, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
          disabled={!adminRectifyRemark.trim() || submittingRectify}
          onPress={submitAdminRectify}>
          {submittingRectify && <ActivityIndicator size={16} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{adminRectifyAction === 'approve' ? 'Approve' : 'Reject'}</Text>
        </TouchableOpacity>
      </PremiumBottomSheet>

      <SelfieCaptureModal
        visible={showSelfieCapture}
        companyId={user?.companyId || ''}
        userId={user?.id || ''}
        onClose={() => setShowSelfieCapture(false)}
        onCaptured={handleSelfieCaptured}
      />

      <BranchQrModal
        visible={showQrSheet}
        branches={myBranches.branches}
        primaryBranchId={myBranches.primaryBranchId}
        submitting={checkingIn}
        onClose={() => setShowQrSheet(false)}
        onSubmit={handleQrPicked}
      />
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  searchRow: { paddingHorizontal: 16, marginTop: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 24 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },

  // ── Orange Punch Banner (matching web's AttendancePunchBanner) ──
  punchBanner: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 16,
    // Same dark navy as every other hero (HeroBanner / DashboardHero /
    // BrandHomeHero) — the orange punch button inside stays the accent.
    backgroundColor: '#1e293b', overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  punchBannerContent: {
    padding: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
  },
  punchHeroRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingTop: 20,
  },
  punchCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.55)',
  },
  punchHeadline: { fontSize: 20, fontWeight: '800', color: '#fff' },
  punchHeadlineSub: { fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 2 },
  punchInfoBox: {
    marginHorizontal: 20, marginTop: 14, borderRadius: 12,
    backgroundColor: 'rgba(17,24,39,0.22)', paddingVertical: 10,
    paddingHorizontal: 12, gap: 9,
  },
  punchInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  punchInfoText: { fontSize: 13.5, color: '#fff', fontWeight: '600' },
  punchBannerTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  punchBannerSubtitle: { fontSize: 14, color: '#fff', opacity: 0.85, marginBottom: 2 },
  punchBannerLate: { fontSize: 13, color: '#fff', opacity: 0.85, marginTop: 4 },
  punchBannerStatus: { fontSize: 13, color: '#fff', opacity: 0.75, marginTop: 4 },

  // ── Device chips (matching web's GPS/Network/Geofence tags) ──
  deviceChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  deviceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  deviceChipText: { fontSize: 11, color: 'rgba(255,255,255,0.8)' },

  // ── Punch buttons ──
  punchButtonsCol: { marginTop: 8 },
  checkInBannerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  checkInBannerBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  checkOutBannerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    backgroundColor: '#fff',
  },
  checkOutBannerBtnText: { color: '#ea580c', fontSize: 16, fontWeight: '600' },

  // ── Policy chips row ──
  policyChipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 24, paddingBottom: 16,
  },
  policyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  policyChipText: { fontSize: 11, fontWeight: '600' },

  // ── Missed checkout inline alert (matching web's SelfAttendanceCard) ──
  missedPunchInline: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: '#f3e8ff', borderRadius: 8,
    borderWidth: 1, borderColor: '#e9d5ff',
  },
  missedPunchInlineText: { flex: 1, fontSize: 13, color: '#7e22ce', fontWeight: '500' },
  rectifyNowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#9333ea', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  rectifyNowBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ── Monthly stats row (matching web's SelfAttendanceCard) ──
  monthStatsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginTop: 16, marginBottom: 8 },
  monthStatItem: { flex: 1, textAlign: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  monthStatValue: { fontSize: 18, fontWeight: '700' },
  monthStatLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },

  // ── Role routing info (matching web's SelfAttendanceCard) ──
  routingInfoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 4, marginBottom: 12,
    padding: 12, backgroundColor: '#eff6ff', borderRadius: 8,
    borderWidth: 1, borderColor: '#dbeafe',
  },
  routingInfoText: { flex: 1, fontSize: 12, color: '#1e40af' },

  // ── Routing notice in rectify sheet ──
  routingNoticeWarn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, marginBottom: 12, borderRadius: 8,
    backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fde68a',
  },
  routingNoticeWarnText: { flex: 1, fontSize: 12, color: '#92400e' },

  // ── Verification progress card ──
  verificationCard: {
    marginTop: 10, padding: 10, backgroundColor: '#faf5ff',
    borderRadius: 8, borderWidth: 1, borderColor: '#e9d5ff',
  },

  // ── Status filter chips (matching web's stat cards) ──
  statusFilterRow: { flexDirection: 'row', gap: 6, paddingRight: 16, paddingBottom: 4 },
  statusFilterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1.5, borderColor: 'transparent',
    backgroundColor: `${c.surface}`,
  },
  statusFilterChipText: { fontSize: 12, fontWeight: '500' },
  statusFilterChipCount: { fontSize: 11, fontWeight: '700' },

  // ── Status badge (small inline) ──
  statusBadgeSmall: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeSmallText: { fontSize: 12, fontWeight: '500' },

  // ── Time input ──
  timeInput: {
    width: '100%', padding: 12, borderRadius: 8,
    borderWidth: 1, fontSize: 14,
  },

  // ── Submit button ──
  submitBtn: {
    paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 4,
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
});
