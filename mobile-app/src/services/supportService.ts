import { collection, doc, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import type { SupportTicket, TicketMessage } from '../types/user';

const COLLECTION_NAME = 'tickets';
const ticketsRef = collection(db, COLLECTION_NAME);

const mapTicket = (d: any): SupportTicket => {
  const data = d.data();
  return {
    id: d.id,
    title: data.title || '',
    description: data.description || '',
    status: data.status || 'Open',
    priority: data.priority || 'Medium',
    createdBy: data.createdBy || '',
    createdById: data.createdById || '',
    assignedTo: data.assignedTo || '',
    createdAt: data.createdAt?.toDate?.() || data.createdAt || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || new Date(),
    resolvedAt: data.resolvedAt?.toDate?.() || data.resolvedAt || null,
    category: data.category || 'General',
    companyId: data.companyId || '',
    companyName: data.companyName || '',
    conversation: (data.conversation || []).map((m: any) => ({
      id: m.id,
      userId: m.userId,
      userName: m.userName,
      message: m.message,
      timestamp: m.timestamp?.toDate?.() || m.timestamp,
    })),
  };
};

export const subscribeTickets = (
  companyId: string | null,
  callback: (tickets: SupportTicket[]) => void
): (() => void) => {
  const q = companyId
    ? query(ticketsRef, where('companyId', '==', companyId), orderBy('createdAt', 'desc'))
    : query(ticketsRef, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapTicket));
  }, () => callback([]));
};

export const subscribeTicketsByUser = (
  userId: string,
  callback: (tickets: SupportTicket[]) => void
): (() => void) => {
  const q = query(ticketsRef, where('createdById', '==', userId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapTicket));
  }, () => callback([]));
};

export const getAllTickets = async (): Promise<SupportTicket[]> => {
  const snap = await getDocs(query(ticketsRef, orderBy('createdAt', 'desc')));
  return snap.docs.map(mapTicket);
};

export const getTicketsByCompany = async (companyId: string): Promise<SupportTicket[]> => {
  const snap = await getDocs(query(ticketsRef, where('companyId', '==', companyId), orderBy('createdAt', 'desc')));
  return snap.docs.map(mapTicket);
};

export const createTicket = async (data: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt'>): Promise<SupportTicket> => {
  const callableFn = httpsCallable(functions, 'mobileCreateTicket');
  const result = await callableFn({ ...data });
  return { ...data, id: result.data as string, createdAt: new Date(), updatedAt: new Date() } as SupportTicket;
};

export const updateTicket = async (id: string, updates: Partial<SupportTicket>): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileUpdateTicket');
  await callableFn({ ticketId: id, ...updates });
};

export const updateTicketStatus = async (id: string, status: SupportTicket['status']): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileUpdateTicketStatus');
  await callableFn({ ticketId: id, status });
};

export const addTicketMessage = async (ticketId: string, message: Omit<TicketMessage, 'id' | 'timestamp'>): Promise<TicketMessage> => {
  const msg: TicketMessage = { ...message, id: Math.random().toString(36).slice(2), timestamp: new Date() };
  const callableFn = httpsCallable(functions, 'mobileAddTicketMessage');
  await callableFn({ ticketId, message: msg });
  return msg;
};
