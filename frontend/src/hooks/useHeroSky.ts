import { useEffect, useState } from 'react'
import { fetchSkyConditions, type SkyConditions } from '../utils/weather'

const INITIAL: SkyConditions = { weather: 'unknown', tempC: null }

/**
 * Live sky conditions for the hero background. Starts as `unknown` (time-of-day
 * scene only) and upgrades once Open-Meteo responds; re-checks every 30 minutes
 * so a changing sky (clear → rain) is picked up without a reload. Never throws.
 */
export function useHeroSky(): SkyConditions {
  const [sky, setSky] = useState<SkyConditions>(INITIAL)

  useEffect(() => {
    let dead = false

    const refresh = () => {
      fetchSkyConditions().then((conditions) => {
        if (!dead) setSky(conditions)
      })
    }

    refresh()
    const id = window.setInterval(refresh, 30 * 60 * 1000)
    return () => {
      dead = true
      window.clearInterval(id)
    }
  }, [])

  return sky
}
