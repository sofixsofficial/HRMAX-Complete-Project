/**
 * WORKING-DAYS HELPERS (backend)
 * ==============================
 * Mirrors frontend/src/utils/workingDays.ts so Cloud Functions can enforce
 * the SAME business-day rules as the UI:
 *   - Salary-slip / payroll correction window: 5 working days
 *   - Attendance / missed-punch / leave re-submission window: 2 working days
 */

export const SLIP_CORRECTION_WORKING_DAYS = 5;
export const ATTENDANCE_CORRECTION_WORKING_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export function startOfDay(d: Date | string | number): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(d: Date | string | number): Date {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function toDateKey(d: Date | string | number): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseWeekendDays(companyWeekends?: string[]): number[] {
  if (!companyWeekends || companyWeekends.length === 0) return [0, 6];
  const days: number[] = [];
  for (const name of companyWeekends) {
    const idx = WEEKDAY_INDEX[String(name || '').trim()];
    if (typeof idx === 'number' && !days.includes(idx)) days.push(idx);
  }
  return days.length ? days : [0, 6];
}

export function isWeekend(d: Date, weekendDays: number[] = [0, 6]): boolean {
  return weekendDays.includes(d.getDay());
}

export function isHoliday(d: Date, holidayKeys: string[] = []): boolean {
  return holidayKeys.includes(toDateKey(d));
}

export function isWorkingDay(
  d: Date,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): boolean {
  return !isWeekend(d, weekendDays) && !isHoliday(d, holidayKeys);
}

export function addWorkingDays(
  from: Date | string | number,
  count: number,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): Date {
  let cursor = startOfDay(from);
  let remaining = Math.max(0, count);
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (isWorkingDay(cursor, weekendDays, holidayKeys)) remaining--;
  }
  return endOfDay(cursor);
}

export function correctionDeadline(
  from: Date | string | number,
  workingDays: number,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): Date {
  return addWorkingDays(from, workingDays, weekendDays, holidayKeys);
}

export function isWithinCorrectionWindow(
  from: Date | string | number,
  now: Date | string | number,
  workingDays: number,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): boolean {
  const deadline = correctionDeadline(from, workingDays, weekendDays, holidayKeys);
  return new Date(now).getTime() <= deadline.getTime();
}

export function isWithinSlipCorrectionWindow(
  from: Date | string | number,
  now: Date | string | number,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): boolean {
  return isWithinCorrectionWindow(from, now, SLIP_CORRECTION_WORKING_DAYS, weekendDays, holidayKeys);
}

export function isWithinAttendanceCorrectionWindow(
  from: Date | string | number,
  now: Date | string | number,
  weekendDays: number[] = [0, 6],
  holidayKeys: string[] = [],
): boolean {
  return isWithinCorrectionWindow(from, now, ATTENDANCE_CORRECTION_WORKING_DAYS, weekendDays, holidayKeys);
}