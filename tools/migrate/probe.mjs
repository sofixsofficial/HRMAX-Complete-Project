/**
 * READ-ONLY probe of the Firebase source (project hrm-sofisx).
 *
 * Reports per-collection document counts, employee subcollection counts,
 * Firebase Auth user count, and Storage object count/size — so the migration
 * mapping only needs to cover data that actually exists.
 *
 * Usage: node probe.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

const here = dirname(fileURLToPath(import.meta.url));
const SA = process.env.FIREBASE_SERVICE_ACCOUNT ?? join(here, '..', '..', 'backend', 'scripts', 'service-account.json');

const cred = JSON.parse(readFileSync(SA, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(cred), storageBucket: cred.project_id + '.appspot.com' });

const db = admin.auth();
const fs = admin.firestore();

const out = { collections: {}, subcollections: {}, authUsers: null, storage: null };

// Root collections + counts (aggregate count query — no data read).
const roots = await fs.listCollections();
for (const col of roots) {
  const snap = await col.count().get();
  out.collections[col.id] = snap.data().count;
}

// Employee subcollections (only if employees exist at all).
if ((out.collections['employees'] ?? 0) > 0) {
  for (const sub of ['bankAccounts', 'documents', 'contracts']) {
    const snap = await fs.collectionGroup(sub).count().get();
    out.subcollections[sub] = snap.data().count;
  }
}

// Auth users (paged).
let authCount = 0;
let pageToken;
do {
  const page = await db.listUsers(1000, pageToken);
  authCount += page.users.length;
  pageToken = page.pageToken;
} while (pageToken);
out.authUsers = authCount;

// Storage objects (bucket name candidates: legacy *.appspot.com vs current
// *.firebasestorage.app naming; some projects have Storage disabled entirely).
out.storage = { objects: 0, bytes: 0, bucket: null, error: null };
const candidates = [process.env.FIREBASE_BUCKET, `${cred.project_id}.firebasestorage.app`, `${cred.project_id}.appspot.com`].filter(Boolean);
for (const name of candidates) {
  try {
    const [files] = await admin.storage().bucket(name).getFiles({ autoPaginate: true });
    out.storage = { objects: files.length, bytes: files.reduce((s, f) => s + Number(f.metadata.size ?? 0), 0), bucket: name, error: null };
    break;
  } catch (e) {
    out.storage.error = `${name}: ${e.message}`;
  }
}

console.log(JSON.stringify(out, null, 2));

const emptyRoots = Object.entries(out.collections).filter(([, n]) => n === 0).map(([k]) => k);
console.log('\nEmpty collections:', emptyRoots.length ? emptyRoots.join(', ') : '(none)');
console.log('Total docs:', Object.values(out.collections).reduce((a, b) => a + b, 0));
process.exit(0);
