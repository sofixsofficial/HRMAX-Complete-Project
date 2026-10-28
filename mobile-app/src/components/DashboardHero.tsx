import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, AccessibilityInfo, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { collection, getDocs, query, where } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useTodayAttendance } from '../hooks/useTodayAttendance';
import { useAttendanceGate } from '../hooks/useAttendanceGate';
import { markCheckIn, markCheckOut } from '../services/attendanceApi';
import { BranchQrModal } from './BranchQrModal';
import { logAudit } from '../services/auditLogService';
import type { Holiday, LeaveRequest } from '../types/user';
import {
  effectiveTimezone,
  formatElapsed,
  formatInZone,
  getHeroScene,
  resolveCompanyTimezone,
  resolveCompanyWeekends,
  toDate,
  type DayPeriod,
} from '../utils/heroScene';
import { resolveCharacterMode, type CharacterMode } from '../utils/characterMode';
import { parseWeekendDays, toDateKey } from '../utils/workingDays';
import { Icon } from '../utils/icons';

/**
 * Premium dashboard hero — time-based scene background + live clock +
 * server-confirmed Working Mode.
 *
 * Drop-in replacement for DashboardHeader (same props) used by all role
 * dashboards. Working Mode derives ONLY from the user's verified today
 * attendance record (`useTodayAttendance`, restored on app resume) — it is
 * never inferred from UI interaction. Check-in/out actions reuse the
 * existing `useAttendanceGate` policy validation + `attendanceApi` cloud
 * functions; the confirmed record is refetched only after the server
 * responds.
 */

export interface DashboardHeroStat {
  label: string;
  value: string | number;
  color?: string;
}

interface DashboardHeroProps {
  name: string;
  roleLabel?: string;
  subtitle?: string;
  stats?: DashboardHeroStat[];
  /** Compact Check In/Out in the hero (gate-validated). EmployeeDashboard
   *  disables this because its full selfie-enabled punch card sits below. */
  showPunchActions?: boolean;
  /**
   * Show the personal attendance slice (status chip, check-in/out, Working
   * Mode). Master Admin and Company Admin do not punch in from the dashboard,
   * so their screens pass false — attendance state is never fetched there.
   */
  showAttendance?: boolean;
}

type PunchUiState =
  | 'loading'
  | 'not_checked_in'
  | 'checking_in'
  | 'working'
  | 'checking_out'
  | 'checked_out'
  | 'on_leave';

/* ── Shared hero background: the app-wide dark navy card ───────────── */
/**
 * Shared hero background for EVERY role dashboard (and the employee hero,
 * which hardcodes the same pair): a simple black-to-blue gradient.
 *
 * Kept to two flat stops with no scene art so the card reads as a plain,
 * calm surface on all screens rather than a different illustration per role.
 */
export const HERO_BG = ['#0b1120', '#152e56'] as const;


/* ── Employee character — one identity, five poses (SECTION 5B) ────── */

const SKIN = '#f0c09a';
const HAIR = '#2b2b3a';

const Character: React.FC<{ mode: CharacterMode; animate: boolean }> = ({ mode, animate }) => {
  const casual = mode === 'on_leave' || mode === 'holiday';
  const shirt = casual ? '#3f7d5a' : '#33507e';
  const shirtDark = casual ? '#356a4d' : '#2b4470';
  const working = mode === 'working';

  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      pulse.setValue(working ? 1 : 0);
      return;
    }
    // Working = subtle screen-glow pulse; every other mode = gentle breathing.
    const hi = 1;
    const lo = working ? 0.82 : 0;
    const dur = working ? 1600 : 2500;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: hi, duration: dur, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: lo, duration: dur, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, mode, pulse, working]);

  const animStyle = working
    ? { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }
    : { transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }] };

  const head = (cx: number, cy: number) => (
    <>
      <Circle cx={cx} cy={cy} r={12} fill={SKIN} />
      <Path d={`M${cx - 12} ${cy - 2} q2 -14 12 -14 q12 0 13 14 q-6 -6 -13 -5 q-8 1 -12 5 z`} fill={HAIR} />
    </>
  );

  const eyes = (cx: number, cy: number) => (
    <>
      <Circle cx={cx - 3} cy={cy + 1} r={1.2} fill={HAIR} />
      <Circle cx={cx + 3} cy={cy + 1} r={1.2} fill={HAIR} />
    </>
  );

  return (
    <Animated.View style={animStyle} pointerEvents="none">
      <Svg width="100%" height={132} viewBox="0 0 240 150">
        {/* Desk */}
        <Rect x="38" y="92" width="172" height="7" rx="3.5" fill="#ffffff" opacity={0.9} />
        <Rect x="50" y="99" width="6" height="34" rx="3" fill="#ffffff" opacity={0.6} />
        <Rect x="192" y="99" width="6" height="34" rx="3" fill="#ffffff" opacity={0.6} />

        {/* Chair */}
        <Path d="M80 40 q-12 8 -12 30 l0 22 h12 l0 -22 q0 -22 12 -30 z" fill="#0f172a" opacity={0.8} />
        <Rect x="82" y="90" width="50" height="6" rx="3" fill="#0f172a" opacity={0.8} />

        {/* Desk plant */}
        <Path d="M42 82 l3 10 h12 l3 -10 z" fill="#ffffff" opacity={0.85} />
        <Ellipse cx="51" cy="72" rx={7} ry={11} fill="#bbf7d0" opacity={0.85} />
        <Ellipse cx="44" cy="76" rx={5} ry={8} fill="#86efac" opacity={0.8} />
        <Ellipse cx="58" cy="76" rx={5} ry={8} fill="#86efac" opacity={0.8} />

        {/* Person — pose varies by mode; same desk, chair, identity */}
        {mode === 'working' && (
          <>
            <Path d="M108 54 q10 -4 22 0 l3 38 h-30 z" fill={shirt} />
            {head(118, 40)}
            <Path d="M126 62 L150 82" stroke={shirtDark} strokeWidth={6} strokeLinecap="round" />
            <Path d="M122 64 L148 84" stroke={shirt} strokeWidth={6} strokeLinecap="round" />
            <Circle cx={152} cy={83} r={4} fill={SKIN} />
            <Circle cx={150} cy={85} r={4} fill={SKIN} />
            {eyes(118, 40)}
            <Path d="M117 45 h4" stroke={HAIR} strokeWidth={1} strokeLinecap="round" />
          </>
        )}
        {mode === 'complete' && (
          <>
            <Path d="M106 54 q10 -5 22 0 l3 38 h-31 z" fill={shirt} />
            {head(116, 40)}
            <Path d="M126 62 q10 0 8 -12" stroke={shirt} strokeWidth={6} strokeLinecap="round" fill="none" />
            <Circle cx={133} cy={48} r={5} fill={SKIN} />
            <Rect x="132" y="41" width="3.4" height="8" rx="1.7" fill={SKIN} />
            {eyes(116, 40)}
            <Path d="M113 45 q3 3.5 6 0" stroke={HAIR} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          </>
        )}
        {mode === 'on_leave' && (
          <>
            <Path d="M102 54 q12 -4 24 0 l4 38 h-34 z" fill={shirt} />
            {head(112, 40)}
            <Path d="M124 60 q9 2 7 -8" stroke={shirt} strokeWidth={6} strokeLinecap="round" fill="none" />
            <Circle cx={130} cy={50} r={4} fill={SKIN} />
            {eyes(112, 40)}
            <Path d="M109 45 q3 2.5 6 0" stroke={HAIR} strokeWidth={1.1} fill="none" strokeLinecap="round" />
          </>
        )}
        {mode === 'holiday' && (
          <>
            <Path d="M104 54 q12 -4 24 0 l3 38 h-32 z" fill={shirt} />
            {head(114, 40)}
            <Path d="M104 58 q-6 -14 8 -18" stroke={shirtDark} strokeWidth={6} strokeLinecap="round" fill="none" />
            <Path d="M128 58 q6 -14 -8 -18" stroke={shirtDark} strokeWidth={6} strokeLinecap="round" fill="none" />
            {eyes(114, 40)}
            <Path d="M111 45 q3 3.5 6 0" stroke={HAIR} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          </>
        )}
        {mode === 'resting' && (
          <>
            <Path d="M104 54 q10 -6 22 0 l4 38 h-32 z" fill={shirt} />
            {head(112, 40)}
            <Path d="M124 60 q10 2 8 -8" stroke={shirt} strokeWidth={6} strokeLinecap="round" fill="none" />
            <Circle cx={132} cy={50} r={4} fill={SKIN} />
            {eyes(112, 40)}
            <Path d="M110 45 q2 1.5 4 0" stroke={HAIR} strokeWidth={1} fill="none" strokeLinecap="round" />
          </>
        )}

        {/* Mug — held for rest / leave */}
        {(mode === 'resting' || mode === 'on_leave') && (
          <>
            <Rect x="126" y="44" width="9" height="8" rx="1.5" fill="#ffffff" opacity={0.95} />
            <Path d="M130 42 q3 -4 0 -8" stroke="#ffffff" strokeWidth={1.4} fill="none" opacity={0.6} strokeLinecap="round" />
          </>
        )}

        {/* Laptop — state per mode */}
        {mode === 'working' ? (
          <>
            <Rect x="150" y="86" width="40" height="5" rx="2.5" fill="#0f172a" opacity={0.9} />
            <Rect x="152" y="62" width="34" height="24" rx="2" fill="#0f172a" opacity={0.9} />
            <Rect x="155" y="65" width="28" height="18" rx="1.5" fill="#7dd3fc" opacity={0.9} />
            <Rect x="158" y="68" width="12" height="3" rx="1.5" fill="#0b3a6b" />
            <Rect x="158" y="73" width="20" height="2" rx="1" fill="#0b3a6b" opacity={0.6} />
          </>
        ) : mode === 'resting' ? (
          <>
            <Rect x="152" y="86" width="40" height="5" rx="2.5" fill="#0f172a" opacity={0.9} />
            <Rect x="155" y="64" width="31" height="22" rx="2" fill="#0f172a" opacity={0.9} />
            <Rect x="158" y="67" width="25" height="16" rx="1.5" fill="#1e293b" />
            <Circle cx={170} cy={75} r={1.6} fill="#f59e0b" opacity={0.7} />
          </>
        ) : (
          /* complete / on_leave / holiday — laptop closed */
          <>
            <Rect x="152" y="88" width="40" height="5" rx="2" fill="#0f172a" opacity={0.9} />
            <Rect x="155" y="83" width="34" height="5" rx="2" fill="#334155" opacity={0.9} />
          </>
        )}
      </Svg>
    </Animated.View>
  );
};

/* ── Helpers ───────────────────────────────────────────────────────── */

const fmtPunchTime = (value: Parameters<typeof toDate>[0], tz: string | null) => {
  const d = toDate(value);
  return d ? formatInZone(d, tz, { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--';
};

const statIconName = (label: string): string => {
  const l = label.toLowerCase();
  if (l.includes('inactive')) return 'remove-circle-outline';
  if (l.includes('present')) return 'checkmark-circle-outline';
  if (l.includes('absent')) return 'close-circle-outline';
  if (l.includes('leave')) return 'leaf-outline';
  if (l.includes('task')) return 'clipboard-outline';
  if (l.includes('active')) return 'trending-up-outline';
  if (l.includes('team')) return 'people-outline';
  if (l.includes('rate') || l.includes('month')) return 'stats-chart-outline';
  if (l.includes('approved')) return 'checkmark-done-outline';
  if (l.includes('slip')) return 'document-text-outline';
  return 'grid-outline';
};

const periodIconName = (period: DayPeriod): string => {
  if (period === 'night') return 'moon-outline';
  if (period === 'evening') return 'partly-sunny-outline';
  return 'sunny-outline';
};

/** '#10b981' + 0.2 → 'rgba(16,185,129,0.2)' — tint for stat badges. */
const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

interface StatusStyle {
  color: string;
  borderColor: string;
  backgroundColor: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  working: { color: '#6ee7b7', borderColor: 'rgba(16,185,129,0.55)', backgroundColor: 'rgba(6,78,59,0.5)' },
  done: { color: '#93c5fd', borderColor: 'rgba(59,130,246,0.55)', backgroundColor: 'rgba(23,47,94,0.5)' },
  leave: { color: '#bfdbfe', borderColor: 'rgba(96,165,250,0.5)', backgroundColor: 'rgba(30,58,110,0.5)' },
  holiday: { color: '#fcd34d', borderColor: 'rgba(245,158,11,0.55)', backgroundColor: 'rgba(69,44,12,0.5)' },
  idle: { color: '#fde68a', borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(2,6,23,0.42)' },
  pending: { color: '#fdba74', borderColor: 'rgba(249,115,22,0.5)', backgroundColor: 'rgba(2,6,23,0.42)' },
  loading: { color: '#cbd5e1', borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(2,6,23,0.42)' },
};

/* ── Hero ──────────────────────────────────────────────────────────── */

/* ── Day context — approved leave + holiday + weekly-off (backend data) ── */

interface DayContext {
  onApprovedLeave: boolean;
  halfDayLeave: boolean;
  isHoliday: boolean;
  holidayLabel?: string;
  isWeeklyOff: boolean;
  weekendLabel?: string;
}

const EMPTY_DAY: DayContext = { onApprovedLeave: false, halfDayLeave: false, isHoliday: false, isWeeklyOff: false };

const toDateValue = (v: unknown): Date | null => {
  const any = v as { toDate?: () => Date } | Date | string | number | null;
  if (!any) return null;
  if (typeof any === 'object' && 'toDate' in any && typeof any.toDate === 'function') return any.toDate();
  const d = new Date(any as string | number | Date);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Loads the non-attendance facts the character resolver needs: an APPROVED
 * leave covering today (pending/rejected never count), the company holiday
 * for today, and the assigned weekly-off day. All reads are best-effort — if a
 * source is unavailable the flag stays false and the mode falls back to the
 * attendance flow, so the app never breaks or invents a state.
 */
const useDayContext = (userId?: string, companyId?: string): DayContext => {
  const [ctx, setCtx] = useState<DayContext>(EMPTY_DAY);

  useEffect(() => {
    let dead = false;
    if (!userId) return;

    // Approved leave covering today.
    getDocs(query(collection(db, 'leaveRequests'), where('userId', '==', userId)))
      .then((snap) => {
        if (dead) return;
        const key = new Date().toDateString();
        const covering = snap.docs
          .map((d) => d.data() as Partial<LeaveRequest>)
          .filter((l) => {
            if (String(l.status ?? '') !== 'Approved') return false;
            const s = toDateValue(l.startDate);
            const e = toDateValue(l.endDate);
            if (!s || !e) return false;
            return s.toDateString() <= key && e.toDateString() >= key;
          });
        const full = covering.some((l) => (l.totalDays ?? 1) >= 1);
        const half = covering.some((l) => (l.totalDays ?? 1) < 1);
        setCtx((p) => ({ ...p, onApprovedLeave: full, halfDayLeave: half }));
      })
      .catch(() => {});

    if (companyId) {
      // Company holiday for today (holidays.view is granted to every employee).
      getDocs(query(collection(db, 'holidays'), where('companyId', '==', companyId)))
        .then((snap) => {
          if (dead) return;
          const todayKey = toDateKey(new Date());
          const hit = snap.docs
            .map((d) => d.data() as Partial<Holiday>)
            .find((h) => {
              const dt = toDateValue(h.date);
              return dt ? toDateKey(dt) === todayKey : false;
            });
          setCtx((p) => ({ ...p, isHoliday: !!hit, holidayLabel: hit?.name }));
        })
        .catch(() => {});

      // Weekly off — company schedule (readable via company.view). Never infer
      // a non-working day from the weekday alone (SECTION 5B).
      resolveCompanyWeekends(companyId)
        .then((weekends) => {
          if (dead || !weekends || weekends.length === 0) return;
          const idxs = parseWeekendDays(weekends);
          const isOff = idxs.includes(new Date().getDay());
          setCtx((p) => ({
            ...p,
            isWeeklyOff: isOff,
            weekendLabel: isOff ? new Date().toLocaleDateString(undefined, { weekday: 'long' }) : undefined,
          }));
        })
        .catch(() => {});
    }

    return () => { dead = true; };
  }, [userId, companyId]);

  return ctx;
};

/**
 * Personal attendance slice of the mobile hero — status chip, check-in/out
 * actions, and the live Working Mode illustration. This mounts the attendance
 * hooks (today's record, policy gate); it is only rendered for roles that
 * actually punch (not Master/Company Admin), so those dashboards never fetch
 * attendance state.
 *
 * Working Mode is derived purely from the server-confirmed `todayRecord`.
 */
const HeroAttendance: React.FC<{
  now: Date;
  tz: string | null;
  showPunchActions: boolean;
  companyId: string;
}> = ({ now, tz, showPunchActions, companyId }) => {
  const { todayRecord, loading, refresh } = useTodayAttendance();
  const { validateCheckIn, validateCheckOut, myBranches } = useAttendanceGate();
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [punchMsg, setPunchMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const { user } = useAuth();
  const day = useDayContext(user?.id, companyId);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const hasIn = !!todayRecord?.checkIn;
  const hasOut = !!todayRecord?.checkOut;
  // The record's own 'On Leave' status is a server signal alongside approved
  // leave records — either way it must come from the backend, never the UI.
  const onApprovedLeave = day.onApprovedLeave || todayRecord?.status === 'On Leave';

  // Single authoritative mode — resolved from backend records only (SECTION 5B).
  const resolved = useMemo(
    () =>
      resolveCharacterMode({
        hasCheckIn: hasIn,
        hasCheckOut: hasOut,
        onApprovedLeave,
        halfDayLeave: day.halfDayLeave,
        isHoliday: day.isHoliday,
        holidayLabel: day.holidayLabel,
        isWeeklyOff: day.isWeeklyOff,
        weekendLabel: day.weekendLabel,
      }),
    [hasIn, hasOut, onApprovedLeave, day],
  );

  const mode = resolved.mode;
  const working = mode === 'working';

  const statusText = loading
    ? 'Loading attendance…'
    : busy === 'in'
      ? 'Checking in…'
      : busy === 'out'
        ? 'Checking out…'
        : resolved.pill;

  const statusKey = loading
    ? 'loading'
    : busy === 'in' || busy === 'out'
      ? 'pending'
      : resolved.pillState;

  const elapsedMs =
    working && toDate(todayRecord?.checkIn)
      ? now.getTime() - toDate(todayRecord!.checkIn)!.getTime()
      : 0;

  const workedMs =
    hasIn && hasOut && toDate(todayRecord?.checkIn) && toDate(todayRecord?.checkOut)
      ? toDate(todayRecord!.checkOut)!.getTime() - toDate(todayRecord!.checkIn)!.getTime()
      : 0;

  const showCheckIn = showPunchActions && !loading && resolved.canCheckIn;
  const showCheckOut = showPunchActions && !loading && resolved.canCheckOut;

  const handleCheckIn = useCallback(async (picked?: { branchId?: string; qrToken?: string }) => {
    if (busy) return;
    if (!companyId) {
      setPunchMsg({ type: 'error', text: 'No company assigned to your account.' });
      return;
    }
    setBusy('in');
    setPunchMsg(null);
    try {
      const res = await validateCheckIn({ branchId: picked?.branchId, qrToken: picked?.qrToken });
      if (!res.ok) {
        if (res.needsQr) {
          // QR-enabled company: collect the branch code before punching,
          // instead of letting the server reject it with QR_REQUIRED.
          setShowQrSheet(true);
          return;
        }
        setPunchMsg({
          type: 'error',
          text: res.needsSelfie
            ? 'This office requires a selfie — please check in from the Attendance module.'
            : res.reason || 'Attendance policy not satisfied.',
        });
        return;
      }
      // Server confirms the write; only then do we refetch the record.
      const result = await markCheckIn(companyId, {
        branchId: picked?.branchId,
        qrToken: picked?.qrToken,
      });
      refresh();
      setPunchMsg({ type: 'success', text: result.message || 'Checked in successfully!' });
      // Audit trail (spec): a punch is a state change on the attendance record.
      logAudit({
        userId: user?.id || '',
        userName: user?.name || 'Employee',
        userRole: user?.role || '',
        action: 'Checked in',
        actionType: 'create',
        module: 'Attendance',
        targetEntity: 'Attendance',
        status: 'success',
      }).catch(() => {});
    } catch (err) {
      setPunchMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Check-in failed',
      });
    } finally {
      setBusy(null);
    }
  }, [busy, companyId, validateCheckIn, refresh, user]);

  const handleQrPicked = useCallback((payload: { branchId: string; qrToken: string }) => {
    setShowQrSheet(false);
    void handleCheckIn(payload);
  }, [handleCheckIn]);

  const handleCheckOut = useCallback(async () => {
    if (busy || !todayRecord?.checkIn || todayRecord?.checkOut) return;
    if (!companyId) {
      setPunchMsg({ type: 'error', text: 'No company assigned to your account.' });
      return;
    }
    setBusy('out');
    setPunchMsg(null);
    try {
      const res = await validateCheckOut();
      if (!res.ok) {
        setPunchMsg({ type: 'error', text: res.reason || 'Attendance policy not satisfied.' });
        return;
      }
      const result = await markCheckOut(companyId, todayRecord.id);
      refresh();
      setPunchMsg({ type: 'success', text: result.message || 'Checked out successfully!' });
      logAudit({
        userId: user?.id || '',
        userName: user?.name || 'Employee',
        userRole: user?.role || '',
        action: 'Checked out',
        actionType: 'create',
        module: 'Attendance',
        targetEntity: 'Attendance',
        status: 'success',
      }).catch(() => {});
    } catch (err) {
      setPunchMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Check-out failed',
      });
    } finally {
      setBusy(null);
    }
  }, [busy, todayRecord, companyId, validateCheckOut, refresh, user]);

  const statusStyle = STATUS_STYLES[statusKey] || STATUS_STYLES.loading;

  return (
    <>
      <View style={[styles.statusChip, { borderColor: statusStyle.borderColor, backgroundColor: statusStyle.backgroundColor }]}>
        <View style={[styles.statusDot, { backgroundColor: statusStyle.color }, statusKey === 'working' && styles.statusDotPulse]} />
        <Text style={[styles.statusText, { color: statusStyle.color }]} numberOfLines={1}>{statusText}</Text>
      </View>

      <View style={styles.detailRow}>
        {working && (
          <>
            <Text style={styles.detailText}>Checked in at {fmtPunchTime(todayRecord?.checkIn, tz)}</Text>
            <Text style={styles.detailText}>·</Text>
            <Text style={styles.detailElapsed}>{formatElapsed(elapsedMs)} elapsed</Text>
          </>
        )}
        {mode === 'complete' && (
          <>
            <Text style={styles.detailText}>In {fmtPunchTime(todayRecord?.checkIn, tz)}</Text>
            <Text style={styles.detailText}>·</Text>
            <Text style={styles.detailText}>Out {fmtPunchTime(todayRecord?.checkOut, tz)}</Text>
            <Text style={styles.detailText}>·</Text>
            <Text style={styles.detailText}>{formatElapsed(workedMs)} worked</Text>
          </>
        )}
        {mode === 'on_leave' && <Text style={styles.detailText}>Approved leave today</Text>}
        {mode === 'holiday' && (
          <Text style={styles.detailText}>
            {resolved.pill} · {formatInZone(now, tz, { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        )}
        {working && todayRecord?.status === 'Late' && (
          <Text style={styles.detailLate}>{todayRecord.lateMinutes ?? 0} min late (auto-approved)</Text>
        )}
      </View>

      {(showCheckIn || showCheckOut || punchMsg) && (
        <View style={styles.actionsRow}>
          {showCheckIn && (
            <Pressable
              onPress={() => void handleCheckIn()}
              disabled={busy !== null}
              style={({ pressed }) => [styles.punchBtn, pressed && styles.punchBtnPressed, busy !== null && styles.punchBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Check in"
            >
              {busy === 'in' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="log-in-outline" size={15} color="#ffffff" />
              )}
              <Text style={styles.punchBtnText}>{busy === 'in' ? 'Checking in…' : 'Check In'}</Text>
            </Pressable>
          )}
          {showCheckOut && (
            <Pressable
              onPress={() => void handleCheckOut()}
              disabled={busy !== null}
              style={({ pressed }) => [styles.punchBtn, pressed && styles.punchBtnPressed, busy !== null && styles.punchBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Check out"
            >
              {busy === 'out' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="log-out-outline" size={15} color="#ffffff" />
              )}
              <Text style={styles.punchBtnText}>{busy === 'out' ? 'Checking out…' : 'Check Out'}</Text>
            </Pressable>
          )}
          {punchMsg ? (
            <Text style={[styles.punchMsg, { color: punchMsg.type === 'success' ? '#6ee7b7' : '#fca5a5' }]} numberOfLines={3}>
              {punchMsg.text}
            </Text>
          ) : null}
        </View>
      )}

      {/* Illustration — one character, five backend-resolved poses. */}
      {!loading && (
        <View style={styles.worker} pointerEvents="none">
          <Character mode={mode} animate={!reduceMotion} />
        </View>
      )}

      {/* Branch + QR sheet for QR-enabled companies (mirrors the Attendance module). */}
      <BranchQrModal
        visible={showQrSheet}
        branches={myBranches.branches}
        primaryBranchId={myBranches.primaryBranchId}
        submitting={busy === 'in'}
        onClose={() => setShowQrSheet(false)}
        onSubmit={handleQrPicked}
      />
    </>
  );
};

export const DashboardHero: React.FC<DashboardHeroProps> = ({
  name,
  roleLabel,
  subtitle,
  stats,
  showPunchActions = true,
  showAttendance = true,
}) => {
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();

  const [companyTz, setCompanyTz] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  // One value per stat tile — filled during render, driven by the stagger below.
  const statAnims = useRef<Animated.Value[]>([]).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Entrance: the header fades/slides up once. (These values previously stayed
  // at opacity 0 / translateY 20 forever — nothing ever animated them.)
  useEffect(() => {
    if (reduceMotion) {
      fadeAnim.setValue(1);
      slideAnim.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, fadeAnim, slideAnim]);

  // Company timezone (one cached read); falls back to the device zone.
  useEffect(() => {
    let dead = false;
    resolveCompanyTimezone(effectiveCompanyId || user?.companyId)
      .then((tz) => { if (!dead) setCompanyTz(tz); })
      .catch(() => {});
    return () => { dead = true; };
  }, [effectiveCompanyId, user?.companyId]);

  // Live clock — local tick only, no API calls; resyncs on resume.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Stat tiles reveal one after another once the header has landed.
  const statCount = stats?.length ?? 0;
  useEffect(() => {
    while (statAnims.length < statCount) statAnims.push(new Animated.Value(0));
    const tiles = statAnims.slice(0, statCount);
    if (reduceMotion) {
      tiles.forEach((v) => v.setValue(1));
      return;
    }
    tiles.forEach((v) => v.setValue(0));
    Animated.stagger(
      70,
      tiles.map((v) => Animated.timing(v, { toValue: 1, duration: 340, useNativeDriver: true })),
    ).start();
  }, [statCount, reduceMotion, statAnims]);

  const tz = effectiveTimezone(companyTz);
  const { period } = getHeroScene(now, tz);

  const time = formatInZone(now, tz, { hour: '2-digit', minute: '2-digit', hour12: true });
  const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);
  // Synchronous fill so the map below always has a value (the effect below
  // is what actually drives them).
  while (statAnims.length < statCount) statAnims.push(new Animated.Value(0));

  return (
    <LinearGradient
      colors={[...HERO_BG]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      {/* The hero is a plain black-to-blue surface for every role - no scene
          art, so the card stays identical across all dashboards. */}
      {/* Contrast scrim for white text on bright scenes */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim]} />

      <Animated.View style={[styles.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.topRow}>
          <View style={styles.identityCol}>
            {/* Time-of-day greeting removed by request (matches web) — the hero
                now shows only the name, role, date and live clock. */}
            <View style={styles.identityRow}>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
              </View>
            </View>

            <View style={styles.tagRow}>
              {roleLabel ? (
                <View style={styles.rolePill}>
                  <Text style={styles.rolePillText} numberOfLines={1}>{roleLabel}</Text>
                </View>
              ) : null}
              <View style={styles.datePill}>
                <Icon name="calendar-outline" size={12} color="#cbd5e1" />
                <Text style={styles.datePillText} numberOfLines={1}>
                  {formatInZone(now, tz, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
              </View>
            </View>

            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
            ) : null}
          </View>

          {/* Clock card — glass panel, right */}
          <View style={styles.clockCard}>
            <View style={styles.clockTimeRow}>
              <Icon name={periodIconName(period)} size={18} color={period === 'night' ? '#dbe6ff' : '#fde68a'} />
              <Text style={styles.clockTime}>{time}</Text>
            </View>
            <View style={styles.periodPill}>
              <View style={styles.periodDot} />
              <Text style={styles.periodPillText}>{periodLabel}</Text>
            </View>
          </View>
        </View>

        {showAttendance ? (
          <View style={styles.attendanceWrap}>
            <HeroAttendance
              now={now}
              tz={tz}
              companyId={effectiveCompanyId || user?.companyId || ''}
              showPunchActions={showPunchActions}
            />
          </View>
        ) : null}

        {stats && stats.length > 0 && (
          <View style={styles.statsRow}>
            {stats.map((st, i) => {
              const v = statAnims[i];
              return (
                <Animated.View
                  key={`${st.label}-${i}`}
                  style={[
                    styles.statTile,
                    {
                      opacity: v,
                      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                    },
                  ]}
                >
                  <Text style={[styles.statValue, { color: st.color || '#10b981' }]}>{st.value}</Text>
                  <Text style={styles.statLabel} numberOfLines={1}>{st.label}</Text>
                </Animated.View>
              );
            })}
          </View>
        )}
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: { overflow: 'hidden', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  scrim: {
    backgroundColor: 'rgba(2,6,23,0.30)',
  },
  container: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 20 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  identityCol: { flex: 1, minWidth: 0 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, minWidth: 0 },
  greeting: {
    fontSize: 11.5,
    color: 'rgba(203,213,225,0.95)',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  name: { fontSize: 24, fontWeight: '800', color: '#fff', marginTop: 2, letterSpacing: -0.3 },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  rolePill: {
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(251,191,36,0.75)',
  },
  rolePillText: { fontSize: 12.5, fontWeight: '700', color: '#fbbf24' },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: 'rgba(2,6,23,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  datePillText: { fontSize: 11.5, fontWeight: '600', color: '#cbd5e1' },
  attendanceWrap: {
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(2,6,23,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
    borderWidth: 1,
    maxWidth: '100%',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusDotPulse: {
    // Static ring substitute — no continuous animation (battery friendly)
    shadowColor: '#6ee7b7',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 9 },
  detailText: { fontSize: 12.5, color: 'rgba(226,232,240,0.92)' },
  detailElapsed: { fontSize: 12.5, color: '#6ee7b7', fontWeight: '700' },
  detailLate: { fontSize: 12.5, color: '#fdba74' },
  subtitle: { fontSize: 12.5, color: '#cbd5e1', marginTop: 9 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 13 },
  punchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
  },
  punchBtnPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  punchBtnDisabled: { opacity: 0.65 },
  punchBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  punchMsg: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },

  clockCard: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(2,6,23,0.38)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: 165,
  },
  clockTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  clockTime: {
    fontSize: 21,
    fontWeight: '800',
    color: '#fff',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
  },
  periodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  periodDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24' },
  periodPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#e2e8f0',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  worker: { alignSelf: 'flex-end', width: 190, marginTop: 6, marginBottom: -4 },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  statTile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  statBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // Scene decor
  star: { position: 'absolute', borderRadius: 2, backgroundColor: '#e8eeff', opacity: 0.85 },
  moonWrap: { position: 'absolute', top: 18, right: 44 },
  moon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f5f3d8' },
  moonBite: {
    position: 'absolute',
    top: -4,
    left: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0d1430',
    opacity: 0.92,
  },
  skyline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    opacity: 0.85,
  },
  skylineBar: { backgroundColor: '#0a1128', borderTopLeftRadius: 2, borderTopRightRadius: 2, justifyContent: 'flex-start', alignItems: 'center' },
  windowLight: { width: 5, height: 6, backgroundColor: '#ffd58a', marginTop: 6, opacity: 0.85 },
  sunHalo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, opacity: 0.28 },
  sun: { position: 'absolute', width: 64, height: 64, borderRadius: 32 },
  sunSmall: { position: 'absolute', width: 44, height: 44, borderRadius: 22 },
  cloud: { position: 'absolute', borderRadius: 100, backgroundColor: '#ffffff', opacity: 0.7 },
  ridge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 54,
    borderTopLeftRadius: 64,
    borderTopRightRadius: 96,
    opacity: 0.55,
  },
});

export default DashboardHero;
