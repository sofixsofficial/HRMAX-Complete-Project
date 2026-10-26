import { describe, it, expect } from 'vitest'
import { haversineDistance, isWithinRadius, toRadians } from '../geoUtils'

// Office used by the attendance policy fixtures (Janakpurdam-style coordinates)
const OFFICE = { lat: 26.724, lon: 83.452 }

describe('toRadians', () => {
  it('converts degrees to radians', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 10)
    expect(toRadians(0)).toBe(0)
  })
})

describe('haversineDistance', () => {
  it('is 0 between identical points', () => {
    expect(haversineDistance(OFFICE.lat, OFFICE.lon, OFFICE.lat, OFFICE.lon)).toBe(0)
  })

  it('is symmetric', () => {
    const a = haversineDistance(OFFICE.lat, OFFICE.lon, OFFICE.lat + 0.01, OFFICE.lon)
    const b = haversineDistance(OFFICE.lat + 0.01, OFFICE.lon, OFFICE.lat, OFFICE.lon)
    expect(a).toBeCloseTo(b, 6)
  })

  it('0.001° of latitude ≈ 111 m', () => {
    const d = haversineDistance(OFFICE.lat, OFFICE.lon, OFFICE.lat + 0.001, OFFICE.lon)
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(117)
  })

  it('a 1 km north–south step is ~1111 m', () => {
    const d = haversineDistance(OFFICE.lat, OFFICE.lon, OFFICE.lat + 0.009, OFFICE.lon)
    expect(d).toBeGreaterThan(950)
    expect(d).toBeLessThan(1050)
  })
})

describe('isWithinRadius (geofence)', () => {
  it('inside the radius allows the punch', () => {
    // ~55 m north of the office
    expect(isWithinRadius(OFFICE.lat + 0.0005, OFFICE.lon, OFFICE.lat, OFFICE.lon, 100)).toBe(true)
  })

  it('outside the radius blocks the punch', () => {
    // ~550 m north of the office
    expect(isWithinRadius(OFFICE.lat + 0.005, OFFICE.lon, OFFICE.lat, OFFICE.lon, 100)).toBe(false)
  })

  it('is inclusive at the exact boundary', () => {
    expect(isWithinRadius(OFFICE.lat, OFFICE.lon, OFFICE.lat, OFFICE.lon, 0)).toBe(true)
  })

  it('a tiny radius rejects anything but standing on the office', () => {
    expect(isWithinRadius(OFFICE.lat + 0.0001, OFFICE.lon, OFFICE.lat, OFFICE.lon, 1)).toBe(false)
  })
})
