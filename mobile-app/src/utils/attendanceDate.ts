/**
 * Attendance date keys.
 *
 * The API stores `attendance.date` as 'YYYY-MM-DD' (backend `todayKey()`), but
 * several screens queried with JS Dates or Firestore Timestamps. A Date
 * serialises to '2026-10-26T00:00:00.000Z', and `'2026-10-26' >= that string`
 * is false — so server-written punches (check-in/out, Late, Absent) never came
 * back and the user's own day looked empty.
 *
 * String ranges work for BOTH representations:
 *   '2026-10-26'          (server)   → within ['2026-10-26', '2026-10-27') ✅
 *   '2026-10-26T09:51:..' (legacy)   → within ['2026-10-26', '2026-10-27') ✅
 *
 * Always use these for `where('date', ...)` range filters on attendance.
 */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A copy of `d` shifted by `n` days (no mutation). */
export const addDays = (d: Date, n: number): Date => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
