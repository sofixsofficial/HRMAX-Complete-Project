import {
  collection, getDocs, doc,
  query, where
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import type { Task } from '../types/user';

const COLLECTION_NAME = 'tasks';
const tasksRef = collection(db, COLLECTION_NAME);

export const createTask = async (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const callableFn = httpsCallable(functions, 'mobileCreateTask');
  const result = await callableFn({ ...data });
  return result.data as string;
};

export const getAllTasks = async (): Promise<Task[]> => {
  const snapshot = await getDocs(tasksRef);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Task[];
};

export const getTasksByCompany = async (companyId: string): Promise<Task[]> => {
  const q = query(tasksRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Task[];
};

export const getTasksByUser = async (userId: string): Promise<Task[]> => {
  const q = query(tasksRef, where('assignedToId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Task[];
};

export const updateTask = async (id: string, updates: Partial<Task>): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileUpdateTask');
  await callableFn({ taskId: id, ...updates });
};

export const getTaskStats = async (companyId?: string, userId?: string) => {
  let tasks: Task[];
  if (userId) tasks = await getTasksByUser(userId);
  else if (companyId) tasks = await getTasksByCompany(companyId);
  else tasks = await getAllTasks();
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    pending: tasks.filter(t => t.status === 'Pending').length,
    overdue: tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Completed').length,
  };
};
