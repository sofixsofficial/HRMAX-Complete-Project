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
import type { LeavePolicy, LeaveTypePolicy } from '../types/user';
import {
  LEAVE_TYPES,
  DEFAULT_LEAVE_ALLOWANCES,
  ENCASHABLE_LEAVE_TYPES,
  PAID_LEAVE_TYPES,
} from './leaveService';
import type { LeaveBalanceConfig, LeaveType } from './leaveService';

const POLICY_COLLECTION = 'leavePolicies';
const policyRef = collection(db, POLICY_COLLECTION);

/** Default per-type config for a company-standard leave policy. */
export const DEFAULT_LEAVE_TYPE_POLICY: Record<string, LeaveTypePolicy> = {
  Casual: { days: 12, paid: true, encashable: false },
  Sick: { days: 12, paid: true, encashable: false },
  Earned: { days: 15, paid: true, encashable: true },
  Unpaid: { days: 0, paid: false, encashable: false },
  Maternity: { days: 180, paid: true, encashable: false },
  Paternity: { days: 5, paid: true, encashable: false },
};

const asDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.toDate) return v.toDate();
  if (typeof v === 'string') return new Date(v);
  return null;
};

const mapPolicy = (d: any): LeavePolicy => {
  const data = d.data();
  return {
    id: d.id,
    companyId: data.companyId,
    name: data.name || 'Untitled Policy',
    description: data.description,
    isDefault: !!data.isDefault,
    types: data.types || {},
    createdBy: data.createdBy,
    createdByName: data.createdByName,
    createdAt: asDate(data.createdAt) || undefined,
    updatedAt: asDate(data.updatedAt) || undefined,
  };
};

export const getLeavePoliciesByCompany = async (companyId: string): Promise<LeavePolicy[]> => {
  if (!companyId) return [];
  const q = query(policyRef, where('companyId', '==', companyId));
  const snap = await getDocs(q);
  return snap.docs.map(mapPolicy);
};

export const getLeavePolicyById = async (policyId: string): Promise<LeavePolicy | null> => {
  if (!policyId) return null;
  const snap = await getDoc(doc(db, POLICY_COLLECTION, policyId));
  if (!snap.exists()) return null;
  return mapPolicy(snap);
};

export interface CreateLeavePolicyInput {
  name: string;
  description?: string;
  types: Record<string, LeaveTypePolicy>;
  isDefault?: boolean;
  createdBy?: string;
  createdByName?: string;
}

export const createLeavePolicy = async (companyId: string, input: CreateLeavePolicyInput): Promise<LeavePolicy> => {
  const ref = await addDoc(policyRef, {
    companyId,
    name: input.name,
    description: input.description || '',
    isDefault: !!input.isDefault,
    types: input.types,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, companyId, name: input.name, description: input.description, isDefault: !!input.isDefault, types: input.types };
};

export const updateLeavePolicy = async (policyId: string, patch: Partial<Pick<LeavePolicy, 'name' | 'description' | 'types' | 'isDefault'>>): Promise<void> => {
  await updateDoc(doc(db, POLICY_COLLECTION, policyId), { ...patch, updatedAt: serverTimestamp() });
};

export const deleteLeavePolicy = async (policyId: string): Promise<void> => {
  await deleteDoc(doc(db, POLICY_COLLECTION, policyId));
};

/** Make one policy the company default (single source); the rest lose the flag. */
export const setDefaultLeavePolicy = async (companyId: string, policyId: string): Promise<void> => {
  const policies = await getLeavePoliciesByCompany(companyId);
  await Promise.all(policies.map(p =>
    updateDoc(doc(db, POLICY_COLLECTION, p.id), {
      isDefault: p.id === policyId,
      updatedAt: serverTimestamp(),
    })
  ));
};

/**
 * Ensure a company has at least one leave policy (create-on-read). Leave
 * policies are NO LONGER auto-created at company creation or on read — the
 * source of leave balances going forward is each employee's own monthly
 * entitlement (Employee Create → Leave Entitlements, Yearly = Monthly × 12).
 * This now only returns an existing policy document (if any) so legacy
 * companies keep using theirs; a company with no policies gets no balance.
 */
export const ensureDefaultLeavePolicy = async (companyId: string, companyName?: string): Promise<LeavePolicy | null> => {
  try {
    const existing = await getLeavePoliciesByCompany(companyId);
    if (existing.length > 0) return existing.find(p => p.isDefault) || existing[0] || null;
  } catch {
    return null;
  }
  return null;
};

export interface ResolvedLeavePolicy {
  policy?: LeavePolicy;
  name: string;
  allowances: Record<string, number>;
  encashable: LeaveType[];
  paid: LeaveType[];
  config: LeaveBalanceConfig;
}

/** Synchronous resolution from an already-fetched policy list (no DB reads). */
export const resolveLeavePolicyFromList = (
  policies: LeavePolicy[],
  employeePolicyId?: string
): ResolvedLeavePolicy | null => {
  const pol = policies.find(p => p.id === employeePolicyId)
    || policies.find(p => p.isDefault)
    || policies[0];
  return pol ? toResolved(pol) : null;
};

const toResolved = (p: LeavePolicy): ResolvedLeavePolicy => {
  const effective: Record<string, LeaveTypePolicy> = {};
  for (const t of LEAVE_TYPES) {
    effective[t] = { ...DEFAULT_LEAVE_TYPE_POLICY[t], ...(p.types?.[t] || {}) };
  }
  const allowances = Object.fromEntries(LEAVE_TYPES.map(t => [t, effective[t].days]));
  const paid = LEAVE_TYPES.filter(t => effective[t].paid) as LeaveType[];
  // An unpaid type should never be encashable.
  const encashable = LEAVE_TYPES.filter(t => effective[t].encashable && effective[t].paid) as LeaveType[];
  return {
    policy: p,
    name: p.name,
    allowances: { ...DEFAULT_LEAVE_ALLOWANCES, ...allowances },
    encashable,
    paid,
    config: { encashable, paid },
  };
};

/**
 * Resolve the effective leave policy for an employee:
 *   1. the employee's explicitly assigned policy (leavePolicyId)
 *   2. the company's default policy
 *   3. legacy fallback: company.leaveAllowances + defaults (no policy docs yet)
 */
export const resolveEmployeeLeavePolicy = async (
  companyId: string,
  employeePolicyId?: string,
  companyName?: string
): Promise<ResolvedLeavePolicy> => {
  if (employeePolicyId) {
    const p = await getLeavePolicyById(employeePolicyId).catch(() => null);
    if (p && p.companyId === companyId) return toResolved(p);
  }
  const policies = await getLeavePoliciesByCompany(companyId).catch(() => []);
  const def = policies.find(p => p.isDefault) || policies[0];
  if (def) return toResolved(def);

  // No policies and no per-company legacy allowances → no leave balance (zero
  // entitlement). Per-employee monthly entitlements are the only source for new
  // employees; legacy companies without policies get no implicit defaults.
  const companySnap = await getDoc(doc(db, 'companies', companyId)).catch(() => null);
  const compData = companySnap?.exists() ? companySnap.data() : null;
  const name = `${(compData as any)?.name || companyName || 'Company'} Default`;
  const allowances = (compData as any)?.leaveAllowances as Record<string, number> | undefined;
  if (allowances && Object.keys(allowances).length > 0) {
    return {
      name,
      allowances,
      encashable: ENCASHABLE_LEAVE_TYPES,
      paid: PAID_LEAVE_TYPES,
      config: { encashable: ENCASHABLE_LEAVE_TYPES, paid: PAID_LEAVE_TYPES },
    };
  }
  return {
    name: 'No Leave Policy',
    allowances: {},
    encashable: [],
    paid: PAID_LEAVE_TYPES,
    config: { encashable: [], paid: PAID_LEAVE_TYPES },
  };
};