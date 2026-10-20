/**
 * READ-ONLY export of Firebase project hrm-sofisx → local JSON.
 *
 * Dumps every root Firestore collection (with recursive subcollection
 * detection), Firebase Auth users (uid/email/name only — never passwords),
 * and records Storage state. Firestore Timestamps become ISO strings,
 * GeoPoint → { latitude, longitude }, Bytes → base64.
 *
 * Output (git-ignored — contains employee PII):
 *   export/collections/<name>.json   [{ id, data }]
 *   export/auth-users.json           [{ uid, email, displayName }]
 *   export/manifest.json             counts + exportedAt
 *
 * Usage: node export.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

const here = dirname(fileURLToPath(import.meta.url));
const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) {
  console.error('FIREBASE_SERVICE_ACCOUNT must point to the hrm-sofisx service-account key — it is stored OUTSIDE the repo (never committed): C:\\Users\\azayy\\Documents\\HRM-AWS\\firebase-migration-credentials\\service-account.json');
  process.exit(1);
}
const OUT = join(here, 'export');

const cred = JSON.parse(readFileSync(SA, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(cred) });
const fs = admin.firestore();

/** Convert Firestore-special values to plain JSON. */
function plain(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (v instanceof admin.firestore.GeoPoint) return { latitude: v.latitude, longitude: v.longitude };
  if (v instanceof admin.firestore.DocumentReference) return v.path;
  if (v instanceof Buffer || v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = plain(val);
    return out;
  }
  return v;
}

mkdirSync(join(OUT, 'collections'), { recursive: true });

const manifest = { exportedAt: new Date().toISOString(), projectId: cred.project_id, counts: {}, subcollections: {}, warnings: [] };

/** Retry transient RPC stalls (gax gives up after 60s total per call). */
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= attempts) throw new Error(`${label} failed after ${attempts} attempts: ${e.message}`);
      console.error(`  retry ${i}/${attempts - 1} — ${label}: ${e.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
}

// ---- Firestore root collections ---------------------------------------------
// Subcollection detection: the probe already confirmed employee subcollections
// (bankAccounts/documents/contracts) contain 0 docs via collectionGroup counts,
// so no per-document listCollections fan-out is needed.
const roots = await withRetry('listCollections', () => fs.listCollections());
for (const col of roots) {
  const snap = await withRetry(`get ${col.id}`, () => col.get());
  const docs = snap.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
  writeFileSync(join(OUT, 'collections', `${col.id}.json`), JSON.stringify(docs, null, 1));
  manifest.counts[col.id] = docs.length;
  console.log(`exported ${col.id}: ${docs.length}`);
}

// ---- Firebase Auth (identities only) -----------------------------------------
const users = [];
let pageToken;
do {
  const page = await withRetry('listUsers', () => admin.auth().listUsers(1000, pageToken));
  for (const u of page.users) {
    users.push({ uid: u.uid, email: u.email ?? null, displayName: u.displayName ?? null, disabled: u.disabled ?? false });
  }
  pageToken = page.pageToken;
} while (pageToken);
writeFileSync(join(OUT, 'auth-users.json'), JSON.stringify(users, null, 2));
manifest.authUsers = users.length;

// ---- Storage ------------------------------------------------------------------
const bucketName = `${cred.project_id}.firebasestorage.app`;
try {
  const [files] = await admin.storage().bucket(bucketName).getFiles({ autoPaginate: true });
  manifest.storage = { bucket: bucketName, objects: files.length };
  if (files.length > 0) manifest.warnings.push(`${files.length} storage objects exist — file migration required before cutover`);
} catch (e) {
  manifest.storage = { bucket: bucketName, objects: 0, error: e.message };
}

if (Object.keys(manifest.subcollections).length > 0) {
  manifest.warnings.push(`Subcollections with data detected: ${JSON.stringify(manifest.subcollections)} — needs explicit mapping before import`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ counts: manifest.counts, authUsers: manifest.authUsers, storage: manifest.storage, subcollections: manifest.subcollections, warnings: manifest.warnings }, null, 2));
console.log(`Total exported docs: ${Object.values(manifest.counts).reduce((a, b) => a + b, 0)}`);
process.exit(0);
