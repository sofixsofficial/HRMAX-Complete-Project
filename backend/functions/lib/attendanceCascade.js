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
exports.notifyAttendanceCascade = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const missedPunchNotifications_1 = require("./missedPunchNotifications");
const db = admin.firestore();
const MANAGEMENT_ROLES = ['master-admin', 'company-admin', 'executive', 'team-leader', 'reporting-manager'];
const RECIPIENT_KEYS = ['reporting-manager', 'executive', 'team-leader', 'company-admin', 'master-admin'];
/**
 * Authorize the caller to trigger a cascade for the target employee's company:
 *  - the employee themselves (any self-service kind)
 *  - master-admins (platform-wide)
 *  - management roles related to that same company.
 */
async function assertAuthorized(callerUid, input) {
    // Self-service: the employee can always request a rectification, mark their own
    // missed punch, or log a late check-in. Resolving requires a manager but we let
    // the security rules / data layer enforce the actual update; here we only fan out.
    if (callerUid === input.employeeUserId)
        return;
    const callerDoc = await db.collection('users').doc(callerUid).get();
    const caller = callerDoc.data();
    if (!caller)
        throw new functions.https.HttpsError('not-found', 'Caller not found');
    const callerRole = caller.role;
    if (callerRole === 'master-admin')
        return;
    if (!MANAGEMENT_ROLES.includes(callerRole)) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized to trigger notifications');
    }
    // Same-company management: company-admins / RMs must belong to the company.
    if (callerRole === 'company-admin' || callerRole === 'reporting-manager') {
        if (caller.companyId === input.companyId)
            return;
        throw new functions.https.HttpsError('permission-denied', 'You can only notify within your own company');
    }
    // Executives: assigned to the company.
    if (callerRole === 'executive') {
        const assigned = Array.isArray(caller.assignedCompanyIds) ? caller.assignedCompanyIds : [];
        if (assigned.includes(input.companyId))
            return;
        throw new functions.https.HttpsError('permission-denied', 'You can only notify within your assigned companies');
    }
    // Team leaders: scoped through their linked executives' assigned companies.
    if (callerRole === 'team-leader') {
        const linked = Array.isArray(caller.linkedExecutiveIds)
            ? caller.linkedExecutiveIds
            : (caller.reportingExecutiveId ? [String(caller.reportingExecutiveId)] : []);
        if (caller.companyId === input.companyId)
            return;
        for (const eid of linked) {
            const edoc = await db.collection('users').doc(eid).get();
            const ecomps = Array.isArray(edoc.data()?.assignedCompanyIds) ? edoc.data().assignedCompanyIds : [];
            if (ecomps.includes(input.companyId))
                return;
        }
        throw new functions.https.HttpsError('permission-denied', 'You can only notify within your scoped companies');
    }
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to trigger notifications');
}
function buildMessages(kind, s, input) {
    const date = input.dateLabel || '';
    const actor = input.actorName || 'Manager';
    const note = input.note ? ` ${input.note}` : '';
    switch (kind) {
        case 'missed-punch-marked': {
            const employeeTitle = 'Missed Punch Recorded';
            const employeeBody = `Your ${date} missed punch has been recorded. Please submit a rectification if this is incorrect.`;
            const managerTitle = `Missed Punch: ${s.employeeName}`;
            const managerBody = `${s.employeeName} was marked as missed punch on ${date} by ${actor}.${note}`;
            return { employeeTitle, employeeBody, managerTitle, managerBody, priority: 'high', type: 'missed_punch' };
        }
        case 'rectification-requested': {
            const employeeTitle = 'Rectification Submitted';
            const employeeBody = `Your missed punch rectification for ${date} has been submitted for manager review.`;
            const managerTitle = `Punch Rectification: ${s.employeeName}`;
            const managerBody = `${s.employeeName} requested a missed punch correction for ${date}.${note}`;
            return { employeeTitle, employeeBody, managerTitle, managerBody, priority: 'normal', type: 'punch_rectification_requested' };
        }
        case 'rectification-resolved': {
            const employeeTitle = 'Missed Punch Resolved';
            const employeeBody = `${actor} resolved your ${date} missed punch correction. ${note.trim() || 'Your attendance has been updated.'}`;
            const managerTitle = `Rectification Resolved: ${s.employeeName}`;
            const managerBody = `${s.employeeName}'s ${date} missed punch rectification was resolved by ${actor}.${note}`;
            return { employeeTitle, employeeBody, managerTitle, managerBody, priority: 'normal', type: 'punch_rectification_resolved' };
        }
        case 'late-checkin': {
            const employeeTitle = 'Late Check-In';
            const employeeBody = `Your late check-in on ${date} has been recorded.${note}`;
            const managerTitle = `Late Check-In: ${s.employeeName}`;
            const managerBody = `${s.employeeName} checked in late on ${date}.${note}`;
            return { employeeTitle, employeeBody, managerTitle, managerBody, priority: 'normal', type: 'attendance_late' };
        }
    }
}
/**
 * Callable: cascade a notification for a real-time attendance event (
 * missed punch marked / rectification requested / rectification resolved /
 * late check-in) to every authorized supervisor within the SAME company:
 * the employee's Reporting Manager, Company Admin, assigned Executive(s),
 * linked Team Leader(s) and Master Admins. Runs server-side with admin
 * privileges so it can read the whole chain regardless of Firestore rules,
 * and never leaks across companies. Written notifications feed the existing
 * `onNotificationCreated` push-forwarder automatically.
 */
exports.notifyAttendanceCascade = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
    }
    const input = {
        companyId: String(data?.companyId || ''),
        employeeUserId: String(data?.employeeUserId || ''),
        employeeName: data?.employeeName ? String(data.employeeName) : '',
        kind: data?.kind,
        dateLabel: data?.dateLabel ? String(data.dateLabel) : '',
        note: data?.note ? String(data.note) : '',
        actorName: data?.actorName ? String(data.actorName) : '',
    };
    if (!input.companyId || !input.employeeUserId || !input.kind) {
        throw new functions.https.HttpsError('invalid-argument', 'companyId, employeeUserId and kind are required');
    }
    if (!['missed-punch-marked', 'rectification-requested', 'rectification-resolved', 'late-checkin'].includes(input.kind)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid kind');
    }
    try {
        await assertAuthorized(context.auth.uid, input);
        const s = await (0, missedPunchNotifications_1.resolveMissedPunchStakeholders)(input.companyId, input.employeeUserId, input.employeeName || '');
        const { employeeTitle, employeeBody, managerTitle, managerBody, priority, type } = buildMessages(input.kind, s, input);
        const now = admin.firestore.FieldValue.serverTimestamp();
        // Employee-facing notification.
        await db.collection('notifications').add({
            userId: s.employeeUserId,
            companyId: input.companyId,
            type,
            title: employeeTitle,
            body: employeeBody,
            read: false,
            link: '/attendance',
            createdAt: now,
        });
        // Same-company management cascade (deduped).
        const recipients = new Map();
        for (const key of RECIPIENT_KEYS) {
            const ids = ATTR_IDS[key](s);
            for (const id of ids) {
                if (id && id !== s.employeeUserId)
                    recipients.set(id, key);
            }
        }
        for (const recipientId of recipients.keys()) {
            await db.collection('notifications').add({
                userId: recipientId,
                companyId: input.companyId,
                type,
                title: managerTitle,
                body: managerBody,
                read: false,
                link: '/attendance',
                createdAt: now,
            });
        }
        // Dashboard admin alert (same company scope).
        await db.collection('adminAlerts').add({
            companyId: input.companyId,
            type,
            title: managerTitle,
            body: managerBody,
            link: '/attendance',
            read: false,
            priority,
            createdAt: now,
        });
        return {
            success: true,
            employeeUserId: s.employeeUserId,
            executiveIds: s.executiveIds,
            teamLeaderIds: s.teamLeaderIds,
            companyAdminIds: s.companyAdminIds,
            reportingManagerId: s.reportingManagerId,
        };
    }
    catch (err) {
        if (err instanceof functions.https.HttpsError)
            throw err;
        functions.logger.error('notifyAttendanceCascade failed', { error: err });
        throw new functions.https.HttpsError('internal', err?.message || 'Failed to cascade notification');
    }
});
const ATTR_IDS = {
    'reporting-manager': (s) => (s.reportingManagerId ? [s.reportingManagerId] : []),
    'executive': (s) => s.executiveIds,
    'team-leader': (s) => s.teamLeaderIds,
    'company-admin': (s) => s.companyAdminIds,
    'master-admin': (s) => s.masterAdminIds,
};
//# sourceMappingURL=attendanceCascade.js.map