/**
 * Time-of-day scene + greeting logic for the dashboard hero.
 *
 * All computations go through Intl with an explicit IANA timezone so remote
 * employees see the scene for the *configured* timezone, never a hardcoded
 * machine timezone:
 *
 *   company settings timezone (if valid)  →  localStorage override  →  user's
 *   device timezone (Intl resolved, i.e. the browser the user is on).
 */
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../config/firebase'

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night'

export interface HeroScene {
  period: DayPeriod
  greeting: string
}

const GREETINGS: Record<DayPeriod, string> = {
  morning: 'Good Morning',
  afternoon: 'Good Afternoon',
  evening: 'Good Evening',
  night: 'Good Night',
}

/** Default timezone (India) — used only when no company/override/device tz resolves. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/** Hour (0-23) in the given timezone, computed via Intl parts (never getHours()). */
export function getZonedHour(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getHours()
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    return Number.isFinite(hour) ? hour % 24 : date.getHours()
  } catch {
    return date.getHours()
  }
}

/**
 * Scene period per spec: morning 5:00-11:59, afternoon 12:00-16:59,
 * evening 17:00-19:59, night 20:00-04:59.
 */
export function periodForHour(hour: number): DayPeriod {
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 16) return 'afternoon'
  if (hour >= 17 && hour <= 19) return 'evening'
  return 'night'
}

export function getHeroScene(now: Date, timeZone?: string | null): HeroScene {
  const period = periodForHour(getZonedHour(now, timeZone))
  return { period, greeting: GREETINGS[period] }
}

/** Format an instant in the resolved timezone; falls back gracefully on bad tz strings. */
export function formatInZone(
  date: Date,
  timeZone: string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return date.toLocaleString('en-US', timeZone ? { ...opts, timeZone } : opts)
  } catch {
    return date.toLocaleString('en-US', opts)
  }
}

/** Device timezone = the browser the *user* is actually on (client-side app). */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

const TZ_OVERRIDE_KEY = 'hrmax_timezone'

/** Optional per-user override (hook for a future timezone preference control). */
export function getStoredTimezone(): string | null {
  try {
    const tz = localStorage.getItem(TZ_OVERRIDE_KEY)
    if (tz && isValidTimezone(tz)) return tz
  } catch {
    /* storage unavailable */
  }
  return null
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Module-level cache so we do at most one company read per session per company.
const companyTzCache = new Map<string, string | null>()

/** Reads `companies/{id}` once for its configured timezone (settings.timeZone | timezone). */
export async function resolveCompanyTimezone(companyId?: string | null): Promise<string | null> {
  if (!companyId) return null
  const cached = companyTzCache.get(companyId)
  if (cached !== undefined) return cached
  try {
    const snap = await getDoc(doc(db, 'companies', companyId))
    const data = snap.data() as
      | { settings?: { timeZone?: unknown }; timezone?: unknown }
      | undefined
    const raw = data?.settings?.timeZone ?? data?.timezone ?? null
    const tz = typeof raw === 'string' && isValidTimezone(raw) ? raw : null
    companyTzCache.set(companyId, tz)
    return tz
  } catch {
    companyTzCache.set(companyId, null)
    return null
  }
}

// Module-level cache for the weekly-off schedule (one company read per session).
const companyWeekendCache = new Map<string, string[]>()

/**
 * Reads `companies/{id}` once for the configured weekly-off schedule
 * (`payrollSettings.weekends`, e.g. ['Sunday','Friday']).
 *
 * Employees hold `company.view`, so this doc is readable by every role — unlike
 * the `holidays` collection, which requires `holidays.view`. Returns null when
 * the schedule is absent so callers never infer a non-working day from the
 * weekday alone (SECTION 5B).
 */
export async function resolveCompanyWeekends(companyId?: string | null): Promise<string[] | null> {
  if (!companyId) return null
  const cached = companyWeekendCache.get(companyId)
  if (cached !== undefined) return cached
  try {
    const snap = await getDoc(doc(db, 'companies', companyId))
    const data = snap.data() as { payrollSettings?: { weekends?: unknown } } | undefined
    const raw = data?.payrollSettings?.weekends
    const weekends = Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string') : []
    companyWeekendCache.set(companyId, weekends)
    return weekends
  } catch {
    companyWeekendCache.set(companyId, [])
    return []
  }
}

/** Effective timezone: stored override → company settings → device → India default. */
export function effectiveTimezone(companyTz: string | null): string | null {
  return getStoredTimezone() || companyTz || deviceTimezone() || DEFAULT_TIMEZONE
}

/** "8h 30m" / "42m" elapsed duration formatter. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0m'
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Robust instant resolver for attendance date fields (Date | ISO string | {toDate}). */
export type DateLike = Date | { toDate: () => Date } | string | number | null | undefined

export function toDate(value: DateLike): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const d = value.toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    } catch {
      return null
    }
  }
  return null
}
