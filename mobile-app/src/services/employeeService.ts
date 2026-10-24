import {
  collection, getDocs, doc, getDoc, query, where, serverTimestamp, onSnapshot,
} from '../aws/firestore-compat';
import { createUserWithEmailAndPassword } from '../aws/auth-compat';
import { auth, db } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';

const COLLECTION_NAME = 'employees';
const employeesRef = collection(db, COLLECTION_NAME);

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone?: string;
  employeeId?: string;
  userId?: string;
  designation?: string;
  department?: string;
  departmentId?: string;
  role?: string;
  status?: string;
  companyId: string;
  joinDate?: any;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

const mapEmp = (d: any): Employee => ({
  id: d.id,
  ...d.data(),
  joinDate: d.data().joinDate?.toDate?.() || d.data().joinDate,
  createdAt: d.data().createdAt?.toDate?.() || new Date(),
});

export const getAllEmployees = async (): Promise<Employee[]> => {
  const snap = await getDocs(employeesRef);
  return snap.docs.map(mapEmp);
};

export const getEmployeesByCompany = async (companyId: string): Promise<Employee[]> => {
  const q = query(employeesRef, where('companyId', '==', companyId));
  const snap = await getDocs(q);
  return snap.docs.map(mapEmp);
};

export const subscribeEmployees = (
  companyId: string | null,
  callback: (emps: Employee[]) => void
): (() => void) => {
  const q = companyId
    ? query(employeesRef, where('companyId', '==', companyId))
    : employeesRef;
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapEmp));
  }, (err) => {
    console.warn('Firestore sync warning handled cleanly (employees):', err.message);
    callback([]);
  });
  return unsub;
};

/**
 * Real-time employees across MULTIPLE companies ("All Companies" mode).
 * Firestore caps `in` at 10 values, so ids are chunked and merged.
 */
export const subscribeEmployeesScoped = (
  companyIds: string[],
  callback: (emps: Employee[]) => void
): (() => void) => {
  if (companyIds.length === 0) {
    callback([]);
    return () => {};
  }
  const chunks: string[][] = [];
  for (let i = 0; i < companyIds.length; i += 10) chunks.push(companyIds.slice(i, i + 10));
  const cache = new Map<string, Employee[]>();
  let reported = false;
  const report = () => {
    const all: Employee[] = [];
    chunks.forEach((c) => (cache.get(c.join('|')) || []).forEach((e) => all.push(e)));
    callback(all);
  };
  const unsubs = chunks.map((chunk) => {
    const key = chunk.join('|');
    const unsub = onSnapshot(
      query(employeesRef, where('companyId', 'in', chunk)),
      (snap) => {
        cache.set(key, snap.docs.map(mapEmp));
        reported = true;
        report();
      },
      (err: any) => {
        console.warn('Firestore sync warning handled cleanly (employees scoped):', err?.message || err);
        cache.set(key, []);
        report();
      }
    );
    return unsub;
  });
  void reported;
  return () => unsubs.forEach((u) => { try { u(); } catch {} });
};

export const createEmployee = async (
  data: Partial<Employee>,
  password?: string
): Promise<Employee & { tempPassword?: string }> => {
  const effectivePassword = password || 'HRM@1234';

  const callableFn = httpsCallable(functions, 'mobileCreateEmployee');
  const result = await callableFn({
    employeeData: {
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      employeeId: data.employeeId || '',
      designation: data.designation || '',
      department: data.department || '',
      departmentId: data.departmentId || '',
      role: data.role || 'employee',
      status: data.status || 'Active',
      companyId: data.companyId || '',
      joinDate: data.joinDate || new Date().toISOString(),
      salary: data.salary || 0,
      ...data,
    },
    password: effectivePassword,
  });

  const resData = result.data as any;
  return { ...data, id: resData.id, userId: resData.userId, tempPassword: effectivePassword } as Employee & { tempPassword?: string };
};

export const updateEmployee = async (id: string, data: Partial<Employee>): Promise<void> => {
  const { id: _ignore, createdAt: _c, ...clean } = data as any;
  const callableFn = httpsCallable(functions, 'mobileUpdateEmployee');
  await callableFn({ employeeId: id, ...clean });
};
