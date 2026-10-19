import {
  collection, doc, getDocs, getDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import type { User, CompanyAdminStatus } from '../types/user';
import { createNotification } from './notificationService';

function getMasterCompanyId(): string {
  const user = auth.currentUser;
  return 'master-admin';
}

// Subscribe to all company-admin users (real-time)
export function subscribeCompanyAdmins(
  callback: (admins: User[]) => void
): () => void {
  const q = query(
    collection(db, 'users'),
    where('role', '==', 'company-admin')
  );

  return onSnapshot(q, (snapshot) => {
    const admins = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate() || new Date(),
      approvedAt: doc.data().approvedAt?.toDate() || null,
      suspendedAt: doc.data().suspendedAt?.toDate() || null,
    })) as User[];
    admins.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    callback(admins);
  }, (err) => {
    console.error('Company admin subscription error:', err);
    callback([]);
  });
}

// Approve a company admin
export async function approveCompanyAdmin(adminId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  if (currentUserDoc.data().role !== 'master-admin') throw new Error('Only Master Admin can approve accounts');

  await updateDoc(doc(db, 'users', adminId), {
    status: 'Approved',
    isApproved: true,
    isActive: true,
    approvedBy: currentUser.uid,
    approvedAt: serverTimestamp(),
    rejectionReason: null,
    updatedAt: serverTimestamp(),
  });

  const adminDoc = await getDoc(doc(db, 'users', adminId));
  if (adminDoc.exists()) {
    const admin = adminDoc.data() as User;
    createNotification(
      adminId,
      'general',
      'Account Approved',
      'Your Company Admin account has been approved by the Master Admin. You can now log in.',
      '/login',
      admin.companyId || getMasterCompanyId()
    ).catch(() => {});
  }
}

// Reject a company admin
export async function rejectCompanyAdmin(adminId: string, reason: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  if (currentUserDoc.data().role !== 'master-admin') throw new Error('Only Master Admin can reject accounts');

  await updateDoc(doc(db, 'users', adminId), {
    status: 'Rejected',
    isApproved: false,
    isActive: false,
    approvedBy: currentUser.uid,
    approvedAt: serverTimestamp(),
    rejectionReason: reason,
    updatedAt: serverTimestamp(),
  });

  const adminDoc = await getDoc(doc(db, 'users', adminId));
  if (adminDoc.exists()) {
    const admin = adminDoc.data() as User;
    createNotification(
      adminId,
      'general',
      'Account Rejected',
      `Your Company Admin account request has been rejected. Reason: ${reason}`,
      '/login',
      admin.companyId || getMasterCompanyId()
    ).catch(() => {});
  }
}

// Suspend a company admin
export async function suspendCompanyAdmin(adminId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  if (currentUserDoc.data().role !== 'master-admin') throw new Error('Only Master Admin can suspend accounts');

  await updateDoc(doc(db, 'users', adminId), {
    status: 'Suspended',
    isApproved: false,
    isActive: false,
    suspendedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const adminDoc = await getDoc(doc(db, 'users', adminId));
  if (adminDoc.exists()) {
    const admin = adminDoc.data() as User;
    createNotification(
      adminId,
      'general',
      'Account Suspended',
      'Your Company Admin account has been suspended. Please contact the system administrator.',
      '/login',
      admin.companyId || getMasterCompanyId()
    ).catch(() => {});
  }
}

// Reactivate a suspended/rejected company admin
export async function reactivateCompanyAdmin(adminId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  if (currentUserDoc.data().role !== 'master-admin') throw new Error('Only Master Admin can reactivate accounts');

  await updateDoc(doc(db, 'users', adminId), {
    status: 'Approved',
    isApproved: true,
    isActive: true,
    rejectionReason: null,
    updatedAt: serverTimestamp(),
  });

  const adminDoc = await getDoc(doc(db, 'users', adminId));
  if (adminDoc.exists()) {
    const admin = adminDoc.data() as User;
    createNotification(
      adminId,
      'general',
      'Account Reactivated',
      'Your Company Admin account has been reactivated by the Master Admin. You can now log in.',
      '/login',
      admin.companyId || getMasterCompanyId()
    ).catch(() => {});
  }
}

// Delete a company admin
export async function deleteCompanyAdmin(adminId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  if (currentUserDoc.data().role !== 'master-admin') throw new Error('Only Master Admin can delete accounts');

  await deleteDoc(doc(db, 'users', adminId));
}

// Get all company admins (one-time fetch)
export async function getAllCompanyAdmins(): Promise<User[]> {
  const q = query(
    collection(db, 'users'),
    where('role', '==', 'company-admin')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date(),
    approvedAt: doc.data().approvedAt?.toDate() || null,
    suspendedAt: doc.data().suspendedAt?.toDate() || null,
  })) as User[];
}

// Get company admin stats
export async function getCompanyAdminStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  suspended: number;
}> {
  const all = await getAllCompanyAdmins();
  return {
    total: all.length,
    pending: all.filter(a => (a.status || 'Pending') === 'Pending').length,
    approved: all.filter(a => a.status === 'Approved').length,
    rejected: all.filter(a => a.status === 'Rejected').length,
    suspended: all.filter(a => a.status === 'Suspended').length,
  };
}
