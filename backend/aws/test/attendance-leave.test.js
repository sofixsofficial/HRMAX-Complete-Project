/**
 * Attendance + leave business-rule tests (spec §18).
 *
 * These cover the pure logic that previously had NO coverage at all: the
 * status machine, company-timezone day/minute resolution (the UTC vs IST bug),
 * geofence/selfie policy flag spelling, and leave date validation, duration
 * and overlap detection.
 *
 * They run against the compiled dist/ (node --test, offline, no AWS calls).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as attendance from '../dist/handlers/attendance.js';
import * as leave from '../dist/handlers/leave.js';
import { ConditionalWriteFailed } from '../dist/lib/db.js';

// ---------------------------------------------------------------------------
// Attendance status machine
// ---------------------------------------------------------------------------

test('determineStatus: on or before shift start → Present, 0 late', () => {
  // 09:00 start, checked in 08:57
  assert.deepEqual(attendance.determineStatus(8 * 60 + 57, 9 * 60, 15), { status: 'Present', lateMinutes: 0 });
});

test('determineStatus: within grace period → Present, 0 late', () => {
  // 09:14 with 15 min grace
  assert.deepEqual(attendance.determineStatus(9 * 60 + 14, 9 * 60, 15), { status: 'Present', lateMinutes: 0 });
  // exactly at the grace boundary
  assert.deepEqual(attendance.determineStatus(9 * 60 + 15, 9 * 60, 15), { status: 'Present', lateMinutes: 0 });
});

test('determineStatus: past grace → Late with exact late minutes', () => {
  assert.deepEqual(attendance.determineStatus(9 * 60 + 16, 9 * 60, 15), { status: 'Late', lateMinutes: 16 });
  assert.deepEqual(attendance.determineStatus(10 * 60, 9 * 60, 15), { status: 'Late', lateMinutes: 60 });
});

// ---------------------------------------------------------------------------
// Timezone resolution (the UTC-vs-IST split)
// ---------------------------------------------------------------------------

test('dateKeyInZone: 18:30 UTC is already the next day in Asia/Kolkata', () => {
  const d = new Date('2026-10-26T18:30:00Z');
  assert.equal(attendance.dateKeyInZone(d, 'Asia/Kolkata'), '2026-10-27');
  assert.equal(attendance.dateKeyInZone(d, 'UTC'), '2026-10-26');
});

test('dateKeyInZone: just after midnight IST stays on the IST day', () => {
  // 2026-10-26 18:35 UTC = 2026-10-27 00:05 IST
  const d = new Date('2026-10-26T18:35:00Z');
  assert.equal(attendance.dateKeyInZone(d, 'Asia/Kolkata'), '2026-10-27');
});

test('minutesInZone: a 09:15 IST punch is 09:15 local even though the Lambda runs UTC', () => {
  // 03:45 UTC = 09:15 IST — the old code read getHours() (UTC) = 03:45 and
  // never marked anyone late.
  assert.equal(attendance.minutesInZone(new Date('2026-10-26T03:45:00Z'), 'Asia/Kolkata'), 9 * 60 + 15);
});

test('minutesInZone: midnight resolves to 0, not 24', () => {
  assert.equal(attendance.minutesInZone(new Date('2026-10-26T18:30:00Z'), 'Asia/Kolkata'), 0);
});

test('DEFAULT_TIMEZONE is the product default and validates', () => {
  assert.equal(attendance.DEFAULT_TIMEZONE, 'Asia/Kolkata');
  assert.equal(attendance.isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(attendance.isValidTimeZone('Not/AZone'), false);
});

// ---------------------------------------------------------------------------
// Policy flags (the enableGeofence vs requireGeofence mismatch)
// ---------------------------------------------------------------------------

test('normalizePolicyFlags: the settings screen\'s enableGeofence now reaches the server', () => {
  assert.deepEqual(attendance.normalizePolicyFlags({ enableGeofence: true }), {
    requireSelfie: false,
    requireGeofence: true,
  });
});

test('normalizePolicyFlags: legacy requireGeofence spelling still works', () => {
  assert.deepEqual(attendance.normalizePolicyFlags({ requireGeofence: true, requireSelfie: true }), {
    requireSelfie: true,
    requireGeofence: true,
  });
});

test('normalizePolicyFlags: both spellings absent → disabled (fail-safe)', () => {
  assert.deepEqual(attendance.normalizePolicyFlags(undefined), { requireSelfie: false, requireGeofence: false });
  assert.deepEqual(attendance.normalizePolicyFlags({}), { requireSelfie: false, requireGeofence: false });
});

// ---------------------------------------------------------------------------
// Geofence maths
// ---------------------------------------------------------------------------

test('haversine: identical points are 0 m apart', () => {
  assert.equal(Math.round(attendance.haversine(28.6139, 77.209, 28.6139, 77.209)), 0);
});

test('haversine: 0.001° of latitude ≈ 111 m', () => {
  const d = attendance.haversine(28.6139, 77.209, 28.6149, 77.209);
  assert.ok(d > 105 && d < 117, `expected ~111 m, got ${d}`);
});

// ---------------------------------------------------------------------------
// Leave date validation
// ---------------------------------------------------------------------------

test('parseLeaveDay: plain day, ISO string, and garbage', () => {
  assert.equal(leave.parseLeaveDay('2026-11-12')?.toISOString().slice(0, 10), '2026-11-12');
  assert.equal(leave.parseLeaveDay('2026-11-12T00:00:00.000Z')?.toISOString().slice(0, 10), '2026-11-12');
  assert.equal(leave.parseLeaveDay('not-a-date'), null);
  assert.equal(leave.parseLeaveDay(''), null);
  assert.equal(leave.parseLeaveDay(undefined), null);
});

test('inclusiveDays: same day is 1, a Mon–Wed range is 3', () => {
  const a = leave.parseLeaveDay('2026-11-12');
  assert.equal(leave.inclusiveDays(a, a), 1);
  assert.equal(leave.inclusiveDays(leave.parseLeaveDay('2026-11-12'), leave.parseLeaveDay('2026-11-14')), 3);
});

test('findOverlappingLeave: a pending request blocks an overlapping range', () => {
  const rows = [
    { id: '1', status: 'Pending', startDate: '2026-11-12', endDate: '2026-11-14' },
  ];
  const hit = leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-14'), leave.parseLeaveDay('2026-11-15'));
  assert.equal(hit?.id, '1');
  // same start day
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-11'), leave.parseLeaveDay('2026-11-12'))?.id, '1');
  // fully contained
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-13'), leave.parseLeaveDay('2026-11-13'))?.id, '1');
});

test('findOverlappingLeave: adjacent and non-overlapping ranges do not block', () => {
  const rows = [{ id: '1', status: 'Approved', startDate: '2026-11-12', endDate: '2026-11-14' }];
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-15'), leave.parseLeaveDay('2026-11-16')), undefined);
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-01'), leave.parseLeaveDay('2026-11-11')), undefined);
});

test('findOverlappingLeave: cancelled/rejected history never blocks a new request', () => {
  const rows = [
    { id: 'c', status: 'Cancelled', startDate: '2026-11-12', endDate: '2026-11-14' },
    { id: 'r', status: 'Rejected', startDate: '2026-11-12', endDate: '2026-11-14' },
  ];
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-13'), leave.parseLeaveDay('2026-11-13')), undefined);
});

test('findOverlappingLeave: malformed dates on the stored row never block', () => {
  const rows = [{ id: 'x', status: 'Approved', startDate: 'whenever', endDate: '' }];
  assert.equal(leave.findOverlappingLeave(rows, leave.parseLeaveDay('2026-11-13'), leave.parseLeaveDay('2026-11-13')), undefined);
});

// ---------------------------------------------------------------------------
// Idempotency contract
// ---------------------------------------------------------------------------

test('ConditionalWriteFailed is an Error with a stable name (handlers map it to 412)', () => {
  const err = new ConditionalWriteFailed();
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'ConditionalWriteFailed');
});
