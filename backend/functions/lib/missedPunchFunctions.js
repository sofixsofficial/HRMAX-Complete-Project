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
exports.migrateLegacyMissedPunchApplicantRoles = exports.onMissedPunchAttendanceUpdated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const missedPunchNotifications_1 = require("./missedPunchNotifications");
const db = admin.firestore();
// Standardized sequential verification chain matching the leave hierarchy:
//   Employee  → 4-tier: Reporting Manager → Company Admin → Executive → Team Leader
//   RM / HR   → 3-tier: Company Admin → Executive → Team Leader  (RM self-tier auto-completes)
//   Executive → 2-tier: Team Leader → Master Admin  (RM/CA/Exec auto-complete, TL active)
//   Team Lead → 1-tier: Master Admin  (all tiers auto-complete, direct MA gate)
const TIER_ORDER = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
const TIER_LABELS = {
    reportingManager: 'Reporting Manager',
    companyAdmin: 'Company Admin',
    executive: 'Executive',
    teamLeader: 'Team Leader',
    masterAdmin: 'Master Admin',
};
const INITIAL_APPROVAL_STATUS = {
    reportingManager: 'Pending',
    companyAdmin: 'Pending',
    executive: 'Pending',
    teamLeader: 'Pending',
};
function computeMissedPunchFlags(approvalStatus) {
    const s = approvalStatus || {};
    return {
        reportingManagerApproved: s.reportingManager === 'Approved',
        companyAdminApproved: s.companyAdmin === 'Approved',
        executiveApproved: s.executive === 'Approved',
        teamLeaderApproved: s.teamLeader === 'Approved',
    };
}
function computeMissedPunchCount(approvalStatus) {
    const s = approvalStatus || {};
    return TIER_ORDER.filter((t) => s[t] === 'Approved' || s[t] === 'Rejected').length;
}
/** Roles whose personal missed-punch self-service requests route to a Master
 * Admin for final oversight (they are themselves registered employees). */
const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);
/** Resolve the applicant's role authoritatively from the users doc. */
async function resolveApplicantRoleServer(userId) {
    try {
        const d = await db.collection('users').doc(userId).get();
        if (d.exists) {
            const u = d.data() || {};
            if (u.role === 'team-leader' || u.role === 'executive')
                return String(u.role);
            // HR manager roles are treated as Reporting Manager for tier computation.
            if (u.role === 'reporting-manager' || u.role === 'hr-manager')
                return 'reporting-manager';
        }
    }
    catch { /* best-effort */ }
    return 'employee';
}
/** Final missed-punch status with the Master Admin gate applied, mirroring the
 * web service `computeOverallMissedPunchStatus`. A rejected tier OR rejected
 * Master Admin => Rejected; otherwise Pending until all active tiers AND (if
 * required) the Master Admin approve. */
function computeMissedPunchOverallStatus(approvalStatus, masterAdminRequired, masterAdminApproveStatus) {
    const s = approvalStatus || {};
    for (const t of TIER_ORDER) {
        if (s[t] === 'Rejected')
            return 'Rejected';
    }
    if (masterAdminRequired && masterAdminApproveStatus === 'Rejected')
        return 'Rejected';
    if (!TIER_ORDER.every((t) => s[t] === 'Approved'))
        return 'Pending';
    if (masterAdminRequired) {
        return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
    }
    return 'Approved';
}
/** Server-side reconciliation of the self-management tier skips, so the chain
 * holds even when a stale/older client writes only the applicant's tier.
 * - Team Leader self-app: every tier auto-approved → single-step Master Admin.
 * - Executive self-app: Admin + Executive tiers auto-approved, but the
 *   teamLeader tier is LEFT LIVE so the assigned Team Leader reviews
 *   (Executive → Team Leader → Master Admin). */
function autoSkipSelfManagementTier(role, approvalStatus) {
    if (role === 'team-leader') {
        // TL self-app: all tiers auto-approved → direct Master Admin gate.
        for (const t of TIER_ORDER) {
            if (approvalStatus[t] === 'Pending')
                approvalStatus[t] = 'Approved';
        }
    }
    else if (role === 'executive') {
        // Executive self-app: RM/CA/Exec auto-complete, Team Leader must still review.
        for (const t of TIER_ORDER) {
            if (t !== 'teamLeader' && approvalStatus[t] === 'Pending')
                approvalStatus[t] = 'Approved';
        }
    }
    else if (role === 'reporting-manager') {
        // RM self-app: their own Reporting Manager tier auto-completes.
        if (approvalStatus.reportingManager === 'Pending')
            approvalStatus.reportingManager = 'Approved';
    }
}
/** Format a Firestore Timestamp / Date / string into a short date label. */
function toDateLabel(value) {
    if (!value)
        return '';
    try {
        const d = typeof value.toDate === 'function'
            ? value.toDate()
            : new Date(value);
        return isNaN(d.getTime())
            ? ''
            : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    catch {
        return '';
    }
}
function nowTs() {
    return admin.firestore.FieldValue.serverTimestamp();
}
/**
 * Fan out a missed-punch rectification notification to the employee's full
 * same-company management chain (Reporting Manager, Company Admin, assigned
 * Executive(s), linked Team Leader(s), Master Admin) plus a dashboard admin
 * alert — mirroring `notifyMissedPunchToStakeholders`.
 */
async function cascadeMissedPunch(companyId, employeeUserId, employeeName, dateLabel, kind, actorName, note) {
    const s = await (0, missedPunchNotifications_1.resolveMissedPunchStakeholders)(companyId, employeeUserId, employeeName || '');
    const now = nowTs();
    const titleFor = (target) => {
        switch (kind) {
            case 'submitted': return `Punch Rectification: ${s.employeeName}`;
            case 'tier-approved': return `Missed Punch Verified: ${s.employeeName}`;
            case 'tier-rejected': return `Missed Punch Rejected: ${s.employeeName}`;
            case 'resolved': return `Rectification Resolved: ${s.employeeName}`;
            default: return `Missed Punch: ${s.employeeName}`;
        }
    };
    const bodyFor = (target) => {
        const suffix = note ? ` ${note}` : '';
        switch (kind) {
            case 'submitted': return `${s.employeeName} submitted a missed punch correction for ${dateLabel}.${suffix}`;
            case 'tier-approved': return `${actorName} verified ${s.employeeName}'s missed punch for ${dateLabel}.${suffix}`;
            case 'tier-rejected': return `${actorName} rejected ${s.employeeName}'s missed punch for ${dateLabel}.${suffix}`;
            case 'resolved': return `${actorName} resolved ${s.employeeName}'s missed punch for ${dateLabel}.${suffix}`;
            default: return `${s.employeeName} missed their punch on ${dateLabel}.${suffix}`;
        }
    };
    const type = kind === 'tier-rejected' || kind === 'tier-approved' || kind === 'resolved'
        ? 'punch_rectification_resolved'
        : 'punch_rectification_requested';
    const priority = kind === 'submitted' ? 'normal' : kind === 'resolved' ? 'high' : 'normal';
    const employeeTitle = kind === 'submitted'
        ? 'Rectification Submitted'
        : kind === 'resolved' ? 'Missed Punch Resolved' : `Missed Punch: ${s.employeeName}`;
    const employeeBody = kind === 'submitted'
        ? `Your missed punch correction for ${dateLabel} has been submitted for supervisor verification.`
        : kind === 'resolved'
            ? `${actorName} resolved your missed punch correction for ${dateLabel}.${note ? ` ${note}` : ''}`
            : `Your ${dateLabel} missed punch correction was updated.`;
    // Employee
    await db.collection('notifications').add({
        userId: s.employeeUserId, companyId, type,
        title: employeeTitle, body: employeeBody, read: false, link: '/attendance', createdAt: now,
    }).catch(() => { });
    // Same-company management chain (deduped).
    const recipients = new Map();
    const keys = [
        ['reporting-manager', s.reportingManagerId ? [s.reportingManagerId] : []],
        ['executive', s.executiveIds],
        ['team-leader', s.teamLeaderIds],
        ['company-admin', s.companyAdminIds],
        ['master-admin', s.masterAdminIds],
    ];
    for (const [role, ids] of keys) {
        for (const id of ids) {
            if (id && id !== s.employeeUserId)
                recipients.set(String(id), role);
        }
    }
    for (const [recipientId] of recipients) {
        await db.collection('notifications').add({
            userId: recipientId, companyId, type,
            title: titleFor(recipientId), body: bodyFor(recipientId), read: false, link: '/attendance', createdAt: now,
        }).catch(() => { });
    }
    // Dashboard admin alert.
    await db.collection('adminAlerts').add({
        companyId, type, title: titleFor('x'), body: bodyFor('x'), link: '/attendance', read: false, priority, createdAt: now,
    }).catch(() => { });
}
/**
 * When the corrected checkout is applied (all tiers approved), recompute
 * workHours / overtime and set the attendance to the verified Approved state
 * exactly like the client-side helper, so the outcome is authoritative server-side.
 */
async function applyMissedPunchResolution(attendanceId, corrected, approvedByName, remark) {
    const ref = db.collection('attendance').doc(attendanceId);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists)
        return;
    const data = snap.data();
    const correctedDate = corrected.toDate
        ? corrected.toDate()
        : new Date(corrected);
    const checkIn = data.checkIn && data.checkIn.toDate
        ? data.checkIn.toDate()
        : new Date();
    const workHours = (correctedDate.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    const shiftEndStr = data.shiftEnd || '18:00';
    let overtimeHours = 0;
    const otThresholdMinutes = 30;
    const [endH, endM] = shiftEndStr.split(':').map(Number);
    const shiftEndToday = new Date(correctedDate);
    shiftEndToday.setHours(endH, endM, 0, 0);
    if (correctedDate > shiftEndToday) {
        const diffMinutes = (correctedDate.getTime() - shiftEndToday.getTime()) / (1000 * 60);
        if (diffMinutes > otThresholdMinutes)
            overtimeHours = Math.round((diffMinutes / 60) * 100) / 100;
    }
    await ref.update({
        checkOut: correctedDate,
        workHours: Math.round(workHours * 100) / 100,
        overtimeHours,
        status: 'Approved',
        approved: true,
        isAutoApproved: true,
        approvedByName,
        approvedOn: nowTs(),
    }).catch(() => { });
}
/**
 * Firestore trigger on the attendance collection. Reacts only to changes in the
 * nested `missedPunchRectification` sub-document (requested / approvalStatus).
 *  1. Reconciles the flat per-tier flags + approvalCount + overall status
 *     server-side (authoritative regardless of which client wrote).
 *  2. Stamps authoritative `approverIds` resolved from the employee's company
 *     chain (RM auth-uid resolution etc.).
 *  3. Fans out to the same-company management chain on request and on reaching
 *     a final (Approved / Rejected) status, applying the corrected checkout on
 *     full verification.
 */
exports.onMissedPunchAttendanceUpdated = functions.firestore
    .document('attendance/{attendanceId}')
    .onUpdate(async (change) => {
    const after = change.after.data();
    const before = change.before.data();
    if (!after)
        return;
    const mp = after.missedPunchRectification;
    const mpBefore = before.missedPunchRectification;
    // Skip when nothing about the rectification changed (ordinary check-in/out).
    const requestedChanged = (mp?.requested ?? false) !== (mpBefore?.requested ?? false);
    const statusChanged = (mp?.status ?? '') !== (mpBefore?.status ?? '');
    const approvalChanged = JSON.stringify(mp?.approvalStatus || {}) !== JSON.stringify(mpBefore?.approvalStatus || {});
    if (!requestedChanged && !statusChanged && !approvalChanged)
        return;
    const companyId = String(after.companyId || '');
    const employeeUserId = String(after.userId || '');
    const employeeName = String(after.name || 'An employee');
    // Reconcile flags + count + overall status server-side. Resolve the
    // applicant's management chain so the Master Admin gate and approverIds can
    // be stamped authoritatively.
    let s = null;
    try {
        s = await (0, missedPunchNotifications_1.resolveMissedPunchStakeholders)(companyId, employeeUserId, employeeName);
    }
    catch {
        /* best-effort */
    }
    const approvalStatus = mp?.approvalStatus || { ...INITIAL_APPROVAL_STATUS };
    // Auto-skip the Reporting Manager tier when no RM is assigned to the
    // employee (mirrors the leave chain: unassigned RM → skip) OR when the
    // applicant is themselves a Reporting Manager / HR Manager applying for
    // their own correction (their own tier always auto-completes, matching the
    // web service — regardless of how reportingManagerId is stored).
    if (approvalStatus.reportingManager !== 'Approved') {
        let isRmSelfApp = false;
        try {
            const uDoc = await db.collection('users').doc(employeeUserId).get();
            if (uDoc.exists) {
                const u = uDoc.data() || {};
                isRmSelfApp = u.role === 'reporting-manager' || u.role === 'hr-manager'
                    || u.isReportingManager === true || u.isHRManager === true;
            }
        }
        catch { /* best-effort */ }
        const unassignedRm = !s?.reportingManagerId || s?.reportingManagerId === employeeUserId;
        if (unassignedRm || isRmSelfApp)
            approvalStatus.reportingManager = 'Approved';
    }
    // Master Admin gate: Team Leaders & Executives are registered employees, so
    // their personal missed-punch corrections route to a Master Admin for final
    // oversight. Auto-skip the applicant's own tier and resolve the MA fields
    // authoritatively (matching the client service).
    const applicantRole = await resolveApplicantRoleServer(employeeUserId);
    const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
    await autoSkipSelfManagementTier(applicantRole, approvalStatus);
    const masterAdminApproverId = masterAdminRequired ? (s && s.masterAdminIds[0]) || '' : '';
    const flags = computeMissedPunchFlags(approvalStatus);
    const masterAdminApproveStatus = masterAdminRequired
        ? String(mp?.masterAdminApproveStatus || 'Pending')
        : undefined;
    const overallStatus = computeMissedPunchOverallStatus(approvalStatus, masterAdminRequired, masterAdminApproveStatus);
    const patch = {
        'missedPunchRectification.approvalStatus': approvalStatus,
        'missedPunchRectification.approvalCount': computeMissedPunchCount(approvalStatus),
        'missedPunchRectification.status': overallStatus,
        'missedPunchRectification.applicantRole': applicantRole,
        'missedPunchRectification.masterAdminRequired': masterAdminRequired,
        'missedPunchRectification.masterAdminApproverId': masterAdminApproverId,
    };
    // CRITICAL: only stamp the Master Admin status when the gate applies —
    // Firestore rejects `undefined` values, and including this key with
    // `undefined` made EVERY non-management (regular employee) reconciliation
    // throw "Cannot use undefined as a Firestore value", silently swallowed by
    // the .catch below → approvalCount/flags/status were never reconciled.
    if (masterAdminRequired) {
        patch['missedPunchRectification.masterAdminApproveStatus'] = masterAdminApproveStatus;
    }
    for (const [k, v] of Object.entries(flags))
        patch[`missedPunchRectification.${k}`] = v;
    await db.collection('attendance').doc(change.after.id).update(patch).catch((e) => console.error('[missedPunch] reconciliation update failed', change.after.id, e));
    const dateLabel = toDateLabel(after.date);
    // Stamp authoritative approverIds (single source of truth for the chain).
    // EVERY tier resolves from the server-side stakeholder chain and overrides
    // any client-stamped value. In particular the Team Leader tier must NOT
    // keep a stale / arbitrary fallback written at request time — otherwise an
    // Executive-approved RM / HR submission would route to the wrong user and
    // never land in the *assigned* Team Leader's pending queue. The authoritative
    // resolution (exec-linked Team Leader) always wins.
    const resolvedApprovers = {
        reportingManager: (s && s.reportingManagerId) || '',
        companyAdmin: (s && s.companyAdminIds[0]) || '',
        executive: (s && s.executiveIds[0]) || '',
        teamLeader: (s && s.teamLeaderIds[0]) || '',
    };
    try {
        const currentAp = mp?.approverIds || {};
        const apPatch = {
            'missedPunchRectification.approverIds.reportingManager': resolvedApprovers.reportingManager || String(currentAp.reportingManager || ''),
            'missedPunchRectification.approverIds.companyAdmin': resolvedApprovers.companyAdmin || String(currentAp.companyAdmin || ''),
            'missedPunchRectification.approverIds.executive': resolvedApprovers.executive || String(currentAp.executive || ''),
            'missedPunchRectification.approverIds.teamLeader': resolvedApprovers.teamLeader || String(currentAp.teamLeader || ''),
        };
        // Same undefined-guard as the reconciliation patch: only stamp the MA
        // approver when the gate applies (see note above).
        if (masterAdminRequired) {
            apPatch['missedPunchRectification.approverIds.masterAdmin'] = masterAdminApproverId;
        }
        await db.collection('attendance').doc(change.after.id).update(apPatch).catch((e) => console.error('[missedPunch] approverIds stamp failed', change.after.id, e));
    }
    catch {
        /* best-effort */
    }
    // --- Workflow routing state ----------------
    // currentTier + assignee are the single place consumers can read "who is
    // next" for a pending rectification. They are recomputed on every trigger so
    // the chain can never stall after a tier advances (e.g. Executive approve
    // -> Team Leader pending). Resolved from the reconciled approvalStatus and
    // the authoritative approverIds above.
    const approvedAp = { ...resolvedApprovers };
    try {
        const currentAp = mp?.approverIds || {};
        for (const t of TIER_ORDER) {
            if (!approvedAp[t] && currentAp[t])
                approvedAp[t] = String(currentAp[t]);
        }
        if (masterAdminRequired)
            approvedAp.masterAdmin = masterAdminApproverId;
    }
    catch { /* best-effort */ }
    let routingTier = null;
    let routingAssignee = '';
    const pendingTier = TIER_ORDER.find((t) => approvalStatus[t] === 'Pending');
    if (pendingTier) {
        routingTier = pendingTier;
        routingAssignee = approvedAp[pendingTier] || '';
    }
    else if (masterAdminRequired && masterAdminApproveStatus !== 'Approved' && masterAdminApproveStatus !== 'Rejected') {
        routingTier = 'masterAdmin';
        routingAssignee = masterAdminApproverId || '';
    }
    await db.collection('attendance').doc(change.after.id).update({
        'missedPunchRectification.currentTier': routingTier,
        'missedPunchRectification.assignee': routingAssignee,
    }).catch(() => { });
    // --- Route-to-next-tier notification ----------------
    // The submission + final-status fan-outs below don't cover an intermediate
    // tier advance (e.g. Executive approves an RM/HR request and the request is
    // still Pending). Without this the assigned Team Leader is never told the
    // rectification is waiting on them. Only fire for an actual tier action
    // (not the initial request, not a final resolution).
    if (approvalChanged && !requestedChanged && !statusChanged && routingTier && routingAssignee && routingAssignee !== employeeUserId && !mp.resolved) {
        await db.collection('notifications').add({
            userId: routingAssignee,
            companyId,
            type: 'punch_rectification_requested',
            title: `Missed Punch Awaiting Your Review: ${employeeName}`,
            body: `${employeeName}'s missed punch rectification for ${dateLabel} is now at the ${TIER_LABELS[routingTier] || routingTier} step and awaits your decision.`,
            read: false,
            link: '/attendance',
            createdAt: nowTs(),
        }).catch(() => { });
    }
    const corrected = mp?.correctedCheckOut;
    // On submitted: notify the whole same-company chain.
    if (requestedChanged && mp?.requested === true && !mp?.resolved) {
        await cascadeMissedPunch(companyId, employeeUserId, employeeName, dateLabel, 'submitted', employeeName, String(mp.employeeRemark || '')).catch((err) => functions.logger.error('missed punch submitted cascade failed', { id: change.after.id, error: err }));
    }
    // On final status reached: fan out + apply the corrected checkout when approved.
    if (statusChanged && (overallStatus === 'Approved' || overallStatus === 'Rejected') && mp?.requested) {
        const finalNote = Array.isArray(mp.approvalLog)
            ? String(mp.approvalLog[mp.approvalLog.length - 1]?.note || '')
            : '';
        await cascadeMissedPunch(companyId, employeeUserId, employeeName, dateLabel, overallStatus === 'Approved' ? 'resolved' : 'tier-rejected', overallStatus === 'Approved' ? 'All verification levels' : 'A verification level', finalNote || String(mp.remark || '')).catch((err) => functions.logger.error('missed punch final cascade failed', { id: change.after.id, error: err }));
        if (overallStatus === 'Approved' && corrected) {
            await applyMissedPunchResolution(change.after.id, corrected, 'All verification levels', finalNote || String(mp.remark || ''));
        }
    }
});
/**
 * One-shot re-stamp for legacy missed-punch rectification records.
 *
 * Legacy docs created before the RM/HR 3-tier fix may carry a stale
 * `applicantRole` (e.g. 'employee') and/or a ghost
 * `approverIds.reportingManager` + `approvalStatus.reportingManager: 'Approved'`
 * stamp, so the frontend modal renders a "4/4 + ghost Reporting Manager" chain
 * even though HR / Reporting Manager applicants should show 3/3
 * (Company Admin → Executive → Team Leader, RM self-tier auto-completed).
 *
 * For every still in-flight (Pending) HR / Reporting Manager application this
 *  1. re-stamps `applicantRole` with the authoritative user-doc role
 *     ('reporting-manager' or 'hr-manager'),
 *  2. auto-completes the applicant's own Reporting Manager tier
 *     (`approvalStatus.reportingManager = 'Approved'`) and removes the ghost
 *     `approverIds.reportingManager`,
 *  3. leaves the remaining tiers (companyAdmin → executive → teamLeader) intact.
 *
 * Fully-Approved (correctedCheckOut applied) and Rejected records are never
 * touched. The attendance onUpdate trigger may additionally reconcile flags /
 * counts / currentTier when the RM tier actually changes — existing behavior.
 */
exports.migrateLegacyMissedPunchApplicantRoles = functions
    .runWith({ timeoutSeconds: 540 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in');
    }
    if (!data || data.confirm !== true) {
        throw new functions.https.HttpsError('invalid-argument', 'Pass { confirm: true } to acknowledge this migration');
    }
    const callerSnap = await db.collection('users').doc(context.auth.uid).get();
    if (!callerSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Caller not found');
    }
    const caller = callerSnap.data() || {};
    const callerRole = String(caller.role || '');
    const allowed = callerRole === 'master-admin' ||
        callerRole === 'reporting-manager' ||
        callerRole === 'hr-manager';
    if (!allowed) {
        throw new functions.https.HttpsError('permission-denied', 'Only Master Admin / Reporting Manager / HR Manager can run this migration');
    }
    let companyId = '';
    if (data.companyId !== undefined && data.companyId !== null && String(data.companyId).trim() !== '') {
        companyId = String(data.companyId).trim();
        if (callerRole !== 'master-admin' && companyId !== String(caller.companyId || '')) {
            throw new functions.https.HttpsError('permission-denied', 'You can only migrate records inside your own company');
        }
    }
    else if (callerRole !== 'master-admin') {
        companyId = String(caller.companyId || '');
    }
    let scanned = 0;
    let migrated = 0;
    let skipped = 0;
    const reasons = {};
    const baseQuery = db.collection('attendance')
        .where('missedPunchRectification.requested', '==', true);
    let cursor = null;
    for (;;) {
        let q = baseQuery.limit(200);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty)
            break;
        for (const doc of snap.docs) {
            scanned++;
            const d = doc.data();
            if (companyId && String(d.companyId || '') !== companyId) {
                skipped++;
                reasons.scopedOut = (reasons.scopedOut || 0) + 1;
                continue;
            }
            const mp = d.missedPunchRectification;
            if (!mp || mp.requested !== true) {
                skipped++;
                reasons.notRequested = (reasons.notRequested || 0) + 1;
                continue;
            }
            // Conservative: only Pending / in-flight records. Never touch records
            // that already reached a final state (fully Approved with the corrected
            // checkout applied, or Rejected).
            if (mp.status === 'Rejected' || mp.status === 'Approved' || mp.resolved === true) {
                skipped++;
                reasons.finalized = (reasons.finalized || 0) + 1;
                continue;
            }
            const applicantUserId = String(d.userId || '');
            if (!applicantUserId) {
                skipped++;
                reasons.noApplicantUser = (reasons.noApplicantUser || 0) + 1;
                continue;
            }
            const userSnap = await db.collection('users').doc(applicantUserId).get();
            if (!userSnap.exists) {
                skipped++;
                reasons.noApplicantUser = (reasons.noApplicantUser || 0) + 1;
                continue;
            }
            const realRole = String(userSnap.data()?.role || '');
            if (realRole !== 'reporting-manager' && realRole !== 'hr-manager') {
                skipped++;
                reasons.notManagerApplicant = (reasons.notManagerApplicant || 0) + 1;
                continue;
            }
            await doc.ref.update({
                'missedPunchRectification.applicantRole': realRole,
                'missedPunchRectification.approvalStatus.reportingManager': 'Approved',
                'missedPunchRectification.approverIds.reportingManager': admin.firestore.FieldValue.delete(),
            });
            migrated++;
        }
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.size < 200)
            break;
    }
    functions.logger.info('missedPunch rectification legacy migration complete', {
        companyId: companyId || 'all',
        scanned,
        migrated,
        skipped,
        reasons,
    });
    return {
        success: true,
        message: `Migrated ${migrated} legacy missed-punch rectification record(s)`,
        scanned,
        migrated,
        skipped,
        reasons,
    };
});
//# sourceMappingURL=missedPunchFunctions.js.map