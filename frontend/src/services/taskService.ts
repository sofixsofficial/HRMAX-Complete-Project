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
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Task } from '../types/user';

const COLLECTION_NAME = 'tasks';
const tasksRef = collection(db, COLLECTION_NAME);

// Get all tasks
export const getAllTasks = async (): Promise<Task[]> => {
  const snapshot = await getDocs(tasksRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date(),
    dueDate: doc.data().dueDate?.toDate() || new Date()
  })) as Task[];
};

// Get tasks by company
export const getTasksByCompany = async (companyId: string): Promise<Task[]> => {
  const q = query(tasksRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date(),
    dueDate: doc.data().dueDate?.toDate() || new Date()
  })) as Task[];
};

// Get tasks by user
export const getTasksByUser = async (userId: string): Promise<Task[]> => {
  const q = query(tasksRef, where('assignedToId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate() || new Date(),
    updatedAt: doc.data().updatedAt?.toDate() || new Date(),
    dueDate: doc.data().dueDate?.toDate() || new Date()
  })) as Task[];
};

// Create task
// avatar/dueDate are optional on create: the TL quick-create modal has no
// avatar or due-date inputs, and every reader guards for their absence.
export const createTask = async (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'avatar' | 'dueDate'> & { avatar?: string; dueDate?: Date }): Promise<Task> => {
  const docRef = await addDoc(tasksRef, {
    ...task,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  
  return {
    ...task,
    id: docRef.id,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Task;
};

// Update task
export const updateTask = async (id: string, updates: Partial<Task>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp()
  });
};

// Update task progress
export const updateTaskProgress = async (id: string, progress: number): Promise<void> => {
  const status = progress === 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Pending';
  await updateTask(id, { progress, status });
};

// Delete task
export const deleteTask = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Get task stats
export const getTaskStats = async (companyId?: string, userId?: string) => {
  if (userId) {
    const tasks = await getTasksByUser(userId);
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'Completed').length,
      inProgress: tasks.filter(t => t.status === 'In Progress').length,
      pending: tasks.filter(t => t.status === 'Pending').length,
      overdue: tasks.filter(t => new Date(t.dueDate) < new Date() && t.status !== 'Completed').length
    };
  }
  if (!companyId) return { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 };
  const tasks = await getTasksByCompany(companyId);
  
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    pending: tasks.filter(t => t.status === 'Pending').length,
    overdue: tasks.filter(t => new Date(t.dueDate) < new Date() && t.status !== 'Completed').length
  };
};
