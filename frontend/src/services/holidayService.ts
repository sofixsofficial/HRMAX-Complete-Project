import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  orderBy 
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { Holiday } from '../types/user';

const COLLECTION_NAME = 'holidays';
const holidaysRef = collection(db, COLLECTION_NAME);

// Get all holidays
export const getAllHolidays = async (): Promise<Holiday[]> => {
  const snapshot = await getDocs(holidaysRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    date: doc.data().date?.toDate() || new Date()
  })) as Holiday[];
};

// Get holidays by company
export const getHolidaysByCompany = async (companyId: string): Promise<Holiday[]> => {
  const q = query(
    holidaysRef, 
    where('companyId', 'in', [companyId, null])
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    date: doc.data().date?.toDate() || new Date()
  })) as Holiday[];
};

// Get upcoming holidays
export const getUpcomingHolidays = async (limit: number = 5): Promise<Holiday[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const q = query(
    holidaysRef,
    where('date', '>=', today),
    orderBy('date', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs
    .slice(0, limit)
    .map(doc => ({
      id: doc.id,
      ...doc.data(),
      date: doc.data().date?.toDate() || new Date()
    })) as Holiday[];
};

// Create holiday
export const createHoliday = async (holiday: Omit<Holiday, 'id'>): Promise<Holiday> => {
  const docRef = await addDoc(holidaysRef, holiday);
  return {
    ...holiday,
    id: docRef.id
  } as Holiday;
};

// Update holiday
export const updateHoliday = async (id: string, updates: Partial<Holiday>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, updates);
};

// Delete holiday
export const deleteHoliday = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};
