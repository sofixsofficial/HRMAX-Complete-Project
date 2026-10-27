/**
 * Branches service — CRUD for the company "branches" collection.
 *
 * Data path: the app talks to the backend through the firestore-compat shim,
 * where the `branches` collection is mapped to the REST route `/api/branches`
 * (see endpointFor() in src/aws/firestore.ts). The backend serves:
 *   GET    /api/branches?companyId=<id>  -> { branches: [...] }
 *   GET    /api/branches/<id>            -> { branch: {...} }
 *   POST   /api/branches                 -> { id, branch }
 *   PUT    /api/branches/<id>            (upsert)
 *   PATCH  /api/branches/<id>            (partial update)
 *   DELETE /api/branches/<id>
 *
 * Reads are open to every signed-in user; writes require the `settings.edit`
 * permission server-side (crudRoutes({ entity: 'branch', writePerm: 'settings.edit' })).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';

const COLLECTION_NAME = 'branches';
const branchesRef = collection(db, COLLECTION_NAME);

/** Geofence radius applied when a branch doesn't carry one (backend default). */
export const DEFAULT_RADIUS_IN_METERS = 100;

/** Shape of a branch record as stored by the backend (BranchDoc). */
export interface Branch {
  id: string;
  companyId: string;
  name: string;
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
  radiusInMeters: number;
  managerId: string;
  managerName: string;
  shifts: string[];
  qrEnabled: boolean;
  /** 16+ char client-generated token encoded into the check-in QR code. */
  qrToken: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Write payload — everything except the server-assigned id/timestamps. */
export type BranchInput = Omit<Branch, 'id' | 'createdAt' | 'updatedAt'> & {
  companyId: string;
  name: string;
};

// Helper: strip undefined values so optional fields are simply not sent
const stripUndefined = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toValidDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const toDate = (value as { toDate?: () => Date }).toDate;
  if (typeof toDate === 'function') {
    const d = toDate.call(value);
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : undefined;
  }
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Normalize any raw record (REST body / snapshot data) into a Branch with
 * every field the attendance chain reads present and usable.
 */
export const mapBranch = (id: string, data: Record<string, unknown>): Branch => ({
  id,
  companyId: String(data.companyId ?? ''),
  name: String(data.name ?? ''),
  address: data.address ? String(data.address) : '',
  city: data.city ? String(data.city) : '',
  latitude: toFiniteNumber(data.latitude),
  longitude: toFiniteNumber(data.longitude),
  radiusInMeters: toFiniteNumber(data.radiusInMeters) ?? DEFAULT_RADIUS_IN_METERS,
  managerId: data.managerId ? String(data.managerId) : '',
  managerName: data.managerName ? String(data.managerName) : '',
  shifts: Array.isArray(data.shifts)
    ? (data.shifts.filter((s): s is string => typeof s === 'string') as string[])
    : [],
  qrEnabled: data.qrEnabled === true,
  qrToken: data.qrToken ? String(data.qrToken) : '',
  isActive: data.isActive !== false,
  createdAt: toValidDate(data.createdAt),
  updatedAt: toValidDate(data.updatedAt),
});

/**
 * Random token encoded into the branch QR code. 4 × 32-bit words joined by
 * '-' is ~36 chars — comfortably above the 16-character minimum the backend
 * expects, and it has no path separators so it is safe in any URL/QR payload.
 */
export const generateQrToken = (): string =>
  crypto.getRandomValues(new Uint32Array(4)).join('-');

/** All branches readable by the signed-in caller. */
export const getAllBranches = async (): Promise<Branch[]> => {
  const snapshot = await getDocs(branchesRef);
  return snapshot.docs.map(d => mapBranch(d.id, d.data() as Record<string, unknown>));
};

/** Branches of one company (server also re-checks the caller's scope). */
export const getBranchesByCompany = async (companyId: string): Promise<Branch[]> => {
  if (!companyId) return [];
  const snapshot = await getDocs(query(branchesRef, where('companyId', '==', companyId)));
  return snapshot.docs.map(d => mapBranch(d.id, d.data() as Record<string, unknown>));
};

/** Single branch, or null when it does not exist / is not readable. */
export const getBranch = async (id: string): Promise<Branch | null> => {
  const snapshot = await getDoc(doc(db, COLLECTION_NAME, id));
  if (!snapshot.exists()) return null;
  return mapBranch(snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>);
};

/** Create branch. Throws a `permission-denied` / `auth/access-denied` coded
 *  error when the caller's role lacks `settings.edit`. */
export const createBranch = async (branch: BranchInput): Promise<Branch> => {
  const payload = stripUndefined({
    ...branch,
    city: branch.city || '',
    shifts: Array.isArray(branch.shifts) ? branch.shifts : [],
    qrEnabled: branch.qrEnabled === true,
    qrToken: branch.qrToken || '',
    isActive: branch.isActive !== false,
    radiusInMeters:
      typeof branch.radiusInMeters === 'number' ? branch.radiusInMeters : DEFAULT_RADIUS_IN_METERS,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const docRef = await addDoc(branchesRef, payload);
  return mapBranch(docRef.id, { ...payload, createdAt: new Date().toISOString() });
};

/** Partial update (PATCH). Pass `companyId` when it is known so the shim can
 *  scope the request with the real company instead of the document path. */
export const updateBranch = async (
  id: string,
  updates: Partial<BranchInput>
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const clean = stripUndefined({ ...updates, updatedAt: serverTimestamp() });
  await updateDoc(docRef, clean);
};

/** Delete a branch. */
export const deleteBranch = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

/**
 * Replace the branch's QR token (or create the first one) and persist it.
 * Returns the new token so the caller can re-render the QR image at once.
 */
export const regenerateQrToken = async (id: string): Promise<string> => {
  const token = generateQrToken();
  await updateBranch(id, { qrToken: token });
  return token;
};
