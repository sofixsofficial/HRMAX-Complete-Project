/**
 * Route-table tests (node:test, offline, no AWS calls).
 *
 * Runs the exact compiled Lambda entry (dist/index.js) with API Gateway v2
 * shaped events. No request carries a valid token, so nothing reaches
 * DynamoDB — the assertions document ROUTE MOUNTING + the error contract:
 *
 *   - 200  public route works without auth
 *   - 401  route exists, auth gate rejects (NOT a 404 — the original bug class:
 *          these paths returned 404 before the routes were registered)
 *   - 404  genuinely wrong paths stay 404 (no blanket fallback)
 *   - 404  wrong method — the router has no 405 branch; unmatched method falls
 *          through to 404. Asserted as ACTUAL behaviour so a future 405
 *          branch is a conscious change.
 *   - 204  CORS preflight
 *
 * Usage: npm test --prefix backend/aws   (requires: npm run build)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';
// Offline pool id so verifyToken reaches the JWT parse (line 34 config guard)
// instead of short-circuiting to 500. Malformed tokens still fail at
// decodeProtectedHeader BEFORE any JWKS fetch → stays network-free.
process.env.COGNITO_USER_POOL_ID ??= 'ap-southeast-2_TESTPOOL';

const { handler } = await import('../dist/index.js');

const ev = (method, path, opts = {}) => ({
  requestContext: { http: { method, sourceIp: '127.0.0.1' } },
  rawPath: path,
  headers: { 'user-agent': 'node-test', ...(opts.headers ?? {}) },
  queryStringParameters: opts.query ?? null,
  body: opts.body ?? null,
  isBase64Encoded: false,
});

const call = async (method, path, opts) => {
  const res = await handler(ev(method, path, opts), {});
  let parsed = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { /* non-json */ }
  return { status: res.statusCode, body: parsed };
};

// ---------------------------------------------------------------------------
// Public route + preflight
// ---------------------------------------------------------------------------

test('GET /api/health is public and returns 200', async () => {
  const { status, body } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('OPTIONS preflight returns 204 without touching routes', async () => {
  const { status } = await call('OPTIONS', '/api/anything');
  assert.equal(status, 204);
});

// ---------------------------------------------------------------------------
// The routes that originally 404'd — they must now be MOUNTED (401 = mounted,
// auth gate rejects anonymous callers). 404 here would mean the route is gone.
// ---------------------------------------------------------------------------

const MOUNTED_GET = [
  '/api/emails',                    // email center list (added in audit)
  '/api/audit-logs',                // audit trail (added in audit; GSI3 global)
  '/api/payroll-audit',             // client-side payroll fallback audit
  '/api/contracts',                 // employee contracts (top-level)
  '/api/bank-accounts',             // employee bank accounts (top-level)
  '/api/notifications',             // bell list
  '/api/tickets',                   // support tickets (correct name)
  '/api/salary-slips',
  '/api/documents',
  '/api/employees',
  '/api/companies',
  '/api/users',
  '/api/attendance',
  '/api/leave-requests',
  '/api/tasks',
  '/api/departments',
  '/api/holidays',
  '/api/announcements',
  '/api/transfers',
  '/api/performance',
  '/api/payroll-runs',
  '/api/roles',
];

// Reset-flow routes are PUBLIC (they must work logged out) and validate input
// before anything else — an empty body yields 400 with the missing fields
// named, not 401.
const MOUNTED_PUBLIC_POST = {
  '/api/auth/verify-reset-code': 'email, code required',
  '/api/auth/forgot-password': 'email required',
  '/api/auth/reset-password': 'email, code, newPassword required',
};

for (const [path, missing] of Object.entries(MOUNTED_PUBLIC_POST)) {
  test(`POST ${path} is mounted (public + validates input: 400, not 404)`, async () => {
    const { status, body } = await call('POST', path, { body: '{}' });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body?.error?.code, 'bad-request');
    assert.equal(body?.error?.message, `${missing}`);
  });
}

const MOUNTED_POST = [
  '/api/notifications/read-all',    // batch mark-read
  '/api/notifications',
  '/api/attendance/mark',
  '/api/payroll/calculate',
  '/api/storage/presign',
  '/api/email/send',
  '/api/broadcast',
  '/fn/logAuditEvent',              // legacy callable dispatcher
];

for (const path of MOUNTED_GET) {
  test(`GET ${path} is mounted (401 unauthenticated, not 404)`, async () => {
    const { status, body } = await call('GET', path);
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body?.error?.code, 'unauthenticated');
  });
}

for (const path of MOUNTED_POST) {
  test(`POST ${path} is mounted (401 unauthenticated, not 404)`, async () => {
    const { status, body } = await call('POST', path, { body: '{}' });
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body?.error?.code, 'unauthenticated');
  });
}

// ---------------------------------------------------------------------------
// Wrong paths must stay 404 — no blanket fallback may mask typos
// ---------------------------------------------------------------------------

const MISSING = [
  ['GET', '/api/support-tickets'],          // wrong name (fixed to /api/tickets)
  ['GET', '/api/auth/reset-codes'],          // never existed; reset uses 3 auth routes
  ['POST', '/api/reset-codes'],
  ['GET', '/api/employees/probe123/documents'],    // old subcollection paths
  ['GET', '/api/employees/probe123/contracts'],
  ['GET', '/api/employees/probe123/bankAccounts'],
  ['GET', '/api/definitely-not-a-route'],
  ['GET', '/api/audit_logs'],                // underscore typo — map must send /api/audit-logs
];

for (const [method, path] of MISSING) {
  test(`${method} ${path} → 404 (no fallback route)`, async () => {
    const { status, body } = await call(method, path, method === 'POST' ? { body: '{}' } : undefined);
    assert.equal(status, 404, `expected 404, got ${status}`);
    assert.equal(body?.error?.code, 'not-found');
  });
}

test('GET /api/auth/verify-reset-code (wrong method) → 404: no 405 branch exists', async () => {
  const { status } = await call('GET', '/api/auth/verify-reset-code');
  assert.equal(status, 404);
});

// ---------------------------------------------------------------------------
// Token handling: garbage tokens must fail safely (401, never 500 / no leak)
// ---------------------------------------------------------------------------

test('malformed Bearer token → 401, no internal detail leaked', async () => {
  const { status, body } = await call('GET', '/api/employees', {
    // no dots → jose fails Compact-JWS parsing before any JWKS lookup
    headers: { authorization: 'Bearer not-a-jwt-at-all' },
  });
  assert.equal(status, 401);
  assert.ok(!JSON.stringify(body).includes('jose'), 'library internals must not leak');
  assert.ok(!JSON.stringify(body).includes('jwks'), 'issuer/jwks detail must not leak');
});

// ---------------------------------------------------------------------------
// Frontend ↔ backend contract: collection→route maps (static source checks)
// ---------------------------------------------------------------------------

test('frontend endpointFor maps underscore/legacy collection names explicitly', async () => {
  const src = await readFile(new URL('../../../frontend/src/aws/firestore.ts', import.meta.url), 'utf8');
  // audit_logs would fall through to /api/audit_logs (404) without the entry.
  assert.ok(/audit_logs:\s*'\/api\/audit-logs'/.test(src), 'audit_logs → /api/audit-logs missing');
  assert.ok(/tickets:\s*'\/api\/tickets'/.test(src), 'tickets → /api/tickets missing');
  assert.ok(/notifications:\s*'\/api\/notifications'/.test(src), 'notifications map missing');
  assert.ok(/documents:\s*'\/api\/documents'/.test(src), 'documents map missing');
});

test('frontend ROUTE_MAP points callables at routes that exist in the router', async () => {
  const src = await readFile(new URL('../../../frontend/src/aws/functions.ts', import.meta.url), 'utf8');
  const expected = {
    sendResetCode: '/api/auth/forgot-password',
    verifyResetCode: '/api/auth/verify-reset-code',
    resetPasswordWithCode: '/api/auth/reset-password',
    markAllNotificationsRead: '/api/notifications/read-all',
  };
  for (const [name, path] of Object.entries(expected)) {
    assert.ok(
      new RegExp(`${name}:\\s*\\{\\s*path:\\s*'${path.replace(/\//g, '\\/')}'`).test(src),
      `ROUTE_MAP ${name} → ${path} missing`,
    );
    // and the backend actually serves it: 401 = auth-gated, 400 = public with
    // input validation — either proves the route exists (404 would not).
    const { status } = await call('POST', path, { body: '{}' });
    assert.ok([400, 401].includes(status), `${path} not mounted (got ${status})`);
  }
});
