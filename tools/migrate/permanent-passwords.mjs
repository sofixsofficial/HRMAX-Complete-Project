#!/usr/bin/env node
/**
 * One-off migration bootstrap: make the rotated temp passwords PERMANENT.
 *
 * import-cognito.mjs set every user's password with `Permanent: false`, which
 * puts Cognito users in FORCE_CHANGE_PASSWORD — the browser then fails sign-in
 * with NEW_PASSWORD_REQUIRED before a session exists. The original Firebase app
 * has no forced-change flow (Login deliberately sends everyone straight to the
 * dashboard), so Firebase parity = login works directly with the password the
 * user was given. This flips the flag without changing the password value.
 *
 * Users keep the strong generated password from export/credentials.txt and can
 * change it themselves in Settings → Change Password (collects current +
 * new password).
 *
 * Reads export/credentials.txt (email \t password \t role \t companyId).
 * Prints per-user status only — NEVER passwords.
 * Idempotent: safe to re-run (setting Permanent on a permanent user is a no-op).
 *
 * Usage: node permanent-passwords.mjs
 * Requires: AWS credentials with cognito-idp:AdminSetUserPassword on the pool.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CREDS = join(here, 'export', 'credentials.txt');
const USER_POOL_ID = process.env.AWS_USER_POOL_ID ?? 'ap-southeast-2_DUe0sfFOx';
const REGION = process.env.AWS_REGION ?? 'ap-southeast-2';

if (!existsSync(CREDS)) {
  console.error(`Missing ${CREDS} — run the export first.`);
  process.exit(1);
}

const CognitoSDK = await import('@aws-sdk/client-cognito-identity-provider');
const client = new CognitoSDK.CognitoIdentityProviderClient({ region: REGION });

const rows = readFileSync(CREDS, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.replace(/\s+$/, ''))
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split('\t'));

let ok = 0;
let fail = 0;
for (const [email, password] of rows) {
  if (!email || !password) continue;
  try {
    await client.send(
      new CognitoSDK.AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );
    const u = await client.send(
      new CognitoSDK.AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }),
    );
    console.log(`${email}\t${u.UserStatus}`);
    ok++;
  } catch (err) {
    console.error(`${email}\tFAILED\t${err.name}: ${err.message}`);
    fail++;
  }
}
console.log(`\nDone: ${ok} permanent, ${fail} failed.`);
process.exit(fail ? 1 : 0);
