import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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
  Percent,
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
/* Moon + mountain band cropped from the HRMAX design art (Night & Day
   Admin Dashboard.png) — the exact photographic scenery the design calls
   for; theme tints are applied via CSS filters. */
import moonUrl from '../assets/moon.png'
import ridgeUrl from '../assets/night-ridge.png'

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
 * Realistic star field: mostly faint pinpoints with a scattering of
 * brighter stars, a few with a soft glow, occasional warm-tinted ones —
 * seeded so re-renders never make the stars jump around. Purely
 * decorative (`aria-hidden` container).
 */
function useSkyStars() {
  return useMemo(() => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    return Array.from({ length: 72 }, () => {
      const bright = rnd() > 0.84
      return {
        left: `${(rnd() * 100).toFixed(2)}%`,
        top: `${(rnd() * 92).toFixed(2)}%`,
        size: Number((bright ? 2.2 + rnd() * 1.4 : 1 + rnd() * 1.3).toFixed(2)),
        opacity: (bright ? 0.85 + rnd() * 0.15 : 0.22 + rnd() * 0.55).toFixed(2),
        glow: bright && rnd() > 0.45,
        warm: rnd() > 0.91,
        delay: `${(rnd() * 6).toFixed(2)}s`,
        dur: `${(3 + rnd() * 4).toFixed(2)}s`,
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

/* ------------------------------------------------------------------ */
/* Wispy cloud masses — fractal-noise alpha thresholds shaped into      */
/* organic clouds. `currentColor` from CSS per theme: dark navy wisps   */
/* at night, white puffs by day, dusk violet at evening. Slow drift,    */
/* disabled under reduced motion.                                       */
/* ------------------------------------------------------------------ */
const Clouds = () => (
  <svg className="clouds" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <filter id="dh-cloud-a" x="-25%" y="-70%" width="150%" height="240%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.010 0.016" numOctaves="4" seed="17" result="t" />
        {/* alpha = 2.4·R − 1.4 → distinct puffs only where noise is strong */}
        <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -1.4" result="a" />
        <feGaussianBlur in="a" stdDeviation="3.2" result="b" />
        <feFlood floodColor="currentColor" result="f" />
        <feComposite in="f" in2="b" operator="in" />
      </filter>
      <filter id="dh-cloud-b" x="-25%" y="-70%" width="150%" height="240%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.007 0.03" numOctaves="4" seed="43" result="t" />
        <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.3 0 0 0 -1.3" result="a" />
        <feGaussianBlur in="a" stdDeviation="2.4" result="b" />
        <feFlood floodColor="currentColor" result="f" />
        <feComposite in="f" in2="b" operator="in" />
      </filter>
      {/* Soft elliptical fades — clouds dissolve at the edges instead of
          being cut straight at the filter-region boundary */}
      <radialGradient id="dh-fade">
        <stop offset="0%" stopColor="#fff" />
        <stop offset="55%" stopColor="#fff" />
        <stop offset="100%" stopColor="#000" />
      </radialGradient>
      <mask id="dh-mask-a" maskUnits="userSpaceOnUse">
        <ellipse cx="990" cy="112" rx="210" ry="68" fill="url(#dh-fade)" />
      </mask>
      <mask id="dh-mask-b" maskUnits="userSpaceOnUse">
        <ellipse cx="860" cy="185" rx="330" ry="54" fill="url(#dh-fade)" />
      </mask>
      <mask id="dh-mask-c" maskUnits="userSpaceOnUse">
        <ellipse cx="320" cy="110" rx="185" ry="54" fill="url(#dh-fade)" />
      </mask>
      <mask id="dh-mask-d" maskUnits="userSpaceOnUse">
        <ellipse cx="1040" cy="34" rx="160" ry="38" fill="url(#dh-fade)" />
      </mask>
    </defs>
    {/* Mass under the orb (moon/sun corner) + a mid band + a left wisp */}
    <g className="cg-a">
      <rect className="cb cb-a" x="790" y="60" width="400" height="105" filter="url(#dh-cloud-a)" mask="url(#dh-mask-a)" />
    </g>
    <g className="cg-b">
      <rect className="cb cb-b" x="540" y="145" width="640" height="80" filter="url(#dh-cloud-b)" mask="url(#dh-mask-b)" />
    </g>
    <g className="cg-c">
      <rect className="cb cb-c" x="150" y="70" width="340" height="80" filter="url(#dh-cloud-a)" mask="url(#dh-mask-c)" />
      <rect className="cb cb-d" x="880" y="5" width="320" height="60" filter="url(#dh-cloud-b)" mask="url(#dh-mask-d)" />
    </g>
  </svg>
)

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
  const { theme, greeting } = useClock()
  const roleBadge = badge || roleDepartmentLabel(user)
  const stars = useSkyStars()

  return (
    <section className="hero" data-theme={theme} aria-label="Welcome summary">
      <div className="sky" aria-hidden="true">
        <div className="stars">
          {stars.map((s, i) => (
            <i
              key={i}
              className={`star${s.glow ? ' glow' : ''}${s.warm ? ' warm' : ''}`}
              style={
                {
                  left: s.left,
                  top: s.top,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  '--tw-op': s.opacity,
                  '--tw-delay': s.delay,
                  '--tw-dur': s.dur,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="orb sun" />
        <div className="orb moon" style={{ backgroundImage: `url(${moonUrl})` }} />
        <Clouds />
        {/* Real photographic mountain band (cropped from the design art) —
            layered ridges + conifer treeline; theme tints via CSS filters */}
        <div className="hills" style={{ backgroundImage: `url(${ridgeUrl})` }} />
        {/* Base fade — melts the crop's bottom into the theme's dark color */}
        <div className="hill-fade" />
      </div>

      <div className="hero-main">
        <div className="welcome">
          <small>Welcome to,</small>
          <h2>
            {user?.name || roleDepartmentLabel(user) || 'User'}
            <span className="greet-inline">{greeting}</span>
          </h2>

          {showAttendance ? (
            <HeroAttendance badge={roleBadge} />
          ) : (
            /* Master Admin / Company Admin — role chip only (no attendance
               slice, so no "Not Checked In" pill). */
            <div className="chips">
              <span className="chip role">
                {PersonIcon} <span>{roleBadge}</span>
              </span>
            </div>
          )}
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
