import { collection, query, where, getDocs, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { SalaryStructure } from '../types/user';

const ref = collection(db, 'salaryStructures');

export const computeGross = (s: { basicSalary: number; hra: number; da: number; conveyance: number; medical: number; specialAllowance: number }) =>
  s.basicSalary + s.hra + s.da + s.conveyance + s.medical + s.specialAllowance;

const mapStructure = (d: any): SalaryStructure => ({
  id: d.id,
  name: d.data().name || '',
  companyId: d.data().companyId || '',
  basicSalary: d.data().basicSalary || 0,
  hra: d.data().hra || 0,
  da: d.data().da || 0,
  conveyance: d.data().conveyance || 0,
  medical: d.data().medical || 0,
  specialAllowance: d.data().specialAllowance || 0,
  pf: d.data().pf || 0,
  professionalTax: d.data().professionalTax || 0,
  overtimeRate: d.data().overtimeRate || 0,
  grossSalary: d.data().grossSalary || 0,
  description: d.data().description,
  createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt,
  updatedAt: d.data().updatedAt?.toDate?.() || d.data().updatedAt,
});

export const getSalaryStructuresByCompany = async (companyId: string): Promise<SalaryStructure[]> => {
  const snap = await getDocs(query(ref, where('companyId', '==', companyId)));
  return snap.docs.map(mapStructure);
};

export const createSalaryStructure = async (data: Omit<SalaryStructure, 'id' | 'grossSalary'>): Promise<SalaryStructure> => {
  const grossSalary = computeGross(data);
  const callableFn = httpsCallable(functions, 'mobileCreateSalaryStructure');
  const result = await callableFn({ ...data, grossSalary });
  return { ...data, id: result.data as string, grossSalary };
};

export const updateSalaryStructure = async (id: string, updates: Partial<SalaryStructure>): Promise<void> => {
  const grossSalary = updates.basicSalary !== undefined || updates.hra !== undefined || updates.da !== undefined ||
    updates.conveyance !== undefined || updates.medical !== undefined || updates.specialAllowance !== undefined
    ? computeGross({
        basicSalary: updates.basicSalary ?? 0,
        hra: updates.hra ?? 0,
        da: updates.da ?? 0,
        conveyance: updates.conveyance ?? 0,
        medical: updates.medical ?? 0,
        specialAllowance: updates.specialAllowance ?? 0,
      })
    : undefined;
  const callableFn = httpsCallable(functions, 'mobileUpdateSalaryStructure');
  await callableFn({ structureId: id, ...updates, ...(grossSalary !== undefined ? { grossSalary } : {}) });
};

export const deleteSalaryStructure = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteSalaryStructure');
  await callableFn({ structureId: id });
};
