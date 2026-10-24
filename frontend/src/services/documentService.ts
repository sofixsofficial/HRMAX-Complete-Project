import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import type { EmployeeDocument } from '../types/employeeProfile'

const getCol = (employeeId: string) => query(collection(db, 'documents'), where('employeeId', '==', employeeId))

const mapDoc = (id: string, data: any): EmployeeDocument => ({
  id,
  employeeId: data.employeeId,
  name: data.name || '',
  category: data.category || 'Other',
  fileUrl: data.fileUrl || '',
  fileSize: data.fileSize || 0,
  mimeType: data.mimeType || '',
  uploadedAt: data.uploadedAt?.toDate?.() ?? new Date(),
  uploadedBy: data.uploadedBy || '',
})

export const getDocuments = async (employeeId: string): Promise<EmployeeDocument[]> => {
  const snapshot = await getDocs(getCol(employeeId))
  return snapshot.docs.map(d => mapDoc(d.id, d.data()))
}

// uploadedBy comes from the third argument (written below), not from `data`.
export const addDocument = async (employeeId: string, data: Omit<EmployeeDocument, 'id' | 'employeeId' | 'uploadedAt' | 'uploadedBy'>, uploadedBy: string): Promise<string> => {
  const docRef = await addDoc(collection(db, 'documents'), {
    ...data,
    employeeId,
    uploadedBy,
    uploadedAt: serverTimestamp(),
  })
  return docRef.id
}

export const deleteDocument = async (employeeId: string, documentId: string): Promise<void> => {
  await deleteDoc(doc(db, 'documents', documentId))
}
