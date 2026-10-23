import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  Percent,
  Sun,
  Sunset,
  Umbrella,
  User,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useClock } from '../context/ClockContext'
import { useAttendancePunch } from '../hooks/useAttendancePunch'
import { getLeaveRequestsByUser } from '../services/leaveService'
import { roleDepartmentLabel } from '../utils/roleLabels'
import { parseWeekendDays, toDateKey } from '../utils/workingDays'
import { resolveCharacterMode } from '../utils/characterMode'
import {
  formatElapsed,
  formatInZone,
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
   * Show the personal attendance section (status chip, check-in/out actions,
   * live Working Mode). Master Admin and Company Admin do not punch in from the
   * dashboard, so they pass false — they render a static "Not Checked In" chip.
   */
  showAttendance?: boolean
}

/* ------------------------------------------------------------------ */
/* Reference sky — CSS sun/moon orbs + seeded DOM stars + 2-layer hills */
/* ------------------------------------------------------------------ */

/**
 * Deterministic star field (reference `HeroBanner`): seeded so re-renders
 * never make the stars jump around. 45 stars, two sizes, twinkle delay and
 * duration baked in. Purely decorative (`aria-hidden` container).
 */
function useSkyStars() {
  return useMemo(() => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    return Array.from({ length: 45 }, () => {
      const size = rnd() > 0.85 ? 3 : 2
      return {
        left: `${(rnd() * 100).toFixed(2)}%`,
        top: `${(rnd() * 100).toFixed(2)}%`,
        size,
        delay: `${(rnd() * 4).toFixed(2)}s`,
        dur: `${(2.6 + rnd() * 3).toFixed(2)}s`,
      }
    })
  }, [])
}

/* Inline icons from the reference markup — tiny stroke SVGs, no icon lib. */
const PersonIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
)
const CalendarIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)
const PinIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

/* ------------------------------------------------------------------ */
/* Bottom scenery — 3 mountain ridges + conifer tree line + soft clouds */
/* ------------------------------------------------------------------ */

/* Layered mountain silhouettes (far → near), anchored to the bottom. */
const RIDGE_FAR =
  'M0 200 L0 128 L90 96 L200 122 L310 84 L430 118 L540 92 L660 124 L780 88 L900 120 L1020 94 L1120 118 L1200 100 L1200 200 Z'
const RIDGE_MID =
  'M0 200 L0 152 L120 124 L250 150 L380 118 L520 148 L650 122 L800 152 L930 126 L1070 150 L1200 130 L1200 200 Z'
const RIDGE_NEAR =
  'M0 200 L0 172 L140 150 L300 172 L460 146 L620 170 L790 148 L950 172 L1110 152 L1200 166 L1200 200 Z'

/**
 * Jagged conifer tree line along the very bottom — deterministic (fixed seed)
 * so the silhouette never jumps between re-renders. Built once at module load.
 */
const TREE_LINE = (() => {
  let seed = 13
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let d = 'M0 200 L0 184'
  for (let x = 0; x < 1200; x += 7) {
    const h = 6 + rnd() * 16
    d += ` L${x + 3.5} ${(184 - h).toFixed(1)} L${x + 7} ${(185 - h * 0.3).toFixed(1)}`
  }
  return d + ' L1200 200 Z'
})()

/**
 * Soft blurred cloud puffs — white and fluffy by day, dark wisps hugging the
 * moon at night (matches the reference art). Slow drift, disabled under
 * reduced motion.
 */
const Clouds = ({ theme }: { theme: DayPeriod }) => {
  const day = theme === 'morning' || theme === 'afternoon'
  const evening = theme === 'evening'
  const fill = day ? '#ffffff' : evening ? '#2a2144' : '#0b1a38'
  const puff = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    opacity: number,
  ) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} opacity={opacity} />

  return (
    <svg className="clouds" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <filter id="dh-cloud-blur" x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>
      <g filter="url(#dh-cloud-blur)" fill={fill}>
        <g className="cg-a">
          {day ? (
            <>
              {puff(200, 44, 74, 13, 0.95)}
              {puff(246, 36, 48, 11, 0.95)}
              {puff(166, 40, 40, 9, 0.9)}
            </>
          ) : (
            <>
              {puff(300, 64, 140, 9, 0.35)}
              {puff(210, 74, 90, 7, 0.28)}
            </>
          )}
        </g>
        <g className="cg-b">
          {day ? (
            <>
              {puff(640, 30, 62, 11, 0.9)}
              {puff(684, 24, 40, 9, 0.85)}
            </>
          ) : (
            <>
              {puff(1020, 66, 116, 10, 0.5)}
              {puff(1140, 82, 92, 8, 0.42)}
            </>
          )}
        </g>
        <g className="cg-c">
          {day ? (
            <>
              {puff(960, 118, 86, 12, 0.8)}
              {puff(1010, 110, 52, 10, 0.75)}
            </>
          ) : (
            <>
              {puff(760, 96, 120, 8, 0.3)}
              {puff(1080, 40, 70, 6, 0.25)}
            </>
          )}
        </g>
      </g>
    </svg>
  )
}

/** Period icon shown before the clock time (moon / sun / sunset). */
const periodIcon = (theme: DayPeriod) => {
  if (theme === 'night') return <Moon className="time-icon" aria-hidden="true" />
  if (theme === 'evening') return <Sunset className="time-icon" aria-hidden="true" />
  return <Sun className="time-icon" aria-hidden="true" />
}

/** Stat label icon — matches the reference strip (person, user-x, umbrella, …). */
const statIcon = (label: string) => {
  const l = label.toLowerCase()
  if (l.includes('present')) return <User size={17} />
  if (l.includes('absent') || l.includes('inactive')) return <UserX size={17} />
  if (l.includes('leave')) return <Umbrella size={17} />
  if (l.includes('task')) return <ClipboardList size={17} />
  if (l.includes('rate') || l.includes('month')) return <Percent size={17} />
  if (l.includes('active')) return <UserCheck size={17} />
  if (l.includes('team')) return <Users size={17} />
  if (l.includes('approved')) return <CheckCircle2 size={17} />
  return <BarChart3 size={17} />
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
/* Attendance slice (employees) — reference chips + live punch actions */
/* ------------------------------------------------------------------ */

function HeroAttendance({ badge }: { badge: string }) {
  const { tz, dateLong } = useClock()
  const { todayRecord, loading, checkingIn, checkingOut, checkIn, checkOut, msg } = useAttendancePunch()
  const day = useDayContext()

  const hasIn = !!todayRecord?.checkIn
  const hasOut = !!todayRecord?.checkOut

  // Single authoritative mode — resolved from backend records only (drives the
  // status chip and the detail line).
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
    ? Date.now() - toDate(todayRecord!.checkIn)!.getTime()
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
      <div className="chips">
        <span className="chip role">
          {PersonIcon} <span>{badge}</span>
        </span>
        <span className={`chip${hasIn ? ' in' : ''}`} data-state={pillState} role="status" aria-live="polite">
          <i aria-hidden="true" /> {pillText}
        </span>
      </div>

      {/* Detail line per mode — live attendance facts (never invented) */}
      {working && (
        <div className="hero-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>Checked in at {fmtPunchTime(todayRecord?.checkIn, tz)}</span>
          <span aria-hidden="true">·</span>
          <span className="hero-elapsed">{formatElapsed(elapsedMs)} elapsed</span>
        </div>
      )}
      {mode === 'complete' && (
        <div className="hero-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>In {fmtPunchTime(todayRecord?.checkIn, tz)}</span>
          <span aria-hidden="true">·</span>
          <span>Out {fmtPunchTime(todayRecord?.checkOut, tz)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatElapsed(workedMs)} worked</span>
        </div>
      )}
      {mode === 'on_leave' && (
        <div className="hero-detail">
          <Umbrella size={14} aria-hidden="true" />
          <span>{day.halfDayLeave && !day.onApprovedLeave ? 'Approved half-day leave today' : 'Approved leave today'}</span>
        </div>
      )}
      {mode === 'holiday' && (
        <div className="hero-detail">
          <Calendar size={14} aria-hidden="true" />
          <span>{resolved.pill} · {dateLong}</span>
        </div>
      )}
      {mode === 'resting' && (
        <div className="hero-detail">
          <Clock3 size={14} aria-hidden="true" />
          <span>You are not currently working.</span>
        </div>
      )}

      {/* Punch actions — the employee check-in/out entry point */}
      {(showCheckIn || showCheckOut) && (
        <div className="hero-actions">
          {showCheckIn && (
            <button type="button" className="hero-btn" onClick={() => void checkIn()} disabled={checkingIn}>
              {checkingIn ? <Loader2 size={15} className="hero-spin" aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
              {checkingIn ? 'Checking in…' : 'Check In'}
            </button>
          )}
          {showCheckOut && (
            <button type="button" className="hero-btn" onClick={() => void checkOut()} disabled={checkingOut}>
              {checkingOut ? <Loader2 size={15} className="hero-spin" aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />}
              {checkingOut ? 'Checking out…' : 'Check Out'}
            </button>
          )}
          {msg && (
            <span className="hero-msg" data-type={msg.type} role={msg.type === 'error' ? 'alert' : undefined}>
              {msg.type === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {msg.text}
            </span>
          )}
        </div>
      )}
      {!showCheckIn && !showCheckOut && msg && (
        <div className="hero-actions">
          <span className="hero-msg" data-type={msg.type} role={msg.type === 'error' ? 'alert' : undefined}>
            {msg.type === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {msg.text}
          </span>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Hero — ported from the hrmax-hero reference (HeroBanner.jsx)        */
/* ------------------------------------------------------------------ */

export function DashboardHero({ stats, badge, showAttendance = true }: DashboardHeroProps) {
  const { user } = useAuth()
  // Shared clock context — ONE time source for the header AND the hero, so
  // the two can never drift apart (hrmax-hero reference wiring).
  const { theme, time, dateLong, greeting, location, tempC } = useClock()
  const roleBadge = badge || roleDepartmentLabel(user)
  const stars = useSkyStars()
  const hasLoc = !!location
  const hasTemp = tempC != null

  // Publish the hero's live height so scroll offsets (html scroll-padding)
  // always clear the sticky header + hero stack.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () => {
      document.documentElement.style.setProperty(
        '--hero-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      )
    }
    // Publish immediately (a hidden tab pauses rAF/RO delivery, so the
    // observer alone could leave the default until first paint), then keep
    // it fresh as the hero resizes (viewport, name length, stats, …).
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <section ref={ref} className="hero" data-theme={theme} aria-label="Welcome summary">
      <div className="sky" aria-hidden="true">
        <div className="stars">
          {stars.map((s, i) => (
            <i
              key={i}
              className="star"
              style={
                {
                  left: s.left,
                  top: s.top,
                  width: s.size,
                  height: s.size,
                  '--tw-delay': s.delay,
                  '--tw-dur': s.dur,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="orb sun" />
        <div className="orb moon" />
        <Clouds theme={theme} />
        {/* Layered scenery: 3 mountain ridges + conifer tree line — fills
            switch per theme in CSS */}
        <svg className="hills" viewBox="0 0 1200 200" preserveAspectRatio="none" focusable="false">
          <path className="h1" d={RIDGE_FAR} />
          <path className="h2" d={RIDGE_MID} />
          <path className="h3" d={RIDGE_NEAR} />
          <path className="tree" d={TREE_LINE} />
        </svg>
      </div>

      <div className="hero-main">
        <div className="welcome">
          <small>Welcome to,</small>
          <h2>{user?.name || roleDepartmentLabel(user) || 'User'}</h2>

          {showAttendance ? (
            <HeroAttendance badge={roleBadge} />
          ) : (
            /* Master Admin / Company Admin — static chips (no attendance slice). */
            <div className="chips">
              <span className="chip role">
                {PersonIcon} <span>{roleBadge}</span>
              </span>
              <span className="chip" data-state="idle" role="status">
                <i aria-hidden="true" /> Not Checked In
              </span>
            </div>
          )}
        </div>

        <div className="when">
          <div className="time">
            {periodIcon(theme)}
            <span>{time}</span>
          </div>
          <div className="row date">
            {CalendarIcon}
            <span>{dateLong}</span>
          </div>
          {(hasLoc || hasTemp) && (
            <div className="row loc">
              {PinIcon}
              <span>
                {location}
                {hasLoc && hasTemp && ' · '}
                {hasTemp && `${Math.round(tempC!)}°C`}
              </span>
            </div>
          )}
          <div className="greet">{greeting}</div>
        </div>
      </div>

      <div className="stats" role="list" aria-label="Dashboard statistics">
        {stats.map((s) => (
          <div key={s.label} className="stat" role="listitem">
            <div className="n" style={{ color: s.color }}>
              {s.value ?? '–'}
            </div>
            <div className="l">
              {statIcon(s.label)}
              <span>{s.label}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default DashboardHero
