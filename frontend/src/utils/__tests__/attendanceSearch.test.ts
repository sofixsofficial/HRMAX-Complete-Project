import { describe, it, expect } from 'vitest';
import { matchesAttendanceSearch } from '../attendanceSearch';

// Shape the server actually writes (verified live via /api/attendance):
// employeeName present, name/department absent.
const serverRecord = {
  id: 'EcBGvrE1PzBi8FAXCDoK',
  date: '2026-10-26',
  status: 'Late',
  employeeName: 'Test Employee',
  userId: 'e96ea488-3081-7079-9cab-0f65071aa41c',
};

describe('matchesAttendanceSearch', () => {
  it('matches EVERY record when the search box is empty (regression)', () => {
    // The old inline filter short-circuited to `undefined` for records without
    // `name`, so an empty search hid all server-written rows: the screen showed
    // "No attendance records found" and 0/0 stats while the API returned 1.
    expect(matchesAttendanceSearch(serverRecord, '')).toBe(true);
    expect(matchesAttendanceSearch(serverRecord, '   ')).toBe(true);
    expect(matchesAttendanceSearch({ name: 'Aarav Sharma' }, '')).toBe(true);
    expect(matchesAttendanceSearch({}, '')).toBe(true);
  });

  it('matches on employeeName (the field the server writes)', () => {
    expect(matchesAttendanceSearch(serverRecord, 'test')).toBe(true);
    expect(matchesAttendanceSearch(serverRecord, 'EMPLOYEE')).toBe(true);
    expect(matchesAttendanceSearch(serverRecord, 'zzz')).toBe(false);
  });

  it('still matches legacy web-written rows by name, department or userId', () => {
    expect(matchesAttendanceSearch({ name: 'Priya Ranjan' }, 'priya')).toBe(true);
    expect(matchesAttendanceSearch({ department: 'Finance' }, 'fin')).toBe(true);
    expect(matchesAttendanceSearch({ userId: 'user-123' }, 'user-12')).toBe(true);
    expect(matchesAttendanceSearch({ name: 'Priya' }, 'finance')).toBe(false);
  });
});
