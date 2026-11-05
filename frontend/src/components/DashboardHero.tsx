import { useEffect, useState } from 'react'
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
  MapPin,
  Percent,
  Umbrella,
  User,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { collection, getDocs, query, where } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useClock } from '../context/ClockContext'
import { useAttendancePunch } from '../hooks/useAttendancePunch'
import { getLeaveRequestsByUser } from '../services/leaveService'
import { roleDepartmentLabel } from '../utils/roleLabels'
import { parseWeekendDays, toDateKey } from '../utils/workingDays'
import { resolveCharacterMode } from '../utils/characterMode'
import { formatElapsed, formatInZone, resolveCompanyWeekends, toDate } from '../utils/heroScene'
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

/** Stat label icon — matches the dark stats strip (person, umbrella, …). */
const statIcon = (label: string, size = 20) => {
  const l = label.toLowerCase()
  if (l.includes('present')) return <User size={size} />
  if (l.includes('absent') || l.includes('inactive')) return <UserX size={size} />
  if (l.includes('leave')) return <Umbrella size={size} />
  if (l.includes('task')) return <ClipboardList size={size} />
  if (l.includes('rate') || l.includes('month')) return <Percent size={size} />
  if (l.includes('active')) return <UserCheck size={size} />
  if (l.includes('team')) return <Users size={size} />
  if (l.includes('approved')) return <CheckCircle2 size={size} />
  return <BarChart3 size={size} />
}

/** Soft pastel chip tint per stat — the icon itself stays black (client spec). */
const statTint = (label: string) => {
  const l = label.toLowerCase()
  if (l.includes('present')) return '#ecfdf5'
  if (l.includes('absent') || l.includes('inactive')) return '#fef2f2'
  if (l.includes('leave')) return '#fffbeb'
  if (l.includes('task')) return '#fdf2f8'
  if (l.includes('rate')) return '#eff6ff'
  return '#f3f4f6'
}

/* Inline icon for the role chip — tiny stroke SVG, no icon lib. */
const PersonIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
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
 * Loads the non-attendance facts the status resolver needs: an APPROVED
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
/* Attendance slice — live status chip + punch actions                 */
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

        {/* Detail line per mode — live attendance facts (never invented) */}
        {working && (
          <>
            <span className="hero-detail">
              <Clock3 size={15} aria-hidden="true" />
              <span>Checked in at {fmtPunchTime(todayRecord?.checkIn, tz)}</span>
            </span>
            <span className="hero-pill elapsed">
              <span aria-hidden="true">·</span> {formatElapsed(elapsedMs)} elapsed
            </span>
          </>
        )}
        {mode === 'complete' && (
          <span className="hero-detail">
            <Clock3 size={15} aria-hidden="true" />
            <span>
              In {fmtPunchTime(todayRecord?.checkIn, tz)} · Out {fmtPunchTime(todayRecord?.checkOut, tz)} · {formatElapsed(workedMs)} worked
            </span>
          </span>
        )}
        {mode === 'on_leave' && (
          <span className="hero-detail">
            <Umbrella size={15} aria-hidden="true" />
            <span>{day.halfDayLeave && !day.onApprovedLeave ? 'Approved half-day leave today' : 'Approved leave today'}</span>
          </span>
        )}
        {mode === 'holiday' && (
          <span className="hero-detail">
            <Calendar size={15} aria-hidden="true" />
            <span>{resolved.pill} · {dateLong}</span>
          </span>
        )}
        {mode === 'resting' && (
          <span className="hero-detail">
            <Clock3 size={15} aria-hidden="true" />
            <span>You are not currently working.</span>
          </span>
        )}
      </div>

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
/* Hero — dark banner (sidebar palette: black-blue slate): #0f172a →   */
/* #0b1120 → #152e56 card, pale blue waves on the right, white name,  */
/* blue-bar subtitle, white chips, right-side tagline, and a white     */
/* KPI strip (tinted icon chips) below                                 */
/* ------------------------------------------------------------------ */

export function DashboardHero({ stats, badge, showAttendance = true }: DashboardHeroProps) {
  const { user } = useAuth()
  const { now, tz, time, location } = useClock()
  const roleBadge = badge || roleDepartmentLabel(user)
  const displayName = user?.name || roleBadge
  // Time-of-day greeting (user-requested): morning <12, afternoon <17,
  // evening <21, night otherwise — based on the reader's local clock.
  const hour = new Date(now).getHours()
  const greeting =
    hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : hour < 21 ? 'Good evening,' : 'Good night,'

  return (
    <section className="hero" aria-label="Welcome summary">
      <div className="hero-card">
        {/* Decorative: soft blue waves (right) + tagline — ornamental
            only, always behind the welcome block (z-index: 0). */}
        <svg className="hero-waves" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path fill="#dbe9fb" d="M860 0 C1010 90 1130 210 940 330 C875 372 905 400 905 400 L1200 400 L1200 0 Z" />
          <path fill="#eef4fd" d="M1200 120 C1075 185 1155 320 995 400 L1200 400 Z" />
          <path fill="#c7dbf8" opacity="0.85" d="M1200 250 C1115 295 1165 362 1085 400 L1200 400 Z" />
          <path fill="#eaf1fd" d="M1200 0 L960 0 C1075 65 1135 115 1200 145 Z" />
        </svg>
        <div className="hero-tagline" aria-hidden="true">
          <span>Smart HR Management</span>
          <span>for a Better Workplace</span>
          <i />
        </div>

        <div className="welcome">
          <div className="hero-greet">
            <small>{greeting}</small>
          </div>
          <h2 className="hero-name">{displayName}</h2>
          <p className="hero-sub">Here's what's happening with your organization today.</p>

          {/* Live date / time / real device location pills */}
          <div className="hero-meta" aria-label="Current date and time">
            <span className="meta-pill">
              <Calendar size={14} aria-hidden="true" />
              {formatInZone(now, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="meta-pill">
              <Clock3 size={14} aria-hidden="true" />
              {time}
            </span>
            {location && (
              <span className="meta-pill">
                <MapPin size={14} aria-hidden="true" />
                {location}
              </span>
            )}
          </div>

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

      {/* Light stat tiles — real values from the role's dashboard */}
      <div className="hero-stats" role="list" aria-label="Dashboard statistics">
        {stats.map((s) => (
          <div key={s.label} className="hero-stat" role="listitem">
            <span
              className="hero-stat-icon"
              style={{ backgroundColor: statTint(s.label), color: '#000000' }}
              aria-hidden="true"
            >
              {statIcon(s.label, 18)}
            </span>
            <div className="hero-stat-meta">
              <div className="hero-stat-n">{s.value ?? '–'}</div>
              <div className="hero-stat-l">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default DashboardHero
