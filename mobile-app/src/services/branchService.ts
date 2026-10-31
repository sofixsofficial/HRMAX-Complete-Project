import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from '../aws/firestore-compat';
import { db } from '../aws/clients';

/**
 * Branch directory for the check-in flow.
 *
 * Employees punch against a BRANCH (created on the web under Companies →
 * Branches): the branch carries the GPS/geofence coordinates, the optional QR
 * code and the geofence radius. The server falls back to the employee's
 * primary branch when no branchId is sent, but the app needs the list to (a)
 * let a multi-branch employee pick where they are working today and (b) show
 * which branch a punch will be recorded against.
 *
 * The second half of this file is the admin CRUD surface (list / create /
 * edit / delete) used by BranchesScreen — parity with the web Branches page.
 * Writes go through the firestore-compat shim to the REST route
 * `/api/branches`, which requires `settings.edit` server-side.
 */
export interface Branch {
  id: string;
  companyId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  isActive?: boolean;
  /** Admin/management fields (BranchesScreen). */
  city?: string;
  managerId?: string;
  managerName?: string;
  shifts?: string[];
  qrEnabled?: boolean;
  qrToken?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface MyBranches {
  /** Authorized branches (primary first), inactive ones excluded. */
  branches: Branch[];
  primaryBranchId: string;
  /** All branches the account may punch from (primary + additional). */
  authorizedIds: string[];
}

const mapBranch = (d: { id: string; data: () => Record<string, unknown> }): Branch => {
  const raw = d.data() || {};
  return {
    id: d.id,
    companyId: String(raw.companyId ?? ''),
    name: String(raw.name ?? 'Branch'),
    address: raw.address == null ? undefined : String(raw.address),
    latitude: Number(raw.latitude ?? 0) || undefined,
    longitude: Number(raw.longitude ?? 0) || undefined,
    // `radiusInMeters` = legacy web-form spelling; accept both so branches
    // created from the web UI carry their radius into the client check.
    radiusMeters: Number(raw.radiusMeters ?? raw.radiusInMeters ?? 0) || undefined,
    // A branch archived on the web must not accept punches (the server
    // returns BRANCH_INACTIVE) — filter it out here so it is never offered.
    isActive: raw.isActive !== false,
    city: raw.city == null ? undefined : String(raw.city),
    managerId: raw.managerId == null ? undefined : String(raw.managerId),
    managerName: raw.managerName == null ? undefined : String(raw.managerName),
    shifts: Array.isArray(raw.shifts)
      ? (raw.shifts.filter((x): x is string => typeof x === 'string') as string[])
      : [],
    qrEnabled: raw.qrEnabled === true,
    qrToken: raw.qrToken == null ? undefined : String(raw.qrToken),
    createdAt: (raw.createdAt as any)?.toDate?.() ?? (raw.createdAt ? new Date(raw.createdAt as any) : undefined),
    updatedAt: (raw.updatedAt as any)?.toDate?.() ?? (raw.updatedAt ? new Date(raw.updatedAt as any) : undefined),
  };
};

/** Every active branch of the company (admins/HR need this; employees use fetchMyBranches). */
export const fetchCompanyBranches = async (companyId: string): Promise<Branch[]> => {
  if (!companyId) return [];
  const snap = await getDocs(
    query(collection(db, 'branches'), where('companyId', '==', companyId))
  ).catch(() => null);
  if (!snap) return [];
  return snap.docs.map(mapBranch).filter((b) => b.isActive !== false);
};

/**
 * The branches THIS user may punch from: the employee record's primary branch
 * plus any additional authorized branches. Returns an empty list for roles
 * without an employee record (company-admin / master-admin cannot punch) or
 * when no branches are configured — the legacy office-geofence flow still
 * applies then.
 */
export const fetchMyBranches = async (companyId: string, userId: string): Promise<MyBranches> => {
  const empty: MyBranches = { branches: [], primaryBranchId: '', authorizedIds: [] };
  if (!companyId || !userId) return empty;

  const empSnap = await getDocs(
    query(collection(db, 'employees'), where('userId', '==', userId))
  ).catch(() => null);
  const emp = empSnap && !empSnap.empty ? (empSnap.docs[0].data() as Record<string, unknown>) : null;
  const primaryBranchId = String(emp?.primaryBranchId ?? '');
  const extraRaw = (emp?.branchIds ?? []) as unknown[];
  const authorizedIds = [
    ...new Set(
      [primaryBranchId, ...(Array.isArray(extraRaw) ? extraRaw.map(String).filter(Boolean) : [])].filter(Boolean)
    ),
  ];
  if (authorizedIds.length === 0) return empty;

  const all = await fetchCompanyBranches(companyId);
  const byId = new Map(all.map((b) => [b.id, b]));
  const branches = authorizedIds
    .map((id) => byId.get(id))
    .filter((b): b is Branch => !!b);
  return { branches, primaryBranchId, authorizedIds };
};

/* ───────────────────────── Admin CRUD (BranchesScreen) ───────────────────── */

/** Geofence radius applied when a branch doesn't carry one (backend default). */
export const DEFAULT_RADIUS_IN_METERS = 100;

/**
 * Random token encoded into the branch QR code. 4 × 32-bit words joined by
 * '-' is ~36 chars — comfortably above the 16-character minimum the backend
 * expects, and it has no path separators so it is safe in any URL/QR payload.
 */
export const generateQrToken = (): string => {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(4)).join('-');
  }
  // Hermes without WebCrypto — Math.random fallback (token is rate-limited
  // by the settings.edit write permission, not secrecy strength).
  return [0, 1, 2, 3].map(() => String((Math.random() * 0xffffffff) >>> 0)).join('-');
};

/** Real-time branches of one company (or every branch when null). */
export const subscribeBranches = (
  companyId: string | null,
  callback: (branches: Branch[]) => void
): (() => void) => {
  const q = companyId ? query(collection(db, 'branches'), where('companyId', '==', companyId)) : collection(db, 'branches');
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => mapBranch(d as any))),
    (err) => {
      console.warn('Firestore sync warning handled cleanly (branches):', err?.message || err);
      callback([]);
    }
  );
};

/**
 * Real-time branches across MULTIPLE companies ("All Companies" mode).
 * Firestore caps `in` at 10 values, so ids are chunked and merged — the same
 * pattern as subscribeDepartmentsScoped.
 */
export const subscribeBranchesScoped = (
  companyIds: string[],
  callback: (branches: Branch[]) => void
): (() => void) => {
  if (companyIds.length === 0) {
    callback([]);
    return () => {};
  }
  const chunks: string[][] = [];
  for (let i = 0; i < companyIds.length; i += 10) chunks.push(companyIds.slice(i, i + 10));
  const cache = new Map<string, Branch[]>();
  const report = () => {
    const all: Branch[] = [];
    chunks.forEach((c) => (cache.get(c.join('|')) || []).forEach((b) => all.push(b)));
    callback(all);
  };
  const unsubs = chunks.map((chunk) => {
    const key = chunk.join('|');
    return onSnapshot(
      query(collection(db, 'branches'), where('companyId', 'in', chunk)),
      (snap) => {
        cache.set(key, snap.docs.map((d) => mapBranch(d as any)));
        report();
      },
      (err: any) => {
        console.warn('Firestore sync warning handled cleanly (branches scoped):', err?.message || err);
        cache.set(key, []);
        report();
      }
    );
  });
  return () => unsubs.forEach((u) => { try { u(); } catch { /* already closed */ } });
};

/** Write payload for create/edit — mirrors the web Branches form. */
export interface BranchAdminInput {
  companyId: string;
  name: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  radiusInMeters?: number;
  managerId?: string;
  managerName?: string;
  shifts?: string[];
  qrEnabled?: boolean;
  qrToken?: string;
  isActive?: boolean;
}

/**
 * Create branch. Throws a permission-denied coded error when the caller's
 * role lacks `settings.edit` (server-side check on /api/branches).
 * `radiusMeters` is written alongside `radiusInMeters` so the backend
 * geofence always reads the configured radius.
 */
export const createBranch = async (data: BranchAdminInput): Promise<string> => {
  const radius =
    typeof data.radiusInMeters === 'number' && Number.isFinite(data.radiusInMeters)
      ? data.radiusInMeters
      : DEFAULT_RADIUS_IN_METERS;
  const payload: Record<string, unknown> = {
    companyId: data.companyId,
    name: (data.name || '').trim(),
    address: (data.address || '').trim(),
    city: data.city || '',
    ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
    ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
    radiusInMeters: radius,
    radiusMeters: radius,
    managerId: data.managerId || '',
    managerName: data.managerName || '',
    shifts: Array.isArray(data.shifts) ? data.shifts : [],
    qrEnabled: data.qrEnabled === true,
    qrToken: data.qrToken || '',
    isActive: data.isActive !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'branches'), payload);
  return ref.id;
};

/** Partial update (PATCH). Pass `companyId` when known so the shim can scope
 *  the request with the real company instead of the document path. */
export const updateBranch = async (id: string, updates: Partial<BranchAdminInput>): Promise<void> => {
  const KEYS: (keyof BranchAdminInput)[] = [
    'companyId', 'name', 'address', 'city', 'latitude', 'longitude',
    'radiusInMeters', 'managerId', 'managerName', 'shifts', 'qrEnabled', 'qrToken', 'isActive',
  ];
  const clean: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = (updates as any)[k];
    if (v !== undefined) clean[k] = v;
  }
  if (typeof clean.name === 'string') clean.name = clean.name.trim();
  if (typeof clean.address === 'string') clean.address = clean.address.trim();
  // Keep the canonical `radiusMeters` in lockstep with the form field.
  if ('radiusInMeters' in clean) clean.radiusMeters = clean.radiusInMeters;
  clean.updatedAt = serverTimestamp();
  await updateDoc(doc(db, 'branches', id), clean);
};

/** Delete a branch. */
export const deleteBranch = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'branches', id));
};

/** Replace the branch's QR token (or create the first one) and persist it. */
export const regenerateQrToken = async (id: string): Promise<string> => {
  const token = generateQrToken();
  await updateBranch(id, { qrToken: token });
  return token;
};
