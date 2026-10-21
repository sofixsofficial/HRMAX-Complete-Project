/**
 * Live sky conditions for the dashboard hero background (SECTION 5B — visual
 * layer only).
 *
 * Reads the browser location (the same permission the attendance punch already
 * asks for) and fetches current conditions from the free Open-Meteo API — no
 * API key, no backend call, no personal data stored anywhere. Every failure
 * path (permission denied, offline, timeout, API error) degrades to
 * `unknown`, which simply means the hero keeps its time-of-day scene. This
 * never touches attendance, payroll, or any backend record.
 */

export type SkyWeather = 'unknown' | 'clear' | 'clouds' | 'rain' | 'storm' | 'snow'

export interface SkyConditions {
  /** Simplified condition used to pick the hero scene. */
  weather: SkyWeather
  /** Current temperature in °C when available (drives the winter scene). */
  tempC: number | null
}

const UNKNOWN: SkyConditions = { weather: 'unknown', tempC: null }
const REFRESH_MS = 30 * 60 * 1000 // re-check the sky every 30 minutes
const FETCH_TIMEOUT_MS = 8000

let cached: SkyConditions | null = null
let cachedAt = 0
let inflight: Promise<SkyConditions> | null = null

/**
 * WMO weather interpretation codes (what Open-Meteo returns) → sky scene.
 * https://open-meteo.com/en/docs — "Weather interpretation code (WMO)"
 */
function toCondition(code: number, tempC: number | null): SkyWeather {
  if (code === 95 || code === 96 || code === 99) return 'storm'
  // Drizzle, rain, freezing rain and showers → rain scene.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  // Snow, snow grains and snow showers → snow scene.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  // Cold, still conditions read as winter → gentle snowfall (spec: winter).
  if (tempC !== null && tempC <= 2) return 'snow'
  // Overcast / fog → heavier clouds, no precipitation layer.
  if (code >= 1 && code <= 3) return 'clouds'
  if (code === 45 || code === 48) return 'clouds'
  return 'clear'
}

function getPosition(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('geolocation unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => reject(new Error('location denied')),
      // Same posture as the attendance punch: coarse is enough for weather,
      // short timeout so the hero never waits on it, cached by the browser.
      { enableHighAccuracy: false, timeout: FETCH_TIMEOUT_MS, maximumAge: REFRESH_MS },
    )
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(id)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(id)
        reject(err)
      },
    )
  })
}

async function load(): Promise<SkyConditions> {
  const coords = await getPosition()
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude.toFixed(4)}` +
    `&longitude=${coords.longitude.toFixed(4)}&current=temperature_2m,weather_code`
  const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS)
  if (!res.ok) return UNKNOWN
  const data = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number }
  }
  const tempC = typeof data.current?.temperature_2m === 'number' ? data.current.temperature_2m : null
  const code = typeof data.current?.weather_code === 'number' ? data.current.weather_code : 0
  return { weather: toCondition(code, tempC), tempC }
}

/**
 * Current sky conditions, cached for REFRESH_MS so the dashboard neither hits
 * the API nor re-requests location on every navigation. Never throws — a miss
 * is remembered briefly so we don't re-prompt in a loop, then retried later.
 */
export function fetchSkyConditions(): Promise<SkyConditions> {
  if (cached && Date.now() - cachedAt < REFRESH_MS) return Promise.resolve(cached)
  if (inflight) return inflight

  inflight = load()
    .then((conditions) => {
      cached = conditions
      cachedAt = Date.now()
      return conditions
    })
    .catch(() => {
      cached = UNKNOWN
      cachedAt = Date.now()
      return UNKNOWN
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
