import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query, where, serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { ShiftConfig } from '../types/user';

const COLLECTION_NAME = 'shiftConfigs';
const ref = collection(db, COLLECTION_NAME);

const mapShift = (d: any): ShiftConfig => {
  const data = d.data();
  return {
    id: d.id,
    companyId: data.companyId,
    name: data.name,
    type: data.type || 'Custom',
    startTime: data.startTime,
    endTime: data.endTime,
    description: data.description || '',
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

export const getAllShifts = async (): Promise<ShiftConfig[]> => {
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(mapShift);
};

export const getShiftsByCompany = async (companyId: string): Promise<ShiftConfig[]> => {
  const q = query(ref, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapShift);
};

export const getShiftById = async (id: string): Promise<ShiftConfig | null> => {
  const snap = await getDoc(doc(db, COLLECTION_NAME, id));
  if (!snap.exists()) return null;
  return mapShift(snap);
};

export const createShift = async (data: Omit<ShiftConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ShiftConfig> => {
  const docRef = await addDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { ...data, id: docRef.id, createdAt: new Date(), updatedAt: new Date() };
};

export const updateShift = async (id: string, updates: Partial<ShiftConfig>): Promise<void> => {
  await updateDoc(doc(db, COLLECTION_NAME, id), { ...updates, updatedAt: serverTimestamp() });
};

export const deleteShift = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};

// ============================================
// COMPANY SETTINGS (grace period, etc.)
// ============================================
import type { CompanySettings } from '../types/user';

const SETTINGS_COLLECTION = 'companySettings';

export const getCompanySettings = async (companyId: string): Promise<CompanySettings | null> => {
  const q = query(collection(db, SETTINGS_COLLECTION), where('companyId', '==', companyId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return {
    id: d.id,
    companyId: data.companyId,
    gracePeriodMinutes: data.gracePeriodMinutes ?? 15,
    missedPunchThresholdMinutes: data.missedPunchThresholdMinutes ?? 60,
    autoApprovalEnabled: data.autoApprovalEnabled ?? true,
    createdAt: data.createdAt?.toDate(),
    updatedAt: data.updatedAt?.toDate(),
  };
};

export const saveCompanySettings = async (settings: Omit<CompanySettings, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
  const q = query(collection(db, SETTINGS_COLLECTION), where('companyId', '==', settings.companyId));
  const snap = await getDocs(q);
  if (snap.empty) {
    await addDoc(collection(db, SETTINGS_COLLECTION), {
      ...settings,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(snap.docs[0].ref, { ...settings, updatedAt: serverTimestamp() });
  }
};
