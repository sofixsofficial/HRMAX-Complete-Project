/**
 * DynamoDB single-table data layer for HR MAX.
 *
 * Table: HRMAX (env TABLE_NAME)
 *   Base keys:
 *     PK = "COMPANY#{companyId}"   SK = "{entity}#{id}"        — tenant-scoped entities
 *     PK = "COMPANY#{companyId}"   SK = "COMPANY#META"         — company profile
 *     PK = "USER#{uid}"            SK = "PROFILE"              — user profile
 *   GSI1 (userId access):
 *     GSI1PK = "USER#{userId}"     GSI1SK = "{entity}#{ts}#{id}"  — per-user queries (attendance, leave, slips, tasks, notifications)
 *   GSI2 (role access):
 *     GSI2PK = "ROLE#{role}"       GSI2SK = "{companyId}#{uid}"   — users by role
 *   GSI3 (global entity listing — master-admin):
 *     GSI3PK = "{entity}"          GSI3SK = "{ts}#{id}"           — unscoped listing (companies, announcements, tickets…)
 *
 * Every stored item carries `data` (the document payload) + `entity` + `companyId` for filtering.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  BatchGetCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { BaseEntity } from './types.js';
import { VALID_ROLES } from './types.js';

const ddb = new DynamoDBClient({});
export const doc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE = process.env.TABLE_NAME ?? 'HRMAX';

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

export const companyPK = (companyId: string) => `COMPANY#${companyId}`;
export const userPK = (uid: string) => `USER#${uid}`;

export function entityKeys(entity: string, companyId: string, id: string) {
  return { PK: companyPK(companyId), SK: `${entity}#${id}` };
}

export function userGsi(userId: string, entity: string, ts: string, id: string) {
  return { GSI1PK: userPK(userId), GSI1SK: `${entity}#${ts}#${id}` };
}

export function roleGsi(role: string, companyId: string, uid: string) {
  return { GSI2PK: `ROLE#${role}`, GSI2SK: `${companyId}#${uid}` };
}

export function globalGsi(entity: string, ts: string, id: string) {
  return { GSI3PK: entity, GSI3SK: `${ts}#${id}` };
}

/** Convert a JS value into a safe DynamoDB-stored string (ISO for dates). */
export function normalizeForStorage<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map(normalizeForStorage) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = normalizeForStorage(v);
    }
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Generic CRUD
// ---------------------------------------------------------------------------

interface StoreOptions {
  entity: string;
  /** Also index on GSI1 for per-user queries. */
  userIdField?: string;
  /** Timestamp field used for GSI1/GSI3 sort keys (default updatedAt/createdAt). */
  tsField?: string;
  /** Also index on GSI3 for global listing. */
  globalList?: boolean;
  /**
   * Override the partition company id (item is stored under COMPANY#{keyCompanyId})
   * while the document keeps its real companyId in `data`. Used for entities
   * that live in a shared partition (invitations → 'global').
   */
  keyCompanyId?: string;
  /**
   * Optional DynamoDB condition evaluated against the EXISTING item before the
   * Put (create-only / punch-once guards). When it fails the write is rejected
   * by DynamoDB and `ConditionalWriteFailed` is thrown, so callers can map it
   * to a domain error instead of silently overwriting a concurrent write.
   * Without this, duplicate prevention is a read-then-put race.
   */
  condition?: {
    expression: string;
    values?: Record<string, unknown>;
    names?: Record<string, string>;
  };
}

/**
 * A `StoreOptions.condition` was not satisfied — the caller's assumption
 * (e.g. "no punch recorded yet") lost a race with a concurrent writer.
 * Handlers translate this into a 412/409 style ApiError.
 */
export class ConditionalWriteFailed extends Error {
  constructor(message = 'Conditional write failed') {
    super(message);
    this.name = 'ConditionalWriteFailed';
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'ConditionalCheckFailedException';
}

/** Write (upsert) an entity document. */
export async function putEntity<T>(doc_: T, opts: StoreOptions): Promise<T> {
  const normalized = normalizeForStorage(doc_);
  const rec = normalized as unknown as BaseEntity;
  const ts = String(rec[opts.tsField ?? 'updatedAt'] ?? rec[opts.tsField ?? 'createdAt'] ?? new Date().toISOString());
  const keyCompanyId = opts.keyCompanyId ?? rec.companyId;
  const item: Record<string, unknown> = {
    ...entityKeys(opts.entity, keyCompanyId, rec.id),
    entity: opts.entity,
    companyId: keyCompanyId,
    docId: rec.id,
    data: normalized,
    updatedAt: new Date().toISOString(),
  };
  const userId = opts.userIdField ? String(rec[opts.userIdField] ?? '') : '';
  if (userId) Object.assign(item, userGsi(userId, opts.entity, ts, rec.id));
  if (opts.globalList) Object.assign(item, globalGsi(opts.entity, ts, rec.id));
  // GSI2 (users by role) — only user-entity documents: other entities may
  // carry a `role` field and must never pollute role lookups.
  if (opts.entity === 'user' && rec.role) {
    Object.assign(item, roleGsi(String(rec.role), String(keyCompanyId), String(rec.id)));
  }
  try {
    await doc.send(new PutCommand({
      TableName: TABLE,
      Item: item,
      ...(opts.condition
        ? {
            ConditionExpression: opts.condition.expression,
            ...(opts.condition.values ? { ExpressionAttributeValues: opts.condition.values } : {}),
            ...(opts.condition.names ? { ExpressionAttributeNames: opts.condition.names } : {}),
          }
        : {}),
    }));
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new ConditionalWriteFailed();
    throw err;
  }
  return normalized;
}

/** Read a single entity by id. */
export async function getEntity<T>(
  entity: string,
  companyId: string,
  id: string,
): Promise<T | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: entityKeys(entity, companyId, id) }),
  );
  return (res.Item?.data as T) ?? null;
}

/** Read a user profile. */
export async function getUserDoc(uid: string): Promise<Record<string, unknown> | null> {
  const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
  return (res.Item?.data as Record<string, unknown>) ?? null;
}

/**
 * Company profile row for a partition — the source of per-company settings the
 * backend previously ignored (timezone, weekends). Falls back from the
 * migration's COMPANY#META row to the CRUD-written `company#<id>` row so both
 * storage layouts resolve.
 */
export async function getCompanyMeta(companyId: string): Promise<Record<string, unknown> | null> {
  if (!companyId) return null;
  try {
    const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: companyPK(companyId), SK: 'COMPANY#META' } }));
    if (res.Item?.data) return res.Item.data as Record<string, unknown>;
  } catch {
    // fall through to the CRUD row
  }
  const rows = await queryEntities<Record<string, unknown>>({ entity: 'company', companyId, limit: 1 });
  return rows[0] ?? null;
}

/** Delete an entity. */
export async function deleteEntity(entity: string, companyId: string, id: string): Promise<void> {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: entityKeys(entity, companyId, id) }));
}

/** Delete a user profile and every partition copy writeUserDoc created. */
export async function deleteUserDoc(uid: string): Promise<void> {
  // PROFILE is the authority resolveCaller reads; consult it first to learn
  // which company partitions hold copies (mirrors writeUserDoc's dual-write,
  // incl. the synthetic 'global' bucket for platform roles). Without this,
  // deleting a user left ghost copies that company-scoped user lists still
  // returned.
  const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
  const data = res.Item?.data as Record<string, unknown> | undefined;
  const realCompanyId = String(data?.companyId ?? '');
  const gsiCompanyId = data?.role === 'master-admin' ? 'global' : realCompanyId || 'global';
  const keys: Array<Record<string, string>> = [
    { PK: userPK(uid), SK: 'PROFILE' },
    { PK: companyPK(gsiCompanyId), SK: `user#${uid}` },
  ];
  if (gsiCompanyId !== realCompanyId && realCompanyId) {
    keys.push({ PK: companyPK(realCompanyId), SK: `user#${uid}` });
  }
  for (const Key of keys) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key }));
  }
}

/** Patch fields on an existing entity document (shallow merge, dot-notation for nested). */
export async function patchEntity<T>(
  entity: string,
  companyId: string,
  id: string,
  patch: Record<string, unknown>,
  opts: StoreOptions,
): Promise<T | null> {
  const existing = await getEntity<T>(entity, companyId, id);
  if (!existing) return null;
  const merged: Record<string, unknown> = { ...(existing as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) {
      // dot-notation: 'missedPunchRectification.resolvedAt'
      const parts = k.split('.');
      let cur = merged;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]] = v;
    } else if (v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  merged.updatedAt = new Date().toISOString();
  // Write back to the EXACT partition the row was read from. putEntity would
  // otherwise default keyCompanyId to rec.companyId (the data field) — for
  // rows whose partition diverges from data.companyId (notifications are
  // forced to the 'global' bucket on create), that silently created a DUPLICATE
  // row in another partition and left the original stale: mark-read returned
  // success but the badge never cleared.
  await putEntity(merged as T, { ...opts, keyCompanyId: companyId });
  return merged as T;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function paginate(input: QueryCommandInput, limit?: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new QueryCommand({ ...input, ExclusiveStartKey, Limit: undefined }));
    out.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey && (!limit || out.length < limit));
  return out;
}

export interface EntityQuery {
  entity: string;
  companyId: string;
  /** Equality filters on `data.<field>` (DynamoDB doesn't index nested, so we filter post-fetch). */
  filters?: Record<string, unknown>;
  /** GSI1 per-user query. */
  userId?: string;
  /** GSI3 global listing (ignores companyId). */
  global?: boolean;
  orderBy?: { field: string; desc?: boolean };
  limit?: number;
}

/**
 * Query entities. Uses PK partition for company-scoped reads (most common),
 * GSI1 for user-scoped, GSI3 for global. Equality filters + ordering applied
 * in-process on the partition (partitions are tenant-sized which keeps this
 * bounded; for very large tenants the orderBy field is embedded in the SK so
 * DynamoDB returns items pre-sorted).
 */
export async function queryEntities<T>(q: EntityQuery): Promise<T[]> {
  let items: Record<string, unknown>[];
  if (q.userId) {
    items = await paginate({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': userPK(q.userId) },
    });
    // entity prefix filter
    items = items.filter((i) => String(i.SK ?? '').startsWith(`${q.entity}#`));
  } else if (q.global) {
    items = await paginate({
      TableName: TABLE,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': q.entity },
    });
  } else {
    items = await paginate({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': companyPK(q.companyId) },
    });
    items = items.filter((i) => String(i.SK ?? '').startsWith(`${q.entity}#`));
  }

  let docs = items.map((i) => i.data as T);

  if (q.filters) {
    docs = docs.filter((d) => {
      const rec = d as unknown as Record<string, unknown>;
      return Object.entries(q.filters!).every(([k, v]) => rec[k] === v);
    });
  }

  if (q.orderBy) {
    const { field, desc } = q.orderBy;
    docs.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[field];
      const bv = (b as unknown as Record<string, unknown>)[field];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return desc ? -cmp : cmp;
    });
  }

  if (q.limit && docs.length > q.limit) docs = docs.slice(0, q.limit);
  return docs;
}

/** List user profiles by role (GSI2). */
export async function usersByRole(role: string): Promise<Record<string, unknown>[]> {
  const items = await paginate({
    TableName: TABLE,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': `ROLE#${role}` },
  });
  return items.map((i) => i.data as Record<string, unknown>);
}

/** List all user profiles (master-admin use). Paginated, bounded. */
export async function allUsers(limit = 2000): Promise<Record<string, unknown>[]> {
  // GSI2 role sweep. (The previous implementation issued
  // `Query KeyConditionExpression: begins_with(PK, :pk)` — DynamoDB only allows
  // equality on a partition key, so that query always threw
  // "Query key condition not supported". Every user-entity item carries
  // GSI2PK = ROLE#<role>, so union across the known roles instead.)
  const seen = new Map<string, Record<string, unknown>>();
  for (const role of VALID_ROLES) {
    const items = await usersByRole(role);
    for (const u of items) {
      const id = String(u.id ?? '');
      if (id && !seen.has(id)) seen.set(id, u);
      if (seen.size >= limit) return [...seen.values()].slice(0, limit);
    }
  }
  return [...seen.values()].slice(0, limit);
}

/** List companies (global GSI3). */
export async function listCompanies(limit = 1000): Promise<Record<string, unknown>[]> {
  const items = await paginate(
    {
      TableName: TABLE,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': 'company' },
    },
    limit,
  );
  return items.map((i) => i.data as Record<string, unknown>);
}

/**
 * Every company partition that exists, ordered so real-company copies win
 * over the synthetic 'global' duplicates writeUserDoc creates for platform
 * users (dedupe keeps the first occurrence per id).
 */
export async function allPartitions(): Promise<string[]> {
  const companies = await listCompanies();
  const ids = companies.map((c) => String(c.id ?? '')).filter(Boolean);
  return [...new Set([...ids, 'master-admin', 'global'])];
}

/**
 * Run the same entity query across several company partitions and merge the
 * results: id-deduped (dual-written user docs appear in two partitions) and
 * re-sorted with the same comparator queryEntities uses per partition.
 * Mirrors Firestore's collection-group reads for super-admins / multi-scope
 * roles that previously listed across every company.
 */
export async function queryEntitiesAcross<T>(
  q: Omit<EntityQuery, 'companyId'>,
  partitions: string[],
): Promise<T[]> {
  const batches = await Promise.all(
    partitions.map((companyId) => queryEntities<T>({ ...q, companyId })),
  );
  const seen = new Set<string>();
  let merged: T[] = [];
  for (const batch of batches) {
    for (const d of batch) {
      const id = String((d as unknown as Record<string, unknown>).id ?? '');
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      merged.push(d);
    }
  }
  if (q.orderBy) {
    const { field, desc } = q.orderBy;
    merged = merged.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[field];
      const bv = (b as unknown as Record<string, unknown>)[field];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return desc ? -cmp : cmp;
    });
  }
  if (q.limit && merged.length > q.limit) merged = merged.slice(0, q.limit);
  return merged;
}

/**
 * Locate one document by id across partitions (first hit wins, in partition
 * order). Needed because the shim derives `?companyId=` from the document
 * path — a doc id for every flat collection — so by-id handlers can never
 * trust that param and must find the record inside the caller's scope.
 */
export async function locateEntityAcross<T>(
  entity: string,
  id: string,
  partitions: string[],
): Promise<{ doc: T; companyId: string } | null> {
  for (const companyId of partitions) {
    const found = await getEntity<T>(entity, companyId, id);
    if (found) return { doc: found, companyId };
  }
  return null;
}
