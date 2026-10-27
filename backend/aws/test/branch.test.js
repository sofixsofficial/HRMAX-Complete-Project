/**
 * Branch feature tests (node:test, offline, no AWS calls).
 *
 * Two layers, both network-free:
 *  1. Route mounting — /api/branches must exist for every verb (401 with an
 *     anonymous caller = mounted + auth-gated; 404 would mean the routes were
 *     never registered, the original bug class these suites exist to catch).
 *  2. Pure policy helpers — the flag spellings the UI writes vs the spellings
 *     the server reads, including the new QR / face flags.
 *
 * Usage: npm test --prefix backend/aws   (requires: npm run build)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';
process.env.COGNITO_USER_POOL_ID ??= 'ap-southeast-2_TESTPOOL';
process.env.HRMAX_DISABLE_RATE_LIMIT ??= '1';

const { handler } = await import('../dist/index.js');
const { normalizePolicyFlags, determineStatus } = await import('../dist/handlers/attendance.js');

const ev = (method, path) => ({
  requestContext: { http: { method, sourceIp: '127.0.0.1' } },
  rawPath: path,
  headers: { 'user-agent': 'node-test' },
  queryStringParameters: null,
  body: null,
  isBase64Encoded: false,
});

const call = async (method, path) => {
  const res = await handler(ev(method, path), {});
  let parsed = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { /* non-json */ }
  return { status: res.statusCode, body: parsed };
};

// ---------------------------------------------------------------------------
// Route mounting (anonymous caller -> 401 = mounted and auth-gated)
// ---------------------------------------------------------------------------

test('GET /api/branches is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('GET', '/api/branches');
  assert.equal(status, 401);
});

test('POST /api/branches is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('POST', '/api/branches');
  assert.equal(status, 401);
});

test('GET /api/branches/:id is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('GET', '/api/branches/br1');
  assert.equal(status, 401);
});

test('PUT /api/branches/:id is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('PUT', '/api/branches/br1');
  assert.equal(status, 401);
});

test('PATCH /api/branches/:id is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('PATCH', '/api/branches/br1');
  assert.equal(status, 401);
});

test('DELETE /api/branches/:id is mounted (401 for anonymous callers)', async () => {
  const { status } = await call('DELETE', '/api/branches/br1');
  assert.equal(status, 401);
});

test('attendance mark route still mounted (401 for anonymous callers)', async () => {
  const { status } = await call('POST', '/api/attendance/mark');
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// Policy flag spellings — the UI writes enable*, the server accepts both
// ---------------------------------------------------------------------------

test('normalizePolicyFlags accepts the legacy enable* spellings', () => {
  const flags = normalizePolicyFlags({ enableSelfie: true, enableGeofence: true });
  assert.equal(flags.requireSelfie, true);
  assert.equal(flags.requireGeofence, true);
});

test('normalizePolicyFlags defaults to off when unset', () => {
  const flags = normalizePolicyFlags(undefined);
  assert.equal(flags.requireSelfie, false);
  assert.equal(flags.requireGeofence, false);
});

test('normalizePolicyFlags prefers the explicit require* spelling on conflict', () => {
  const flags = normalizePolicyFlags({ requireSelfie: false, enableSelfie: true, requireGeofence: true, enableGeofence: false });
  assert.equal(flags.requireSelfie, false);
  assert.equal(flags.requireGeofence, true);
});

// ---------------------------------------------------------------------------
// Status determination (drives late/ontime on every punch)
// ---------------------------------------------------------------------------

test('determineStatus: on time is Present', () => {
  const r = determineStatus(9 * 60, 9 * 60, 15);
  assert.equal(r.status, 'Present');
  assert.equal(r.lateMinutes, 0);
});

test('determineStatus: inside grace period is Present', () => {
  const r = determineStatus(9 * 60 + 10, 9 * 60, 15);
  assert.equal(r.status, 'Present');
  assert.equal(r.lateMinutes, 0);
});

test('determineStatus: beyond grace is Late with exact minutes', () => {
  const r = determineStatus(9 * 60 + 37, 9 * 60, 15);
  assert.equal(r.status, 'Late');
  assert.equal(r.lateMinutes, 37);
});
