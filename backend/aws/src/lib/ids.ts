/**
 * Backend-owned ID generation — Company / Employee / Department codes.
 *
 * The FRONTEND never generates IDs anymore (the old client-side collection
 * scans were racy and non-atomic). Every code is minted here, on the AWS
 * backend, from DynamoDB atomic counters:
 *
 *   Company ID   COMP-[SHORT]-[YEAR]-[SERIAL]   e.g. COMP-SOF-2026-0001
 *   Employee ID  [SHORT]-EMP-[YEAR]-[SERIAL]    e.g. SOF-EMP-2026-0001
 *   Department   DEPT-[SERIAL]                  e.g. DEPT-0004 (per company)
 *
 * Rules enforced by construction:
 *   1. Company IDs are auto-generated (serial global per calendar year).
 *   2. Employee IDs = company short code + EMP + JOINING year + serial.
 *   3. Each company gets its own employee sequence (per company + year).
 *   4. Never duplicated — serials come from a single atomic `ADD` item
 *      operation, so concurrent creates can't read the same number.
 *   5. Name / company / department edits never touch an issued ID (the create
 *      paths are the only writers; updates strip the field for non-super-admins).
 *   6. Never reused — counters only increase, even after a delete.
 *   7. A new calendar year starts a fresh sequence (the year is part of the
 *      counter scope and of the ID itself).
 *   8. Frontend never generates — clients may send an employeeId/code but the
 *      backend overwrites it on create.
 *
 * Counter rows live in the same table under `PK = SEQ#<scope> SK = SEQ`.
 * On first use for a scope the counter is seeded from the highest serial
 * already present (so a migration that rewrites IDs by hand can never produce
 * a duplicate on the next create), then incremented atomically.
 */

import { GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  doc,
  TABLE,
  getEntity,
  queryEntities,
  listCompanies,
} from './db.js';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — no AWS calls)
// ---------------------------------------------------------------------------

const pad4 = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(4, '0');

/** First letters of a company name, uppercased — "Sofixs Pvt. Ltd." → "SOF". */
export function lettersOf(name: string): string {
  return String(name ?? '').toUpperCase().replace(/[^A-Z]/g, '');
}

/** Derive a candidate short code from a company name (best effort, ≥1 char). */
export function deriveShortCode(name: string): string {
  const letters = lettersOf(name);
  return letters ? letters.slice(0, 3) : 'CMP';
}

/**
 * Next candidate short code given the codes already in use: tries the full
 * name prefix of increasing length first (SOF → SOFI → SOFIX …), then falls
 * back to appending a digit. Deterministic for a given `taken` set.
 */
export function nextShortCodeCandidate(name: string, taken: ReadonlySet<string>): string {
  const letters = lettersOf(name) || 'CMP';
  const start = Math.min(3, letters.length);
  for (let len = start; len <= letters.length; len++) {
    const candidate = letters.slice(0, len);
    if (!taken.has(candidate)) return candidate;
  }
  const base = letters.slice(0, 3);
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 3)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Pathological name collisions — the serial suffix keeps it unique anyway.
  return `${base.slice(0, 3)}${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

export const formatCompanyCode = (short: string, year: number, serial: number) =>
  `COMP-${short}-${year}-${pad4(serial)}`;

export const formatEmployeeCode = (short: string, year: number, serial: number) =>
  `${short}-EMP-${year}-${pad4(serial)}`;

export const formatDepartmentCode = (serial: number) => `DEPT-${pad4(serial)}`;

/** Extract `2026` + `0007` from `COMP-SOF-2026-0007` / `SOF-EMP-2026-0007`. */
export function parseIssuedCode(code: string, year?: number): { year: number; serial: number } | null {
  const m = /-(\d{4})-(\d{1,6})$/.exec(String(code ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  if (year !== undefined && y !== year) return null;
  return { year: y, serial: Number(m[2]) };
}

/** Calendar year of a joinDate-ish value; current year when unparseable. */
export function yearOf(value: unknown, fallback = new Date().getFullYear()): number {
  if (value === undefined || value === null || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(String(value));
  const y = d.getFullYear();
  return Number.isFinite(y) && y > 1970 && y < 2200 ? y : fallback;
}

// ---------------------------------------------------------------------------
// DynamoDB atomic counter
// ---------------------------------------------------------------------------

/**
 * Atomically increment a scope's counter and return the new value.
 *
 * `seed` is applied ONLY when the row does not exist yet, guarded by
 * `attribute_not_exists` so two first-time writers can't both seed (the loser
 * of that race falls straight through to the ADD). The increment itself is a
 * single atomic `ADD` — DynamoDB guarantees distinct results per caller.
 */
async function nextSequence(scope: string, seed: number): Promise<number> {
  const Key = { PK: `SEQ#${scope}`, SK: 'SEQ' };
  const existing = await doc.send(new GetCommand({ TableName: TABLE, Key }));
  if (!existing.Item) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE,
        Item: { ...Key, n: Math.trunc(seed), scope },
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (err) {
      // Lost the first-writer race — the row now exists with the other
      // writer's seed (equal to ours: both compute it from the same scan).
      if (!isConditional(err)) throw err;
    }
  }
  const res = await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key,
    UpdateExpression: 'ADD #n :one',
    ExpressionAttributeNames: { '#n': 'n' },
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'ALL_NEW',
  }));
  return Number(res.Attributes?.n ?? seed + 1);
}

function isConditional(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'ConditionalCheckFailedException';
}

// ---------------------------------------------------------------------------
// Short-code uniqueness (companies)
// ---------------------------------------------------------------------------

/** Every short code already spoken for, in stable company-list order. */
async function takenShortCodes(): Promise<Set<string>> {
  const companies = await listCompanies();
  const taken = new Set<string>();
  const ordered = [...companies].sort((a, b) =>
    String(a.code ?? a.id ?? '') < String(b.code ?? b.id ?? '') ? -1 : 1,
  );
  for (const c of ordered) {
    const own = String(c.shortCode ?? '');
    if (own) { taken.add(own); continue; }
    const fromCode = /^COMP-([A-Z]+)-\d{4}-\d+$/.exec(String(c.code ?? ''));
    if (fromCode) { taken.add(fromCode[1]); continue; }
    taken.add(deriveShortCode(String(c.name ?? '')));
  }
  return taken;
}

/**
 * Reserve a globally unique short code for `name`. A lock row
 * (`SEQ#CODE#<candidate>`) with an `attribute_not_exists` condition closes the
 * read-derive-write race: two companies created at the same instant that would
 * both derive "SOF" resolve to different codes because only one can take the
 * lock; the loser re-derives with the extended candidate.
 */
async function reserveShortCode(name: string): Promise<string> {
  const taken = await takenShortCodes();
  let candidate = nextShortCodeCandidate(name, taken);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: `SEQ#CODE#${candidate}`, SK: 'LOCK', shortCode: candidate },
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
      return candidate;
    } catch (err) {
      if (!isConditional(err)) throw err;
      taken.add(candidate);
      candidate = nextShortCodeCandidate(name, taken);
    }
  }
  throw new Error('Could not derive a unique company short code');
}

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------

/** Company ID: COMP-[SHORT]-[YEAR]-[SERIAL] (+ the short code for employees). */
export async function generateCompanyId(name: string): Promise<{ code: string; shortCode: string }> {
  const year = new Date().getFullYear();
  // Seed = highest COMP-…-<year>-<serial> already issued this year (migrated
  // rows included), so a hand-run migration can never collide.
  const companies = await listCompanies();
  let maxSerial = 0;
  for (const c of companies) {
    const parsed = parseIssuedCode(String(c.code ?? ''), year);
    if (parsed && parsed.serial > maxSerial) maxSerial = parsed.serial;
  }
  const shortCode = await reserveShortCode(name);
  const serial = await nextSequence(`COMPANY#${year}`, maxSerial);
  return { code: formatCompanyCode(shortCode, year, serial), shortCode };
}

/** Resolve a company's short code (stored → parsed from ID → derived). */
export async function companyShortCode(companyId: string): Promise<string> {
  if (!companyId || companyId === 'global') return 'CMP';
  const company = await getEntity<Record<string, unknown>>('company', companyId, companyId);
  if (company) {
    const own = String(company.shortCode ?? '').trim();
    if (own && /^[A-Z]{2,8}\d{0,3}$/.test(own)) return own;
    const fromCode = /^COMP-([A-Z]+)-\d{4}-\d+$/.exec(String(company.code ?? ''));
    if (fromCode) return fromCode[1];
    const derived = deriveShortCode(String(company.name ?? ''));
    // Must not collide with ANOTHER company's issued code — same derivation
    // order the company-create path uses, so both sides agree.
    const taken = await takenShortCodes();
    taken.delete(derived);
    return taken.has(derived) ? nextShortCodeCandidate(String(company.name ?? ''), taken) : derived;
  }
  return 'CMP';
}

/**
 * Employee ID: [SHORT]-EMP-[JOINING YEAR]-[SERIAL], per-company sequence.
 * Overwrites whatever the client sent — IDs are backend-owned (rule 8).
 */
export async function generateEmployeeId(companyId: string, joinDate?: unknown): Promise<string> {
  const year = yearOf(joinDate);
  const shortCode = await companyShortCode(companyId);
  // Seed from the highest serial already present in this company+year scope
  // (any legacy format parses via the trailing `-NNNN`), floored by the number
  // of employees in scope so a missing/foreign ID can never restart the count.
  const employees = await queryEntities<Record<string, unknown>>({
    entity: 'employee',
    companyId,
  });
  let maxSerial = 0;
  let inScope = 0;
  for (const e of employees) {
    const parsed = parseIssuedCode(String(e.employeeId ?? ''), year);
    if (parsed && parsed.serial > maxSerial) maxSerial = parsed.serial;
    if (yearOf(e.joinDate, year) === year) inScope++;
  }
  const serial = await nextSequence(`EMPLOYEE#${companyId}#${year}`, Math.max(maxSerial, inScope));
  return formatEmployeeCode(shortCode, year, serial);
}

/** Department code: DEPT-[SERIAL] per company. Only minted when absent — */
// the company-onboarding batch seeds readable 3-letter codes on purpose.
export async function generateDepartmentId(companyId: string, existingCode?: unknown): Promise<string | undefined> {
  const code = String(existingCode ?? '').trim();
  if (code) return undefined;
  const departments = await queryEntities<Record<string, unknown>>({
    entity: 'department',
    companyId,
  });
  let maxSerial = 0;
  for (const d of departments) {
    const m = /^DEPT-(\d{1,6})$/.exec(String(d.code ?? ''));
    if (m) maxSerial = Math.max(maxSerial, Number(m[1]));
  }
  const serial = await nextSequence(`DEPARTMENT#${companyId}`, Math.max(maxSerial, departments.length));
  return formatDepartmentCode(serial);
}
