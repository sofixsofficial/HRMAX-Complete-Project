import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Department } from '../types/user';
import { generateUniqueCode } from './codeGenerator';

const COLLECTION_NAME = 'departments';
const departmentsRef = collection(db, COLLECTION_NAME);

// Helper: strip undefined values for Firestore
const stripUndefined = (obj: Record<string, any>) => {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
};

const mapDept = (d: any): Department => ({
  id: d.id,
  name: d.data().name,
  code: d.data().code,
  color: d.data().color || '#3b82f6',
  companyId: d.data().companyId,
  managerId: d.data().managerId,
  managerName: d.data().managerName,
  description: d.data().description,
  employeeCount: d.data().employeeCount || 0,
  createdAt: d.data().createdAt?.toDate() || new Date(),
  createdBy: d.data().createdBy || '',
  createdByName: d.data().createdByName || '',
  createdByRole: d.data().createdByRole || '',
  teamLeaderName: d.data().teamLeaderName || '',
  executiveName: d.data().executiveName || '',
});

// Get all departments
export const getAllDepartments = async (): Promise<Department[]> => {
  const snapshot = await getDocs(departmentsRef);
  return snapshot.docs.map(mapDept);
};

// Get departments by company
export const getDepartmentsByCompany = async (companyId: string): Promise<Department[]> => {
  const q = query(departmentsRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDept);
};

// Create department
// code is generated when omitted; color may be omitted (readers fall back to
// their own palette) — both defaulted/stripped inside before writing the doc.
export const createDepartment = async (department: Omit<Department, 'id' | 'createdAt' | 'code' | 'color'> & { code?: string; color?: string }): Promise<Department> => {
  const code = department.code || await generateUniqueCode('departments', 'DEPT', 'code', department.companyId);
  const docRef = await addDoc(departmentsRef, {
    ...stripUndefined({ ...department, code } as any),
    employeeCount: department.employeeCount || 0,
    createdBy: department.createdBy || '',
    createdByName: department.createdByName || '',
    createdByRole: department.createdByRole || '',
    teamLeaderName: department.teamLeaderName || '',
    executiveName: department.executiveName || '',
    createdAt: serverTimestamp()
  });
  return { ...department, code, id: docRef.id } as Department;
};

// Update department
export const updateDepartment = async (id: string, updates: Partial<Department>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const { id: _ignore, createdAt: _c, ...clean } = updates as any;
  await updateDoc(docRef, stripUndefined({ ...clean, updatedAt: serverTimestamp() }));
};

// Delete department
export const deleteDepartment = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Get department stats
export const getDepartmentStats = async (companyId?: string) => {
  if (!companyId) return { total: 0, totalEmployees: 0, withManager: 0 };
  const departments = await getDepartmentsByCompany(companyId);

  const totalEmployees = departments.reduce((sum, d) => sum + (d.employeeCount || 0), 0);

  return {
    total: departments.length,
    totalEmployees,
    withManager: departments.filter(d => !!d.managerId).length
  };
};
