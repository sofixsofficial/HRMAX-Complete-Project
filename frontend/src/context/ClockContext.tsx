import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useCompany } from './CompanyContext'
import { useSkyClock } from '../hooks/useSkyClock'
import {
  formatInZone,
  periodForHour,
  greetingForPeriod,
  type DayPeriod,
} from '../utils/heroScene'
import type { SkyConditions } from '../utils/weather'

/**
 * Shared clock context — the SINGLE time source for the global header and the
 * dashboard hero (both must always render the identical time/date, never a
 * mismatch). Ported from the hrmax-hero reference (`ClockProvider`/`useClock`).
 *
 * One provider (mounted in AuthenticatedLayout) drives one `useSkyClock`
 * subscriber; every consumer just reads the formatted values off context. The
 * place (weather + location + timezone) resolves the user's real location when
 * permitted and the New Delhi baseline otherwise — nothing is invented, and
 * `location`/`tempC` stay null when unavailable so callers hide those rows.
 */
export interface ClockValue {
  /** Time-of-day theme driving the hero sky + greeting (morning…night). */
  theme: DayPeriod
  /** "10:39 PM" — live, updates on the minute. */
  time: string
  /** "Oct 22, 2026 · Thu" — hero date line. */
  dateLong: string
  /** "Thu, Oct 22" — compact header date. */
  dateShort: string
  /** "Good Evening" — contextual greeting for the theme. */
  greeting: string
  /** Real location label — null when unavailable (never invented). */
  location: string | null
  /** Real temperature (°C) — null when unavailable. */
  tempC: number | null
  /** Effective display timezone of this clock. */
  tz: string | null
  /** The shared instant — identical for every consumer. */
  now: Date
  /** Live place conditions (weather etc.). */
  sky: SkyConditions
}

const ClockContext = createContext<ClockValue | null>(null)

/* Dev-only theme override for QA: `?hour=6|13|17|22` pins the period so all
   four sky scenes can be previewed without waiting for the clock.
   `import.meta.env.DEV` compiles to `false` in production builds, so this —
   and the query parameter it reads — is stripped from the shipped bundle;
   production always renders the live period. */
const HOUR_OVERRIDE: number | null = import.meta.env.DEV
  ? (() => {
      const raw = new URLSearchParams(window.location.search).get('hour')
      const n = raw === null ? Number.NaN : Number(raw)
      return Number.isFinite(n) ? n : null
    })()
  : null

export function ClockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const companyId = effectiveCompanyId || user?.companyId
  // The shared engine: one minute-aligned tick, one weather/place resolution.
  const { now, sky, tz, period, greeting } = useSkyClock(companyId)

  const value = useMemo<ClockValue>(() => {
    const theme: DayPeriod = HOUR_OVERRIDE !== null ? periodForHour(HOUR_OVERRIDE) : period
    return {
      theme,
      time: formatInZone(now, tz, { hour: '2-digit', minute: '2-digit', hour12: true }),
      dateLong: `${formatInZone(now, tz, { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatInZone(now, tz, { weekday: 'short' })}`,
      dateShort: formatInZone(now, tz, { weekday: 'short', month: 'short', day: 'numeric' }),
      greeting: HOUR_OVERRIDE !== null ? greetingForPeriod(theme) : greeting,
      location: sky.locationLabel ?? null,
      tempC: sky.tempC ?? null,
      tz,
      now,
      sky,
    }
  }, [now, sky, tz, period, greeting])

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>
}

/** Read the shared clock. Renders inside `<ClockProvider>` (every authenticated page does). */
export function useClock(): ClockValue {
  const ctx = useContext(ClockContext)
  if (!ctx) throw new Error('useClock must be used within <ClockProvider>')
  return ctx
}

export default ClockContext
