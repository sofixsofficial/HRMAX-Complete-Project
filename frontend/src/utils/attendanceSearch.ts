/**
 * Attendance list search matcher (shared by Attendance + AttendanceDashboard).
 *
 * The bug this replaces: `r.name?.toLowerCase().includes(q) || r.department?...`
 * short-circuits to `undefined` — which is falsy — for records written by the
 * server, which carry `employeeName` and no `name`/`department`. With an EMPTY
 * search box every record therefore failed the filter and the screen showed
 * "No attendance records found" + zeroed stats while the API was returning the
 * rows (verified live: `?orderBy=date&desc=false` → 1 record, UI → 0).
 *
 * Empty search always matches; otherwise any searchable field may match.
 */
export interface AttendanceSearchable {
  name?: string | null;
  employeeName?: string | null;
  department?: string | null;
  userId?: string | null;
}

export function matchesAttendanceSearch(record: AttendanceSearchable, term: string): boolean {
  const q = (term || '').trim().toLowerCase();
  if (!q) return true;
  const fields = [record.name, record.employeeName, record.department, record.userId];
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}
