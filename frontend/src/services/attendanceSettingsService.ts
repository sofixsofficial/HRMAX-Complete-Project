import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query, where, serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { AttendancePolicy } from '../types/attendance';

const COLLECTION_NAME = 'attendanceSettings';
const ref = collection(db, COLLECTION_NAME);

const mapPolicy = (d: any): AttendancePolicy => {
  const data = d.data();
  return {
    id: d.id,
    companyId: data.companyId,
    mode: data.mode || 'gps-only',
    officeLocation: data.officeLocation || { name: '', address: '', latitude: 0, longitude: 0, radiusMeters: 100 },
    allowedWifis: data.allowedWifis || [],
    wifiOnly: data.wifiOnly ?? false,
    mobileDataAllowed: data.mobileDataAllowed ?? true,
    requireSelfie: data.requireSelfie ?? false,
    selfieExpirySeconds: data.selfieExpirySeconds ?? 30,
    gracePeriodMinutes: data.gracePeriodMinutes ?? 15,
    lateThresholdMinutes: data.lateThresholdMinutes ?? 60,
    autoCheckoutMinutes: data.autoCheckoutMinutes ?? 0,
    enableAutoCheckout: data.enableAutoCheckout ?? false,
    defaultShiftStart: data.defaultShiftStart ?? '09:00',
    defaultShiftEnd: data.defaultShiftEnd ?? '18:00',
    weekendDays: data.weekendDays ?? [0, 6],
    holidayCalendarId: data.holidayCalendarId || null,
    enableGeofence: data.enableGeofence ?? true,
    enableNetworkGuard: data.enableNetworkGuard ?? true,
    enableAntiSpoofing: data.enableAntiSpoofing ?? true,
    enableSelfie: data.enableSelfie ?? false,
    enableQr: data.enableQr ?? data.requireQr ?? false,
    requireFace: data.requireFace ?? data.requireSelfie ?? false,
    updatedAt: data.updatedAt?.toDate() || new Date(),
    updatedBy: data.updatedBy || '',
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate() || new Date(),
  };
};

export const getAttendancePolicy = async (companyId: string): Promise<AttendancePolicy | null> => {
  const q = query(ref, where('companyId', '==', companyId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return mapPolicy(snap.docs[0]);
};

export const saveAttendancePolicy = async (
  companyId: string,
  data: Partial<AttendancePolicy> & { updatedBy: string }
): Promise<AttendancePolicy> => {
  const q = query(ref, where('companyId', '==', companyId));
  const snap = await getDocs(q);
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
  };
  if (snap.empty) {
    const docRef = await addDoc(ref, {
      companyId,
      ...data,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return { ...payload, id: docRef.id, companyId, createdAt: new Date() } as AttendancePolicy;
  } else {
    await updateDoc(snap.docs[0].ref, payload);
    return { ...data, id: snap.docs[0].id, companyId, createdAt: new Date() } as AttendancePolicy;
  }
};

export const deleteAttendancePolicy = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};

export const subscribeAttendancePolicy = (
  companyId: string,
  callback: (policy: AttendancePolicy | null) => void,
  onError?: (err: any) => void
): (() => void) => {
  const q = query(ref, where('companyId', '==', companyId));
  const unsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      callback(null);
    } else {
      callback(mapPolicy(snap.docs[0]));
    }
  }, (err) => {
    console.error('[subscribeAttendancePolicy] error:', err?.message || err);
    if (onError) onError(err);
  });
  return unsub;
};

import { onSnapshot } from '../aws/firestore-compat';
