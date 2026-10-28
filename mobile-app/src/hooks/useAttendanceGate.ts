import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { subscribeAttendancePolicy, AttendancePolicy } from '../services/attendanceSettingsService';
import { fetchMyBranches, MyBranches } from '../services/branchService';

export interface CheckResult {
  ok: boolean;
  reason?: string;
  needsSelfie?: boolean;
  /** Company policy requires the branch QR code — open the scanner sheet. */
  needsQr?: boolean;
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
  const { user } = useAuth();
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [myBranches, setMyBranches] = useState<MyBranches>({ branches: [], primaryBranchId: '', authorizedIds: [] });

  // Branch assignment (primary + additional authorized branches) — the punch
  // must be recorded against a branch, and the local geofence check should use
  // the BRANCH's coordinates when it has any (server precedence, mirrored).
  useEffect(() => {
    let dead = false;
    if (!effectiveCompanyId || !user?.id) {
      setMyBranches({ branches: [], primaryBranchId: '', authorizedIds: [] });
      return;
    }
    fetchMyBranches(effectiveCompanyId, user.id)
      .then((res) => { if (!dead) setMyBranches(res); })
      .catch(() => { if (!dead) setMyBranches({ branches: [], primaryBranchId: '', authorizedIds: [] }); });
    return () => { dead = true; };
  }, [effectiveCompanyId, user?.id]);

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
    async (opts?: { selfieUri?: string; qrToken?: string; branchId?: string }): Promise<CheckResult> => {
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

      // Geofence — the BRANCH's own coordinates win over the company office
      // (exact server precedence). Falls back to the office when the chosen
      // branch has none configured.
      const geofenceOn = policy.requireGeofence || policy.enableGeofence;
      const chosenBranch =
        myBranches.branches.find((b) => b.id === (opts?.branchId || myBranches.primaryBranchId)) ?? null;
      const geofence =
        chosenBranch && chosenBranch.latitude && chosenBranch.longitude
          ? {
              latitude: chosenBranch.latitude,
              longitude: chosenBranch.longitude,
              radiusMeters: chosenBranch.radiusMeters || policy.officeLocation?.radiusMeters || 100,
            }
          : policy.officeLocation;
      if (geofenceOn && geofence && geofence.latitude) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            return { ok: false, reason: 'Location permission is required to mark attendance.' };
          }
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const distance = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            geofence.latitude,
            geofence.longitude
          );
          const radius = geofence.radiusMeters || 100;
          if (distance > radius) {
            return {
              ok: false,
              reason: `You are ${distance}m from the ${chosenBranch ? 'branch' : 'office location'}. Attendance is allowed within ${radius}m.`,
            };
          }
        } catch {
          return { ok: false, reason: 'Could not verify your location. Please try again.' };
        }
      }

      // Branch QR code: the server rejects a punch without the scanned token
      // (QR_REQUIRED), so block here and open the scanner instead of letting
      // the punch fail remotely.
      if (policy.requireQr && !opts?.qrToken) {
        return { ok: false, needsQr: true, reason: 'Scan your branch QR code to check in.' };
      }

      // Selfie verification: camera capture required when enforced.
      const selfieRequired = !!(policy.requireSelfie || policy.requireFace || policy.enableSelfie);
      if (selfieRequired && !opts?.selfieUri) {
        return { ok: false, needsSelfie: true, reason: 'This office requires a selfie to mark attendance.' };
      }

      return { ok: true };
    },
    [policy, getCurrentNetwork, myBranches]
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

      // Geofence: same distance check as check-in, with the branch's own
      // coordinates taking precedence (a check-out is recorded on the same
      // branch the check-in used — the primary branch by default).
      const chosenBranch = myBranches.branches.find((b) => b.id === myBranches.primaryBranchId) ?? null;
      const geofence =
        chosenBranch && chosenBranch.latitude && chosenBranch.longitude
          ? {
              latitude: chosenBranch.latitude,
              longitude: chosenBranch.longitude,
              radiusMeters: chosenBranch.radiusMeters || policy.officeLocation?.radiusMeters || 100,
            }
          : policy.officeLocation;
      if ((policy.requireGeofence || policy.enableGeofence) && geofence && geofence.latitude) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            return { ok: false, reason: 'Location permission is required to check out.' };
          }
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const distance = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            geofence.latitude,
            geofence.longitude
          );
          const radius = geofence.radiusMeters || 100;
          if (distance > radius) {
            return {
              ok: false,
              reason: `You are ${distance}m from the ${chosenBranch ? 'branch' : 'office'}. Check-out is allowed within ${radius}m.`,
            };
          }
        } catch {
          return { ok: false, reason: 'Could not verify your location. Please try again.' };
        }
      }

      return { ok: true };
    },
    [policy, getCurrentNetwork, myBranches]
  );

  return {
    policy,
    policyLoading,
    /** Company policy demands the branch QR code on check-in. */
    qrRequired: !!policy?.requireQr,
    /** The account's punchable branches (primary first). Empty = office flow. */
    myBranches,
    validateCheckIn,
    validateCheckOut,
    getCheckInStatus,
  };
}
