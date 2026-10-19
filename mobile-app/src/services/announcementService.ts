import { collection, query, where, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  author: string;
  authorId?: string;
  createdAt: Date | string;
  pinned: boolean;
  companyId: string;
}

const ref = collection(db, 'announcements');

const mapAnnouncement = (d: any): Announcement => ({
  id: d.id,
  title: d.data().title || '',
  content: d.data().content || '',
  category: d.data().category || '',
  priority: d.data().priority || 'Medium',
  author: d.data().author || '',
  authorId: d.data().authorId || '',
  createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || new Date(),
  pinned: d.data().pinned ?? false,
  companyId: d.data().companyId || '',
});

export const subscribeAnnouncements = (
  companyId: string | null,
  callback: (announcements: Announcement[]) => void
): (() => void) => {
  const q = companyId
    ? query(ref, where('companyId', '==', companyId), orderBy('createdAt', 'desc'))
    : query(ref, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapAnnouncement));
  }, () => callback([]));
  return unsub;
};

/**
 * Real-time announcements across MULTIPLE companies ("All Companies" mode).
 * One listener per company (same query shape as the single-company one, so no
 * new composite indexes are needed), merged and sorted client-side.
 */
export const subscribeAnnouncementsScoped = (
  companyIds: string[],
  callback: (announcements: Announcement[]) => void
): (() => void) => {
  if (companyIds.length === 0) {
    callback([]);
    return () => {};
  }
  const cache = new Map<string, Announcement[]>();
  const report = () => {
    const all: Announcement[] = [];
    companyIds.forEach((id) => (cache.get(id) || []).forEach((a) => all.push(a)));
    all.sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return tb - ta;
    });
    callback(all);
  };
  const unsubs = companyIds.map((id) =>
    onSnapshot(
      query(ref, where('companyId', '==', id), orderBy('createdAt', 'desc')),
      (snap) => {
        cache.set(id, snap.docs.map(mapAnnouncement));
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

export const createAnnouncement = async (data: {
  title: string;
  content: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  pinned: boolean;
  author: string;
  authorId: string;
  companyId: string;
}): Promise<Announcement> => {
  const callableFn = httpsCallable(functions, 'mobileCreateAnnouncement');
  const result = await callableFn({ ...data });
  return { ...data, id: result.data as string, createdAt: new Date() };
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteAnnouncement');
  await callableFn({ announcementId: id });
};
