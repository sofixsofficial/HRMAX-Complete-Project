import {
  collection, getDocs, doc, query, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const COLLECTION_NAME = 'departments';
const deptsRef = collection(db, COLLECTION_NAME);

export interface Department {
  id: string;
  name: string;
  code?: string;
  color?: string;
  companyId: string;
  managerId?: string;
  managerName?: string;
  description?: string;
  employeeCount?: number;
  createdAt?: any;
  updatedAt?: any;
}

const mapDept = (d: any): Department => ({
  id: d.id,
  ...d.data(),
  createdAt: d.data().createdAt?.toDate?.() || new Date(),
});

export const getDepartmentsByCompany = async (companyId: string): Promise<Department[]> => {
  const q = query(deptsRef, where('companyId', '==', companyId));
  const snap = await getDocs(q);
  return snap.docs.map(mapDept);
};

export const subscribeDepartments = (
  companyId: string | null,
  callback: (depts: Department[]) => void
): (() => void) => {
  const q = companyId
    ? query(deptsRef, where('companyId', '==', companyId))
    : deptsRef;
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapDept));
  }, (err) => {
    console.warn('Firestore sync warning handled cleanly (departments):', err.message);
    callback([]);
  });
  return unsub;
};

/**
 * Real-time departments across MULTIPLE companies ("All Companies" mode).
 * Firestore caps `in` at 10 values, so ids are chunked and merged.
 */
export const subscribeDepartmentsScoped = (
  companyIds: string[],
  callback: (depts: Department[]) => void
): (() => void) => {
  if (companyIds.length === 0) {
    callback([]);
    return () => {};
  }
  const chunks: string[][] = [];
  for (let i = 0; i < companyIds.length; i += 10) chunks.push(companyIds.slice(i, i + 10));
  const cache = new Map<string, Department[]>();
  const report = () => {
    const all: Department[] = [];
    chunks.forEach((c) => (cache.get(c.join('|')) || []).forEach((d) => all.push(d)));
    callback(all);
  };
  const unsubs = chunks.map((chunk) => {
    const key = chunk.join('|');
    return onSnapshot(
      query(deptsRef, where('companyId', 'in', chunk)),
      (snap) => {
        cache.set(key, snap.docs.map(mapDept));
        report();
      },
      (err: any) => {
        console.warn('Firestore sync warning handled cleanly (departments scoped):', err?.message || err);
        cache.set(key, []);
        report();
      }
    );
  });
  return () => unsubs.forEach((u) => { try { u(); } catch {} });
};

export const createDepartment = async (data: Partial<Department>): Promise<Department> => {
  const callableFn = httpsCallable(functions, 'mobileCreateDepartment');
  const result = await callableFn({
    ...data,
    employeeCount: data.employeeCount || 0,
  });
  return { ...data, id: result.data as string } as Department;
};

export const updateDepartment = async (id: string, data: Partial<Department>): Promise<void> => {
  const { id: _ignore, createdAt: _c, ...clean } = data as any;
  const callableFn = httpsCallable(functions, 'mobileUpdateDepartment');
  await callableFn({ departmentId: id, ...clean });
};

export const deleteDepartment = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteDepartment');
  await callableFn({ departmentId: id });
};
