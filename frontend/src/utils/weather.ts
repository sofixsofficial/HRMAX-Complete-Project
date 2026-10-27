/**
 * Live sky conditions + place context for the dashboard hero background
 * (visual layer only).
 *
 * Two places, one rule:
 *
 *   1. PERMISSION IS ASKED ON OPEN — `fetchUserSky()` runs the moment the app
 *      mounts (in parallel with the baseline), so the browser's location
 *      prompt appears immediately instead of after a network round-trip.
 *      Granted → the user's REAL city, real temperature and IANA timezone
 *      ("jahan ka time, wahi ka mausam").
 *   2. THE NEW DELHI BASELINE IS SCENE-ONLY — it paints the hero sky/timezone
 *      while permission is pending or when it is denied, but `source` stays
 *      `'default'` and ClockContext deliberately does NOT expose its label or
 *      temperature, so a default place is never shown as the user's location.
 *
 * Weather comes from the free Open-Meteo API (no key, no backend call); the
 * city label from the free BigDataCloud reverse-geocode endpoint. This never
 * touches attendance, payroll, or any backend record.
 */

export type SkyWeather = 'unknown' | 'clear' | 'clouds' | 'rain' | 'storm' | 'snow'

/** Where the hero's place came from. */
export type SkySource = 'device' | 'default' | 'none'

export interface SkyConditions {
  /** Simplified condition used to pick the hero scene. */
  weather: SkyWeather
  /** Current temperature in °C when available (drives the winter scene). */
  tempC: number | null
  /** Human place label, e.g. "New Delhi, India" — populated once loaded. */
  locationLabel: string | null
  /** IANA timezone of the place (Open-Meteo `timezone`) — drives the hero clock. */
  timezone: string | null
  /** Whether the place is the user's real location or the India default. */
  source: SkySource
}

export interface SkyPlace {
  lat: number
  lon: number
  /** Known label up front (default place); user place is reverse-geocoded. */
  label: string | null
  /** Known IANA timezone up front; user place gets it from Open-Meteo. */
  timezone: string | null
}

/** India baseline — used instantly, and whenever location/API is unavailable. */
export const DEFAULT_PLACE: SkyPlace = {
  lat: 28.6139,
  lon: 77.209,
  label: 'New Delhi, India',
  timezone: 'Asia/Kolkata',
}

const REFRESH_MS = 30 * 60 * 1000 // re-check the sky every 30 minutes
const FETCH_TIMEOUT_MS = 8000

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

/** "New Delhi, India" for the given coords; null on any failure (keyless API). */
async function reverseLabel(lat: number, lon: number): Promise<string | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(4)}` +
    `&longitude=${lon.toFixed(4)}&localityLanguage=en`
  try {
    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS)
    if (!res.ok) return null
    const data = (await res.json()) as {
      city?: string
      locality?: string
      principalSubdivision?: string
      countryName?: string
    }
    const city = data.city || data.locality || data.principalSubdivision
    if (!city) return null
    return data.countryName && data.countryName !== city ? `${city}, ${data.countryName}` : city
  } catch {
    return null
  }
}

/** Current conditions + timezone for a place. Never throws — a miss returns the baseline shape. */
async function fetchPlaceWeather(place: SkyPlace, source: SkySource): Promise<SkyConditions> {
  const base: SkyConditions = {
    weather: 'unknown',
    tempC: null,
    locationLabel: place.label,
    timezone: place.timezone,
    source,
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(4)}` +
    `&longitude=${place.lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=auto`
  try {
    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS)
    if (!res.ok) return base
    const data = (await res.json()) as {
      timezone?: string
      current?: { temperature_2m?: number; weather_code?: number }
    }
    const tempC = typeof data.current?.temperature_2m === 'number' ? data.current.temperature_2m : null
    const code = typeof data.current?.weather_code === 'number' ? data.current.weather_code : 0
    return {
      weather: toCondition(code, tempC),
      tempC,
      locationLabel: place.label,
      timezone: data.timezone || place.timezone,
      source,
    }
  } catch {
    return base
  }
}

// Per-place weather cache so navigations and the 30-minute refresh do not
// hammer the API.
const weatherCache = new Map<string, { at: number; conditions: SkyConditions }>()
const placeKey = (place: SkyPlace, source: SkySource) => `${source}:${place.lat.toFixed(3)},${place.lon.toFixed(3)}`

async function cachedWeather(place: SkyPlace, source: SkySource): Promise<SkyConditions> {
  const key = placeKey(place, source)
  const hit = weatherCache.get(key)
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit.conditions
  const conditions = await fetchPlaceWeather(place, source)
  weatherCache.set(key, { at: Date.now(), conditions })
  return conditions
}

// The user's actual place — resolved at most once per session so we never
// re-prompt in a loop. `undefined` = not tried yet, `null` = unavailable.
let userPlace: SkyPlace | null | undefined

async function getUserPlace(): Promise<SkyPlace | null> {
  if (userPlace !== undefined) return userPlace
  try {
    const coords = await getPosition()
    userPlace = { lat: coords.latitude, lon: coords.longitude, label: null, timezone: null }
  } catch {
    userPlace = null
  }
  return userPlace
}

/** Phase 1 — India baseline: real New Delhi weather + Asia/Kolkata, no permission needed. */
export function fetchDefaultSky(): Promise<SkyConditions> {
  return cachedWeather(DEFAULT_PLACE, 'default')
}

/**
 * Phase 2 — the user's real place (weather + IANA timezone + city label).
 * Returns null when location is unavailable so the caller keeps the baseline.
 */
export async function fetchUserSky(): Promise<SkyConditions | null> {
  const place = await getUserPlace()
  if (!place) return null
  const key = placeKey(place, 'device')
  const [conditions, label] = await Promise.all([
    cachedWeather(place, 'device'),
    place.label ? Promise.resolve(place.label) : reverseLabel(place.lat, place.lon),
  ])
  if (!label) return conditions
  // Label resolved lazily so the weather never waits on the geocode.
  const merged: SkyConditions = { ...conditions, locationLabel: label }
  place.label = label
  weatherCache.set(key, { at: Date.now(), conditions: merged })
  return merged
}
