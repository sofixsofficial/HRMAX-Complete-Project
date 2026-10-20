/**
 * Firebase Auth → Cognito user-pool import (project hrm-sofisx → hrmax-users).
 *
 * - Never migrates passwords (impossible); creates users with a random
 *   temporary password that forces a change on first sign-in (the app's own
 *   requirePasswordChange / ForcePasswordChange flow).
 * - Users whose email already exists in the pool are REUSED (sub kept).
 * - Output: export/cognito-map.json  { firebaseUid → cognitoSub } — consumed
 *   by import-dynamodb.mjs to remap every uid reference in the data.
 * - Output: export/credentials.txt   (git-ignored) temporary credentials for
 *   out-of-band handoff. NEVER printed to the console.
 *
 * Usage: node import-cognito.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';

// Static named imports fail CJS interop detection on this SDK build — dynamic import works.
const CognitoSDK = await import('@aws-sdk/client-cognito-identity-provider');
const { CognitoIdentityProviderClient, ListUsersCommand, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand } =
  CognitoSDK.AdminCreateUserCommand ? CognitoSDK : CognitoSDK.default;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'export');
const REGION = process.env.AWS_REGION ?? 'ap-southeast-2';
const DRY = process.argv.includes('--dry-run');

/** Pool id: env override → frontend/.env → known default. */
function poolId() {
  if (process.env.COGNITO_USER_POOL_ID) return process.env.COGNITO_USER_POOL_ID;
  const envFile = join(here, '..', '..', 'frontend', '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/VITE_COGNITO_USER_POOL_ID=(.+)/);
    if (m) return m[1].trim();
  }
  return 'ap-southeast-2_DUe0sfFOx';
}

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const POOL = poolId();

const authUsers = JSON.parse(readFileSync(join(OUT, 'auth-users.json'), 'utf8'));
const userDocs = JSON.parse(readFileSync(join(OUT, 'collections', 'users.json'), 'utf8'));
const docByUid = new Map(userDocs.map((d) => [d.id, d.data]));

/** Temp password satisfying default Cognito policy (upper+lower+digit+symbol, ≥16 chars). */
const tempPassword = () => `Hrmax!${randomBytes(6).toString('base64url')}${randomInt(1000, 9999)}`;

// Existing pool users (by email).
const existing = new Map();
let PaginationToken;
do {
  const page = await cognito.send(new ListUsersCommand({ UserPoolId: POOL, PaginationToken }));
  for (const u of page.Users ?? []) {
    const email = (u.Attributes ?? []).find((a) => a.Name === 'email')?.Value?.toLowerCase();
    if (email) existing.set(email, { username: u.Username, sub: (u.Attributes ?? []).find((a) => a.Name === 'sub')?.Value });
  }
  PaginationToken = page.PaginationToken;
} while (PaginationToken);
console.log(`Pool ${POOL}: ${existing.size} user(s) already exist`);

const map = [];
const credentials = [];
let created = 0, reused = 0, failed = 0;

for (const u of authUsers) {
  const email = (u.email ?? '').toLowerCase();
  if (!email) { console.error(`SKIP uid=${u.uid}: no email`); failed++; continue; }
  const role = String(docByUid.get(u.uid)?.role ?? 'employee');
  const companyId = String(docByUid.get(u.uid)?.companyId ?? 'global');

  const hit = existing.get(email);
  if (hit?.sub) {
    map.push({ firebaseUid: u.uid, sub: hit.sub, email, role, companyId, created: false });
    reused++;
    continue;
  }
  if (DRY) { map.push({ firebaseUid: u.uid, sub: `dry-${u.uid}`, email, role, companyId, created: true }); created++; continue; }

  const base = {
    UserPoolId: POOL,
    Username: email,
    MessageAction: 'SUPPRESS',
    TemporaryPassword: tempPassword(),
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      ...(u.displayName ? [{ Name: 'name', Value: u.displayName }] : []),
    ],
  };
  const withCustom = {
    ...base,
    UserAttributes: [...base.UserAttributes, { Name: 'custom:role', Value: role }, { Name: 'custom:companyId', Value: companyId }],
  };

  try {
    let res;
    try {
      res = await cognito.send(new AdminCreateUserCommand(withCustom));
    } catch (e) {
      if (e.name === 'InvalidParameterException' && /custom/i.test(e.message)) {
        console.warn(`  pool lacks custom attributes — creating ${email} without them (PreToken trigger supplies claims from the users table anyway)`);
        res = await cognito.send(new AdminCreateUserCommand(base));
      } else throw e;
    }
    let sub = (res.User?.Attributes ?? []).find((a) => a.Name === 'sub')?.Value;
    if (!sub) sub = (await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: email }))).UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) throw new Error('could not determine sub');
    existing.set(email, { username: email, sub });
    map.push({ firebaseUid: u.uid, sub, email, role, companyId, created: true });
    credentials.push(`${email}\t${base.TemporaryPassword}\t${role}\t${companyId}`);
    created++;
  } catch (e) {
    console.error(`FAIL ${email}: ${e.message}`);
    failed++;
  }
}

writeFileSync(join(OUT, 'cognito-map.json'), JSON.stringify(map, null, 2));

// --rotate-all: reset every mapped user to a fresh temp password (Permanent:false
// → Cognito forces a change on next sign-in) so credentials.txt is complete even
// when users were created by an earlier run.
if (process.argv.includes('--rotate-all') && !DRY) {
  credentials.length = 0;
  for (const m of map) {
    const pw = tempPassword();
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL, Username: m.email, Password: pw, Permanent: false }));
    credentials.push(`${m.email}\t${pw}\t${m.role}\t${m.companyId}`);
  }
  console.log(`Rotated passwords for ${credentials.length} user(s).`);
}

writeFileSync(join(OUT, 'credentials.txt'), `# Temporary credentials for migrated users — SECURE HANDOFF, DELETE AFTER USE\n# email\ttempPassword\trole\tcompanyId\n${credentials.join('\n')}\n`);

console.log(JSON.stringify({ pool: POOL, total: authUsers.length, created, reused, failed, mapEntries: map.length }, null, 2));
if (credentials.length) console.log(`Temporary credentials written to export/credentials.txt (${credentials.length} entries — not printed here).`);
if (failed > 0) { console.error('FAILURES present — abort DynamoDB import until resolved.'); process.exit(1); }
process.exit(0);
