import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import type { EmployeeContract } from '../types/employeeProfile'

const getCol = (employeeId: string) => query(collection(db, 'contracts'), where('employeeId', '==', employeeId))

const mapDoc = (id: string, data: any): EmployeeContract => ({
  id,
  employeeId: data.employeeId,
  type: data.type || 'Full-time',
  startDate: data.startDate?.toDate?.() ?? new Date(data.startDate),
  endDate: data.endDate?.toDate?.() ?? data.endDate,
  status: data.status || 'Active',
  documentUrl: data.documentUrl || '',
  salary: data.salary,
  notes: data.notes || '',
  createdAt: data.createdAt?.toDate?.() ?? new Date(),
  updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
})

export const getContracts = async (employeeId: string): Promise<EmployeeContract[]> => {
  const snapshot = await getDocs(getCol(employeeId))
  return snapshot.docs.map(d => mapDoc(d.id, d.data()))
}

export const addContract = async (employeeId: string, data: Omit<EmployeeContract, 'id' | 'employeeId' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const docRef = await addDoc(collection(db, 'contracts'), {
    ...data,
    employeeId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

export const updateContract = async (employeeId: string, contractId: string, data: Partial<EmployeeContract>): Promise<void> => {
  await updateDoc(doc(db, 'contracts', contractId), { ...data, updatedAt: serverTimestamp() })
}

export const deleteContract = async (employeeId: string, contractId: string): Promise<void> => {
  await deleteDoc(doc(db, 'contracts', contractId))
}
