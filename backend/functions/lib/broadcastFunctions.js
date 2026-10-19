"use strict";
/**
 * COMPANY ADMIN NOTIFICATION & EMAIL BROADCAST
 * ============================================
 * Lets a Company Admin (or Master Admin / scoped Executive / Team Leader) send
 * a secure, individually-addressed email broadcast to employees inside ONE
 * company scope (all active, a department, or a hand-picked set).
 *
 * Guarantees:
 *   - Strict company boundary: recipients are always resolved from the
 *     `employees` collection filtered by the caller's company scope.
 *   - No group visibility: every recipient gets their OWN email via
 *     `sendEmailCentral` (single `to` address — no CC/BCC fan-out).
 *   - Audit trail: per-recipient result stored in `broadcast_jobs`, per-email
 *     records in `email_logs`, plus a `BROADCAST_SENT` audit log entry and an
 *     admin-alert confirmation for the Company Admin(s).
 *   - Real-time in-app notifications: each employee with an app account also
 *     receives an in-app notification.
 */
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
exports.listBroadcastJobs = exports.companyAdminBroadcast = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const emailService_1 = require("./emailService");
const db = () => admin.firestore();
const BROADCAST_TYPES = ['payroll', 'attendance', 'leave', 'general'];
const NOTIFICATION_LINK = {
    payroll: '/salary-slips',
    attendance: '/attendance',
    leave: '/leave',
    general: '/announcements',
};
function broadcastHtml(companyName, message) {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#374151;line-height:1.6;max-width:600px;margin:0 auto;">
      <div style="background:#f97316;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">${companyName || 'HR MAX'}</h2>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
        ${message}
        <p style="color:#9ca3af;font-size:12px;margin-top:20px;">This message is confidential and intended solely for you as an employee of ${companyName || 'your organization'}.</p>
      </div>
    </div>`;
}
async function assertCompanyScope(context, companyId) {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    if (!companyId)
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
    const callerSnap = await db().collection('users').doc(context.auth.uid).get();
    if (!callerSnap.exists)
        throw new functions.https.HttpsError('permission-denied', 'User not found.');
    const caller = callerSnap.data();
    const role = caller?.role;
    const authorized = role === 'master-admin' ||
        (role === 'company-admin' && String(caller?.companyId) === String(companyId)) ||
        ((role === 'executive' || role === 'team-leader') &&
            Array.isArray(caller?.assignedCompanyIds) && caller.assignedCompanyIds.includes(String(companyId))) ||
        ((role === 'executive' || role === 'team-leader') && String(caller?.companyId) === String(companyId));
    if (!authorized) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized to broadcast to this company.');
    }
    return { caller, uid: context.auth.uid };
}
async function getCompanyName(companyId) {
    try {
        const snap = await db().collection('companies').doc(companyId).get();
        return snap.exists ? String(snap.data()?.name || '') : '';
    }
    catch {
        return '';
    }
}
// ============================================
// companyAdminBroadcast — secure company-scoped email broadcast
// ============================================
exports.companyAdminBroadcast = functions
    .runWith({ timeoutSeconds: 300 })
    .https.onCall(async (payload, context) => {
    const companyId = String(payload?.companyId || '');
    const { caller, uid } = await assertCompanyScope(context, companyId);
    const subject = String(payload?.subject || '').trim();
    const message = String(payload?.message || '').trim();
    if (!subject || !message) {
        throw new functions.https.HttpsError('invalid-argument', 'Subject and message are required.');
    }
    const messageType = BROADCAST_TYPES.includes(payload?.messageType) ? payload.messageType : 'general';
    const recipientMode = ['all-active', 'department', 'selected'].includes(payload?.recipientMode)
        ? payload.recipientMode
        : 'all-active';
    const departmentId = payload?.departmentId ? String(payload.departmentId) : null;
    const employeeIds = Array.isArray(payload?.employeeIds) ? payload.employeeIds.map(String) : [];
    const notifyInApp = payload?.notifyInApp !== false;
    // Resolve recipients — strictly inside the company scope.
    const empSnap = await db().collection('employees').where('companyId', '==', companyId).get();
    let employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    employees = employees.filter((e) => e.status === 'Active');
    if (recipientMode === 'department' && departmentId) {
        employees = employees.filter((e) => String(e.departmentId || '') === departmentId);
    }
    if (recipientMode === 'selected' && employeeIds.length > 0) {
        employees = employees.filter((e) => employeeIds.includes(String(e.userId || e.id)));
    }
    employees = employees.filter((e) => e.email && String(e.email).trim());
    if (employees.length === 0) {
        return { success: true, jobId: null, total: 0, dispatched: 0, failed: 0, message: 'No active employees matched the selected scope (all with email addresses).' };
    }
    const companyName = await getCompanyName(companyId);
    const html = broadcastHtml(companyName, message);
    // Roll the job id first so dedup keys and the audit trail are stable.
    const jobRef = db().collection('broadcast_jobs').doc();
    await jobRef.set({
        id: jobRef.id,
        companyId,
        subject,
        messageType,
        recipientMode,
        departmentId,
        total: employees.length,
        dispatched: 0,
        failed: 0,
        recipients: [],
        status: 'in-progress',
        triggeredBy: uid,
        triggeredByName: caller?.name || caller?.email || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    let dispatched = 0;
    let failed = 0;
    let skipped = 0;
    const recipients = [];
    for (const emp of employees) {
        const userId = String(emp.userId || emp.id || '');
        const res = await (0, emailService_1.sendEmailCentral)({
            companyId,
            to: String(emp.email).trim(),
            subject,
            html,
            type: 'alert',
            triggeredBy: uid,
            dedupKey: `broadcast:${jobRef.id}:${userId || emp.email}`,
        });
        if (res.delivered) {
            dispatched++;
        }
        else if (res.skipped) {
            skipped++;
        }
        else {
            failed++;
        }
        recipients.push({
            userId,
            name: emp.name || '',
            email: String(emp.email).trim(),
            status: res.delivered ? 'sent' : res.skipped ? 'skipped' : 'failed',
            error: res.error || '',
            logId: res.logId || null,
        });
        // Real-time in-app notification for employees with an app account.
        if (notifyInApp && userId) {
            await db()
                .collection('notifications')
                .add({
                userId,
                type: 'company_broadcast',
                title: subject,
                body: message.replace(/<[^>]*>/g, '').slice(0, 160) + (message.replace(/<[^>]*>/g, '').length > 160 ? '…' : ''),
                read: false,
                link: NOTIFICATION_LINK[messageType] || '/announcements',
                companyId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
                .catch(() => { });
        }
    }
    await jobRef.update({
        status: 'completed',
        dispatched,
        failed,
        skipped,
        recipients,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Company Admin confirmation alert (real-time) — scoped to the company.
    await db()
        .collection('adminAlerts')
        .add({
        type: 'broadcast',
        title: `Broadcast Sent: ${subject}`,
        body: `Secure email broadcast delivered to ${dispatched} employee(s)${skipped ? ` (${skipped} duplicate-skipped)` : ''}${failed ? `, ${failed} failed` : ''} in ${companyName || 'company'}.`,
        link: '/email-center',
        read: false,
        priority: 'normal',
        companyId,
        companyName,
        actionBy: uid,
        actionByName: caller?.name || caller?.email || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
    await db()
        .collection('audit_logs')
        .add({
        companyId,
        userId: uid,
        userName: caller?.name || '',
        userRole: caller?.role || '',
        userEmail: caller?.email || '',
        action: 'BROADCAST_SENT',
        actionType: 'create',
        module: 'Communications',
        targetEntity: subject,
        targetId: jobRef.id,
        description: `Broadcast "${subject}" (${messageType}) to ${dispatched} employee(s)${failed ? `, ${failed} failed` : ''}`,
        details: `mode=${recipientMode} total=${employees.length} dispatched=${dispatched} failed=${failed}`,
        status: failed > 0 ? 'partial' : 'success',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
    return {
        success: true,
        jobId: jobRef.id,
        total: employees.length,
        dispatched,
        failed,
        skipped,
        companyId,
    };
});
// ============================================
// listBroadcastJobs — confirmation log for the company admins
// ============================================
exports.listBroadcastJobs = functions.https.onCall(async (payload, context) => {
    const companyId = String(payload?.companyId || '');
    await assertCompanyScope(context, companyId);
    const snap = await db().collection('broadcast_jobs').where('companyId', '==', companyId).get();
    const jobs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
    })
        .slice(0, 100);
    return { jobs };
});
//# sourceMappingURL=broadcastFunctions.js.map