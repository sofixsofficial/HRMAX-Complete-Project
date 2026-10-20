/**
 * Firestore-compatible data layer backed by the HR MAX REST API (DynamoDB).
 * Implements the exact API surface the frontend uses — collection, doc,
 * query, where, orderBy, limit, getDocs, getDoc, onSnapshot (polling-based),
 * addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp.
 *
 * Swap: `from 'firebase/firestore'` → `from '../aws/firestore'`.
 */

import { getIdToken, getCurrentUser } from './auth';
import { AWS_CONFIG } from './config';
import { FriendlyError, ERROR_CODES, ERROR_MESSAGES, markSessionExpired, networkError, toFriendlyError } from './errors';

// ---------------------------------------------------------------------------
// Types mirroring the Firestore SDK
// ---------------------------------------------------------------------------

/**
 * Matches the real SDK where `DocumentData` is `{ [field: string]: any }` —
 * loosely typed so app code can read/write arbitrary fields off snapshots.
 */
export interface DocumentData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [field: string]: any;
}

/** Opaque sentinel returned by serverTimestamp()/deleteField(). */
export interface FieldValue {
  readonly _serverTimestamp?: boolean;
  readonly _deleteField?: boolean;
}

export class Timestamp {
  readonly _seconds: number;
  readonly _nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this._seconds = seconds;
    this._nanoseconds = nanoseconds;
  }

  get seconds(): number {
    return this._seconds;
  }

  get nanoseconds(): number {
    return this._nanoseconds;
  }

  static now(): Timestamp {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  static fromMillis(ms: number): Timestamp {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }

  toDate(): Date {
    return new Date(this._seconds * 1000 + this._nanoseconds / 1e6);
  }

  toMillis(): number {
    return this._seconds * 1000 + this._nanoseconds / 1e6;
  }
}

export function serverTimestamp(): FieldValue {
  return { _serverTimestamp: true };
}

export function deleteField(): FieldValue {
  return { _deleteField: true };
}

export class FirestoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FirestoreError';
  }
}

// ---------------------------------------------------------------------------
// Snapshot types (Firestore-compatible shape)
// ---------------------------------------------------------------------------

export interface SnapshotMetadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface SnapshotOptions {
  serverTimestamps?: 'estimate' | 'previous' | 'none';
}

export interface DocumentSnapshot {
  readonly id: string;
  readonly ref: DocumentReference;
  readonly metadata: SnapshotMetadata;
  /** Real Firebase: `exists()` is a method with a type predicate. */
  exists(): this is QueryDocumentSnapshot;
  data(options?: SnapshotOptions): DocumentData | undefined;
  get(fieldPath: string, options?: SnapshotOptions): unknown;
}

export interface QueryDocumentSnapshot {
  readonly id: string;
  readonly ref: DocumentReference;
  readonly metadata: SnapshotMetadata;
  exists(): this is QueryDocumentSnapshot;
  data(options?: SnapshotOptions): DocumentData;
  get(fieldPath: string, options?: SnapshotOptions): unknown;
}

export interface QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;
  readonly metadata: SnapshotMetadata;
  forEach(cb: (doc: QueryDocumentSnapshot) => void): void;
}

const SNAPSHOT_META: SnapshotMetadata = { fromCache: false, hasPendingWrites: false };

/** Internal runtime shape shared by every snapshot object we hand out. */
interface SnapshotRuntime {
  id: string;
  ref: DocumentReference;
  metadata: SnapshotMetadata;
  // NOTE: at runtime `exists` is a FUNCTION (the app calls snapshot.exists()).
  exists: () => boolean;
  data: (options?: SnapshotOptions) => DocumentData | undefined;
  get: (fieldPath: string, options?: SnapshotOptions) => unknown;
}

function makeDocumentSnapshot(ref: DocumentReference, data: DocumentData | undefined): DocumentSnapshot {
  const rt: SnapshotRuntime = {
    id: ref.id,
    ref,
    metadata: SNAPSHOT_META,
    exists: () => data !== undefined,
    data: () => data,
    get: (fieldPath) => (data == null ? undefined : data[fieldPath]),
  };
  return rt as unknown as DocumentSnapshot;
}

function makeQuerySnapshot(path: string, docs: DocumentData[]): QuerySnapshot {
  const snaps: QueryDocumentSnapshot[] = docs.map((d) => {
    const ref = new DocumentReference(String(d.id ?? ''), `${path}/${d.id}`);
    const rt: SnapshotRuntime = {
      id: ref.id,
      ref,
      metadata: SNAPSHOT_META,
      exists: () => true,
      data: () => d,
      get: (fieldPath) => d[fieldPath],
    };
    return rt as unknown as QueryDocumentSnapshot;
  });
  return {
    docs: snaps,
    size: snaps.length,
    empty: snaps.length === 0,
    metadata: SNAPSHOT_META,
    forEach: (cb) => {
      for (const s of snaps) cb(s);
    },
  };
}

// ---------------------------------------------------------------------------
// Collection / document references
// ---------------------------------------------------------------------------

export class DocumentReference {
  readonly id: string;
  readonly _path: string;

  constructor(id: string, _path: string) {
    this.id = id;
    this._path = _path;
  }

  get path(): string {
    return this._path;
  }

  get parent(): CollectionReference {
    return new CollectionReference(this._path.split('/').slice(0, -1).join('/'));
  }

  /** Firestore parity: `ref.update(data)` (delegates to the same REST PATCH as updateDoc). */
  async update(data: DocumentData): Promise<void> {
    return updateDoc(this, data);
  }

  async set(data: DocumentData, options?: { merge?: boolean }): Promise<void> {
    return setDoc(this, data, options);
  }

  async delete(): Promise<void> {
    return deleteDoc(this);
  }

  async get(): Promise<DocumentSnapshot> {
    return getDoc(this);
  }
}

export class Query {
  readonly _path: string;
  readonly _constraints: QueryConstraint[];

  constructor(_path: string, _constraints: QueryConstraint[] = []) {
    this._path = _path;
    this._constraints = _constraints;
  }

  get id(): string {
    return this._path.split('/').pop()!;
  }

  get path(): string {
    return this._path;
  }
}

/** Real Firebase: CollectionReference extends Query. */
export class CollectionReference extends Query {
  constructor(_path: string) {
    super(_path, []);
  }

  get parent(): CollectionReference | null {
    const parts = this._path.split('/');
    if (parts.length < 2) return null;
    return new CollectionReference(parts.slice(0, -1).join('/'));
  }
}

export function collection(_db: unknown, ...segments: string[]): CollectionReference {
  return new CollectionReference(segments.join('/'));
}

export function doc(first: unknown, ...segments: string[]): DocumentReference {
  const base = first instanceof CollectionReference ? first._path : null;
  const path = base === null ? segments.join('/') : [base, ...segments].join('/');
  const parts = path.split('/').filter((p) => p.length > 0);
  // Even segment count = full document path (col/doc[/col/doc…]);
  // odd count = a collection path → generate a fresh id under it.
  if (parts.length > 0 && parts.length % 2 === 0) {
    const id = parts[parts.length - 1];
    return new DocumentReference(id, parts.join('/'));
  }
  const id = generateId();
  return new DocumentReference(id, [...parts, id].join('/'));
}

function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 20; i++) out += chars[buf[i] % chars.length];
  return out;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

export type WhereFilterOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains' | 'array-contains-any';

export interface QueryConstraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: WhereFilterOp;
  value?: unknown;
  direction?: 'asc' | 'desc';
  n?: number;
}

/**
 * Runtime marker for QueryConstraint — the app imports it in a mixed
 * value/type import, so a bundler-visible value must exist even though the
 * real constraint is a plain interface. (Type annotations still resolve to
 * the interface above.)
 */
export const QueryConstraint = Symbol('QueryConstraint');

export function where(field: string, op: WhereFilterOp, value: unknown): QueryConstraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(n: number): QueryConstraint {
  return { type: 'limit', n };
}

export function query(base: CollectionReference | Query, ...constraints: QueryConstraint[]): Query {
  // CollectionReference extends Query, so it must be checked FIRST.
  if (base instanceof CollectionReference) return new Query(base._path, [...constraints]);
  return new Query(base._path, [...base._constraints, ...constraints]);
}

// ---------------------------------------------------------------------------
// API transport
// ---------------------------------------------------------------------------

const API = () => AWS_CONFIG.apiUrl.replace(/\/$/, '');

/** Map a collection path to the REST endpoint. */
function endpointFor(path: string): string {
  const map: Record<string, string> = {
    users: '/api/users',
    companies: '/api/companies',
    employees: '/api/employees',
    attendance: '/api/attendance',
    attendanceLogs: '/api/attendance-logs',
    attendanceSettings: '/api/attendance-settings',
    departments: '/api/departments',
    leaveRequests: '/api/leave-requests',
    leavePolicies: '/api/leave-policies',
    tasks: '/api/tasks',
    holidays: '/api/holidays',
    tickets: '/api/tickets',
    salarySlips: '/api/salary-slips',
    payrollRuns: '/api/payroll-runs',
    salaryStructures: '/api/salary-structures',
    announcements: '/api/announcements',
    assets: '/api/assets',
    notifications: '/api/notifications',
    documents: '/api/documents',
    transfers: '/api/transfers',
    performance: '/api/performance',
    performanceReviews: '/api/performance',
    shiftConfigs: '/api/shift-configs',
    companySettings: '/api/company-settings',
    emailLogs: '/api/email/logs',
    invitations: '/api/auth/invitations',
  };
  const top = path.split('/')[0];
  return map[top] ?? `/api/${top.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let token: string;
  try {
    token = await getIdToken();
  } catch (err) {
    if (err instanceof FriendlyError) throw err; // already normalized (session expired)
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  try {
    return await fetch(`${API()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw networkError(); // offline / DNS / TLS — never surface raw fetch errors
  }
}

interface RestListResponse {
  [key: string]: unknown[];
}

async function fetchCollection(q: Query): Promise<DocumentData[]> {
  const endpoint = endpointFor(q._path);
  const params = new URLSearchParams();

  const wheres = q._constraints.filter((c) => c.type === 'where');
  const orderC = q._constraints.find((c) => c.type === 'orderBy');
  const limitC = q._constraints.find((c) => c.type === 'limit');

  // Translate supported filters into REST query params
  for (const w of wheres) {
    if (w.op === '==' && typeof w.value === 'string') {
      params.set(w.field!, w.value);
    }
  }
  if (orderC) {
    params.set('orderBy', orderC.field!);
    params.set('desc', orderC.direction === 'desc' ? 'true' : 'false');
  }
  if (limitC) params.set('limit', String(limitC.n));

  const qs = params.toString();
  const res = await apiFetch(`${endpoint}${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
  const body = (await res.json()) as RestListResponse;
  const key = Object.keys(body).find((k) => Array.isArray(body[k])) ?? Object.keys(body)[0];
  let docs = (body[key] ?? []) as DocumentData[];

  // Post-filter the operators the API can't express (in, !=, comparisons)
  for (const w of wheres) {
    if (w.op === '==' && typeof w.value !== 'string') {
      docs = docs.filter((d) => d[w.field!] === w.value);
    } else if (w.op === 'in' && Array.isArray(w.value)) {
      const allowed = w.value as unknown[];
      docs = docs.filter((d) => allowed.includes(d[w.field!]) || allowed.includes(String(d[w.field!])));
    } else if (w.op === '!=') {
      docs = docs.filter((d) => d[w.field!] !== w.value);
    } else if (['<', '<=', '>', '>='].includes(w.op!)) {
      const rhs = w.value as any;
      docs = docs.filter((d) => {
        const v = d[w.field!];
        switch (w.op) {
          case '<': return v < rhs;
          case '<=': return v <= rhs;
          case '>': return v > rhs;
          case '>=': return v >= rhs;
          default: return true;
        }
      });
    } else if (w.op === 'array-contains') {
      docs = docs.filter((d) => Array.isArray(d[w.field!]) && (d[w.field!] as unknown[]).includes(w.value));
    }
  }

  // Client-side ordering if the API couldn't apply it
  if (orderC) {
    docs.sort((a, b) => {
      const av = a[orderC.field!];
      const bv = b[orderC.field!];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return orderC.direction === 'desc' ? -cmp : cmp;
    });
  }
  if (limitC && docs.length > limitC.n!) docs = docs.slice(0, limitC.n!);

  return docs;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDocs(reference: Query): Promise<QuerySnapshot> {
  const docs = await fetchCollection(reference);
  return makeQuerySnapshot(reference._path, docs);
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const endpoint = endpointFor(ref._path);
  const companyId = ref._path.split('/')[1] ?? '';
  const res = await apiFetch(`${endpoint}/${ref.id}?companyId=${encodeURIComponent(companyId)}`);
  if (res.status === 404) {
    return makeDocumentSnapshot(ref, undefined);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
  const body = (await res.json()) as Record<string, DocumentData>;
  const entityKey = Object.keys(body).find((k) => k !== 'success') ?? Object.keys(body)[0];
  const data = body[entityKey];
  if (!data) return makeDocumentSnapshot(ref, undefined);
  return makeDocumentSnapshot(ref, data);
}

// ---------------------------------------------------------------------------
// onSnapshot — polling implementation
// ---------------------------------------------------------------------------

const DEFAULT_POLL_MS = 20_000;

export type Unsubscribe = () => void;

export interface SnapshotListenOptions {
  includeMetadataChanges?: boolean;
}

interface SnapshotObserver<T> {
  next?: (snapshot: T) => void;
  error?: (error: FirestoreError) => void;
  complete?: () => void;
}

export function onSnapshot(
  reference: DocumentReference,
  observer: SnapshotObserver<DocumentSnapshot>,
): Unsubscribe;
export function onSnapshot(
  reference: DocumentReference,
  options: SnapshotListenOptions,
  observer: SnapshotObserver<DocumentSnapshot>,
): Unsubscribe;
export function onSnapshot(
  reference: DocumentReference,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: FirestoreError) => void,
  onCompletion?: () => void,
): Unsubscribe;
export function onSnapshot(
  reference: DocumentReference,
  options: SnapshotListenOptions,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: FirestoreError) => void,
  onCompletion?: () => void,
): Unsubscribe;
export function onSnapshot(
  query: Query,
  observer: SnapshotObserver<QuerySnapshot>,
): Unsubscribe;
export function onSnapshot(
  query: Query,
  options: SnapshotListenOptions,
  observer: SnapshotObserver<QuerySnapshot>,
): Unsubscribe;
export function onSnapshot(
  query: Query,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: FirestoreError) => void,
  onCompletion?: () => void,
): Unsubscribe;
export function onSnapshot(
  query: Query,
  options: SnapshotListenOptions,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: FirestoreError) => void,
  onCompletion?: () => void,
): Unsubscribe;
export function onSnapshot(
  target: Query | DocumentReference,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...rest: any[]
): Unsubscribe {
  const fns = rest.filter((r) => typeof r === 'function') as Array<(arg: never) => void>;
  const onNext = fns[0];
  const onError = fns[1];
  const observer = rest.find(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      ('next' in r || 'error' in r || 'complete' in r),
  ) as SnapshotObserver<never> | undefined;
  const pollMs = (rest.find((r) => typeof r === 'number') as number | undefined) ?? DEFAULT_POLL_MS;

  const emit = (snap: never) => {
    (onNext as unknown as ((s: unknown) => void) | undefined)?.(snap);
    (observer?.next as unknown as ((s: unknown) => void) | undefined)?.(snap);
  };
  const fail = (err: FirestoreError) => {
    (onError as unknown as ((e: FirestoreError) => void) | undefined)?.(err);
    observer?.error?.(err);
    console.error('onSnapshot error', err);
  };

  let stopped = false;
  let lastJson = '';

  const tick = async () => {
    if (stopped) return;
    try {
      if (target instanceof DocumentReference) {
        const snap = await getDoc(target);
        const json = JSON.stringify(snap.data() ?? null);
        if (json !== lastJson) {
          lastJson = json;
          emit(snap as never);
        }
      } else {
        const snap = await getDocs(target);
        const json = JSON.stringify(snap.docs.map((d) => d.data()));
        if (json !== lastJson) {
          lastJson = json;
          emit(snap as never);
        }
      }
    } catch (err) {
      // Firestore-compatible error emission for rules-like denials
      fail(
        err instanceof FirestoreError
          ? err
          : new FirestoreError('unknown', (err as Error)?.message ?? String(err)),
      );
    }
  };

  void tick();
  const timer = setInterval(tick, pollMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function prepareData(data: DocumentData): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null && '_serverTimestamp' in (v as object)) {
      out[k] = new Date().toISOString();
    } else if (typeof v === 'object' && v !== null && '_deleteField' in (v as object)) {
      // skip — API deletes null fields
    } else if (v instanceof Timestamp) {
      out[k] = v.toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function addDoc(collRef: CollectionReference, data: DocumentData): Promise<DocumentReference> {
  const endpoint = endpointFor(collRef._path);
  const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(prepareData(data)) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
  const body = (await res.json()) as { id?: string };
  const id = body.id ?? generateId();
  return new DocumentReference(id, `${collRef._path}/${id}`);
}

export async function setDoc(ref: DocumentReference, data: DocumentData, opts?: { merge?: boolean }): Promise<void> {
  const endpoint = endpointFor(ref._path);
  const prepared = prepareData(data);
  const method = opts?.merge ? 'PATCH' : 'PUT';
  const companyId = extractCompanyId(ref, data);
  const url = companyId ? `${endpoint}/${ref.id}?companyId=${encodeURIComponent(companyId)}` : `${endpoint}/${ref.id}`;
  const res = await apiFetch(url, {
    method,
    body: JSON.stringify({ ...prepared, id: ref.id, companyId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
}

export async function updateDoc(ref: DocumentReference, data: DocumentData): Promise<void> {
  const endpoint = endpointFor(ref._path);
  const companyId = extractCompanyId(ref, data);
  const url = companyId ? `${endpoint}/${ref.id}?companyId=${encodeURIComponent(companyId)}` : `${endpoint}/${ref.id}`;
  const res = await apiFetch(url, { method: 'PATCH', body: JSON.stringify(prepareData(data)) });
  if (res.status === 404) {
    throw new FirestoreError('not-found', 'No document to update');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  const endpoint = endpointFor(ref._path);
  const companyId = ref._path.split('/')[1] ?? '';
  const res = await apiFetch(`${endpoint}/${ref.id}?companyId=${encodeURIComponent(companyId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => null);
    const friendly = toFriendlyError(res.status, body);
    throw new FirestoreError(friendly.code, friendly.message);
  }
}

/** users collection docs use the uid as both id and companyId bucket. */
function extractCompanyId(ref: DocumentReference, data: DocumentData): string {
  if (typeof data.companyId === 'string' && data.companyId) return data.companyId;
  const parts = ref._path.split('/');
  if (parts[0] === 'users') return 'global';
  return parts[1] ?? '';
}

export { getCurrentUser as _getCurrentUser };
