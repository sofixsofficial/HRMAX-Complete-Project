import { collection, query, where, getDocs } from '../aws/firestore-compat';
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
