/**
 * Cognito JWT verification + caller resolution.
 *
 * ID tokens are issued by the HRMAX Cognito User Pool. Role/companyId live in
 * custom:role / custom:companyId attributes (PreTokenGeneration trigger keeps
 * them in sync from the users table), permissions stay table-side (token size).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ApiError, type Caller, type UserRole, VALID_ROLES } from './types.js';
import { getUserDoc, allPartitions } from './db.js';

const POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  }
  return jwks;
}

export interface TokenPayload extends JWTPayload {
  'custom:role'?: string;
  'custom:companyId'?: string;
  email?: string;
  name?: string;
}

/** Verify a Cognito ID token and return its payload. */
export async function verifyToken(token: string): Promise<TokenPayload> {
  if (!POOL_ID) throw new ApiError('internal', 'COGNITO_USER_POOL_ID not configured');
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: ISSUER,
      audience: process.env.COGNITO_CLIENT_ID,
    });
    return payload as TokenPayload;
  } catch (err) {
    throw new ApiError('unauthenticated', `Invalid token: ${(err as Error).message}`);
  }
}

/**
 * Resolve the full Caller from the request Authorization header.
 * The users table is authoritative (mirrors the original design where the
 * Firestore user doc — not the claims — decides authorization).
 */
export async function resolveCaller(
  authHeader: string | undefined,
  ip: string,
  userAgent: string,
  opts?: { soft?: boolean },
): Promise<Caller> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError('unauthenticated', 'Missing Authorization bearer token');
  }
  const payload = await verifyToken(authHeader.slice(7));
  const uid = payload.sub;
  if (!uid) throw new ApiError('unauthenticated', 'Token missing subject');

  const doc_ = await getUserDoc(uid);
  if (!doc_) {
    if (opts?.soft) {
      // Bootstrap caller (routes flagged `bootstrap`): Cognito session is
      // valid but no users-table row exists yet — e.g. signUpCompany creates
      // the company doc and then the user doc through the API. No role, no
      // permissions: every authorization gate denies until the row exists.
      return {
        uid,
        email: String(payload.email ?? ''),
        name: String(payload.name ?? ''),
        role: 'unprovisioned',
        companyId: '',
        assignedCompanyIds: [],
        linkedExecutiveIds: [],
        reportingExecutiveId: null,
        isReportingManager: false,
        permissions: [],
        permissionsConfigured: false,
        ip,
        userAgent,
      };
    }
    throw new ApiError('unauthenticated', 'User profile not found');
  }

  const role = (doc_.role as UserRole) ?? 'employee';
  if (!VALID_ROLES.includes(role)) throw new ApiError('permission-denied', `Unknown role: ${role}`);

  const status = String(doc_.status ?? 'Active');
  if (status === 'Suspended' || status === 'Rejected') {
    throw new ApiError('permission-denied', `Account ${status.toLowerCase()}`);
  }

  return {
    uid,
    email: String(doc_.email ?? payload.email ?? ''),
    name: String(doc_.name ?? payload.name ?? ''),
    role,
    companyId: String(doc_.companyId ?? ''),
    assignedCompanyIds: (doc_.assignedCompanyIds as string[]) ?? [],
    linkedExecutiveIds: (doc_.linkedExecutiveIds as string[]) ?? [],
    reportingExecutiveId: (doc_.reportingExecutiveId as string) ?? null,
    isReportingManager: Boolean(doc_.isReportingManager),
    permissions: (doc_.permissions as string[]) ?? [],
    permissionsConfigured: Boolean(doc_.permissionsConfigured),
    ip,
    userAgent,
  };
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

export function isSuperAdmin(caller: Caller): boolean {
  return caller.role === 'master-admin';
}

export function isManagement(caller: Caller): boolean {
  return ['master-admin', 'company-admin', 'team-leader', 'executive'].includes(caller.role);
}

/** Company ids the caller may act on ([] = all, for master-admin). */
export function scopedCompanyIds(caller: Caller, override?: string[]): string[] {
  if (isSuperAdmin(caller)) return override ?? [];
  if (caller.role === 'executive') {
    return override ?? (caller.assignedCompanyIds.length ? caller.assignedCompanyIds : caller.companyId ? [caller.companyId] : []);
  }
  if (caller.role === 'team-leader') return override ?? [];
  return override ?? (caller.companyId ? [caller.companyId] : []);
}

/** Assert the caller belongs to (or oversees) the given company. */
export function assertCompanyScope(caller: Caller, companyId: string): void {
  if (isSuperAdmin(caller)) return;
  const scope = scopedCompanyIds(caller);
  if (scope.length > 0 && !scope.includes(companyId)) {
    throw new ApiError('permission-denied', 'Company out of scope');
  }
  if (scope.length === 0 && caller.role !== 'team-leader') {
    throw new ApiError('permission-denied', 'No company scope');
  }
}

/**
 * The caller's OWN company when a client sends the All-Companies placeholder
 * (`global`) or omits companyId — Executive/Team-Leader personal flows (punch,
 * apply leave) must land in a real partition instead of failing scope checks.
 * Executives resolve through their assignment; team leaders through the
 * executive they report to. Returns '' when nothing resolves so callers can
 * raise a precise error rather than writing to the `global` partition.
 */
export async function resolvePersonalCompanyId(caller: Caller): Promise<string> {
  if (caller.companyId && caller.companyId !== 'global') return caller.companyId;
  if (caller.role === 'executive') {
    return caller.assignedCompanyIds[0] ?? '';
  }
  if (caller.role === 'team-leader') {
    const execId = caller.reportingExecutiveId || caller.linkedExecutiveIds[0] || '';
    if (execId) {
      const execDoc = await getUserDoc(execId).catch(() => null);
      const ids = (execDoc?.assignedCompanyIds as string[] | undefined) ?? [];
      if (ids.length) return ids[0];
    }
    return caller.assignedCompanyIds[0] ?? '';
  }
  return '';
}

/**
 * Company partitions this caller may read from, in dedupe-preferred order.
 * - super-admin → every partition (unfiltered Firestore reads)
 * - executive → assigned companies (falls back to own company)
 * - team-leader → dynamic scope: stored assignments, else all (matches
 *   assertCompanyScope's TL allowance)
 * - everyone else → their single company (denied entirely when unset)
 */
export async function readPartitions(caller: Caller): Promise<string[]> {
  if (isSuperAdmin(caller)) return allPartitions();
  const scope = scopedCompanyIds(caller);
  if (scope.length > 0) return scope;
  if (caller.role === 'team-leader') return allPartitions();
  throw new ApiError('permission-denied', 'No company scope');
}

/**
 * Partitions a `GET /api/users` listing may read for this caller.
 *
 * `?role=master-admin` is the platform-master lookup every authenticated role
 * performs (executive/TL self-submissions resolving the MA approval gate,
 * CA-registration fan-out, manager-inbox notifications). Master Admin docs
 * live in the 'global' platform partition, which company-scoped callers
 * (executive → assigned companies, employee/CA/HR → own company) never
 * enumerate — without appending it the lookup came back empty and clients
 * raised "Master Admin is not assigned" on every submission.
 */
export function userListingPartitions(caller: Caller, partitions: string[], roleFilter?: string): string[] {
  if (isSuperAdmin(caller)) return partitions;
  if (String(roleFilter ?? '') !== 'master-admin') return partitions;
  return partitions.includes('global') ? partitions : [...partitions, 'global'];
}

/**
 * Company-visibility line for a `GET /api/users` row. Master Admin rows pass
 * whenever the request filters role=master-admin (the platform approver is a
 * legitimate answer for every role); everything else keeps the company-scope
 * rule: platform rows (empty companyId), own company, or assigned companies.
 */
export function userDocVisible(caller: Caller, doc: Record<string, unknown>, roleFilter?: string): boolean {
  if (isSuperAdmin(caller)) return true;
  if (String(roleFilter ?? '') === 'master-admin' && String(doc.role ?? '') === 'master-admin') return true;
  const c = String(doc.companyId ?? '');
  return !c || c === caller.companyId || caller.assignedCompanyIds.includes(c);
}

/**
 * hasPermission with legacy fallback semantics:
 *  - '*' grants everything
 *  - exact match or module.* / module.manage wildcards
 *  - unconfigured matrix for TL/executive grants defaults
 */
export function hasPermission(caller: Caller, perm: string): boolean {
  if (isSuperAdmin(caller)) return true;

  // company-admin: view-only except explicit allow
  if (caller.role === 'company-admin') {
    const [, action] = perm.split('.');
    if (['view', 'reports', 'analytics'].includes(action)) return true;
    if (perm.startsWith('leave.')) return true;
  }

  // employee: hard-coded subset
  if (caller.role === 'employee') {
    if (['leave.apply', 'leave.create', 'leave.view', 'attendance.view', 'attendance.create', 'holidays.view'].includes(perm)) return true;
    return caller.permissions.includes(perm);
  }

  // reporting-manager
  if (caller.role === 'reporting-manager') {
    if (perm.startsWith('leave.')) return true;
    if (perm === 'employees.view' || perm === 'attendance.view') return true;
  }

  // TL / executive: unconfigured matrix = full default access
  if ((caller.role === 'team-leader' || caller.role === 'executive') && !caller.permissionsConfigured) {
    const p = caller.permissions;
    if (p.length === 0 || p.includes('*')) return true;
  }

  const p = caller.permissions;
  if (p.includes('*')) return true;
  if (p.includes(perm)) return true;
  const module_ = perm.split('.')[0];
  if (p.includes(`${module_}.*`) || p.includes(`${module_}.manage`)) return true;
  return false;
}

export function assertPermission(caller: Caller, perm: string): void {
  if (!hasPermission(caller, perm)) {
    throw new ApiError('permission-denied', `Missing permission: ${perm}`);
  }
}

export function assertRole(caller: Caller, roles: UserRole[]): void {
  if (!roles.includes(caller.role)) {
    throw new ApiError('permission-denied', `Requires role: ${roles.join(' | ')}`);
  }
}
