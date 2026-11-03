/**
 * Server-side attendance-correction window (2 working days).
 *
 * The web client enforced this in `attendanceService.requestPunchRectification`
 * and the mobile client in `AttendanceScreen` — both purely client-side, so a
 * direct callable call bypassed the policy entirely. The window is now also
 * enforced inside the backend callable, using the SAME maths as
 * `frontend/src/utils/workingDays.ts` so a rejection message is identical on
 * every platform.
 */

import { getCompanyMeta, queryEntities } from './db.js';
import { ApiError } from './types.js';

/** Company policy: attendance / missed-punch corrections close after this many working days. */
export const ATTENDANCE_CORRECTION_WORKING_DAYS = 2;

const DAY_MS = 86_400_000;

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/** Local 'YYYY-MM-DD' key (used for holiday sets). */
function toDateKey(d: Date | string | number): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convert a company `weekends` string array to JS day indexes. */
function parseWeekendDays(companyWeekends?: unknown): number[] {
  if (!Array.isArray(companyWeekends) || companyWeekends.length === 0) return [0, 6];
  const days: number[] = [];
  for (const name of companyWeekends) {
    const idx = WEEKDAY_INDEX[String(name ?? '').trim().toLowerCase()];
    if (typeof idx === 'number' && !days.includes(idx)) days.push(idx);
  }
  return days.length ? days : [0, 6];
}

function startOfDay(d: Date | string | number): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(d: Date | string | number): Date {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

function isWorkingDay(d: Date, weekendDays: number[], holidayKeys: string[]): boolean {
  return !weekendDays.includes(d.getDay()) && !holidayKeys.includes(toDateKey(d));
}

/** End-of-day of the `count`-th working day strictly after `from`. */
function addWorkingDays(from: Date | string | number, count: number, weekendDays: number[], holidayKeys: string[]): Date {
  let cursor = startOfDay(from);
  let remaining = Math.max(0, count);
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (isWorkingDay(cursor, weekendDays, holidayKeys)) remaining--;
  }
  return endOfDay(cursor);
}

/** The company's weekend + holiday calendar for the correction window. */
export async function resolveAttendanceCorrectionWindow(companyId: string): Promise<{ weekendDays: number[]; holidayKeys: string[] }> {
  let weekendDays: number[] = [0, 6];
  const holidayKeys: string[] = [];
  try {
    // getCompanyMeta resolves BOTH storage layouts (migration COMPANY#META and
    // the CRUD `company#<id>` row) and never throws.
    const comp = await getCompanyMeta(companyId);
    const settings = (comp?.payrollSettings ?? comp) as Record<string, unknown> | undefined;
    if (settings) weekendDays = parseWeekendDays(settings.weekends ?? settings.weekendDays);
  } catch {
    /* default Sat+Sun */
  }
  try {
    const holidays = await queryEntities<{ date: string }>({ entity: 'holiday', companyId });
    for (const h of holidays) {
      const key = toDateKey(h.date);
      if (key) holidayKeys.push(key);
    }
  } catch {
    /* no holidays */
  }
  return { weekendDays, holidayKeys };
}

/**
 * Throw when `recordDate` is older than the 2-working-day correction window.
 * Exported for tests.
 */
export function assertWithinAttendanceCorrectionWindow(
  recordDate: Date | string | number,
  weekendDays: number[],
  holidayKeys: string[],
  now: Date = new Date(),
): void {
  const deadline = addWorkingDays(recordDate, ATTENDANCE_CORRECTION_WORKING_DAYS, weekendDays, holidayKeys);
  if (now.getTime() > deadline.getTime()) {
    throw new ApiError(
      'failed-precondition',
      'The 2-working-day correction window for this day has closed. Changes can no longer be made to this attendance record.',
    );
  }
}
