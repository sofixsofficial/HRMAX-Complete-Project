import {
  collection, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { AttendanceLog } from '../types/attendance';

const COLLECTION_NAME = 'attendanceLogs';
const ref = collection(db, COLLECTION_NAME);

const mapLog = (d: any): AttendanceLog => {
  const data = d.data();
  return {
    id: d.id,
    attendanceId: data.attendanceId || null,
    userId: data.userId,
    companyId: data.companyId,
    action: data.action || 'verify',
    status: data.status || 'failure',
    reasonCode: data.reasonCode || null,
    reasonMessage: data.reasonMessage || null,
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    deviceId: data.deviceId || null,
    deviceModel: data.deviceModel || null,
    batteryLevel: data.batteryLevel || null,
    networkType: data.networkType || null,
    wifiSsid: data.wifiSsid || null,
    isVpn: data.isVpn ?? null,
    isMockLocation: data.isMockLocation ?? null,
    isEmulator: data.isEmulator ?? null,
    ipAddress: data.ipAddress || null,
    timestamp: data.timestamp?.toDate() || new Date(),
  };
};

export const logAttendanceEvent = async (
  data: Omit<AttendanceLog, 'id' | 'timestamp'>
): Promise<string> => {
  const docRef = await addDoc(ref, {
    ...data,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
};

export const getAttendanceLogsByCompany = async (
  companyId: string,
  maxResults: number = 100
): Promise<AttendanceLog[]> => {
  const q = query(
    ref,
    where('companyId', '==', companyId),
    orderBy('timestamp', 'desc'),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapLog);
};

export const getAttendanceLogsByUser = async (
  userId: string,
  maxResults: number = 50
): Promise<AttendanceLog[]> => {
  const q = query(
    ref,
    where('userId', '==', userId),
    orderBy('timestamp', 'desc'),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapLog);
};

export const getRecentFailedAttempts = async (
  companyId: string,
  minutes: number = 15,
  maxResults: number = 20
): Promise<AttendanceLog[]> => {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const q = query(
    ref,
    where('companyId', '==', companyId),
    where('status', '==', 'failure'),
    where('timestamp', '>=', since),
    orderBy('timestamp', 'desc'),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapLog);
};
