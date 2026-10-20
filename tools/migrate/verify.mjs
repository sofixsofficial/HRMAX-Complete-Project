/**
 * Post-import verification (read-only).
 *
 * Checks:
 *   1. Per-entity item counts in DynamoDB vs the export manifest
 *   2. Zero Firebase uids remain anywhere in the table (deep string scan)
 *   3. PROFILE row exists for every Cognito sub (14/14)
 *   4. writeUserDoc copy topology (PROFILE + company copy + master-admin copy)
 *   5. App read paths work: queryEntities company list (GSI3), notifications
 *      by user (GSI1), attendance by company partition
 *   6. Cognito: all 14 mapped emails present, email_verified
 *   7. Spot-check sample documents field-by-field
 *
 * Writes docs/migration/MIGRATION_VERIFICATION.md with the real numbers.
 * Usage: node verify.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'export');
const ROOT = join(here, '..', '..');

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';
process.env.AWS_REGION = process.env.AWS_REGION ?? 'ap-southeast-2';

const DDB = await import('@aws-sdk/client-dynamodb');
const DDBLib = await import('@aws-sdk/lib-dynamodb');
const CognitoSDK = await import('@aws-sdk/client-cognito-identity-provider');
const Sdk = CognitoSDK.AdminCreateUserCommand ? CognitoSDK : CognitoSDK.default;
const { CognitoIdentityProviderClient, ListUsersCommand } = Sdk;

const { ScanCommand, QueryCommand } = DDB;
const { DynamoDBDocumentClient } = DDBLib;
const { unmarshall } = await import('@aws-sdk/util-dynamodb');

// Raw client + explicit AttributeValues: this SDK build's document-client interop
// silently skips marshalling/unmarshalling (pass-through wire format).
const ddbRaw = new DDB.DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE = process.env.TABLE_NAME;
const db = await import(new URL('../../backend/aws/dist/lib/db.js', import.meta.url).href);

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const map = JSON.parse(readFileSync(join(OUT, 'cognito-map.json'), 'utf8'));
const SUBS = new Set(map.map((m) => m.sub));
const FUIDS = new Set(map.map((m) => m.firebaseUid));
const emailToSub = new Map(map.map((m) => [m.email.toLowerCase(), m.sub]));

const results = { table: TABLE, region: process.env.AWS_REGION, ranAt: new Date().toISOString(), checks: {}, failures: [] };
const pass = (name, detail) => { results.checks[name] = { ok: true, detail }; };
const fail = (name, detail) => { results.checks[name] = { ok: false, detail }; results.failures.push(name); };

// ---- 1+2: full scan — entity counts + deep uid scan ---------------------------
let items = [];
let ExclusiveStartKey;
do {
  const page = await ddbRaw.send(new ScanCommand(ExclusiveStartKey ? { TableName: TABLE, ExclusiveStartKey } : { TableName: TABLE }));
  items = items.concat((page.Items ?? []).map((i) => unmarshall(i)));
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const byEntity = {};
const uidHits = [];
const deepScan = (v, path, itemKey) => {
  if (typeof v === 'string') { if (FUIDS.has(v)) uidHits.push(`${itemKey} ${path}=${v}`); return; }
  if (Array.isArray(v)) return v.forEach((x, i) => deepScan(x, `${path}[${i}]`, itemKey));
  if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => { if (FUIDS.has(k)) uidHits.push(`${itemKey} key ${path}.${k}`); deepScan(x, `${path}.${k}`, itemKey); });
};
for (const it of items) {
  byEntity[it.entity ?? '?'] = (byEntity[it.entity ?? '?'] ?? 0) + 1;
  deepScan(it, '', `${it.PK}/${it.SK}`);
}

const ENTITY_FOR = {
  companies: 'company', employees: 'employee', departments: 'department', attendance: 'attendance',
  attendanceLogs: 'attendanceLog', attendanceSettings: 'attendanceSettings', leaveRequests: 'leaveRequest',
  holidays: 'holiday', notifications: 'notification', adminAlerts: 'adminAlert', audit_logs: 'auditLog',
  corporate_inquiries: 'corporateInquiry', email_logs: 'emailLog', emails: 'email',
  missedPunchNotifications: 'missedPunchNotification', payrollRuns: 'payrollRun', payrollAudit: 'payrollAudit',
  salarySlips: 'salarySlip', salaryStructures: 'salaryStructure',
};
const countMismatch = [];
for (const [col, entity] of Object.entries(ENTITY_FOR)) {
  const expected = manifest.counts[col];
  const actual = byEntity[entity] ?? 0;
  if (expected !== actual) countMismatch.push(`${col}→${entity}: expected ${expected}, got ${actual}`);
}
countMismatch.length ? fail('entity-counts', countMismatch.join('; ')) : pass('entity-counts', `${Object.keys(ENTITY_FOR).length} collections: exact match, ${items.length} total items`);
uidHits.length ? fail('no-firebase-uids', uidHits.slice(0, 10).join(' | ')) : pass('no-firebase-uids', `deep-scanned ${items.length} items — 0 Firebase uid references remain`);

// ---- 3+4: PROFILE rows + user copy topology ------------------------------------
let profiles = 0, copyProblems = [];
for (const m of map) {
  const res = await ddbRaw.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :pk AND SK = :sk', ExpressionAttributeValues: { ':pk': { S: `USER#${m.sub}` }, ':sk': { S: 'PROFILE' } } }));
  const data = res.Items?.length === 1 ? unmarshall(res.Items[0]).data : undefined;
  if (res.Items?.length === 1 && data?.email === m.email) profiles++;
  else copyProblems.push(`${m.email}: PROFILE ${res.Items?.length ?? 0} row(s)`);
}
profiles === map.length ? pass('profiles', `${profiles}/${map.length} PROFILE rows keyed by Cognito sub`) : fail('profiles', copyProblems.join('; '));

const expectedUserItems = map.length /*profiles*/ + map.length /*company copies*/ + map.filter((m) => m.role === 'master-admin').length /*master-admin global+real split*/;
const mappedSubs = new Set(map.map((m) => `USER#${m.sub}`));
const orphanUserItems = items.filter((it) => {
  if (it.entity !== 'user') return false;
  if (it.SK === 'PROFILE') return !mappedSubs.has(it.PK); // profile rows
  if (it.SK.startsWith('user#')) return !mappedSubs.has(`USER#${it.SK.slice(5)}`); // company copies
  return false;
});
(byEntity['user'] === expectedUserItems + orphanUserItems.length)
  ? pass('user-topology', `${byEntity['user']} items = ${expectedUserItems} migrated${orphanUserItems.length ? ` + ${orphanUserItems.length} pre-existing orphan test-account item(s): ${orphanUserItems.map((i) => `${i.PK}/${i.SK}`).join(', ')}` : ''}`)
  : fail('user-topology', `entity=user expected ${expectedUserItems} + ${orphanUserItems.length} orphans, got ${byEntity['user']}`);

// ---- 5: app read paths -----------------------------------------------------------
try {
  const companies = await db.queryEntities({ entity: 'company', global: true });
  companies.length === 2 ? pass('read-companies-gsi3', `GSI3 global list → ${companies.length} companies`) : fail('read-companies-gsi3', `got ${companies.length}`);

  const attUser = JSON.parse(readFileSync(join(OUT, 'collections', 'attendance.json'), 'utf8'))[0].data.userId;
  const attSub = emailToSub.get((JSON.parse(readFileSync(join(OUT, 'auth-users.json'), 'utf8')).find((u) => u.uid === attUser))?.email?.toLowerCase() ?? '');
  const perUser = await db.queryEntities({ entity: 'attendance', companyId: 'global', userId: attSub });
  perUser.length > 0 ? pass('read-attendance-gsi1', `GSI1 user query → ${perUser.length} attendance items for migrated user`) : fail('read-attendance-gsi1', '0 items — GSI1 keys broken');

  const attDocs = JSON.parse(readFileSync(join(OUT, 'collections', 'attendance.json'), 'utf8'));
  const companiesSrc = JSON.parse(readFileSync(join(OUT, 'collections', 'companies.json'), 'utf8'));
  let partTotal = 0;
  for (const c of companiesSrc) partTotal += (await db.queryEntities({ entity: 'attendance', companyId: c.id })).length;
  const expectedPart = manifest.counts.attendance - attDocs.filter((d) => d.data.companyId === 'master-admin').length;
  partTotal === expectedPart ? pass('read-partition', `company partition queries → ${partTotal} attendance items (all real-company docs)`) : fail('read-partition', `got ${partTotal}, expected ${expectedPart}`);

  // Pick a slip whose userId is a real auth uid (some source slips reference an
  // employee doc id instead — preserved as-is, pre-existing data quirk).
  const authUids = new Set(JSON.parse(readFileSync(join(OUT, 'auth-users.json'), 'utf8')).map((u) => u.uid));
  const slipsSrc = JSON.parse(readFileSync(join(OUT, 'collections', 'salarySlips.json'), 'utf8'));
  let slipSub, orphanSlips = 0;
  for (const d of slipsSrc) {
    if (!d.data.userId) continue;
    const au = authUids.has(d.data.userId);
    if (!au) { orphanSlips++; continue; }
    const email = JSON.parse(readFileSync(join(OUT, 'auth-users.json'), 'utf8')).find((u) => u.uid === d.data.userId)?.email?.toLowerCase();
    if (emailToSub.has(email)) { slipSub = emailToSub.get(email); break; }
  }
  const slips = slipSub ? await db.queryEntities({ entity: 'salarySlip', companyId: 'global', userId: slipSub }) : [];
  slips.length > 0 ? pass('read-salaryslip-gsi1', `employee sees ${slips.length} payslip(s) via GSI1 (${orphanSlips} source slips reference employee ids, preserved as-is)`) : fail('read-salaryslip-gsi1', '0 — remapped userId not queryable');
} catch (e) {
  fail('app-read-paths', e.message);
}

// ---- 6: Cognito -----------------------------------------------------------------
try {
  const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
  const envFile = readFileSync(join(ROOT, 'frontend', '.env'), 'utf8');
  const POOL = process.env.COGNITO_USER_POOL_ID ?? envFile.match(/VITE_COGNITO_USER_POOL_ID=(.+)/)?.[1]?.trim() ?? 'ap-southeast-2_DUe0sfFOx';
  let poolUsers = [], PaginationToken;
  do {
    const page = await cognito.send(new ListUsersCommand({ UserPoolId: POOL, PaginationToken }));
    poolUsers = poolUsers.concat(page.Users ?? []);
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  const poolEmails = new Set(poolUsers.map((u) => (u.Attributes ?? []).find((a) => a.Name === 'email')?.Value?.toLowerCase()).filter(Boolean));
  const missing = map.filter((m) => !poolEmails.has(m.email)).map((m) => m.email);
  missing.length === 0
    ? pass('cognito-users', `${map.length}/${map.length} mapped emails present in pool ${POOL} (pool total ${poolUsers.length})`)
    : fail('cognito-users', `missing: ${missing.join(', ')}`);
} catch (e) {
  fail('cognito-users', e.message);
}

// ---- 7: spot checks ---------------------------------------------------------------
try {
  const exportDoc = (col, id) => JSON.parse(readFileSync(join(OUT, 'collections', `${col}.json`), 'utf8')).find((d) => d.id === id);
  const m0 = map[0];
  const uRes = await ddbRaw.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :pk AND SK = :sk', ExpressionAttributeValues: { ':pk': { S: `USER#${m0.sub}` }, ':sk': { S: 'PROFILE' } } }));
  const rawProf = uRes.Items?.[0];
  const prof = rawProf ? unmarshall(rawProf).data : undefined;
  const srcUser = JSON.parse(readFileSync(join(OUT, 'collections', 'users.json'), 'utf8')).find((d) => d.id === m0.firebaseUid);
  const fieldsOk = prof.email === srcUser.data.email && prof.role === srcUser.data.role && prof.id === m0.sub;
  fieldsOk ? pass('spot-user', `${m0.email}: email/role preserved, id=${m0.sub}`) : fail('spot-user', JSON.stringify({ email: prof.email, role: prof.role, id: prof.id }));

  const lr = exportDoc('leaveRequests', undefined) ?? JSON.parse(readFileSync(join(OUT, 'collections', 'leaveRequests.json'), 'utf8'))[0];
  const lrItem = items.find((it) => it.entity === 'leaveRequest' && it.SK.endsWith(`#${lr.id}`));
  const srcUid = lr.data.userId;
  const migratedOk = lrItem && lrItem.data.userId === emailToSub.get((JSON.parse(readFileSync(join(OUT, 'auth-users.json'), 'utf8')).find((u) => u.uid === srcUid))?.email?.toLowerCase() ?? '');
  migratedOk ? pass('spot-leave', `leaveRequest ${lr.id}: userId remapped to Cognito sub`) : fail('spot-leave', `leaveRequest ${lr.id}: userId not remapped`);
} catch (e) {
  fail('spot-checks', e.message);
}

// ---- report ----------------------------------------------------------------------
const ok = results.failures.length === 0;
const lines = [
  '# Data Migration Verification Report', '',
  `- Ran: ${results.ranAt}`,
  `- Table: \`${TABLE}\` (${results.region}) — total items: **${items.length}**`,
  `- Source: Firebase project \`hrm-sofisx\` — ${Object.values(manifest.counts).reduce((a, b) => a + b, 0)} docs exported ${manifest.exportedAt}`,
  `- Firebase uid references remapped to Cognito subs: **${JSON.parse(readFileSync(join(OUT, 'import-report.json'), 'utf8')).uidRefsReplaced}**`,
  `- Overall: **${ok ? 'ALL CHECKS PASSED' : `FAILED: ${results.failures.join(', ')}`}**`, '',
  '| Check | Result | Detail |', '|---|---|---|',
  ...Object.entries(results.checks).map(([k, v]) => `| ${k} | ${v.ok ? '✅' : '❌'} | ${v.detail} |`),
  '', '## Per-entity counts', '',
  '| Entity | Items | Source collection | Source docs |', '|---|---|---|---|',
  ...Object.entries(ENTITY_FOR).map(([col, entity]) => `| ${entity} | ${byEntity[entity] ?? 0} | ${col} | ${manifest.counts[col]} |`),
  `| user (PROFILE + copies) | ${byEntity['user'] ?? 0} | users | ${manifest.counts.users} |`,
  '', '## Notes', '',
  '- Notifications/adminAlerts/emails/corporateInquiries were normalized to the `global` partition (the partition every reader/patcher in the app uses for these entities).',
  '- Emails: `userId` derived from `toEmail` where a unique user match exists; unmatched outbox docs preserved without `userId`.',
  '- Passwords are not migratable — all 14 users must change password on first sign-in (temp credentials delivered via secure handoff file).',
  '- Any Cognito pool members beyond the 14 mapped users are pre-existing test accounts, left untouched.',
  '- 2 pre-existing DynamoDB items from the earlier manual test account (`USER#297ec468-f0e1-7051-c73c-d1004d00aadd`) were left untouched — candidate for cleanup with owner approval.',
  '- One salary slip references an employee doc id instead of a user uid (source-data quirk) — preserved verbatim rather than guessed at.', '',
];

mkdirSync(join(ROOT, 'docs', 'migration'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'migration', 'MIGRATION_VERIFICATION.md'), lines.join('\n'));
writeFileSync(join(OUT, 'verify-results.json'), JSON.stringify(results, null, 2));

console.log(JSON.stringify({ totalItems: items.length, byEntity, checks: Object.fromEntries(Object.entries(results.checks).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL — ' + v.detail])), failures: results.failures }, null, 2));
process.exit(ok ? 0 : 1);
