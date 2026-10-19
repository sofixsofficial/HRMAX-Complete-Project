import type { GeoPoint } from '../types/attendance';

const EARTH_RADIUS_METERS = 6371000;

export function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function isWithinRadius(
  currentLat: number,
  currentLon: number,
  centerLat: number,
  centerLon: number,
  radiusMeters: number
): boolean {
  const distance = haversineDistance(currentLat, currentLon, centerLat, centerLon);
  return distance <= radiusMeters;
}

export function getCurrentPosition(
  timeout: number = 10000,
  maximumAge: number = 30000,
  enableHighAccuracy: boolean = true
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      { enableHighAccuracy, timeout, maximumAge }
    );
  });
}

export function getBatteryLevel(): Promise<number | null> {
  return new Promise((resolve) => {
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery().then((battery: any) => {
        resolve(battery.level * 100);
      }).catch(() => resolve(null));
    } else {
      resolve(null);
    }
  });
}
