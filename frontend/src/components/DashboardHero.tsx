import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  Umbrella,
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
        {/* Two soft hill layers — fills switch per theme in CSS */}
        <svg className="hills" viewBox="0 0 1200 200" preserveAspectRatio="none" focusable="false">
          <path className="h1" d="M0 140 L120 95 L240 130 L380 70 L520 125 L660 85 L800 135 L940 80 L1080 120 L1200 95 V200 H0Z" />
          <path className="h2" d="M0 170 L150 135 L300 165 L470 120 L640 168 L820 130 L1000 170 L1200 140 V200 H0Z" />
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
          <div className="time">{time}</div>
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
            <div className="l">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default DashboardHero
