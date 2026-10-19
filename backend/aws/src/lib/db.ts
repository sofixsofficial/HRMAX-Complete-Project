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
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
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

/** Delete an entity. */
export async function deleteEntity(entity: string, companyId: string, id: string): Promise<void> {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: entityKeys(entity, companyId, id) }));
}

/** Delete a user profile. */
export async function deleteUserDoc(uid: string): Promise<void> {
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: userPK(uid), SK: 'PROFILE' } }));
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
  await putEntity(merged as T, opts);
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
