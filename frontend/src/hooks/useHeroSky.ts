import { useEffect, useState } from 'react'
import { fetchDefaultSky, fetchUserSky, type SkyConditions } from '../utils/weather'

const INITIAL: SkyConditions = {
  weather: 'unknown',
  tempC: null,
  locationLabel: null,
  timezone: null,
  source: 'none',
}

/**
 * Live sky conditions for the hero background — always resolves to a place:
 *
 *   1. The location permission is requested IMMEDIATELY on mount (parallel to
 *      the baseline fetch), so the browser prompt appears the moment the app
 *      opens instead of after the baseline network call resolves.
 *   2. Granted → the user's real place: its weather, its city label and its
 *      IANA timezone (this is the ONLY source ever shown as "your location").
 *   3. Denied/unavailable → the New Delhi baseline still paints the hero
 *      scene/timezone, but the header keeps location/temp hidden (ClockContext
 *      only exposes `source === 'device'`).
 *
 * Re-checks every 30 minutes so a changing sky (clear → rain) is picked up
 * without a reload. Never throws.
 */
export function useHeroSky(): SkyConditions {
  const [sky, setSky] = useState<SkyConditions>(INITIAL)

  useEffect(() => {
    let dead = false

    const refresh = async () => {
      // Both at once: the prompt fires immediately, and the hero never sits on
      // an empty sky while the geolocation/weather calls round-trip.
      const [baseline, mine] = await Promise.allSettled([fetchDefaultSky(), fetchUserSky()])
      if (dead) return
      if (mine.status === 'fulfilled' && mine.value) {
        setSky(mine.value)
      } else if (baseline.status === 'fulfilled') {
        setSky(baseline.value)
      }
    }

    void refresh()
    const id = window.setInterval(() => void refresh(), 30 * 60 * 1000)
    return () => {
      dead = true
      window.clearInterval(id)
    }
  }, [])

  return sky
}
