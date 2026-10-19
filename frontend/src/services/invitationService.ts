import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';

export interface Invitation {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
  departmentId: string | null;
  token: string;
  status: 'pending' | 'accepted' | 'cancelled';
  invitedBy: string;
  invitedByName: string;
  createdAt: any;
  expiresAt: any;
  acceptedBy?: string;
  acceptedAt?: any;
}

/**
 * Get pending invitations by company
 */
export const getPendingInvitations = async (companyId?: string): Promise<Invitation[]> => {
  try {
    let q;
    if (companyId) {
      q = query(
        collection(db, 'invitations'),
        where('companyId', '==', companyId),
        where('status', '==', 'pending')
      );
    } else {
      q = query(
        collection(db, 'invitations'),
        where('status', '==', 'pending')
      );
    }
    
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Invitation[];
    
    // Sort client-side to avoid composite index requirements
    return items.sort((a, b) => {
      const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bTime - aTime;
    });
  } catch (error) {
    console.error('Get pending invitations error:', error);
    return [];
  }
};

/**
 * Cancel an invitation
 */
export const cancelInvitation = async (inviteId: string): Promise<void> => {
  try {
    const inviteRef = doc(db, 'invitations', inviteId);
    await updateDoc(inviteRef, {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Cancel invitation error:', error);
    throw new Error('Failed to cancel invitation');
  }
};
