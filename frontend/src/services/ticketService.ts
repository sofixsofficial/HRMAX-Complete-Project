import { 
  collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { SupportTicket, TicketMessage } from '../types/user';

const COLLECTION_NAME = 'tickets';
const ticketsRef = collection(db, COLLECTION_NAME);

const mapDoc = (d: any): SupportTicket => {
  const data = d.data();
  return { id: d.id, ...data, createdAt: data.createdAt?.toDate() || new Date(), updatedAt: data.updatedAt?.toDate() || new Date(), resolvedAt: data.resolvedAt?.toDate() || null } as SupportTicket;
};

export const getAllTickets = async (): Promise<SupportTicket[]> => {
  const q = query(ticketsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc);
};

export const getTicketsByCompany = async (companyId: string): Promise<SupportTicket[]> => {
  const q = query(ticketsRef, where('companyId', '==', companyId), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc).reverse();
};

export const getTicketsByCompanies = async (companyIds: string[]): Promise<SupportTicket[]> => {
  if (companyIds.length === 0) return [];
  const q = query(ticketsRef, where('companyId', 'in', companyIds.slice(0, 10)), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc).reverse();
};

export const getTicketsByUser = async (userId: string): Promise<SupportTicket[]> => {
  const q = query(ticketsRef, where('createdById', '==', userId), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc).reverse();
};

export const getTicketsByExecutive = async (executiveId: string): Promise<SupportTicket[]> => {
  const q = query(ticketsRef, where('executiveId', '==', executiveId), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc).reverse();
};

export const getTicketsByTeamLeader = async (tlId: string): Promise<SupportTicket[]> => {
  const q = query(ticketsRef, where('tlId', '==', tlId), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc).reverse();
};

export const getTicketById = async (id: string): Promise<SupportTicket | null> => {
  const snap = await getDoc(doc(db, COLLECTION_NAME, id));
  if (!snap.exists()) return null;
  return mapDoc(snap);
};

export const createTicket = async (ticket: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt'>): Promise<SupportTicket> => {
  const docRef = await addDoc(ticketsRef, { ...ticket, status: 'Open', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { ...ticket, id: docRef.id, status: 'Open', createdAt: new Date(), updatedAt: new Date() } as SupportTicket;
};

export const updateTicket = async (id: string, updates: Partial<SupportTicket>): Promise<void> => {
  await updateDoc(doc(db, COLLECTION_NAME, id), { ...updates, updatedAt: serverTimestamp() });
};

export const updateTicketStatus = async (id: string, status: SupportTicket['status']): Promise<void> => {
  const updateData: any = { status, updatedAt: serverTimestamp() };
  if (status === 'Resolved') updateData.resolvedAt = serverTimestamp();
  await updateDoc(doc(db, COLLECTION_NAME, id), updateData);
};

export const deleteTicket = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};

export const addTicketMessage = async (ticketId: string, message: Omit<TicketMessage, 'id' | 'timestamp'>): Promise<TicketMessage> => {
  const msg: TicketMessage = { ...message, id: crypto.randomUUID?.() || Math.random().toString(36).slice(2), timestamp: new Date() };
  const snap = await getDoc(doc(db, COLLECTION_NAME, ticketId));
  if (!snap.exists()) throw new Error('Ticket not found');
  const existing = snap.data().conversation || [];
  await updateDoc(doc(db, COLLECTION_NAME, ticketId), { conversation: [...existing, msg], updatedAt: serverTimestamp() });
  return msg;
};

export const getTicketStats = async (companyId?: string, executiveId?: string, tlId?: string) => {
  let tickets: SupportTicket[];
  if (companyId) tickets = await getTicketsByCompany(companyId);
  else if (executiveId) tickets = await getTicketsByExecutive(executiveId);
  else if (tlId) tickets = await getTicketsByTeamLeader(tlId);
  else return { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 };
  return { total: tickets.length, open: tickets.filter(t => t.status === 'Open').length, inProgress: tickets.filter(t => t.status === 'In Progress').length, resolved: tickets.filter(t => t.status === 'Resolved').length, closed: tickets.filter(t => t.status === 'Closed').length };
};

export const getFilterOptions = async () => {
  const all = await getAllTickets();
  const companies = [...new Map(all.filter(t => t.companyId).map(t => [t.companyId, { id: t.companyId, name: t.companyName || t.companyId }])).values()];
  const executives = [...new Map(all.filter(t => t.executiveId).map(t => [t.executiveId, { id: t.executiveId, name: t.executiveName || t.executiveId }])).values()];
  const teamLeaders = [...new Map(all.filter(t => t.tlId).map(t => [t.tlId, { id: t.tlId, name: t.tlName || t.tlId }])).values()];
  return { companies, executives, teamLeaders };
};
