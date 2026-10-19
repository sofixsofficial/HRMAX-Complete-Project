import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '../config/firebase'
import type { BankAccount } from '../types/employeeProfile'

const getCol = (employeeId: string) => collection(db, 'employees', employeeId, 'bankAccounts')

const mapDoc = (id: string, data: any): BankAccount => ({
  id,
  employeeId: data.employeeId,
  accountHolderName: data.accountHolderName || '',
  bankName: data.bankName || '',
  accountNumber: data.accountNumber || '',
  ifscCode: data.ifscCode || '',
  panNumber: data.panNumber || '',
  upiId: data.upiId || '',
  isDefault: data.isDefault ?? false,
  createdAt: data.createdAt?.toDate?.() ?? new Date(),
  updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
})

export const getBankAccounts = async (employeeId: string): Promise<BankAccount[]> => {
  const snapshot = await getDocs(getCol(employeeId))
  return snapshot.docs.map(d => mapDoc(d.id, d.data()))
}

export const addBankAccount = async (employeeId: string, data: Omit<BankAccount, 'id' | 'employeeId' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  if (data.isDefault) {
    const existing = await getBankAccounts(employeeId)
    for (const acct of existing) {
      if (acct.isDefault) await updateDoc(doc(db, 'employees', employeeId, 'bankAccounts', acct.id), { isDefault: false })
    }
  }
  const docRef = await addDoc(getCol(employeeId), {
    ...data,
    employeeId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

export const updateBankAccount = async (employeeId: string, accountId: string, data: Partial<BankAccount>): Promise<void> => {
  if (data.isDefault) {
    const existing = await getBankAccounts(employeeId)
    for (const acct of existing) {
      if (acct.id !== accountId && acct.isDefault) await updateDoc(doc(db, 'employees', employeeId, 'bankAccounts', acct.id), { isDefault: false })
    }
  }
  await updateDoc(doc(db, 'employees', employeeId, 'bankAccounts', accountId), { ...data, updatedAt: serverTimestamp() })
}

export const deleteBankAccount = async (employeeId: string, accountId: string): Promise<void> => {
  await deleteDoc(doc(db, 'employees', employeeId, 'bankAccounts', accountId))
}
