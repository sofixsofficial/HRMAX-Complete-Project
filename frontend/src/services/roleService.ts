import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  onSnapshot,
  serverTimestamp 
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { User, UserRole } from '../types/user';

const COLLECTION_NAME = 'roles';
const rolesRef = collection(db, COLLECTION_NAME);

export interface Role {
  id: string;
  name: string;
  description: string;
  icon: string;
  iconColor: string;
  roleType: 'System' | 'Custom';
  accessLevel: 'Full Access' | 'High Access' | 'Medium Access' | 'Low Access';
  usersAssigned: number;
  status: 'Active' | 'Inactive';
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Get all roles
export const getAllRoles = async (): Promise<Role[]> => {
  const snapshot = await getDocs(rolesRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date()
  })) as Role[];
};

// Real-time subscription to roles
export const subscribeToRoles = (
  onRoles: (roles: Role[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const unsubscribe = onSnapshot(
    rolesRef,
    (snapshot) => {
      const roles = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date()
      })) as Role[];
      onRoles(roles);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
  return unsubscribe;
};

// Get roles by status
export const getRolesByStatus = async (status: string): Promise<Role[]> => {
  const q = query(rolesRef, where('status', '==', status));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date()
  })) as Role[];
};

// Get roles by type
export const getRolesByType = async (type: 'System' | 'Custom'): Promise<Role[]> => {
  const q = query(rolesRef, where('roleType', '==', type));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date()
  })) as Role[];
};

// Get single role
export const getRoleById = async (id: string): Promise<Role | null> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
    createdAt: snapshot.data().createdAt?.toDate() || new Date(),
    updatedAt: snapshot.data().updatedAt?.toDate() || new Date()
  } as Role;
};

// Create role
export const createRole = async (role: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>): Promise<Role> => {
  const docRef = await addDoc(rolesRef, {
    ...role,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  
  return {
    ...role,
    id: docRef.id,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Role;
};

// Update role
export const updateRole = async (id: string, updates: Partial<Role>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp()
  });
};

// Delete role
export const deleteRole = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Clone role
export const cloneRole = async (role: Role): Promise<Role> => {
  const clonedRole: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> = {
    name: `${role.name} (Copy)`,
    description: role.description,
    icon: role.icon,
    iconColor: role.iconColor,
    roleType: 'Custom',
    status: 'Inactive',
    accessLevel: role.accessLevel,
    permissions: [...role.permissions],
    usersAssigned: 0
  };
  return createRole(clonedRole);
};

// Get role stats
export const getRoleStats = async () => {
  const roles = await getAllRoles();
  
  return {
    total: roles.length,
    active: roles.filter(r => r.status === 'Active').length,
    inactive: roles.filter(r => r.status === 'Inactive').length,
    system: roles.filter(r => r.roleType === 'System').length,
    custom: roles.filter(r => r.roleType === 'Custom').length,
    totalUsersAssigned: roles.reduce((sum, r) => sum + (r.usersAssigned || 0), 0)
  };
};

// Get users by role - queries users collection by role field
export const getUsersByRole = async (roleName: string): Promise<User[]> => {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('role', '==', roleName.toLowerCase().replace(' ', '-')));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as User[];
};
