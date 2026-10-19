import {
  collection, getDocs, query, where
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Holiday } from '../types/user';

const COLLECTION_NAME = 'holidays';
const holidaysRef = collection(db, COLLECTION_NAME);

export const getAllHolidays = async (): Promise<Holiday[]> => {
  const snapshot = await getDocs(holidaysRef);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Holiday[];
};

export const getHolidaysByCompany = async (companyId: string): Promise<Holiday[]> => {
  const q = query(holidaysRef, where('companyId', 'in', [companyId, null]));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Holiday[];
};
