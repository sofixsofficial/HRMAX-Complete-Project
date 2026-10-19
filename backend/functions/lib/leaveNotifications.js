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
exports.resolveLeaveStakeholders = void 0;
exports.notifyLeaveToStakeholders = notifyLeaveToStakeholders;
const admin = __importStar(require("firebase-admin"));
const stakeholderResolver_1 = require("./stakeholderResolver");
const db = admin.firestore();
/**
 * Resolve every stakeholder who must be notified about a leave event, scoped
 * strictly to the employee's company and its permission hierarchy.
 * Shared implementation: see `resolveManagementStakeholders`.
 */
exports.resolveLeaveStakeholders = stakeholderResolver_1.resolveManagementStakeholders;
const ATTR_KEYS = {
    'reporting-manager': (s) => (s.reportingManagerId ? [s.reportingManagerId] : []),
    'executive': (s) => s.executiveIds,
    'team-leader': (s) => s.teamLeaderIds,
    'company-admin': (s) => s.companyAdminIds,
    'master-admin': (s) => s.masterAdminIds,
};
function buildMessages(kind, s, leave) {
    const typePrefix = {
        applied: 'leave_applied',
        approved: 'leave_approved',
        rejected: 'leave_rejected',
    }[kind];
    if (kind === 'applied') {
        return {
            employee: {
                type: 'leave_applied',
                title: 'Leave Request Submitted',
                body: `Your ${leave.leaveType} leave (${leave.totalDays} day(s)) has been submitted and is pending approval.`,
            },
            manager: {
                type: 'leave_pending_review',
                title: `Pending Leave: ${s.employeeName}`,
                body: `${s.employeeName} applied for ${leave.leaveType} leave (${leave.totalDays} day(s), ${leave.startDateLabel} to ${leave.endDateLabel}). Review required.`,
            },
        };
    }
    const approved = kind === 'approved';
    return {
        employee: {
            type: typePrefix,
            title: approved ? 'Leave Approved' : 'Leave Rejected',
            body: approved
                ? `Your ${leave.leaveType} leave request has been fully approved.`
                : `Your ${leave.leaveType} leave request was rejected. ${leave.reviewNote ? `Reason: ${leave.reviewNote}` : ''}`,
        },
        manager: {
            type: typePrefix,
            title: approved ? `Leave Approved: ${s.employeeName}` : `Leave Rejected: ${s.employeeName}`,
            body: `${s.employeeName}'s ${leave.leaveType} leave was ${approved ? 'approved' : 'rejected'}.`,
        },
    };
}
/**
 * Notify every stakeholder about a leave event:
 *   applied  -> employee (confirmation) + RM, Executive, TL, Company Admin, Master Admin (pending review)
 *   approved / rejected -> employee + all management stakeholders
 * Also writes a dashboard `adminAlerts` entry. Written notifications are
 * automatically converted to mobile push by `onNotificationCreated`.
 */
async function notifyLeaveToStakeholders(params, preResolved) {
    const s = preResolved ?? await (0, exports.resolveLeaveStakeholders)(params.companyId, params.employeeUserId, params.employeeName);
    const { employee, manager } = buildMessages(params.kind, s, params.leave);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('notifications').add({
        userId: s.employeeUserId,
        companyId: params.companyId,
        type: employee.type,
        title: employee.title,
        body: employee.body,
        read: false,
        link: params.link,
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
            type: manager.type,
            title: manager.title,
            body: manager.body,
            read: false,
            link: params.link,
            createdAt: now,
        });
    }
    await db.collection('adminAlerts').add({
        companyId: params.companyId,
        type: manager.type,
        title: manager.title,
        body: manager.body,
        link: params.link,
        read: false,
        priority: params.kind === 'applied' ? 'normal' : 'high',
        createdAt: now,
    });
}
//# sourceMappingURL=leaveNotifications.js.map