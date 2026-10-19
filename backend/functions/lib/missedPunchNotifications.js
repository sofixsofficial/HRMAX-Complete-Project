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
exports.dateKeyOf = exports.resolveMissedPunchStakeholders = void 0;
exports.notifyMissedPunchToStakeholders = notifyMissedPunchToStakeholders;
const admin = __importStar(require("firebase-admin"));
const stakeholderResolver_1 = require("./stakeholderResolver");
const db = admin.firestore();
/**
 * Resolve every stakeholder who must be alerted about an employee's missed
 * punch / failed attendance, scoped strictly to the employee's company and its
 * permission hierarchy.
 * Shared implementation: see `resolveManagementStakeholders`.
 */
exports.resolveMissedPunchStakeholders = stakeholderResolver_1.resolveManagementStakeholders;
const ATTR_KEYS = {
    'reporting-manager': (s) => (s.reportingManagerId ? [s.reportingManagerId] : []),
    'executive': (s) => s.executiveIds,
    'team-leader': (s) => s.teamLeaderIds,
    'company-admin': (s) => s.companyAdminIds,
    'master-admin': (s) => s.masterAdminIds,
};
/**
 * Instantiate the missed-punch alert for every stakeholder and create a
 * dashboard admin alert. Used by both the designated-cutoff trigger and the
 * end-of-day sweep. Idempotent per (company, user, date) via
 * `missedPunchNotifiedAt` on the attendance record / a dedup marker doc.
 */
async function notifyMissedPunchToStakeholders(params) {
    const s = await (0, exports.resolveMissedPunchStakeholders)(params.companyId, params.employeeUserId, params.employeeName);
    const isCheckInMiss = params.kind === 'checkin';
    const employeeTitle = isCheckInMiss ? 'Attendance Alert: No Check-In' : 'Missed Punch Alert';
    const employeeBody = isCheckInMiss
        ? `You have not logged your attendance for ${params.dateLabel}. Please check in or request a correction.`
        : `You missed your punch (check-out) on ${params.dateLabel}. Please submit a rectification request.`;
    const managerTitle = isCheckInMiss ? `No Check-In: ${s.employeeName}` : `Missed Punch: ${s.employeeName}`;
    const managerBody = isCheckInMiss
        ? `${s.employeeName} has not logged attendance for ${params.dateLabel}.`
        : `${s.employeeName} missed their punch on ${params.dateLabel}.`;
    const link = '/attendance';
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('notifications').add({
        userId: s.employeeUserId,
        companyId: params.companyId,
        type: 'missed_punch',
        title: employeeTitle,
        body: employeeBody,
        read: false,
        link,
        createdAt: now,
    });
    const recipients = new Map();
    for (const key of ['reporting-manager', 'executive', 'team-leader', 'company-admin', 'master-admin']) {
        for (const id of ATTR_KEYS[key](s)) {
            if (id && id !== s.employeeUserId)
                recipients.set(id, key);
        }
    }
    for (const [recipientId] of recipients) {
        await db.collection('notifications').add({
            userId: recipientId,
            companyId: params.companyId,
            type: 'missed_punch',
            title: managerTitle,
            body: managerBody,
            read: false,
            link,
            createdAt: now,
        });
    }
    await db.collection('adminAlerts').add({
        companyId: params.companyId,
        type: 'missed_punch',
        title: managerTitle,
        body: managerBody,
        link,
        read: false,
        priority: 'high',
        createdAt: now,
    });
    // Dedup marker so the alert fires only once per (employee, date, kind).
    await db.collection('missedPunchNotifications').doc(params.dedupeKey).set({
        companyId: params.companyId,
        employeeUserId: params.employeeUserId,
        employeeName: s.employeeName,
        dateLabel: params.dateLabel,
        kind: params.kind,
        attendanceId: params.attendanceId || null,
        createdAt: now,
    });
    // Mark the attendance record so the sweep won't re-notify.
    if (params.attendanceId) {
        try {
            await db.collection('attendance').doc(params.attendanceId).update({
                missedPunchNotified: true,
                missedPunchNotifiedAt: now,
            });
        }
        catch {
            /* record may have been deleted */
        }
    }
}
const dateKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
exports.dateKeyOf = dateKeyOf;
//# sourceMappingURL=missedPunchNotifications.js.map