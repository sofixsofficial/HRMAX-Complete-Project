import { collection, doc, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
interface Email {
  id: string; from: string; fromEmail: string; to: string; toEmail: string;
  cc?: string; bcc?: string; subject: string; body: string; date: string;
  type: string; status: string; read: boolean; starred: boolean;
  attachments?: any[]; templateId?: string; scheduledFor?: string;
  recipientGroup?: string; companyId: string; replyToId?: string;
  forwardOfId?: string; threadId?: string; sentAt?: string;
  deliveredAt?: string; openedAt?: string; clickedAt?: string;
}

const COLLECTION = 'emails';
const ref = collection(db, COLLECTION);

const mapEmail = (d: any): Email => {
  const data = d.data();
  return {
    id: d.id,
    from: data.from || '',
    fromEmail: data.fromEmail || '',
    to: data.to || '',
    toEmail: data.toEmail || '',
    cc: data.cc || '',
    bcc: data.bcc || '',
    subject: data.subject || '',
    body: data.body || '',
    date: data.date || data.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
    type: data.type || 'Employee',
    status: data.status || 'Sent',
    read: data.read ?? false,
    starred: data.starred ?? false,
    attachments: data.attachments || [],
    templateId: data.templateId || '',
    scheduledFor: data.scheduledFor || '',
    recipientGroup: data.recipientGroup || '',
    companyId: data.companyId || '',
    replyToId: data.replyToId || '',
    forwardOfId: data.forwardOfId || '',
    threadId: data.threadId || '',
    sentAt: data.sentAt || '',
    deliveredAt: data.deliveredAt || '',
    openedAt: data.openedAt || '',
    clickedAt: data.clickedAt || '',
  };
};

export const subscribeEmails = (
  companyId: string | null,
  callback: (emails: Email[]) => void
): (() => void) => {
  const constraints: any[] = [];
  if (companyId) constraints.push(where('companyId', '==', companyId));
  constraints.push(orderBy('date', 'desc'));
  const q = query(ref, ...constraints);
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapEmail));
  }, () => callback([]));
  return unsub;
};

/**
 * Real-time emails across MULTIPLE companies ("All Companies" mode).
 * One listener per company (same query shape as the single-company one, so no
 * new composite indexes are needed), merged and sorted client-side.
 */
export const subscribeEmailsScoped = (
  companyIds: string[],
  callback: (emails: Email[]) => void
): (() => void) => {
  if (companyIds.length === 0) {
    callback([]);
    return () => {};
  }
  const cache = new Map<string, Email[]>();
  const report = () => {
    const all: Email[] = [];
    companyIds.forEach((id) => (cache.get(id) || []).forEach((e) => all.push(e)));
    all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    callback(all);
  };
  const unsubs = companyIds.map((id) =>
    onSnapshot(
      query(ref, where('companyId', '==', id), orderBy('date', 'desc')),
      (snap) => {
        cache.set(id, snap.docs.map(mapEmail));
        report();
      },
      () => {
        cache.set(id, []);
        report();
      }
    )
  );
  return () => unsubs.forEach((u) => { try { u(); } catch {} });
};

const stripUndefined = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out;
};

export const saveEmail = async (data: Omit<Email, 'id'>): Promise<string> => {
  const callableFn = httpsCallable(functions, 'mobileSaveEmail');
  const result = await callableFn({ ...stripUndefined({ ...data }) });
  return result.data as string;
};

/**
 * Save the email record AND deliver it via the `sendEmail` callable, which
 * sends through the company's SMTP config (server-side). Falls back to the
 * Firestore-only record when the callable is unavailable so drafts/records
 * are never lost.
 */
export const sendAndDeliverEmail = async (data: Omit<Email, 'id'>): Promise<{ id: string; delivered: boolean }> => {
  const id = await saveEmail(data);
  try {
    const sendEmailCall = httpsCallable(functions, 'sendEmail');
    const res: any = await sendEmailCall({
      to: data.toEmail || data.to,
      subject: data.subject,
      body: data.body,
      cc: data.cc || undefined,
      bcc: data.bcc || undefined,
      companyId: data.companyId,
      emailId: id,
    });
    return { id, delivered: !!res?.data?.delivered };
  } catch (err) {
    console.warn('SMTP delivery failed, record saved only', err);
    return { id, delivered: false };
  }
};

export const updateEmail = async (id: string, updates: Partial<Email>): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileUpdateEmail');
  await callableFn({ emailId: id, ...updates });
};

export const deleteEmail = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteEmail');
  await callableFn({ emailId: id });
};

export const archiveEmail = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileArchiveEmail');
  await callableFn({ emailId: id });
};

export const toggleStar = async (id: string, starred: boolean): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileToggleStarEmail');
  await callableFn({ emailId: id, starred: !starred });
};

export const markAsRead = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileMarkEmailRead');
  await callableFn({ emailId: id });
};
