"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.missedPunchCutoffAlert = exports.monthlyPayrollReminder = exports.dailyAttendanceSweep = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const missedPunchNotifications_1 = require("./missedPunchNotifications");
const db = admin.firestore();
const dayStart = (d) => {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    return s;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const toDate = (v) => {
    if (!v)
        return new Date(0);
    if (v.toDate)
        return v.toDate();
    return new Date(v);
};
/**
 * Daily attendance sweep (23:30 IST).
 * 1. Missed-punch: closes any check-in that never got a check-out, flips the
 *    record to 'Miss Punch' and notifies the employee.
 * 2. Auto mark absent: for working days, marks Active/On Leave employees with
 *    no check-in today and no approved leave (and not a company holiday) as
 *    'Absent' so payroll and dashboards reflect the day.
 */
exports.dailyAttendanceSweep = functions.pubsub
    .schedule('30 23 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    const now = new Date();
    const start = dayStart(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    // ---- 1) Missed-punch detection ----
    const openSnap = await db.collection('attendance')
        .where('date', '>=', start)
        .where('date', '<', end)
        .where('checkOut', '==', null)
        .get();
    let missedPunches = 0;
    for (const doc of openSnap.docs) {
        const data = doc.data();
        if (data.status === 'On Leave' || data.status === 'Absent' || data.status === 'Miss Punch')
            continue;
        await doc.ref.update({
            status: 'Miss Punch',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Fan out to the employee, their reporting manager, the assigned
        // executive + team leaders, the company admin and all master admins.
        // Idempotent: skip if the designated-cutoff alert already notified.
        if (data.missedPunchNotified !== true) {
            try {
                await (0, missedPunchNotifications_1.notifyMissedPunchToStakeholders)({
                    companyId: data.companyId,
                    employeeUserId: data.userId,
                    employeeName: data.name || '',
                    dateLabel: start.toISOString().slice(0, 10),
                    kind: 'checkout',
                    attendanceId: doc.id,
                    dedupeKey: `${data.companyId}_${data.userId}_${(0, missedPunchNotifications_1.dateKeyOf)(start)}_checkout`,
                });
            }
            catch (err) {
                functions.logger.warn('Missed-punch stakeholder notify failed', { attendanceId: doc.id, error: err });
            }
        }
        missedPunches++;
    }
    // ---- 2) Auto mark absent (skip weekends) ----
    let absentMarked = 0;
    if (!isWeekend(now)) {
        const companySnap = await db.collection('companies').get();
        for (const company of companySnap.docs) {
            const companyId = company.id;
            // Skip company holidays
            const holSnap = await db.collection('holidays')
                .where('companyId', '==', companyId)
                .get();
            const isHoliday = holSnap.docs.some((h) => {
                const d = toDate(h.data().date);
                return d >= start && d < end;
            });
            if (isHoliday)
                continue;
            const empSnap = await db.collection('employees')
                .where('companyId', '==', companyId)
                .where('status', 'in', ['Active', 'On Leave'])
                .get();
            if (empSnap.empty)
                continue;
            const attSnap = await db.collection('attendance')
                .where('companyId', '==', companyId)
                .where('date', '>=', start)
                .where('date', '<', end)
                .get();
            const attendedUserIds = new Set(attSnap.docs.map((d) => d.data().userId));
            const leaveSnap = await db.collection('leaveRequests')
                .where('companyId', '==', companyId)
                .where('status', '==', 'Approved')
                .get();
            const onLeaveUserIds = new Set();
            for (const l of leaveSnap.docs) {
                const ld = l.data();
                const ls = toDate(ld.startDate);
                const le = toDate(ld.endDate);
                if (ls < end && le >= start)
                    onLeaveUserIds.add(ld.userId);
            }
            let batch = db.batch();
            let ops = 0;
            for (const emp of empSnap.docs) {
                const ed = emp.data();
                const uid = ed.userId || emp.id;
                if (attendedUserIds.has(uid) || onLeaveUserIds.has(uid))
                    continue;
                batch.set(db.collection('attendance').doc(), {
                    userId: uid,
                    companyId,
                    name: ed.name || '',
                    email: ed.email || '',
                    avatar: ed.avatar || '',
                    employeeId: ed.employeeId || '',
                    department: ed.department || '',
                    departmentColor: ed.departmentColor || '',
                    departmentId: ed.departmentId || null,
                    date: start,
                    checkIn: null,
                    checkOut: null,
                    status: 'Absent',
                    workHours: 0,
                    shiftId: null,
                    shiftStart: ed.shiftStart || '09:00',
                    shiftEnd: ed.shiftEnd || '18:00',
                    shiftType: ed.shiftType || 'Morning',
                    isAutoApproved: false,
                    lateMinutes: 0,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                ops++;
                absentMarked++;
                if (ops >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }
            if (ops > 0)
                await batch.commit();
        }
    }
    functions.logger.info('Daily attendance sweep complete', { missedPunches, absentMarked });
    return null;
});
/**
 * Monthly payroll reminder (1st of month, 08:00 IST): notifies every company
 * admin to process the previous month's payroll and raises an admin alert.
 */
exports.monthlyPayrollReminder = functions.pubsub
    .schedule('0 8 1 * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    const companySnap = await db.collection('companies').get();
    let reminded = 0;
    for (const company of companySnap.docs) {
        const companyId = company.id;
        const companyName = company.data().name || 'Company';
        const adminSnap = await db.collection('users')
            .where('companyId', '==', companyId)
            .where('role', '==', 'company-admin')
            .get();
        for (const adminUser of adminSnap.docs) {
            await db.collection('notifications').add({
                userId: adminUser.id,
                companyId,
                type: 'payroll_reminder',
                title: 'Payroll Due This Month',
                body: `It's time to process payroll for ${companyName} for the previous month.`,
                read: false,
                link: '/payroll',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            reminded++;
        }
        await db.collection('adminAlerts').add({
            companyId,
            companyName,
            type: 'payroll_reminder',
            title: 'Payroll Due',
            body: `Process payroll for ${companyName} for the previous month.`,
            read: false,
            priority: 'normal',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    functions.logger.info('Monthly payroll reminder sent', { reminded });
    return null;
});
/**
 * Missed Punch / Attendance Alert cutoff trigger (21:30 IST, Mon-Fri).
 *
 * Proactively alerts the employee and their full permission hierarchy
 * (Reporting Manager, assigned Executive, Team Leaders, Company Admin and all
 * Master Admins) as soon as the designated cutoff passes and someone still has
 * not logged attendance or closed their punch for the working day.
 *
 * Two cases are detected, each idempotent:
 *  - checkout: an open attendance record that never got a check-out.
 *  - checkin:  an Active employee with no check-in at all (and no approved
 *              leave, and not a company holiday).
 *
 * The end-of-day sweep (`dailyAttendanceSweep`) uses the same notification
 * helper and the `missedPunchNotified` flag, so no duplicate alerts fire.
 */
exports.missedPunchCutoffAlert = functions.pubsub
    .schedule('30 21 * * 1-5')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    const now = new Date();
    const start = dayStart(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    let checkoutAlerts = 0;
    let checkinAlerts = 0;
    const companySnap = await db.collection('companies').get();
    for (const company of companySnap.docs) {
        const companyId = company.id;
        // Skip company holidays.
        const holSnap = await db.collection('holidays')
            .where('companyId', '==', companyId)
            .get();
        const isHoliday = holSnap.docs.some((h) => {
            const d = toDate(h.data().date);
            return d >= start && d < end;
        });
        if (isHoliday)
            continue;
        // ---- Case A: open records that never got a check-out ----
        const openSnap = await db.collection('attendance')
            .where('companyId', '==', companyId)
            .where('date', '>=', start)
            .where('date', '<', end)
            .get();
        for (const doc of openSnap.docs) {
            const data = doc.data();
            if (data.checkOut !== null && data.checkOut !== undefined)
                continue;
            if (data.status === 'On Leave' || data.status === 'Absent' || data.status === 'Miss Punch')
                continue;
            if (data.missedPunchNotified === true)
                continue;
            try {
                await (0, missedPunchNotifications_1.notifyMissedPunchToStakeholders)({
                    companyId,
                    employeeUserId: data.userId,
                    employeeName: data.name || '',
                    dateLabel: start.toISOString().slice(0, 10),
                    kind: 'checkout',
                    attendanceId: doc.id,
                    dedupeKey: `${companyId}_${data.userId}_${(0, missedPunchNotifications_1.dateKeyOf)(start)}_checkout`,
                });
                checkoutAlerts++;
            }
            catch (err) {
                functions.logger.warn('Cutoff checkout alert failed', { companyId, error: err });
            }
        }
        // ---- Case B: Active employees with no check-in at all ----
        const empSnap = await db.collection('employees')
            .where('companyId', '==', companyId)
            .where('status', 'in', ['Active', 'On Leave'])
            .get();
        if (empSnap.empty)
            continue;
        const attSnap = await db.collection('attendance')
            .where('companyId', '==', companyId)
            .where('date', '>=', start)
            .where('date', '<', end)
            .get();
        const attended = new Set(attSnap.docs.map((d) => d.data().userId));
        const leaveSnap = await db.collection('leaveRequests')
            .where('companyId', '==', companyId)
            .where('status', '==', 'Approved')
            .get();
        const onLeave = new Set();
        for (const l of leaveSnap.docs) {
            const ld = l.data();
            const ls = toDate(ld.startDate);
            const le = toDate(ld.endDate);
            if (ls < end && le >= start)
                onLeave.add(ld.userId);
        }
        for (const emp of empSnap.docs) {
            const ed = emp.data();
            const uid = ed.userId || emp.id;
            // Skip employees who already checked in, are on approved leave, or are
            // On Leave status.
            if (attended.has(uid) || onLeave.has(uid))
                continue;
            if (ed.status === 'On Leave')
                continue;
            const dedupeKey = `${companyId}_${uid}_${(0, missedPunchNotifications_1.dateKeyOf)(start)}_checkin`;
            const markerRef = db.collection('missedPunchNotifications').doc(dedupeKey);
            const marker = await markerRef.get();
            if (marker.exists)
                continue;
            try {
                await (0, missedPunchNotifications_1.notifyMissedPunchToStakeholders)({
                    companyId,
                    employeeUserId: uid,
                    employeeName: ed.name || '',
                    dateLabel: start.toISOString().slice(0, 10),
                    kind: 'checkin',
                    attendanceId: null,
                    dedupeKey,
                });
                checkinAlerts++;
            }
            catch (err) {
                functions.logger.warn('Cutoff checkin alert failed', { companyId, userId: uid, error: err });
            }
        }
    }
    functions.logger.info('Missed-punch cutoff alert complete', { checkoutAlerts, checkinAlerts });
    return null;
});
//# sourceMappingURL=scheduledFunctions.js.map