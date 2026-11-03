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
import { assertWithinAttendanceCorrectionWindow, ATTENDANCE_CORRECTION_WORKING_DAYS } from '../dist/lib/correctionWindow.js';
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

// ---------------------------------------------------------------------------
// Condition expressions (regression: two production-outage bugs)
// ---------------------------------------------------------------------------

test('attendance conditions alias the reserved words data/PK', () => {
  for (const cond of [attendance.CHECK_IN_CONDITION, attendance.CHECK_OUT_CONDITION]) {
    assert.ok(
      !/(^|[^#\w.])data\./.test(cond.expression),
      `bare "data." must never appear (reserved word): ${cond.expression}`,
    );
    assert.ok(
      !/attribute_not_exists\(\s*PK\s*\)/.test(cond.expression),
      `bare PK must be aliased: ${cond.expression}`,
    );
    assert.equal(cond.names['#d'], 'data');
  }
  assert.equal(attendance.CHECK_IN_CONDITION.names['#pk'], 'PK');
});

test('attendance condition values are JS null, not the {NULL:true} wire form', () => {
  // DocumentClient marshals JS null → DynamoDB NULL. {NULL:true} would be
  // marshalled as a Map, so the equality never matches and a legitimate
  // check-out was rejected with "Already checked out today".
  for (const cond of [attendance.CHECK_IN_CONDITION, attendance.CHECK_OUT_CONDITION]) {
    for (const v of Object.values(cond.values)) {
      assert.equal(v, null, 'condition values must be JS null');
    }
  }
});

test('conditions reference the exact attribute paths the write stores', () => {
  assert.match(attendance.CHECK_IN_CONDITION.expression, /#d\.checkIn/);
  assert.match(attendance.CHECK_OUT_CONDITION.expression, /#d\.checkOut/);
});

// ---------------------------------------------------------------------------
// PATCH /api/attendance/:id authorization (missed-punch submission bug)
// ---------------------------------------------------------------------------

test('owner submitting DOTTED rectification field paths is allowed (regression: first submit was 403)', () => {
  // The web/mobile client writes 'missedPunchRectification.requested' etc.
  // as dotted field paths; the old gate only matched the literal root key
  // 'missedPunchRectification', so every first-time submission by the record
  // owner was rejected with permission-denied.
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: true,
    canManage: false,
    stampedApprover: false,
    patchKeys: [
      'missedPunchRectification.requested',
      'missedPunchRectification.requestedAt',
      'missedPunchRectification.correctedCheckOut',
      'missedPunchRectification.approvalStatus',
      'missedPunchRectification.employeeId',
      'missedPunchRectification.missedPunchType',
      'missedPunchRectification.currentTierStatus',
    ],
    rect: undefined,
    callerRole: 'employee',
  }), true);
});

test('owner patching the rectification root key or punch fields is allowed', () => {
  for (const key of ['missedPunchRectification', 'checkOut', 'workHours']) {
    assert.equal(attendance.attendancePatchAuthorized({
      isOwn: true, canManage: false, stampedApprover: false,
      patchKeys: [key], rect: undefined, callerRole: 'employee',
    }), true, key);
  }
});

test('owner patching fields outside ownAllowed is denied', () => {
  for (const keys of [['status'], ['approvedByName', 'status'], []]) {
    assert.equal(attendance.attendancePatchAuthorized({
      isOwn: true, canManage: false, stampedApprover: false,
      patchKeys: keys, rect: undefined, callerRole: 'employee',
    }), false, JSON.stringify(keys));
  }
});

test('manage permission and stamped tier approvers are always allowed', () => {
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: true, stampedApprover: false,
    patchKeys: ['status'], rect: undefined, callerRole: 'company-admin',
  }), true);
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: true,
    patchKeys: ['missedPunchRectification.approvalStatus.hr'], rect: undefined, callerRole: 'hr',
  }), true);
});

test('role fallback: only the natural holder of the ACTIVE pending tier may patch (rectification-only)', () => {
  const rect = { approvalStatus: { reportingManager: 'Skipped', hr: 'Pending', companyAdmin: 'Pending', executive: 'Pending', teamLeader: 'Pending' } };
  const keys = ['missedPunchRectification.approvalStatus.hr'];
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: keys, rect, callerRole: 'hr',
  }), true);
  // A different role than the active tier → denied
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: keys, rect, callerRole: 'team-leader',
  }), false);
  // Active tier patch mixed with unrelated fields → denied
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: [...keys, 'status'], rect, callerRole: 'hr',
  }), false);
});

test('stranger without permissions is denied', () => {
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: ['missedPunchRectification.requested'], rect: undefined, callerRole: 'employee',
  }), false);
});

test('attendance.approve may stamp Miss Punch without attendance.manage (RM regression)', () => {
  // Reporting Managers hold `attendance.approve` but NOT `attendance.manage`.
  // Their "Miss Punch" button patched status/missPunchRemark* and was denied,
  // so in RM-driven orgs `status = 'Miss Punch'` was never written and the
  // whole rectification feature (Rectify button) never became reachable.
  const markKeys = ['status', 'missPunchRemark', 'missPunchMarkedBy', 'missPunchMarkedByName', 'missPunchMarkedAt'];
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: markKeys, rect: undefined, callerRole: 'reporting-manager', canApprove: true,
  }), true);
  // Without the approve permission the same patch stays denied.
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: markKeys, rect: undefined, callerRole: 'reporting-manager', canApprove: false,
  }), false);
  // Employees never get it, even with a stray flag.
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: true, canManage: false, stampedApprover: false,
    patchKeys: ['status'], rect: undefined, callerRole: 'employee', canApprove: true,
  }), false, 'approve-class keys must never leak into owner patches');
  // Mixing a mark key with an unrelated write stays denied.
  assert.equal(attendance.attendancePatchAuthorized({
    isOwn: false, canManage: false, stampedApprover: false,
    patchKeys: ['status', 'approvedByName'], rect: undefined, callerRole: 'reporting-manager', canApprove: true,
  }), false);
});

// ---------------------------------------------------------------------------
// 2-working-day attendance correction window (server-side enforcement)
// ---------------------------------------------------------------------------

test('correction window: opens for the record day and the next working days', () => {
  const noHolidays = [];
  // Wednesday record, Sat+Sun weekends → deadline = end of Friday (2 working days).
  const wed = new Date(2026, 10, 4, 12, 0, 0); // 2026-11-04 is a Wednesday
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], noHolidays, new Date(2026, 10, 4, 18, 0)));
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], noHolidays, new Date(2026, 10, 5, 9, 0)));
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], noHolidays, new Date(2026, 10, 6, 23, 59)));
  // Friday is the 2nd working day after Wednesday → still open until end of day.
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], noHolidays, new Date(2026, 10, 6, 23, 59, 59)));
});

test('correction window: closes after the deadline (regression: client-only check)', () => {
  const wed = new Date(2026, 10, 4, 12, 0, 0);
  // Saturday 00:00:01 is past Friday's end-of-day deadline.
  assert.throws(
    () => assertWithinAttendanceCorrectionWindow(wed, [0, 6], [], new Date(2026, 10, 7, 0, 0, 1)),
    /2-working-day correction window/,
  );
  // A month-old record is always out of window.
  assert.throws(
    () => assertWithinAttendanceCorrectionWindow(new Date(2026, 9, 1), [0, 6], [], new Date(2026, 10, 4)),
    /2-working-day correction window/,
  );
});

test('correction window: holidays and weekends are not counted', () => {
  const wed = new Date(2026, 10, 4, 12, 0, 0); // Wednesday
  // Thursday 2026-11-05 is a holiday → the 2 working days become Fri + Mon.
  const holidays = ['2026-11-05'];
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], holidays, new Date(2026, 10, 6, 12, 0))); // Friday open
  assert.doesNotThrow(() => assertWithinAttendanceCorrectionWindow(wed, [0, 6], holidays, new Date(2026, 10, 9, 23, 59))); // Monday = deadline
  assert.throws(
    () => assertWithinAttendanceCorrectionWindow(wed, [0, 6], holidays, new Date(2026, 10, 10, 0, 0, 1)), // Tuesday closed
    /2-working-day correction window/,
  );
});

test('correction window: the product window is 2 working days', () => {
  assert.equal(ATTENDANCE_CORRECTION_WORKING_DAYS, 2);
});
