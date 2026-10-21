import { memo, useEffect, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Percent,
  Sun,
  Sunset,
  Umbrella,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useAttendancePunch } from '../hooks/useAttendancePunch'
import { getLeaveRequestsByUser } from '../services/leaveService'
import { roleDepartmentLabel } from '../utils/roleLabels'
import { parseWeekendDays, toDateKey } from '../utils/workingDays'
import { resolveCharacterMode, type CharacterMode } from '../utils/characterMode'
import {
  effectiveTimezone,
  formatElapsed,
  formatInZone,
  getHeroScene,
  resolveCompanyTimezone,
  resolveCompanyWeekends,
  toDate,
  type DayPeriod,
} from '../utils/heroScene'
import './DashboardHero.css'

export interface DashboardHeroStat {
  label: string
  value: string | number
  color: string
}

interface DashboardHeroProps {
  /** Real database values supplied by each role's dashboard — never hardcoded. */
  stats: DashboardHeroStat[]
  /** Override for the role badge (defaults to the user's role • department). */
  badge?: string
  /**
   * Show the personal attendance section (status pill, check-in/out actions,
   * live Working Mode). Master Admin and Company Admin do not punch in from the
   * dashboard, so they pass false — they render a resting illustration and a
   * static "Not Checked In" pill.
   */
  showAttendance?: boolean
}

/* ------------------------------------------------------------------ */
/* Time-based decorative sky (independent of attendance state)         */
/* ------------------------------------------------------------------ */

const Landscape = memo(function Landscape({ period }: { period: DayPeriod }) {
  const night = period === 'night'
  const evening = period === 'evening'

  if (night) {
    return (
      <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        {[
          [26, 22], [70, 40], [120, 16], [176, 36], [228, 14],
          [272, 44], [320, 20], [364, 38], [100, 60], [300, 64],
        ].map(([cx, cy], i) => (
          <circle key={i} className="dh-star" cx={cx} cy={cy} r={i % 3 === 0 ? 1.4 : 1} fill="#e8eeff" style={{ animationDelay: `${(i % 5) * 0.7}s` }} />
        ))}
        {/* Moon with crescent */}
        <circle cx="330" cy="30" r="16" fill="#f5f3d8" />
        <circle cx="322" cy="26" r="13" fill="#0d1430" opacity="0.92" />
        {/* City skyline with lit windows */}
        <g fill="#0a1128">
          {[34, 54, 30, 46, 26, 50, 34, 58, 30, 42].map((h, i) => (
            <rect key={i} x={12 + i * 38} y={200 - h} width={26} height={h} rx={2} />
          ))}
        </g>
        <g fill="#ffd58a" opacity="0.85">
          <rect x="20" y="176" width="4" height="5" /><rect x="96" y="168" width="4" height="5" />
          <rect x="172" y="180" width="4" height="5" /><rect x="248" y="172" width="4" height="5" />
          <rect x="324" y="178" width="4" height="5" />
        </g>
      </svg>
    )
  }

  if (evening) {
    return (
      <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <circle cx="60" cy="168" r="42" fill="#ffb347" opacity="0.28" />
        <circle cx="60" cy="172" r="22" fill="#ffb347" />
        <ellipse cx="150" cy="54" rx="42" ry="10" fill="#ffffff" opacity="0.55" />
        <ellipse cx="182" cy="48" rx="26" ry="7" fill="#ffffff" opacity="0.4" />
        <path d="M0 176 Q100 160 200 172 T400 168 L400 200 L0 200 Z" fill="#2c1e4e" opacity="0.75" />
      </svg>
    )
  }

  // morning / afternoon — sun high right, soft drifting clouds
  return (
    <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle cx="340" cy="42" r="46" fill="#fff6c8" opacity="0.28" />
      <circle cx="340" cy="42" r="22" fill="#fffbe8" />
      <ellipse cx="90" cy="70" rx="46" ry="10" fill="#ffffff" opacity="0.7" />
      <ellipse cx="126" cy="64" rx="28" ry="7" fill="#ffffff" opacity="0.5" />
      <ellipse cx="250" cy="100" rx="38" ry="9" fill="#ffffff" opacity="0.6" />
    </svg>
  )
})

/* ------------------------------------------------------------------ */
/* Employee character — one identity, five poses (SECTION 5B)          */
/* ------------------------------------------------------------------ */

const Character = memo(function Character({ mode }: { mode: CharacterMode }) {
  const skin = '#f0c09a'
  const hair = '#2b2b3a'
  const casual = mode === 'on_leave' || mode === 'holiday'
  const shirt = casual ? '#3f7d5a' : '#33507e'
  const shirtDark = casual ? '#356a4d' : '#2b4470'

  return (
    <svg className="dh-person-svg" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      {/* ── Shared desk ─────────────────────────────────────────── */}
      <rect x="38" y="92" width="172" height="7" rx="3.5" fill="#ffffff" opacity="0.9" />
      <rect x="50" y="99" width="6" height="34" rx="3" fill="#ffffff" opacity="0.6" />
      <rect x="192" y="99" width="6" height="34" rx="3" fill="#ffffff" opacity="0.6" />

      {/* ── Shared chair (back view) ────────────────────────────── */}
      <path d="M80 40 q-12 8 -12 30 l0 22 h12 l0 -22 q0 -22 12 -30 z" fill="#0f172a" opacity="0.8" />
      <rect x="82" y="90" width="50" height="6" rx="3" fill="#0f172a" opacity="0.8" />

      {/* ── Shared desk plant ───────────────────────────────────── */}
      <path d="M42 82 l3 10 h12 l3 -10 z" fill="#ffffff" opacity="0.85" />
      <ellipse cx="51" cy="72" rx="7" ry="11" fill="#bbf7d0" opacity="0.85" />
      <ellipse cx="44" cy="76" rx="5" ry="8" fill="#86efac" opacity="0.8" />
      <ellipse cx="58" cy="76" rx="5" ry="8" fill="#86efac" opacity="0.8" />

      {/* ── Person (pose varies by mode; same identity) ─────────── */}
      {(() => {
        const head = (cx: number, cy: number) => (
          <>
            <circle cx={cx} cy={cy} r="12" fill={skin} />
            <path d={`M${cx - 12} ${cy - 2} q2 -14 12 -14 q12 0 13 14 q-6 -6 -13 -5 q-8 1 -12 5 z`} fill={hair} />
          </>
        )
        const eyes = (cx: number, cy: number) => (
          <>
            <circle cx={cx - 3} cy={cy + 1} r="1.2" fill="#2b2b3a" />
            <circle cx={cx + 3} cy={cy + 1} r="1.2" fill="#2b2b3a" />
          </>
        )

        if (mode === 'working') {
          return (
            <g>
              <path d="M108 54 q10 -4 22 0 l3 38 h-30 z" fill={shirt} />
              {head(118, 40)}
              <path d="M126 62 L150 82" stroke={shirtDark} strokeWidth="6" strokeLinecap="round" />
              <path d="M122 64 L148 84" stroke={shirt} strokeWidth="6" strokeLinecap="round" />
              <circle cx="152" cy="83" r="4" fill={skin} />
              <circle cx="150" cy="85" r="4" fill={skin} />
              {eyes(118, 40)}
              <path d="M117 45 h4" stroke="#2b2b3a" strokeWidth="1" strokeLinecap="round" />
            </g>
          )
        }
        if (mode === 'complete') {
          return (
            <g>
              <path d="M106 54 q10 -5 22 0 l3 38 h-31 z" fill={shirt} />
              {head(116, 40)}
              <path d="M126 62 q10 0 8 -12" stroke={shirt} strokeWidth="6" strokeLinecap="round" fill="none" />
              <circle cx="133" cy="48" r="5" fill={skin} />
              <rect x="132" y="41" width="3.4" height="8" rx="1.7" fill={skin} />
              {eyes(116, 40)}
              <path d="M113 45 q3 3.5 6 0" stroke="#2b2b3a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </g>
          )
        }
        if (mode === 'on_leave') {
          return (
            <g>
              <path d="M102 54 q12 -4 24 0 l4 38 h-34 z" fill={shirt} />
              {head(112, 40)}
              <path d="M124 60 q9 2 7 -8" stroke={shirt} strokeWidth="6" strokeLinecap="round" fill="none" />
              <circle cx="130" cy="50" r="4" fill={skin} />
              {eyes(112, 40)}
              <path d="M109 45 q3 2.5 6 0" stroke="#2b2b3a" strokeWidth="1.1" fill="none" strokeLinecap="round" />
            </g>
          )
        }
        if (mode === 'holiday') {
          return (
            <g>
              <path d="M104 54 q12 -4 24 0 l3 38 h-32 z" fill={shirt} />
              {head(114, 40)}
              <path d="M104 58 q-6 -14 8 -18" stroke={shirtDark} strokeWidth="6" strokeLinecap="round" fill="none" />
              <path d="M128 58 q6 -14 -8 -18" stroke={shirtDark} strokeWidth="6" strokeLinecap="round" fill="none" />
              {eyes(114, 40)}
              <path d="M111 45 q3 3.5 6 0" stroke="#2b2b3a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </g>
          )
        }
        // resting (default)
        return (
          <g>
            <path d="M104 54 q10 -6 22 0 l4 38 h-32 z" fill={shirt} />
            {head(112, 40)}
            <path d="M124 60 q10 2 8 -8" stroke={shirt} strokeWidth="6" strokeLinecap="round" fill="none" />
            <circle cx="132" cy="50" r="4" fill={skin} />
            {eyes(112, 40)}
            <path d="M110 45 q2 1.5 4 0" stroke="#2b2b3a" strokeWidth="1" fill="none" strokeLinecap="round" />
          </g>
        )
      })()}

      {/* ── Mug (held for rest/leave, on desk for working) ──────── */}
      {(mode === 'resting' || mode === 'on_leave') && (
        <g>
          <rect x="126" y="44" width="9" height="8" rx="1.5" fill="#ffffff" opacity="0.95" />
          <path className="dh-steam" d="M130 42 q3 -4 0 -8" stroke="#ffffff" strokeWidth="1.4" fill="none" opacity="0.6" strokeLinecap="round" />
        </g>
      )}

      {/* ── Laptop (state per mode) ─────────────────────────────── */}
      {mode === 'working' ? (
        <g>
          <rect x="150" y="86" width="40" height="5" rx="2.5" fill="#0f172a" opacity="0.9" />
          <rect x="152" y="62" width="34" height="24" rx="2" fill="#0f172a" opacity="0.9" />
          <rect className="dh-screen-glow" x="155" y="65" width="28" height="18" rx="1.5" fill="#7dd3fc" opacity="0.9" />
          <rect x="158" y="68" width="12" height="3" rx="1.5" fill="#0b3a6b" />
          <rect x="158" y="73" width="20" height="2" rx="1" fill="#0b3a6b" opacity="0.6" />
        </g>
      ) : mode === 'resting' ? (
        <g>
          <rect x="152" y="86" width="40" height="5" rx="2.5" fill="#0f172a" opacity="0.9" />
          <rect x="155" y="64" width="31" height="22" rx="2" fill="#0f172a" opacity="0.9" />
          <rect x="158" y="67" width="25" height="16" rx="1.5" fill="#1e293b" />
          <circle cx="170" cy="75" r="1.6" fill="#f59e0b" opacity="0.7" />
        </g>
      ) : (
        // complete / on_leave / holiday — laptop closed
        <g>
          <rect x="152" y="88" width="40" height="5" rx="2" fill="#0f172a" opacity="0.9" />
          <rect x="155" y="83" width="34" height="5" rx="2" fill="#334155" opacity="0.9" />
        </g>
      )}
    </svg>
  )
})

/* ------------------------------------------------------------------ */
/* Status pill metadata (SECTION 5B — five modes)                      */
/* ------------------------------------------------------------------ */

const MODE_PILL: Record<CharacterMode, string> = {
  resting: 'Not Checked In',
  working: 'Working',
  complete: 'Checked Out',
  on_leave: 'On Leave',
  holiday: 'Off',
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const statIcon = (label: string) => {
  const l = label.toLowerCase()
  if (l.includes('present')) return <CalendarCheck size={13} />
  if (l.includes('absent') || l.includes('inactive')) return <UserX size={13} />
  if (l.includes('leave')) return <Umbrella size={13} />
  if (l.includes('task')) return <ClipboardList size={13} />
  if (l.includes('rate') || l.includes('month')) return <Percent size={13} />
  if (l.includes('active')) return <UserCheck size={13} />
  if (l.includes('team')) return <Users size={13} />
  if (l.includes('approved')) return <CheckCircle2 size={13} />
  return <BarChart3 size={13} />
}

const periodIcon = (period: DayPeriod) => {
  if (period === 'night') return <Moon size={26} className="dh-clock-icon" aria-hidden="true" />
  if (period === 'evening') return <Sunset size={26} className="dh-clock-icon" aria-hidden="true" />
  return <Sun size={26} className="dh-clock-icon" aria-hidden="true" />
}

const fmtClockTime = (d: Date, tz: string | null) =>
  formatInZone(d, tz, { hour: '2-digit', minute: '2-digit', hour12: true })
const fmtClockDate = (d: Date, tz: string | null) =>
  `${formatInZone(d, tz, { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatInZone(d, tz, { weekday: 'short' })}`
const fmtPunchTime = (value: Parameters<typeof toDate>[0], tz: string | null) => {
  const d = toDate(value)
  return d ? formatInZone(d, tz, { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'
}

const toDateValue = (v: unknown): Date | null => {
  const any = v as { toDate?: () => Date } | Date | string | number | null
  if (!any) return null
  if (typeof any === 'object' && 'toDate' in any && typeof any.toDate === 'function') return any.toDate()
  const d = new Date(any as string | number | Date)
  return isNaN(d.getTime()) ? null : d
}

/* ------------------------------------------------------------------ */
/* Day context — approved leave + holiday + weekly-off (backend data)  */
/* ------------------------------------------------------------------ */

interface DayContext {
  onApprovedLeave: boolean
  halfDayLeave: boolean
  isHoliday: boolean
  holidayLabel?: string
  isWeeklyOff: boolean
  weekendLabel?: string
}

const EMPTY_DAY: DayContext = {
  onApprovedLeave: false,
  halfDayLeave: false,
  isHoliday: false,
  isWeeklyOff: false,
}

/**
 * Loads the non-attendance facts the character resolver needs: an APPROVED
 * leave covering today (pending/rejected never count), the company holiday
 * for today, and the assigned weekly-off day. All reads are best-effort — if
 * a source is unavailable the flag stays false and the mode falls back to the
 * attendance flow, so the app never breaks or invents a state.
 */
function useDayContext(): DayContext {
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const [ctx, setCtx] = useState<DayContext>(EMPTY_DAY)

  useEffect(() => {
    let dead = false
    const uid = user?.id
    const cid = effectiveCompanyId || user?.companyId || ''
    if (!uid) return

    // Approved leave covering today.
    getLeaveRequestsByUser(uid)
      .then((leaves) => {
        if (dead) return
        const key = new Date().toDateString()
        const covering = leaves.filter(
          (l) =>
            l.status === 'Approved' &&
            new Date(l.startDate).toDateString() <= key &&
            new Date(l.endDate).toDateString() >= key,
        )
        const full = covering.some((l) => (l.totalDays ?? 1) >= 1)
        const half = covering.some((l) => (l.totalDays ?? 1) < 1)
        setCtx((p) => ({ ...p, onApprovedLeave: full, halfDayLeave: half }))
      })
      .catch(() => {})

    // Company holiday for today.
    if (cid) {
      getDocs(query(collection(db, 'holidays'), where('companyId', '==', cid)))
        .then((snap) => {
          if (dead) return
          const todayKey = toDateKey(new Date())
          const hit = snap.docs
            .map((d) => d.data() as { name?: string; date?: unknown })
            .find((h) => {
              const dt = toDateValue(h.date)
              return dt ? toDateKey(dt) === todayKey : false
            })
          setCtx((p) => ({ ...p, isHoliday: !!hit, holidayLabel: hit?.name }))
        })
        .catch(() => {})
    }

    // Weekly off — read the company's configured schedule from `companies/{id}`
    // (readable via company.view for every role). Never infer a non-working day
    // from the weekday alone (SECTION 5B).
    if (cid) {
      resolveCompanyWeekends(cid)
        .then((weekends) => {
          if (dead || !weekends || weekends.length === 0) return
          const idxs = parseWeekendDays(weekends)
          const isOff = idxs.includes(new Date().getDay())
          setCtx((p) => ({
            ...p,
            isWeeklyOff: isOff,
            weekendLabel: isOff ? new Date().toLocaleDateString(undefined, { weekday: 'long' }) : undefined,
          }))
        })
        .catch(() => {})
    }

    return () => {
      dead = true
    }
  }, [user?.id, user?.companyId, effectiveCompanyId])

  return ctx
}

/* ------------------------------------------------------------------ */
/* Attendance slice (employees) — resolves the mode and renders it     */
/* ------------------------------------------------------------------ */

function HeroAttendance({ badge, tz, now }: { badge: string; tz: string | null; now: Date }) {
  const { todayRecord, loading, checkingIn, checkingOut, checkIn, checkOut, msg } = useAttendancePunch()
  const day = useDayContext()

  const hasIn = !!todayRecord?.checkIn
  const hasOut = !!todayRecord?.checkOut

  // Single authoritative mode — resolved from backend records only.
  const resolved = resolveCharacterMode({
    hasCheckIn: hasIn,
    hasCheckOut: hasOut,
    onApprovedLeave: day.onApprovedLeave,
    halfDayLeave: day.halfDayLeave,
    isHoliday: day.isHoliday,
    holidayLabel: day.holidayLabel,
    isWeeklyOff: day.isWeeklyOff,
    weekendLabel: day.weekendLabel,
  })
  const mode = resolved.mode
  const working = mode === 'working'

  const elapsedMs = working && toDate(todayRecord?.checkIn)
    ? now.getTime() - toDate(todayRecord!.checkIn)!.getTime()
    : 0
  const workedMs =
    hasIn && hasOut && toDate(todayRecord?.checkIn) && toDate(todayRecord?.checkOut)
      ? toDate(todayRecord!.checkOut)!.getTime() - toDate(todayRecord!.checkIn)!.getTime()
      : 0

  const pillText = loading ? 'Loading…' : resolved.pill
  const pillState = loading ? 'loading' : resolved.pillState
  const showCheckIn = !loading && resolved.canCheckIn
  const showCheckOut = !loading && resolved.canCheckOut

  return (
    <>
      <div className="dh-badges">
        <span className="dh-role">
          <Users size={13} aria-hidden="true" /> {badge}
        </span>
        <span className="dh-status" data-state={pillState} role="status" aria-live="polite">
          <i className="dh-status-dot" aria-hidden="true" /> {pillText}
        </span>
      </div>

      {/* Detail line per mode */}
      {working && (
        <div className="dh-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>Checked in at {fmtPunchTime(todayRecord?.checkIn, tz)}</span>
          <span aria-hidden="true">·</span>
          <span className="dh-elapsed">{formatElapsed(elapsedMs)} elapsed</span>
        </div>
      )}
      {mode === 'complete' && (
        <div className="dh-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>In {fmtPunchTime(todayRecord?.checkIn, tz)}</span>
          <span aria-hidden="true">·</span>
          <span>Out {fmtPunchTime(todayRecord?.checkOut, tz)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatElapsed(workedMs)} worked</span>
        </div>
      )}
      {mode === 'on_leave' && (
        <div className="dh-detail">
          <Umbrella size={14} aria-hidden="true" />
          <span>{day.halfDayLeave && !day.onApprovedLeave ? 'Approved half-day leave today' : 'Approved leave today'}</span>
        </div>
      )}
      {mode === 'holiday' && (
        <div className="dh-detail">
          <Calendar size={14} aria-hidden="true" />
          <span>{resolved.pill} · {fmtClockDate(now, tz)}</span>
        </div>
      )}
      {mode === 'resting' && (
        <div className="dh-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>You are not currently working.</span>
        </div>
      )}

      {/* Punch actions */}
      {(showCheckIn || showCheckOut) && (
        <div className="dh-actions">
          {showCheckIn && (
            <button type="button" className="dh-btn" onClick={() => void checkIn()} disabled={checkingIn}>
              {checkingIn ? <Loader2 size={15} className="dh-spin" aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
              {checkingIn ? 'Checking in…' : 'Check In'}
            </button>
          )}
          {showCheckOut && (
            <button type="button" className="dh-btn" onClick={() => void checkOut()} disabled={checkingOut}>
              {checkingOut ? <Loader2 size={15} className="dh-spin" aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />}
              {checkingOut ? 'Checking out…' : 'Check Out'}
            </button>
          )}
          {msg && (
            <span className="dh-msg" data-type={msg.type} role={msg.type === 'error' ? 'alert' : undefined}>
              {msg.type === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {msg.text}
            </span>
          )}
        </div>
      )}
      {!showCheckIn && !showCheckOut && msg && (
        <div className="dh-actions">
          <span className="dh-msg" data-type={msg.type} role={msg.type === 'error' ? 'alert' : undefined}>
            {msg.type === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {msg.text}
          </span>
        </div>
      )}

      {/* Character illustration — Working ONLY on server-confirmed check-in */}
      <div className="dh-worker" data-mode={working ? 'work' : 'rest'} aria-hidden="true">
        <Character mode={mode} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export function DashboardHero({ stats, badge, showAttendance = true }: DashboardHeroProps) {
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const [companyTz, setCompanyTz] = useState<string | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    let dead = false
    resolveCompanyTimezone(effectiveCompanyId || user?.companyId)
      .then((tz) => {
        if (!dead) setCompanyTz(tz)
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [effectiveCompanyId, user?.companyId])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    const onVisible = () => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const tz = effectiveTimezone(companyTz)
  const { period, greeting } = getHeroScene(now, tz)
  const roleBadge = badge || roleDepartmentLabel(user)

  return (
    <section className="dh" data-period={period} aria-label="Welcome summary">
      <div className="dh-scene" aria-hidden="true" />
      <Landscape period={period} />
      <div className="dh-scrim" aria-hidden="true" />

      <div className="dh-inner">
        <div className="dh-main">
          <span className="dh-greeting">Welcome back,</span>
          <h2 className="dh-name">{user?.name || 'User'}</h2>

          {showAttendance ? (
            <HeroAttendance badge={roleBadge} tz={tz} now={now} />
          ) : (
            <>
              {/* Admins (Master / Company): resting character + static pill, no punch. */}
              <div className="dh-badges">
                <span className="dh-role">
                  <Users size={13} aria-hidden="true" /> {roleBadge}
                </span>
                <span className="dh-status" data-state="idle" role="status">
                  <i className="dh-status-dot" aria-hidden="true" /> Not Checked In
                </span>
              </div>
              <div className="dh-worker" data-mode="rest" aria-hidden="true">
                <Character mode="resting" />
              </div>
            </>
          )}
        </div>

        <div className="dh-side">
          <div className="dh-clock">
            <div className="dh-clock-time-row">
              {periodIcon(period)}
              <span className="dh-clock-time">{fmtClockTime(now, tz)}</span>
            </div>
            <span className="dh-clock-date">
              <Calendar size={14} aria-hidden="true" /> {fmtClockDate(now, tz)}
            </span>
            <span className="dh-clock-greeting">
              <MapPin size={14} aria-hidden="true" /> {greeting}
            </span>
          </div>
        </div>

        <div className="dh-stats" role="list" aria-label="Dashboard statistics">
          {stats.map((s) => (
            <div key={s.label} className="dh-stat" role="listitem">
              <span className="dh-stat-value" style={{ color: s.color }}>
                {s.value}
              </span>
              <span className="dh-stat-label">
                {statIcon(s.label)} {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default DashboardHero
