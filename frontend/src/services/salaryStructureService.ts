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
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { SalaryStructure } from '../types/user';

const COLLECTION_NAME = 'salaryStructures';
const structuresRef = collection(db, COLLECTION_NAME);

export const computeGross = (s: Pick<SalaryStructure, 'basicSalary' | 'hra' | 'da' | 'conveyance' | 'medical' | 'specialAllowance'>): number => {
  return (s.basicSalary || 0) + (s.hra || 0) + (s.da || 0) + (s.conveyance || 0) + (s.medical || 0) + (s.specialAllowance || 0);
};

const mapStructure = (d: any): SalaryStructure => {
  const data = d.data();
  return {
    id: d.id,
    name: data.name,
    companyId: data.companyId,
    basicSalary: data.basicSalary || 0,
    hra: data.hra || 0,
    da: data.da || 0,
    conveyance: data.conveyance || 0,
    medical: data.medical || 0,
    specialAllowance: data.specialAllowance || 0,
    pf: data.pf || 0,
    professionalTax: data.professionalTax || 0,
    overtimeRate: data.overtimeRate || 0,
    grossSalary: data.grossSalary || 0,
    description: data.description,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date()
  };
};

export const getAllSalaryStructures = async (): Promise<SalaryStructure[]> => {
  const snapshot = await getDocs(structuresRef);
  return snapshot.docs.map(mapStructure);
};

export const getSalaryStructuresByCompany = async (companyId: string): Promise<SalaryStructure[]> => {
  const q = query(structuresRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapStructure);
};

export const createSalaryStructure = async (
  structure: Omit<SalaryStructure, 'id' | 'grossSalary' | 'createdAt' | 'updatedAt'>
): Promise<SalaryStructure> => {
  const grossSalary = computeGross(structure);
  const docRef = await addDoc(structuresRef, {
    ...structure,
    grossSalary,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { ...structure, grossSalary, id: docRef.id } as SalaryStructure;
};

export const updateSalaryStructure = async (
  id: string,
  updates: Partial<SalaryStructure>
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const { id: _i, createdAt: _c, ...clean } = updates as any;
  // recompute gross if any component changed
  if (
    clean.basicSalary !== undefined || clean.hra !== undefined || clean.da !== undefined ||
    clean.conveyance !== undefined || clean.medical !== undefined || clean.specialAllowance !== undefined
  ) {
    clean.grossSalary = computeGross(clean as any);
  }
  await updateDoc(docRef, { ...clean, updatedAt: serverTimestamp() });
};

export const deleteSalaryStructure = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};
