/**
 * Firestore → DynamoDB single-table import (table HRMAX).
 *
 * Reuses the application's OWN compiled data layer (backend/aws/dist/lib/db.js
 * putEntity + handlers/auth.js writeUserDoc) so every key, GSI attribute and
 * normalization matches exactly what the API reads/writes at runtime.
 *
 * Transformations:
 *   1. Global uid remap — every string (and object key) equal to a Firebase
 *      Auth uid is replaced with the user's Cognito sub (cognito-map.json),
 *      because Cognito subs are the identity the API resolves from JWTs.
 *   2. Documented normalizations (see MAPPING notes + migration report):
 *      notifications/adminAlerts/emails/corporateInquiries → companyId 'global'
 *      (that is the partition every reader/patcher in the app uses for them);
 *      email_logs with empty companyId → 'global'; audit partition sanitize.
 *   3. `id` field set to the document id when missing.
 *
 * Idempotent: putEntity overwrites by key, safe to re-run.
 * Usage: node import-dynamodb.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'export');

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';
process.env.AWS_REGION = process.env.AWS_REGION ?? 'ap-southeast-2';

// Import the app's compiled data layer AFTER env is set (module-level TABLE/region).
const dbUrl = new URL('../../backend/aws/dist/lib/db.js', import.meta.url);
const authUrl = new URL('../../backend/aws/dist/handlers/auth.js', import.meta.url);
const { putEntity } = await import(dbUrl.href);
const { writeUserDoc } = await import(authUrl.href);

const uidMapList = JSON.parse(readFileSync(join(OUT, 'cognito-map.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
if (uidMapList.some((m) => String(m.sub).startsWith('dry-'))) {
  console.error('cognito-map.json contains dry-run entries — run import-cognito.mjs for real first.'); process.exit(1);
}
const UID_MAP = new Map(uidMapList.map((m) => [m.firebaseUid, m.sub]));
const CREATED = new Set(uidMapList.filter((m) => m.created).map((m) => m.sub));

/** Recursively replace Firebase uids (values AND object keys). Returns [value, replacements]. */
function deepReplace(v, map) {
  let n = 0;
  if (typeof v === 'string') {
    const hit = map.get(v);
    return hit ? [hit, 1] : [v, 0];
  }
  if (Array.isArray(v)) {
    const out = v.map((x) => { const [y, k] = deepReplace(x, map); n += k; return y; });
    return [out, n];
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const [nk, k1] = deepReplace(k, map); n += k1;
      const [nv, k2] = deepReplace(val, map); n += k2;
      if (nk !== '__proto__' && nk !== 'constructor') out[nk] = nv;
    }
    return [out, n];
  }
  return [v, 0];
}

const badCompanyId = (c) => c === undefined || c === null || c === '' || c === 'undefined' || c === 'null';

/** collection → exact opts mirroring the app's writers/readers (see audit in docs). */
const MAPPING = [
  { collection: 'companies', entity: 'company', opts: { globalList: true }, after: (d, id) => ({ ...d, companyId: id }) },
  { collection: 'employees', entity: 'employee', opts: { userIdField: 'userId' } },
  { collection: 'departments', entity: 'department', opts: {} },
  { collection: 'attendance', entity: 'attendance', opts: { userIdField: 'userId', tsField: 'date' } },
  { collection: 'attendanceLogs', entity: 'attendanceLog', opts: { userIdField: 'userId', tsField: 'timestamp' } },
  { collection: 'attendanceSettings', entity: 'attendanceSettings', opts: {} },
  { collection: 'leaveRequests', entity: 'leaveRequest', opts: { userIdField: 'userId' } },
  { collection: 'holidays', entity: 'holiday', opts: { tsField: 'date' } },
  { collection: 'notifications', entity: 'notification', opts: { userIdField: 'userId' }, forceCompanyId: 'global' },
  { collection: 'adminAlerts', entity: 'adminAlert', opts: {}, forceCompanyId: 'global' },
  { collection: 'audit_logs', entity: 'auditLog', opts: { globalList: true, tsField: 'timestamp' }, sanitizePartition: true },
  { collection: 'corporate_inquiries', entity: 'corporateInquiry', opts: { globalList: true }, forceCompanyId: 'global' },
  { collection: 'email_logs', entity: 'emailLog', opts: { globalList: true }, sanitizePartition: true },
  { collection: 'emails', entity: 'email', opts: { userIdField: 'userId' }, forceCompanyId: 'global', deriveUserIdFrom: 'toEmail' },
  { collection: 'missedPunchNotifications', entity: 'missedPunchNotification', opts: {}, sanitizePartition: true },
  { collection: 'payrollRuns', entity: 'payrollRun', opts: { tsField: 'createdAt' } },
  { collection: 'payrollAudit', entity: 'payrollAudit', opts: { tsField: 'timestamp' } },
  { collection: 'salarySlips', entity: 'salarySlip', opts: { userIdField: 'userId', tsField: 'createdAt' } },
  { collection: 'salaryStructures', entity: 'salaryStructure', opts: {} },
  { collection: 'users', special: 'users' },
  { collection: 'conversations', skip: true },
];

async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= attempts) throw new Error(`${label}: ${e.message}`);
      console.error(`  retry ${i}/${attempts - 1} — ${label}: ${e.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, i * 1500));
    }
  }
}

// email→sub derivation for the legacy outbox docs (they carry toEmail, no userId).
const emailToSub = new Map(uidMapList.map((m) => [m.email.toLowerCase(), m.sub]));

const report = { startedAt: new Date().toISOString(), table: process.env.TABLE_NAME, region: process.env.AWS_REGION, collections: {}, uidRefsReplaced: 0, normalizations: [], failures: [] };

for (const m of MAPPING) {
  if (m.skip) { report.collections[m.collection] = { skipped: true, reason: 'empty/unused' }; continue; }
  const src = join(OUT, 'collections', `${m.collection}.json`);
  const docs = JSON.parse(readFileSync(src, 'utf8'));

  if (m.special === 'users') {
    let written = 0;
    for (const d of docs) {
      const sub = UID_MAP.get(d.id);
      if (!sub) { report.failures.push(`user ${d.id}: no cognito mapping`); continue; }
      let data; let n;
      [data, n] = deepReplace(d.data, UID_MAP); report.uidRefsReplaced += n;
      data = { ...data, id: sub, uid: sub };
      if (CREATED.has(sub)) data.requirePasswordChange = true; // temp password → force change on first login
      await withRetry(`writeUserDoc ${sub}`, () => writeUserDoc(sub, data));
      written++;
    }
    report.collections[m.collection] = { entity: 'user (via writeUserDoc)', written, total: docs.length };
    console.log(`users: wrote ${written}/${docs.length} profiles (PROFILE + company copies + GSI2)`);
    continue;
  }

  let written = 0, normalized = 0;
  for (const d of docs) {
    let data; let n;
    [data, n] = deepReplace(d.data, UID_MAP); report.uidRefsReplaced += n;
    if (data.id === undefined) data.id = d.id;

    if (m.after) { data = m.after(data, d.id); normalized++; }
    if (m.forceCompanyId !== undefined && String(data.companyId) !== m.forceCompanyId) { data.companyId = m.forceCompanyId; normalized++; }
    if (m.sanitizePartition && badCompanyId(data.companyId)) { /* keep data value, fix partition only */ }
    if (m.deriveUserIdFrom === 'toEmail' && !data.userId) {
      const to = String(data.toEmail ?? '').toLowerCase();
      const sub = emailToSub.get(to);
      if (sub) { data.userId = sub; normalized++; }
    }

    const partition = m.forceCompanyId ?? (m.sanitizePartition && badCompanyId(data.companyId) ? 'global' : data.companyId ?? 'global');
    await withRetry(`${m.entity}/${d.id}`, () => putEntity(data, { entity: m.entity, ...m.opts, keyCompanyId: partition }));
    written++;
  }
  report.collections[m.collection] = { entity: m.entity, written, total: docs.length, normalized };
  console.log(`${m.collection} → ${m.entity}: ${written}/${docs.length} (normalized ${normalized})`);
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, 'import-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ uidRefsReplaced: report.uidRefsReplaced, failures: report.failures, totalWritten: Object.values(report.collections).reduce((a, c) => a + (c.written ?? 0), 0) }, null, 2));
if (report.failures.length) { process.exit(1); }
process.exit(0);
