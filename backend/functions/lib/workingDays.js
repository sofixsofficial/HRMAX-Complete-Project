"use strict";
/**
 * WORKING-DAYS HELPERS (backend)
 * ==============================
 * Mirrors frontend/src/utils/workingDays.ts so Cloud Functions can enforce
 * the SAME business-day rules as the UI:
 *   - Salary-slip / payroll correction window: 5 working days
 *   - Attendance / missed-punch / leave re-submission window: 2 working days
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAY_INDEX = exports.ATTENDANCE_CORRECTION_WORKING_DAYS = exports.SLIP_CORRECTION_WORKING_DAYS = void 0;
exports.startOfDay = startOfDay;
exports.endOfDay = endOfDay;
exports.toDateKey = toDateKey;
exports.parseWeekendDays = parseWeekendDays;
exports.isWeekend = isWeekend;
exports.isHoliday = isHoliday;
exports.isWorkingDay = isWorkingDay;
exports.addWorkingDays = addWorkingDays;
exports.correctionDeadline = correctionDeadline;
exports.isWithinCorrectionWindow = isWithinCorrectionWindow;
exports.isWithinSlipCorrectionWindow = isWithinSlipCorrectionWindow;
exports.isWithinAttendanceCorrectionWindow = isWithinAttendanceCorrectionWindow;
exports.SLIP_CORRECTION_WORKING_DAYS = 5;
exports.ATTENDANCE_CORRECTION_WORKING_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
exports.WEEKDAY_INDEX = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
};
function startOfDay(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
}
function endOfDay(d) {
    const date = new Date(d);
    date.setHours(23, 59, 59, 999);
    return date;
}
function toDateKey(d) {
    const date = new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function parseWeekendDays(companyWeekends) {
    if (!companyWeekends || companyWeekends.length === 0)
        return [0, 6];
    const days = [];
    for (const name of companyWeekends) {
        const idx = exports.WEEKDAY_INDEX[String(name || '').trim()];
        if (typeof idx === 'number' && !days.includes(idx))
            days.push(idx);
    }
    return days.length ? days : [0, 6];
}
function isWeekend(d, weekendDays = [0, 6]) {
    return weekendDays.includes(d.getDay());
}
function isHoliday(d, holidayKeys = []) {
    return holidayKeys.includes(toDateKey(d));
}
function isWorkingDay(d, weekendDays = [0, 6], holidayKeys = []) {
    return !isWeekend(d, weekendDays) && !isHoliday(d, holidayKeys);
}
function addWorkingDays(from, count, weekendDays = [0, 6], holidayKeys = []) {
    let cursor = startOfDay(from);
    let remaining = Math.max(0, count);
    while (remaining > 0) {
        cursor = new Date(cursor.getTime() + DAY_MS);
        if (isWorkingDay(cursor, weekendDays, holidayKeys))
            remaining--;
    }
    return endOfDay(cursor);
}
function correctionDeadline(from, workingDays, weekendDays = [0, 6], holidayKeys = []) {
    return addWorkingDays(from, workingDays, weekendDays, holidayKeys);
}
function isWithinCorrectionWindow(from, now, workingDays, weekendDays = [0, 6], holidayKeys = []) {
    const deadline = correctionDeadline(from, workingDays, weekendDays, holidayKeys);
    return new Date(now).getTime() <= deadline.getTime();
}
function isWithinSlipCorrectionWindow(from, now, weekendDays = [0, 6], holidayKeys = []) {
    return isWithinCorrectionWindow(from, now, exports.SLIP_CORRECTION_WORKING_DAYS, weekendDays, holidayKeys);
}
function isWithinAttendanceCorrectionWindow(from, now, weekendDays = [0, 6], holidayKeys = []) {
    return isWithinCorrectionWindow(from, now, exports.ATTENDANCE_CORRECTION_WORKING_DAYS, weekendDays, holidayKeys);
}
//# sourceMappingURL=workingDays.js.map