import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

export interface AttendancePolicy {
  id: string;
  companyId: string;
  mode: string;
  officeLocation: { name: string; address: string; latitude: number; longitude: number; radiusMeters: number };
  allowedWifis: { ssid: string; bssid?: string }[];
  wifiOnly: boolean;
  mobileDataAllowed: boolean;
  requireSelfie: boolean;
  selfieExpirySeconds: number;
  gracePeriodMinutes: number;
  lateThresholdMinutes: number;
  autoCheckoutMinutes: number;
  enableAutoCheckout: boolean;
  defaultShiftStart: string;
  defaultShiftEnd: string;
  weekendDays: number[];
  holidayCalendarId: string | null;
  enableGeofence: boolean;
  enableNetworkGuard: boolean;
  enableAntiSpoofing: boolean;
  enableSelfie: boolean;
  updatedAt: Date;
  updatedBy: string;
  createdBy: string;
  createdAt: Date;
}

const ref = collection(db, 'attendanceSettings');

const mapPolicy = (d: any): AttendancePolicy => ({
  id: d.id,
  companyId: d.data().companyId || '',
  mode: d.data().mode || 'gps-only',
  officeLocation: d.data().officeLocation || { name: '', address: '', latitude: 0, longitude: 0, radiusMeters: 100 },
  allowedWifis: d.data().allowedWifis || [],
  wifiOnly: d.data().wifiOnly ?? false,
  mobileDataAllowed: d.data().mobileDataAllowed ?? true,
  requireSelfie: d.data().requireSelfie ?? false,
  selfieExpirySeconds: d.data().selfieExpirySeconds ?? 30,
  gracePeriodMinutes: d.data().gracePeriodMinutes ?? 15,
  lateThresholdMinutes: d.data().lateThresholdMinutes ?? 60,
  autoCheckoutMinutes: d.data().autoCheckoutMinutes ?? 0,
  enableAutoCheckout: d.data().enableAutoCheckout ?? false,
  defaultShiftStart: d.data().defaultShiftStart || '09:00',
  defaultShiftEnd: d.data().defaultShiftEnd || '18:00',
  weekendDays: d.data().weekendDays ?? [0, 6],
  holidayCalendarId: d.data().holidayCalendarId || null,
  enableGeofence: d.data().enableGeofence ?? true,
  enableNetworkGuard: d.data().enableNetworkGuard ?? true,
  enableAntiSpoofing: d.data().enableAntiSpoofing ?? true,
  enableSelfie: d.data().enableSelfie ?? false,
  updatedAt: d.data().updatedAt?.toDate?.() || d.data().updatedAt || new Date(),
  updatedBy: d.data().updatedBy || '',
  createdBy: d.data().createdBy || '',
  createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || new Date(),
});

export const saveAttendancePolicy = async (companyId: string, data: Partial<AttendancePolicy> & { updatedBy: string }): Promise<AttendancePolicy> => {
  const callableFn = httpsCallable(functions, 'mobileSaveAttendancePolicy');
  const result = await callableFn({ companyId, ...data });
  const resData = result.data as any;
  return { ...data, id: resData.id, companyId } as AttendancePolicy;
};

export const subscribeAttendancePolicy = (companyId: string, callback: (policy: AttendancePolicy | null) => void): (() => void) => {
  const q = query(ref, where('companyId', '==', companyId));
  return onSnapshot(q, (snap) => {
    if (snap.empty) { callback(null); return; }
    callback(mapPolicy(snap.docs[0]));
  }, () => callback(null));
};
