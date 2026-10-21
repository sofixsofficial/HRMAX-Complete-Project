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

  if (night) {
    return (
      <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        {/* Moon — subtle crescent */}
        <circle cx="336" cy="40" r="15" fill="#f5f3d8" opacity="0.85" />
        <circle cx="329" cy="36" r="12" fill="#0d1430" opacity="0.9" />
        {/* Very faint, slow-drifting clouds */}
        <ellipse className="dh-cloud dh-cloud-a" cx="120" cy="76" rx="44" ry="9" fill="#ffffff" opacity="0.05" />
        <ellipse className="dh-cloud dh-cloud-b" cx="256" cy="120" rx="34" ry="7" fill="#ffffff" opacity="0.04" />
      </svg>
    )
  }

  // Day / evening — soft sun + slow, unobtrusive clouds (position follows the
  // scene gradient's glow so the light source feels coherent).
  const sunX = period === 'evening' ? 64 : period === 'afternoon' ? 344 : 328
  const sunY = period === 'evening' ? 172 : period === 'afternoon' ? 20 : 32
  return (
    <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle cx={sunX} cy={sunY} r="42" fill="#fff6c8" opacity="0.2" />
      <circle cx={sunX} cy={sunY} r="18" fill="#fffbe8" opacity="0.85" />
      <ellipse className="dh-cloud dh-cloud-a" cx="112" cy="74" rx="46" ry="10" fill="#ffffff" opacity="0.5" />
      <ellipse className="dh-cloud dh-cloud-b" cx="252" cy="116" rx="36" ry="8" fill="#ffffff" opacity="0.38" />
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

  // Small head + longer torso = natural seated proportions (reads as a
  // realistic office illustration, not a cartoon). Same identity in all poses.
  const head = (cx: number, cy: number) => (
    <>
      <circle cx={cx} cy={cy} r={7.5} fill={skin} />
      <path
        d={`M${cx - 7.5} ${cy - 1.5} q0.5 -8 7.5 -8 q7.5 0 7.5 8 q-3.5 -4.2 -7.5 -3.8 q-4.5 0.4 -7.5 3.8 z`}
        fill={hair}
      />
    </>
  )
  const eyes = (cx: number, cy: number) => (
    <>
      <circle cx={cx - 2.5} cy={cy + 0.6} r={0.9} fill={hair} />
      <circle cx={cx + 2.5} cy={cy + 0.6} r={0.9} fill={hair} />
    </>
  )

  // Arm pose differs by mode; the body/head stay identical so the character is
  // unmistakably one person across all five states.
  const armPose = () => {
    if (mode === 'working') {
      return (
        <>
          <path d="M123 66 L140 82 L154 90" stroke={shirtDark} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx={155} cy={90} r={3.4} fill={skin} />
        </>
      )
    }
    if (mode === 'complete') {
      // Thumbs-up — day complete.
      return (
        <>
          <path d="M123 66 q9 3 5 -13" stroke={shirt} strokeWidth={5} strokeLinecap="round" fill="none" />
          <circle cx={127} cy={51} r={4} fill={skin} />
          <rect x={126} y={43.5} width={3} height={7} rx={1.5} fill={skin} />
        </>
      )
    }
    if (mode === 'holiday') {
      return <path d="M123 66 q10 7 6 18" stroke={shirtDark} strokeWidth={5} strokeLinecap="round" fill="none" />
    }
    // resting + on_leave — holding a warm mug.
    return (
      <>
        <path d="M123 66 q8 3 4 13" stroke={shirtDark} strokeWidth={5} strokeLinecap="round" fill="none" />
        <circle cx={126} cy={80} r={3.4} fill={skin} />
        <rect x={122.5} y={71} width={7} height={6} rx={1.5} fill="#ffffff" opacity={0.95} />
        <path className="dh-steam" d="M126 69 q2.5 -3 0 -6" stroke="#ffffff" strokeWidth={1.2} fill="none" opacity={0.55} strokeLinecap="round" />
      </>
    )
  }

  return (
    <svg className="dh-person-svg" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      {/* ── Chair (behind the person) ───────────────────────────── */}
      <rect x="88" y="58" width="9" height="44" rx="4" fill="#0f172a" opacity="0.68" />
      <rect x="92" y="95" width="48" height="6" rx="3" fill="#0f172a" opacity="0.68" />

      {/* ── Desk ────────────────────────────────────────────────── */}
      <rect x="40" y="98" width="160" height="6" rx="3" fill="#ffffff" opacity="0.9" />
      <rect x="52" y="104" width="5" height="32" rx="2.5" fill="#ffffff" opacity="0.5" />
      <rect x="183" y="104" width="5" height="32" rx="2.5" fill="#ffffff" opacity="0.5" />

      {/* ── Desk plant ──────────────────────────────────────────── */}
      <path d="M46 90 l3 8 h11 l3 -8 z" fill="#ffffff" opacity={0.8} />
      <ellipse cx="54" cy="82" rx="6" ry="9" fill="#bbf7d0" opacity={0.8} />
      <ellipse cx="48" cy="85" rx="4" ry="6" fill="#86efac" opacity={0.75} />
      <ellipse cx="60" cy="85" rx="4" ry="6" fill="#86efac" opacity={0.75} />

      {/* ── Person (seated, facing the laptop) ──────────────────── */}
      {(() => {
        const torso =
          mode === 'working' ? 'M106 60 q10 -4 20 0 l3 38 h-26 z' : 'M105 60 q11 -4 21 0 l4 38 h-29 z'
        const cx = mode === 'working' ? 117 : mode === 'complete' ? 116 : 114
        return (
          <g>
            <path d={torso} fill={shirt} />
            <rect x={cx - 2.5} y={55} width={5} height={6} fill={skin} />
            {head(cx, 50)}
            {eyes(cx, 50)}
            {armPose()}
          </g>
        )
      })()}

      {/* ── Laptop (state per mode) ─────────────────────────────── */}
      {mode === 'working' ? (
        <g>
          <rect x="154" y="94" width="40" height="4" rx="2" fill="#0f172a" opacity={0.9} />
          <rect x="156" y="72" width="34" height="22" rx="2" fill="#0f172a" opacity={0.9} />
          <rect className="dh-screen-glow" x="158" y="74" width="30" height="18" rx="1.5" fill="#7dd3fc" opacity={0.9} />
          <rect x="161" y="77" width="12" height="3" rx="1.5" fill="#0b3a6b" />
          <rect x="161" y="82" width="20" height="2" rx="1" fill="#0b3a6b" opacity={0.6} />
        </g>
      ) : mode === 'resting' ? (
        <g>
          <rect x="154" y="94" width="40" height="4" rx="2" fill="#0f172a" opacity={0.9} />
          <rect x="156" y="72" width="34" height="22" rx="2" fill="#0f172a" opacity={0.9} />
          <rect x="158" y="74" width="30" height="18" rx="1.5" fill="#1e293b" />
          <circle cx={173} cy={83} r={1.4} fill="#f59e0b" opacity={0.7} />
        </g>
      ) : (
        // complete / on_leave / holiday — laptop closed.
        <g>
          <rect x="154" y="94" width="40" height="4" rx="2" fill="#0f172a" opacity={0.9} />
          <rect x="157" y="89" width="34" height="5" rx="2" fill="#334155" opacity={0.9} />
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

function HeroAttendance({ badge, tz, now, onModeChange }: { badge: string; tz: string | null; now: Date; onModeChange?: (m: CharacterMode) => void }) {
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

  // Report the resolved mode up so the hero can place the character in its own
  // dedicated column (it can't live inside this slice's DOM flow without
  // overlapping the clock). setMode is stable, so this won't loop.
  useEffect(() => {
    onModeChange?.(mode)
  }, [mode, onModeChange])

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
  // The character pose, reported up by HeroAttendance (defaults to resting so
  // admins without an attendance slice, and the pre-load state, show resting).
  const [heroMode, setHeroMode] = useState<CharacterMode>('resting')

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
            <HeroAttendance badge={roleBadge} tz={tz} now={now} onModeChange={setHeroMode} />
          ) : (
            /* Company Admin: static pill; the resting character lives in the
               side column below the clock. */
            <div className="dh-badges">
              <span className="dh-role">
                <Users size={13} aria-hidden="true" /> {roleBadge}
              </span>
              <span className="dh-status" data-state="idle" role="status">
                <i className="dh-status-dot" aria-hidden="true" /> Not Checked In
              </span>
            </div>
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

          {/* Character — its own dedicated area under the clock, never
              overlapping the time, date, greeting, or status badges. */}
          <div className="dh-worker" data-mode={heroMode === 'working' ? 'work' : 'rest'} aria-hidden="true">
            <Character mode={heroMode} />
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
