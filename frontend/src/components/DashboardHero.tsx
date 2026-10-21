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
import { resolveCharacterMode } from '../utils/characterMode'
import { useHeroSky } from '../hooks/useHeroSky'
import type { SkyWeather } from '../utils/weather'
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
   * dashboard, so they pass false — they render a static "Not Checked In" pill.
   */
  showAttendance?: boolean
}

/* ------------------------------------------------------------------ */
/* Time + weather based decorative sky (independent of attendance)     */
/* ------------------------------------------------------------------ */

/** Sparse night stars — only shown on a clear night (never under clouds). */
const NIGHT_STARS: Array<[number, number, number]> = [
  [28, 34, 1.3],
  [74, 16, 1],
  [118, 52, 1.5],
  [158, 28, 1],
  [196, 64, 1.2],
  [236, 22, 1.4],
  [272, 46, 1],
  [306, 92, 1.1],
  [352, 116, 1.3],
  [384, 68, 1],
  [46, 124, 1],
  [214, 104, 1.2],
  [96, 96, 0.9],
  [140, 12, 1],
]

const Landscape = memo(function Landscape({ period, weather }: { period: DayPeriod; weather: SkyWeather }) {
  const night = period === 'night'
  // Precipitation implies cloud cover: hide sun/moon glow, thicken the clouds.
  const overcast = weather === 'rain' || weather === 'storm' || weather === 'snow'
  // Twinkling stars only on a clear night — clouds and snowfall hide them.
  const stars = night && !overcast

  if (night) {
    return (
      <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        {/* Moon — subtle crescent */}
        <circle cx="336" cy="40" r="15" fill="#f5f3d8" opacity={overcast ? 0.25 : 0.85} />
        <circle cx="329" cy="36" r="12" fill="#0d1430" opacity={overcast ? 0.95 : 0.9} />
        {stars &&
          NIGHT_STARS.map(([x, y, r], i) => (
            <circle
              key={i}
              className="dh-star"
              cx={x}
              cy={y}
              r={r}
              fill="#eaf0ff"
              style={{ animationDelay: `${(i % 5) * 0.75}s`, animationDuration: `${3 + (i % 4) * 0.6}s` }}
            />
          ))}
        {/* Very faint, slow-drifting clouds */}
        <ellipse className="dh-cloud dh-cloud-a" cx="120" cy="76" rx="44" ry="9" fill="#ffffff" opacity={overcast ? 0.1 : 0.05} />
        <ellipse className="dh-cloud dh-cloud-b" cx="256" cy="120" rx="34" ry="7" fill="#ffffff" opacity={overcast ? 0.08 : 0.04} />
      </svg>
    )
  }

  // Day / evening — soft sun + slow, unobtrusive clouds (position follows the
  // scene gradient's glow so the light source feels coherent). No sun while it
  // is raining or snowing — it sits behind the cloud deck.
  const sunX = period === 'evening' ? 64 : period === 'afternoon' ? 344 : 328
  const sunY = period === 'evening' ? 172 : period === 'afternoon' ? 20 : 32
  return (
    <svg className="dh-decor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {!overcast && (
        <>
          <circle cx={sunX} cy={sunY} r="42" fill="#fff6c8" opacity="0.2" />
          <circle cx={sunX} cy={sunY} r="18" fill="#fffbe8" opacity="0.85" />
        </>
      )}
      <ellipse
        className="dh-cloud dh-cloud-a"
        cx="112"
        cy="74"
        rx="46"
        ry="10"
        fill={overcast ? '#cbd5e1' : '#ffffff'}
        opacity={overcast ? 0.2 : 0.12}
      />
      <ellipse
        className="dh-cloud dh-cloud-b"
        cx="252"
        cy="116"
        rx="36"
        ry="8"
        fill={overcast ? '#cbd5e1' : '#ffffff'}
        opacity={overcast ? 0.16 : 0.09}
      />
    </svg>
  )
})

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

  // Single authoritative mode — resolved from backend records only (drives the
  // status pill and the detail line).
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
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

/* Dev-only scene preview for QA: `?sky=rain|storm|snow|clouds|clear`.
   `import.meta.env.DEV` compiles to `false` in production builds, so this
   constant — and the query parameter it reads — are stripped from the shipped
   bundle; production always renders live conditions. */
const DEV_SKY: SkyWeather | null = import.meta.env.DEV
  ? (new URLSearchParams(window.location.search).get('sky') as SkyWeather | null)
  : null

export function DashboardHero({ stats, badge, showAttendance = true }: DashboardHeroProps) {
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const [companyTz, setCompanyTz] = useState<string | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())
  // Live sky conditions for the background (Open-Meteo + location; silently
  // falls back to time-of-day-only scenes when unavailable).
  const sky = useHeroSky()

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
  const weather = DEV_SKY ?? sky.weather

  return (
    <section className="dh" data-period={period} data-weather={weather} aria-label="Welcome summary">
      <div className="dh-scene" aria-hidden="true" />
      <Landscape period={period} weather={weather} />
      {(weather === 'rain' || weather === 'storm') && <div className="dh-rain" aria-hidden="true" />}
      {weather === 'snow' && <div className="dh-snow" aria-hidden="true" />}
      <div className="dh-scrim" aria-hidden="true" />

      <div className="dh-inner">
        <div className="dh-main">
          <span className="dh-greeting">Welcome back,</span>
          <h2 className="dh-name">{user?.name || 'User'}</h2>

          {showAttendance ? (
            <HeroAttendance badge={roleBadge} tz={tz} now={now} />
          ) : (
            /* Company Admin — static pill (no attendance slice on the hero). */
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
