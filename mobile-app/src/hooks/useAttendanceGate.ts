import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useCompany } from '../context/CompanyContext';
import { subscribeAttendancePolicy, AttendancePolicy } from '../services/attendanceSettingsService';

export interface CheckResult {
  ok: boolean;
  reason?: string;
  needsSelfie?: boolean;
}

const toMinutes = (time: string): number => {
  const [h, m] = (time || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

export function useAttendanceGate() {
  const { effectiveCompanyId } = useCompany();
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);

  useEffect(() => {
    if (!effectiveCompanyId) {
      setPolicy(null);
      setPolicyLoading(false);
      return;
    }
    setPolicyLoading(true);
    const unsub = subscribeAttendancePolicy(effectiveCompanyId, (p) => {
      setPolicy(p);
      setPolicyLoading(false);
    });
    return unsub;
  }, [effectiveCompanyId]);

  const getCurrentNetwork = useCallback(async () => {
    try {
      const state = await NetInfo.fetch();
      const isWifi = state.type === 'wifi';
      let ssid: string | null = null;
      if (isWifi && state.details && 'ssid' in state.details) {
        ssid = (state.details as any).ssid ?? null;
      }
      return { isWifi, ssid, isConnected: !!state.isConnected };
    } catch {
      return { isWifi: false, ssid: null, isConnected: false };
    }
  }, []);

  const validateCheckIn = useCallback(
    async (opts?: { selfieUri?: string }): Promise<CheckResult> => {
      if (!policy) return { ok: true };

      // Network guard: Wi-Fi-only and approved-SSID enforcement
      if (policy.enableNetworkGuard || policy.wifiOnly) {
        const network = await getCurrentNetwork();
        const approvedNames = (policy.allowedWifis || []).map((w) => w.ssid).filter(Boolean);
        const onApprovedWifi =
          network.isWifi &&
          network.ssid != null &&
          approvedNames.some((name) => name.toLowerCase() === (network.ssid || '').toLowerCase());

        if (policy.wifiOnly && !network.isWifi) {
          return {
            ok: false,
            reason:
              approvedNames.length > 0
                ? `Attendance requires the office Wi-Fi (${approvedNames.join(', ')}). Please connect and try again.`
                : 'Attendance requires an office Wi-Fi connection. Please connect and try again.',
          };
        }
        if (policy.wifiOnly && approvedNames.length > 0 && !onApprovedWifi) {
          return {
            ok: false,
            reason: `You are not connected to the approved office network (${approvedNames.join(', ')}).`,
          };
        }
        if (!network.isWifi && !policy.mobileDataAllowed) {
          return {
            ok: false,
            reason: 'Mobile data is not allowed for attendance. Please connect to Wi-Fi.',
          };
        }
        if (!network.isConnected) {
          return { ok: false, reason: 'No network connection detected.' };
        }
      }

      // Geofence: distance check against the office location
      if (policy.enableGeofence && policy.officeLocation && policy.officeLocation.latitude) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            return { ok: false, reason: 'Location permission is required to mark attendance.' };
          }
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const distance = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            policy.officeLocation.latitude,
            policy.officeLocation.longitude
          );
          const radius = policy.officeLocation.radiusMeters || 100;
          if (distance > radius) {
            return {
              ok: false,
              reason: `You are ${distance}m from the office location. Attendance is allowed within ${radius}m.`,
            };
          }
        } catch {
          return { ok: false, reason: 'Could not verify your location. Please try again.' };
        }
      }

      // Selfie verification: camera capture required when enforced.
      const selfieRequired = !!(policy.requireSelfie || policy.enableSelfie);
      if (selfieRequired && !opts?.selfieUri) {
        return { ok: false, needsSelfie: true, reason: 'This office requires a selfie to mark attendance.' };
      }

      return { ok: true };
    },
    [policy, getCurrentNetwork]
  );

  const getCheckInStatus = useCallback(
    (now: Date = new Date()): 'Present' | 'Late' => {
      if (!policy) return 'Present';
      const shiftStart = toMinutes(policy.defaultShiftStart || '09:00');
      const grace = policy.gracePeriodMinutes ?? 0;
      const lateAfter = shiftStart + grace;
      const current = now.getHours() * 60 + now.getMinutes();
      return current > lateAfter ? 'Late' : 'Present';
    },
    [policy]
  );

  const validateCheckOut = useCallback(
    async (): Promise<CheckResult> => {
      if (!policy) return { ok: true };

      // Network guard: same rules as check-in
      if (policy.enableNetworkGuard || policy.wifiOnly) {
        const network = await getCurrentNetwork();
        const approvedNames = (policy.allowedWifis || []).map((w) => w.ssid).filter(Boolean);
        const onApprovedWifi =
          network.isWifi &&
          network.ssid != null &&
          approvedNames.some((name) => name.toLowerCase() === (network.ssid || '').toLowerCase());

        if (policy.wifiOnly && !network.isWifi) {
          return {
            ok: false,
            reason:
              approvedNames.length > 0
                ? `Check-out requires the office Wi-Fi (${approvedNames.join(', ')}). Please connect and try again.`
                : 'Check-out requires an office Wi-Fi connection. Please connect and try again.',
          };
        }
        if (policy.wifiOnly && approvedNames.length > 0 && !onApprovedWifi) {
          return {
            ok: false,
            reason: `You are not connected to the approved office network (${approvedNames.join(', ')}).`,
          };
        }
        if (!network.isWifi && !policy.mobileDataAllowed) {
          return {
            ok: false,
            reason: 'Mobile data is not allowed. Please connect to Wi-Fi to check out.',
          };
        }
        if (!network.isConnected) {
          return { ok: false, reason: 'No network connection detected.' };
        }
      }

      // Geofence: same distance check as check-in
      if (policy.enableGeofence && policy.officeLocation && policy.officeLocation.latitude) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            return { ok: false, reason: 'Location permission is required to check out.' };
          }
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const distance = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            policy.officeLocation.latitude,
            policy.officeLocation.longitude
          );
          const radius = policy.officeLocation.radiusMeters || 100;
          if (distance > radius) {
            return {
              ok: false,
              reason: `You are ${distance}m from the office. Check-out is allowed within ${radius}m of the office.`,
            };
          }
        } catch {
          return { ok: false, reason: 'Could not verify your location. Please try again.' };
        }
      }

      return { ok: true };
    },
    [policy, getCurrentNetwork]
  );

  return { policy, policyLoading, validateCheckIn, validateCheckOut, getCheckInStatus };
}
