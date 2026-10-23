import { useEffect, useState } from 'react'
import { useHeroSky } from './useHeroSky'
import type { SkyConditions } from '../utils/weather'
import {
  effectiveTimezone,
  getHeroScene,
  resolveCompanyTimezone,
  type DayPeriod,
} from '../utils/heroScene'

/**
 * Shared live sky clock — the SINGLE time source for the global header and the
 * dashboard hero (spec: both must show identical time/date, never a mismatch).
 *
 * A module-level minute-aligned tick drives every subscriber (it fires exactly
 * on the minute boundary, then once a minute — no drift), so the header clock
 * and the hero clock always render the same `now`. The place (weather +
 * location + IANA timezone) comes from the cached `useHeroSky` hook, which
 * resolves the user's real location when permitted and the New Delhi baseline
 * otherwise. Scene period + greeting are derived from that one place's
 * timezone ("jahan ka time, wahi ka mausam").
 */

let clockNow: Date = new Date()
let started = false
const listeners = new Set<(d: Date) => void>()

function ensureTicking() {
  if (started || typeof window === 'undefined') return
  started = true
  const tick = () => {
    clockNow = new Date()
    listeners.forEach((notify) => notify(clockNow))
  }
  // Update exactly on the minute boundary (spec: the clock changes with the
  // minute, never mid-minute), then once per minute.
  const msToNextMinute = 60_000 - (Date.now() % 60_000)
  window.setTimeout(() => {
    tick()
    window.setInterval(tick, 60_000)
  }, msToNextMinute)
  // Refresh immediately when the tab becomes visible again (a sleeping
  // background tab pauses timers, so the clock could be minutes stale).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick()
  })
}

export interface SkyClock {
  /** The shared "now" — identical for every consumer. */
  now: Date
  /** Live place conditions (weather, temperature, label, timezone). */
  sky: SkyConditions
  /** Effective display timezone (company setting → override → device → India). */
  tz: string | null
  /** Period + greeting for the place's local time. */
  period: DayPeriod
  greeting: string
}

/**
 * @param companyId Current company scope — its configured timezone (cached per
 *   session by resolveCompanyTimezone) is honoured for the clock and scene so
 *   the header and hero agree with the business timezone too.
 */
export function useSkyClock(companyId?: string | null): SkyClock {
  const [now, setNow] = useState<Date>(clockNow)
  const [companyTz, setCompanyTz] = useState<string | null>(null)
  const sky = useHeroSky()

  useEffect(() => {
    ensureTicking()
    listeners.add(setNow)
    setNow(clockNow)
    return () => {
      listeners.delete(setNow)
    }
  }, [])

  useEffect(() => {
    let dead = false
    resolveCompanyTimezone(companyId)
      .then((tz) => {
        if (!dead) setCompanyTz(tz)
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [companyId])

  // Clock + scene follow the displayed place's timezone; the company
  // timezone is the fallback when the place has none.
  const tz = sky.timezone ?? effectiveTimezone(companyTz)
  const { period, greeting } = getHeroScene(now, tz)
  return { now, sky, tz, period, greeting }
}

export default useSkyClock
