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
 *   1. New Delhi baseline (real weather + Asia/Kolkata) loads instantly, no
 *      location permission needed.
 *   2. If the browser location permission is granted, everything upgrades to
 *      the user's actual place — its weather and its IANA timezone — so the
 *      hero clock and the background always belong to the same location.
 *
 * Re-checks every 30 minutes so a changing sky (clear → rain) is picked up
 * without a reload. Never throws.
 */
export function useHeroSky(): SkyConditions {
  const [sky, setSky] = useState<SkyConditions>(INITIAL)

  useEffect(() => {
    let dead = false

    const refresh = async () => {
      const baseline = await fetchDefaultSky()
      if (!dead) setSky(baseline)
      const mine = await fetchUserSky()
      if (mine && !dead) setSky(mine)
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
