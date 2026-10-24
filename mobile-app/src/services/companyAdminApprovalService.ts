import {
  collection, doc,
  query, where, onSnapshot,
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';
import type { User } from '../types/user';

export function subscribeCompanyAdmins(callback: (admins: User[]) => void): () => void {
  const q = query(collection(db, 'users'), where('role', '==', 'company-admin'));
  return onSnapshot(q, (snapshot) => {
    const admins = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as User[];
    admins.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    callback(admins);
  }, (err) => {
    console.warn('Firestore sync warning handled cleanly (company admins):', err.message);
    callback([]);
  });
}

export async function approveCompanyAdmin(adminId: string): Promise<void> {
  const callableFn = httpsCallable(functions, 'mobileApproveCompanyAdmin');
  await callableFn({ adminId });
}

export async function rejectCompanyAdmin(adminId: string, reason: string): Promise<void> {
  const callableFn = httpsCallable(functions, 'mobileRejectCompanyAdmin');
  await callableFn({ adminId, reason });
}

export async function suspendCompanyAdmin(adminId: string): Promise<void> {
  const callableFn = httpsCallable(functions, 'mobileSuspendCompanyAdmin');
  await callableFn({ adminId });
}

export async function reactivateCompanyAdmin(adminId: string): Promise<void> {
  const callableFn = httpsCallable(functions, 'mobileReactivateCompanyAdmin');
  await callableFn({ adminId });
}

export async function deleteCompanyAdmin(adminId: string): Promise<void> {
  const callableFn = httpsCallable(functions, 'mobileDeleteCompanyAdmin');
  await callableFn({ adminId });
}
