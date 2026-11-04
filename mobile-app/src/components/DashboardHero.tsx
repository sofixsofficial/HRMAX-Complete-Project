import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, AccessibilityInfo, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
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
  resolveCompanyTimezone,
  resolveCompanyWeekends,
  toDate,
} from '../utils/heroScene';
import { resolveCharacterMode } from '../utils/characterMode';
import { parseWeekendDays, toDateKey } from '../utils/workingDays';
import { Icon } from '../utils/icons';

/**
 * Dashboard hero — light banner (web parity, client reference):
 *  • white → pale-blue card with soft blue waves (bottom-right)
 *  • Welcome to, + NAME + blue-bar subtitle + light date/time pills
 *  • role pill + live attendance chips (state-coloured pale pills)
 *    + gate-validated punch actions
 *  • white stat tiles BELOW the card (neutral icon chips, black text,
 *    real values)
 *
 * Working Mode derives ONLY from the user's verified today attendance record
 * (`useTodayAttendance`, restored on app resume) — it is never inferred from
 * UI interaction. Check-in/out actions reuse the existing `useAttendanceGate`
 * policy validation + `attendanceApi` cloud functions; the confirmed record
 * is refetched only after the server responds.
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
  /**
   * @deprecated The hero no longer renders a "View Details" button (removed
   * per the client's design) — dashboards may keep passing the scroll
   * handler; it is simply ignored.
   */
  onViewDetails?: () => void;
}

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

interface StatusStyle {
  color: string;
  borderColor: string;
  backgroundColor: string;
}

/** Light pill palette — pale backgrounds with state-coloured text (reference). */
const STATUS_STYLES: Record<string, StatusStyle> = {
  working: { color: '#047857', borderColor: '#a7f3d0', backgroundColor: '#ecfdf5' },
  done: { color: '#1d4ed8', borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  leave: { color: '#6d28d9', borderColor: '#ddd6fe', backgroundColor: '#f5f3ff' },
  holiday: { color: '#b45309', borderColor: '#fde68a', backgroundColor: '#fffbeb' },
  idle: { color: '#475569', borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  pending: { color: '#c2410c', borderColor: '#fed7aa', backgroundColor: '#fff7ed' },
  loading: { color: '#64748b', borderColor: '#e2e8f0', backgroundColor: '#f1f5f9' },
};

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
 * Loads the non-attendance facts the status resolver needs: an APPROVED
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
 * Personal attendance slice of the hero — status chip, live detail line
 * (checked-in time / elapsed), and gate-validated check-in/out actions. This
 * mounts the attendance hooks (today's record, policy gate); it is only
 * rendered for roles that actually punch (not Master/Company Admin), so those
 * dashboards never fetch attendance state.
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
  const { user } = useAuth();
  const day = useDayContext(user?.id, companyId);

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
            <View style={styles.detailInline}>
              <Icon name="time-outline" size={13} color="#2563eb" />
              <Text style={styles.detailText}>Checked in at {fmtPunchTime(todayRecord?.checkIn, tz)}</Text>
            </View>
            <Text style={styles.detailElapsed}>· {formatElapsed(elapsedMs)} elapsed</Text>
          </>
        )}
        {mode === 'complete' && (
          <Text style={styles.detailText}>
            In {fmtPunchTime(todayRecord?.checkIn, tz)} · Out {fmtPunchTime(todayRecord?.checkOut, tz)} · {formatElapsed(workedMs)} worked
          </Text>
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
            <Text
              style={[styles.punchMsg, { color: punchMsg.type === 'success' ? '#047857' : '#b91c1c' }]}
              numberOfLines={3}
            >
              {punchMsg.text}
            </Text>
          ) : null}
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

  // Entrance: the card fades/slides up once.
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

  // Stat tiles reveal one after another once the card has landed.
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
  // Synchronous fill so the map below always has a value (the effect above
  // is what actually drives them).
  while (statAnims.length < statCount) statAnims.push(new Animated.Value(0));

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      {/* ── Light banner card (client reference) ── */}
      <View style={styles.cardWrap}>
      <LinearGradient
        colors={['#ffffff', '#f6f9ff', '#eef4ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.85 }}
        style={styles.card}
      >
        {/* Decorative: soft blue waves (bottom-right) — behind content */}
        <Svg pointerEvents="none" style={styles.wavesArt} width={320} height={107} viewBox="0 0 1200 400" preserveAspectRatio="none">
          <Path d="M860 0 C1010 90 1130 210 940 330 C875 372 905 400 905 400 L1200 400 L1200 0 Z" fill="#dbe9fb" />
          <Path d="M1200 120 C1075 185 1155 320 995 400 L1200 400 Z" fill="#eef4fd" />
          <Path d="M1200 250 C1115 295 1165 362 1085 400 L1200 400 Z" fill="#c7dbf8" opacity={0.85} />
          <Path d="M1200 0 L960 0 C1075 65 1135 115 1200 145 Z" fill="#eaf1fd" />
        </Svg>

        <View style={styles.topRow}>
          <View style={styles.identityCol}>
            <Text style={styles.welcomeSmall}>Welcome to,</Text>
            <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">{name}</Text>
            <Text style={styles.heroSub} numberOfLines={2}>
              {subtitle || "Here's what's happening with your organization today."}
            </Text>

            {/* Live date + time pills (real clock — device zone/company tz) */}
            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Icon name="calendar-outline" size={13} color="#2563eb" />
                <Text style={styles.metaPillText} numberOfLines={1}>
                  {formatInZone(now, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
              <View style={styles.metaPill}>
                <Icon name="time-outline" size={13} color="#2563eb" />
                <Text style={styles.metaPillText}>
                  {formatInZone(now, tz, { hour: '2-digit', minute: '2-digit', hour12: true })}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Role pill + live attendance chips (status, checked-in, elapsed) */}
        <View style={styles.chipsFlow}>
          {roleLabel ? (
            <View style={styles.rolePill}>
              <Icon name="people-outline" size={13} color="#1d4ed8" />
              <Text style={styles.rolePillText} numberOfLines={1}>{roleLabel}</Text>
            </View>
          ) : null}
          {showAttendance ? (
            <HeroAttendance
              now={now}
              tz={tz}
              companyId={effectiveCompanyId || user?.companyId || ''}
              showPunchActions={showPunchActions}
            />
          ) : null}
        </View>

      </LinearGradient>
      </View>

      {/* ── Light stat tiles (real values from the dashboard) ── */}
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
                <View style={[styles.statCircle, { backgroundColor: '#f3f4f6' }]}>
                  <Icon name={statIconName(st.label)} size={17} color="#000000" />
                </View>
                <View style={styles.statMeta}>
                  <Text style={styles.statValue} selectable={false}>{st.value}</Text>
                  <Text style={styles.statLabel} numberOfLines={1} selectable={false}>{st.label}</Text>
                </View>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { marginBottom: 6 },
  // Outer shadow layer (iOS clips shadows when overflow is hidden, so the
  // gradient card sits inside this wrapper) — gentle blue shadow.
  cardWrap: {
    borderRadius: 18,
    shadowColor: '#1e3a8a',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e3ebfb',
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 20,
  },
  wavesArt: { position: 'absolute', right: 0, bottom: 0 },

  topRow: {
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  identityCol: { flex: 1, minWidth: 0 },
  welcomeSmall: { fontSize: 15, fontWeight: '600', color: '#64748b', letterSpacing: 0.1 },
  userName: { fontSize: 25, fontWeight: '800', color: '#16233f', marginTop: 3, letterSpacing: -0.5 },
  heroSub: {
    fontSize: 13,
    color: '#33415a',
    marginTop: 10,
    lineHeight: 19,
    borderLeftWidth: 4,
    borderLeftColor: '#2563eb',
    paddingLeft: 12,
    alignSelf: 'flex-start',
    maxWidth: '96%',
  },

  /* Live date / time pills (light — white on the pale card) */
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#dbe4f0',
    maxWidth: '100%',
  },
  metaPillText: { fontSize: 12, fontWeight: '700', color: '#334155', flexShrink: 1 },

  chipsFlow: {
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#9dbdfb',
  },
  rolePillText: { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    maxWidth: '100%',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusDotPulse: {
    // Static ring substitute — no continuous animation (battery friendly)
    shadowColor: '#10b981',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  detailInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  detailElapsed: {
    fontSize: 12.5,
    color: '#047857',
    fontWeight: '700',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  detailLate: { fontSize: 12.5, color: '#c2410c', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  punchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 100,
    backgroundColor: '#2563eb',
  },
  punchBtnPressed: { backgroundColor: '#1d4ed8' },
  punchBtnDisabled: { opacity: 0.7 },
  punchBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  punchMsg: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },

  statsRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statTile: {
    width: '48%',
    minWidth: 140,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eefb',
    paddingHorizontal: 12,
    paddingVertical: 12,
    // Soft elevation (iOS + Android)
    shadowColor: '#0f2142',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  statCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statMeta: { flexShrink: 1 },
  statValue: { fontSize: 18, fontWeight: '800', color: '#000000', fontVariant: ['tabular-nums'], lineHeight: 21 },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#000000',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 1,
  },
});

export default DashboardHero;
