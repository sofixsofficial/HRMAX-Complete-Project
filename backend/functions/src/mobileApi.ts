/**
 * MOBILE API CLOUD FUNCTIONS
 * ===========================
 * Callable functions for the mobile app to perform write operations.
 * Since the Firestore rules are LOCKED (all client writes denied),
 * the mobile app must go through these Cloud Functions which use
 * the Admin SDK to bypass the rules.
 *
 * Every function verifies authentication and role-based permissions
 * before performing the write.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const auth = admin.auth();

// ============================================
// HELPER: Verify authenticated user
// ============================================
function assertAuth(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }
  return context.auth;
}

// ============================================
// LEAVE REQUESTS
// ============================================

/** Create a leave request (mobile → Admin SDK bypass) */
export const mobileCreateLeaveRequest = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { leaveData } = data;
  if (!leaveData || !leaveData.userId || !leaveData.companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing leave data');
  }

  // Verify the caller is creating for themselves or has management role
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  const isManagement = ['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole);

  if (leaveData.userId !== context.auth!.uid && !isManagement) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot create leave for another user');
  }

  const docRef = await db.collection('leaveRequests').add({
    ...leaveData,
    // Stamp an authoritative applied-on timestamp (mirrors the web client's
    // `appliedOn: serverTimestamp()`). Without it, orderBy('appliedOn') queries
    // silently drop the document, so mobile-applied leave would be invisible on
    // both the website approvals panel and the mobile leave list.
    appliedOn: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

// ── Shared multi-tier helpers (mirrors web leaveService / attendanceService) ──
const TIER_ORDER = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
const TIER_LABELS: Record<string, string> = {
  reportingManager: 'Reporting Manager',
  companyAdmin: 'Company Admin',
  executive: 'Executive',
  teamLeader: 'Team Leader',
};
const TIER_ROLES: Record<string, string[]> = {
  reportingManager: ['reporting-manager', 'hr-manager'],
  companyAdmin: ['company-admin'],
  executive: ['executive'],
  teamLeader: ['team-leader'],
};

/** Update leave request status (approve/reject at a tier) */
export const mobileReviewLeaveTier = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { leaveId, tier, action, reviewNote } = data;
  if (!leaveId || !tier || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }
  if (!TIER_ORDER.includes(tier)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown approval tier');
  }
  if (action === 'Rejected' && (!reviewNote || !String(reviewNote).trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'A mandatory remark is required to reject');
  }

  const docRef = db.collection('leaveRequests').doc(leaveId);
  const snap = await docRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Leave request not found');

  const leave = snap.data()!;
  const approvalStatus = leave.approvalStatus || {};
  const approvalLog = leave.approvalLog || [];

  // Sequential gate (web reviewTierLeaveRequest parity): the tier must still be
  // Pending and every earlier tier must already be Approved before this one can
  // act — enforces the RM → CA → Exec → TL order server-side.
  if (approvalStatus[tier] && approvalStatus[tier] !== 'Pending') {
    throw new functions.https.HttpsError('failed-precondition', `This tier has already been ${approvalStatus[tier]}`);
  }
  for (let i = 0; i < TIER_ORDER.indexOf(tier); i++) {
    const prev = TIER_ORDER[i];
    if (approvalStatus[prev] !== 'Approved') {
      throw new functions.https.HttpsError('failed-precondition', `${TIER_LABELS[prev]} must verify first`);
    }
  }

  // Authorization — mirrors firestore.rules / web direct writes: allow the
  // stamped approver, any master-admin, or (when the stamp is stale/empty) the
  // natural role holder for this tier within the same company.
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const caller = callerDoc.data() || {};
  const callerRole = caller.role || '';
  const approverIds = leave.approverIds || {};
  const stamp = String(approverIds[tier] || '');
  const isStamped = stamp === context.auth!.uid;
  const isMa = callerRole === 'master-admin';
  const isNaturalRoleHolder =
    (TIER_ROLES[tier] || []).includes(callerRole) &&
    (!leave.companyId || !caller.companyId || leave.companyId === caller.companyId);
  if (!isStamped && !isMa && !isNaturalRoleHolder) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to review this tier');
  }

  const reviewedByName = caller.name || caller.email || 'Unknown';

  const newApprovalStatus = { ...approvalStatus, [tier]: action };
  const newEntry: Record<string, any> = {
    tier,
    status: action,
    approvedBy: context.auth!.uid,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...approvalLog, newEntry];

  // Compute overall status
  let overallStatus = 'Pending';
  const anyRejected = TIER_ORDER.some((t) => newApprovalStatus[t] === 'Rejected');
  const allApproved = TIER_ORDER.every((t) => newApprovalStatus[t] === 'Approved');

  if (anyRejected) overallStatus = 'Rejected';
  else if (allApproved) {
    overallStatus =
      leave.masterAdminRequired && leave.masterAdminApproveStatus !== 'Approved' ? 'Pending' : 'Approved';
  }

  // Web parity: approvalCount = resolved tiers (Approved or Rejected).
  const approvalCount = TIER_ORDER.filter(
    (t) => newApprovalStatus[t] === 'Approved' || newApprovalStatus[t] === 'Rejected',
  ).length;

  await docRef.update({
    approvalStatus: newApprovalStatus,
    approvalLog: newApprovalLog,
    status: overallStatus,
    approvalCount,
    reviewedBy: context.auth!.uid,
    reviewedByName,
    reviewNote: reviewNote || '',
    reviewedOn: admin.firestore.FieldValue.serverTimestamp(),
    ...(action === 'Rejected' ? { rejectedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // Sync flat flags
    reportingManagerApproved: newApprovalStatus.reportingManager === 'Approved',
    companyAdminApproved: newApprovalStatus.companyAdmin === 'Approved',
    executiveApproved: newApprovalStatus.executive === 'Approved',
    teamLeaderApproved: newApprovalStatus.teamLeader === 'Approved',
  });

  // Send notification to leave applicant
  if (leave.userId) {
    try {
      await db.collection('notifications').add({
        userId: leave.userId,
        type: action === 'Rejected' ? 'leave_rejected' : 'leave_approved',
        title: action === 'Rejected' ? `Leave Rejected by ${TIER_LABELS[tier]}` : `Leave Approved by ${TIER_LABELS[tier]}`,
        body: `Your ${leave.leaveType || 'leave'} request was ${action.toLowerCase()} by ${reviewedByName}.`,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch {}
  }

  // Route to the next verification tier (or the Master Admin gate).
  // leaveFunctions.onLeaveRequestUpdated only fans out on FINAL status — without
  // this, the next approver (or the MA gate) is never notified when a review
  // arrives from mobile, unlike web's notifyLeaveTierApproved fan-out.
  if (action === 'Approved') {
    const nextTier = TIER_ORDER.find((t) => newApprovalStatus[t] === 'Pending');
    const targetUid = nextTier
      ? String(approverIds[nextTier] || '')
      : leave.masterAdminRequired &&
          leave.masterAdminApproveStatus === 'Pending' &&
          String(leave.masterAdminApproverId || '')
      ? String(leave.masterAdminApproverId)
      : '';
    const stepLabel = nextTier ? TIER_LABELS[nextTier] : 'Master Admin';
    if (targetUid) {
      try {
        await db.collection('notifications').add({
          userId: targetUid,
          type: 'leave_tier_approved',
          title: `Leave Awaiting Your ${stepLabel} Verification`,
          body: `${leave.employeeName || 'An employee'}'s ${leave.leaveType || 'leave'} request cleared ${TIER_LABELS[tier]} verification and awaits your decision.`,
          read: false,
          link: '/leave-approvals',
          companyId: leave.companyId || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch {}
    }
  }

  return { success: true, status: overallStatus };
});

/** Master Admin final review for leave */
export const mobileReviewMasterAdminLeave = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { leaveId, action, reviewNote } = data;
  if (!leaveId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }
  if (!reviewNote || !reviewNote.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Mandatory remark required');
  }

  // Only master-admin can do this
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only Master Admin can perform final review');
  }

  const docRef = db.collection('leaveRequests').doc(leaveId);
  const snap = await docRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Leave request not found');

  const leave = snap.data()!;
  if (!leave.masterAdminRequired) {
    throw new functions.https.HttpsError('failed-precondition', 'This request does not require Master Admin review');
  }
  if (leave.masterAdminApproveStatus && leave.masterAdminApproveStatus !== 'Pending') {
    throw new functions.https.HttpsError('failed-precondition', `Master Admin review already ${leave.masterAdminApproveStatus}`);
  }

  const reviewedByName = callerDoc.data()?.name || callerDoc.data()?.email || 'Master Admin';

  await docRef.update({
    status: action,
    masterAdminApproveStatus: action,
    masterAdminApprovedBy: context.auth!.uid,
    masterAdminApprovedByName: reviewedByName,
    masterAdminApprovedOn: new Date(),
    masterAdminNote: reviewNote,
    approvalLog: admin.firestore.FieldValue.arrayUnion({
      tier: 'masterAdmin',
      status: action,
      approvedBy: context.auth!.uid,
      approvedByName: reviewedByName,
      approvedOn: new Date(),
      note: reviewNote,
    }),
    reviewedBy: context.auth!.uid,
    reviewedByName,
    reviewNote,
    reviewedOn: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify employee
  if (leave.userId) {
    try {
      await db.collection('notifications').add({
        userId: leave.userId,
        type: action === 'Rejected' ? 'leave_rejected' : 'leave_approved',
        title: action === 'Rejected' ? 'Leave Rejected by Master Admin' : 'Leave Fully Approved by Master Admin',
        body: action === 'Rejected'
          ? `Your ${leave.leaveType || 'leave'} was rejected by Master Admin. ${reviewNote}`
          : `All approvers and Master Admin have approved your ${leave.leaveType || 'leave'}!`,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch {}
  }

  return { success: true, status: action };
});

/** Cancel a leave request */
export const mobileCancelLeaveRequest = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { leaveId } = data;
  if (!leaveId) throw new functions.https.HttpsError('invalid-argument', 'Missing leaveId');

  const docRef = db.collection('leaveRequests').doc(leaveId);
  const snap = await docRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Leave request not found');

  const leave = snap.data()!;
  if (leave.userId !== context.auth!.uid) {
    // Allow management to cancel
    const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
    const role = callerDoc.data()?.role || 'employee';
    if (!['master-admin', 'company-admin'].includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot cancel another user\'s leave');
    }
  }

  await docRef.update({
    status: 'Cancelled',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// MISSED PUNCH RECTIFICATION
// ============================================

/** Request missed punch rectification */
export const mobileRequestPunchRectification = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { attendanceId, correctedCheckOut, employeeRemark, companyId, userId, approverIds: clientApproversRaw } = data;
  if (!attendanceId || !correctedCheckOut) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  const effectiveUserId = userId || context.auth!.uid;
  const effectiveCompanyId = companyId || '';

  // Build the 4-tier approval chain
  const approverIds: Record<string, string> = { reportingManager: '', companyAdmin: '', executive: '', teamLeader: '' };

  // Resolve Reporting Manager
  try {
    const empSnap = await db.collection('employees').where('userId', '==', effectiveUserId).limit(1).get();
    if (!empSnap.empty && empSnap.docs[0].data().reportingManagerId) {
      approverIds.reportingManager = empSnap.docs[0].data().reportingManagerId;
    }
  } catch {}

  // Resolve Company Admin
  try {
    const adminSnap = await db.collection('users').where('role', '==', 'company-admin').where('companyId', '==', effectiveCompanyId).limit(1).get();
    if (!adminSnap.empty) approverIds.companyAdmin = adminSnap.docs[0].id;
  } catch {}

  // Resolve Team Leader
  try {
    const execSnap = await db.collection('users').where('role', '==', 'executive').get();
    for (const d of execSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(effectiveCompanyId)) {
        const assigned = d.data().assignedTeamLeaderIds || [];
        if (assigned.length > 0) { approverIds.teamLeader = String(assigned[0]); break; }
      }
    }
  } catch {}

  // Resolve Executive
  try {
    const execSnap = await db.collection('users').where('role', '==', 'executive').get();
    for (const d of execSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(effectiveCompanyId)) {
        approverIds.executive = d.id;
        break;
      }
    }
  } catch {}

  // Prefer the client's authoritative resolution (attendanceApi.resolveApproverIds
  // mirrors the web service incl. linkedExecutiveIds / reportingExecutiveId / TL
  // assignedCompanyIds fallbacks). The server resolution above is only a fallback:
  // its weak `assignedTeamLeaderIds[0]`-only rule could stamp the wrong/empty TL,
  // so the Team Leader tier never reached the assigned TL's queue (web parity).
  const clientApprovers: Record<string, unknown> =
    clientApproversRaw && typeof clientApproversRaw === 'object' ? clientApproversRaw : {};
  for (const k of ['reportingManager', 'companyAdmin', 'executive', 'teamLeader']) {
    const v = String(clientApprovers[k] || '').trim();
    if (v) approverIds[k] = v;
  }

  // Determine applicant role
  const applicantDoc = await db.collection('users').doc(effectiveUserId).get();
  const applicantRole = applicantDoc.data()?.role || 'employee';
  const MANAGEMENT_ROLES = ['team-leader', 'executive'];
  const masterAdminRequired = MANAGEMENT_ROLES.includes(applicantRole);

  let masterAdminApproverId = '';
  if (masterAdminRequired) {
    const maSnap = await db.collection('users').where('role', '==', 'master-admin').limit(1).get();
    if (!maSnap.empty) masterAdminApproverId = maSnap.docs[0].id;
  }

  // Auto-skip tiers based on role
  const TIER_ORDER = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
  const approvalStatus: Record<string, string> = {};
  for (const tier of TIER_ORDER) {
    approvalStatus[tier] = 'Pending';
    const isSelfApprover = approverIds[tier] === effectiveUserId;
    const isUnassignedRm = tier === 'reportingManager' && !approverIds[tier];
    const isSelfReportingManager = tier === 'reportingManager' && (applicantRole === 'reporting-manager' || applicantRole === 'hr-manager');

    if (applicantRole === 'executive') {
      if (tier !== 'teamLeader') approvalStatus[tier] = 'Approved';
    } else if (masterAdminRequired) {
      approvalStatus[tier] = 'Approved';
    } else {
      // Normal employee: self-approver / unassigned-RM skip. Reporting Manager
      // or HR Manager self-app: their own tier always auto-completes, matching
      // the web service (so the chain becomes Company Admin → Executive → TL).
      if (isSelfApprover || isUnassignedRm || isSelfReportingManager) approvalStatus[tier] = 'Approved';
    }
  }

  const docRef = db.collection('attendance').doc(attendanceId);

  // The callable protocol delivers `correctedCheckOut` as an ISO string — store
  // it as a Timestamp so it matches the web client's direct `Date` writes (the
  // approval cascade applies `checkOut: mp.correctedCheckOut` and readers call
  // `.toDate()` / `new Date(...)` on it).
  const correctedDate = new Date(correctedCheckOut);
  const correctedValue = isNaN(correctedDate.getTime())
    ? correctedCheckOut
    : admin.firestore.Timestamp.fromDate(correctedDate);

  await docRef.update({
    'missedPunchRectification.requested': true,
    'missedPunchRectification.requestedAt': admin.firestore.FieldValue.serverTimestamp(),
    'missedPunchRectification.correctedCheckOut': correctedValue,
    'missedPunchRectification.employeeRemark': employeeRemark || '',
    'missedPunchRectification.resolved': false,
    'missedPunchRectification.applicantRole': applicantRole,
    'missedPunchRectification.masterAdminRequired': masterAdminRequired,
    'missedPunchRectification.masterAdminApproverId': masterAdminApproverId,
    // Firestore rejects `undefined` values ("Cannot use undefined as a Firestore
    // value"), so only stamp the Master Admin status when the gate applies. The
    // previous `masterAdminRequired ? 'Pending' : undefined` made every
    // regular-employee rectification throw → callable INTERNAL (HTTP 500).
    ...(masterAdminRequired
      ? { 'missedPunchRectification.masterAdminApproveStatus': 'Pending' }
      : {}),
    'missedPunchRectification.approvalStatus': approvalStatus,
    'missedPunchRectification.approvalLog': [],
    // Web parity: resolved-tier count + flat flags stamped at creation so
    // dashboard counters/queues read correct values immediately (the trigger
    // re-reconciles them on every subsequent tier action).
    'missedPunchRectification.approvalCount': TIER_ORDER.filter(
      (t) => approvalStatus[t] === 'Approved' || approvalStatus[t] === 'Rejected',
    ).length,
    'missedPunchRectification.reportingManagerApproved': approvalStatus.reportingManager === 'Approved',
    'missedPunchRectification.companyAdminApproved': approvalStatus.companyAdmin === 'Approved',
    'missedPunchRectification.executiveApproved': approvalStatus.executive === 'Approved',
    'missedPunchRectification.teamLeaderApproved': approvalStatus.teamLeader === 'Approved',
    'missedPunchRectification.approverIds': { ...approverIds, masterAdmin: masterAdminApproverId },
    'missedPunchRectification.status': 'Pending',
  });

  return { success: true };
});

/** Review missed punch at a specific tier */
export const mobileReviewMissedPunchTier = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { attendanceId, tier, action, reviewNote } = data;
  if (!attendanceId || !tier || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  const docRef = db.collection('attendance').doc(attendanceId);
  const snap = await docRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Attendance record not found');

  const mp = snap.data()?.missedPunchRectification || {};
  const current = mp.approvalStatus || {};

  if (!TIER_ORDER.includes(tier)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown approval tier');
  }
  if (current[tier] && current[tier] !== 'Pending') {
    throw new functions.https.HttpsError('failed-precondition', `This tier has already been ${current[tier]}`);
  }
  // Sequential gate (web reviewMissedPunchTier parity): every earlier tier must
  // be Approved before this one can act — enforces RM → CA → Exec → TL order.
  for (let i = 0; i < TIER_ORDER.indexOf(tier); i++) {
    const prev = TIER_ORDER[i];
    if (current[prev] !== 'Approved') {
      throw new functions.https.HttpsError('failed-precondition', `${TIER_LABELS[prev]} must verify first`);
    }
  }
  if (action === 'Rejected' && (!reviewNote || !String(reviewNote).trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'A mandatory remark is required to reject');
  }

  // Verify caller is the assigned approver (stamped approver, master-admin, or —
  // when the stamp is stale/empty — the natural role holder for this tier in the
  // same company; mirrors web's permission-based Firestore rules).
  const approverIds = mp.approverIds || {};
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const caller = callerDoc.data() || {};
  const callerRole = caller.role || '';
  const stamp = String(approverIds[tier] || '');
  const isStamped = stamp === context.auth!.uid;
  const isMa = callerRole === 'master-admin';
  const isNaturalRoleHolder =
    (TIER_ROLES[tier] || []).includes(callerRole) &&
    (!snap.data()?.companyId || !caller.companyId || snap.data()?.companyId === caller.companyId);
  if (!isStamped && !isMa && !isNaturalRoleHolder) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized');
  }

  const reviewedByName = caller.name || caller.email || 'Unknown';

  const newApprovalStatus = { ...current, [tier]: action };
  const newEntry = { tier, status: action, approvedBy: context.auth!.uid, approvedByName: reviewedByName, approvedOn: new Date(), note: reviewNote || '' };
  const newApprovalLog = [...(mp.approvalLog || []), newEntry];

  // Compute overall
  let overall = 'Pending';
  if (TIER_ORDER.some((t) => newApprovalStatus[t] === 'Rejected')) overall = 'Rejected';
  else if (TIER_ORDER.every((t) => newApprovalStatus[t] === 'Approved')) {
    if (mp.masterAdminRequired) {
      overall = mp.masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
    } else overall = 'Approved';
  }

  const approvalCount = TIER_ORDER.filter(
    (t) => newApprovalStatus[t] === 'Approved' || newApprovalStatus[t] === 'Rejected',
  ).length;

  await docRef.update({
    'missedPunchRectification.approvalStatus': newApprovalStatus,
    'missedPunchRectification.approvalLog': newApprovalLog,
    'missedPunchRectification.status': overall,
    'missedPunchRectification.approvalCount': approvalCount,
    // Rejected is TERMINAL (web parity): mark resolved so the record clears
    // every pending queue (`requested && !resolved` filters, dashboard counters,
    // missPunchPending) instead of hanging as "Rectification pending" forever.
    // Approved final keeps resolved=true too; Pending (MA gate) stays unresolved.
    'missedPunchRectification.resolved': overall !== 'Pending',
    ...(overall === 'Rejected'
      ? {
          'missedPunchRectification.resolvedAt': admin.firestore.FieldValue.serverTimestamp(),
          'missedPunchRectification.resolvedBy': context.auth!.uid,
          'missedPunchRectification.resolvedByName': reviewedByName,
          'missedPunchRectification.remark': String(reviewNote || ''),
        }
      : {}),
    'missedPunchRectification.reportingManagerApproved': newApprovalStatus.reportingManager === 'Approved',
    'missedPunchRectification.companyAdminApproved': newApprovalStatus.companyAdmin === 'Approved',
    'missedPunchRectification.executiveApproved': newApprovalStatus.executive === 'Approved',
    'missedPunchRectification.teamLeaderApproved': newApprovalStatus.teamLeader === 'Approved',
  });

  return { success: true, status: overall };
});

/** Master Admin final review for missed punch */
export const mobileReviewMasterAdminMissedPunch = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { attendanceId, action, reviewNote } = data;
  if (!attendanceId || !action || !reviewNote) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only Master Admin');
  }

  const docRef = db.collection('attendance').doc(attendanceId);
  const snap = await docRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Not found');

  const mp = snap.data()?.missedPunchRectification || {};
  if (!mp.masterAdminRequired) throw new functions.https.HttpsError('failed-precondition', 'Does not require MA review');
  if (mp.masterAdminApproveStatus && mp.masterAdminApproveStatus !== 'Pending') {
    throw new functions.https.HttpsError('failed-precondition', `Already ${mp.masterAdminApproveStatus}`);
  }
  // Web parity: the Master Admin gate only opens once every earlier verification
  // tier is Approved (getEffectiveMissedPunchTiers precondition).
  const mpStatus = mp.approvalStatus || {};
  if (!TIER_ORDER.every((t) => mpStatus[t] === 'Approved')) {
    throw new functions.https.HttpsError('failed-precondition', 'Earlier verification tiers are not all approved');
  }

  const reviewedByName = callerDoc.data()?.name || 'Master Admin';
  const overall = action;

  await docRef.update({
    'missedPunchRectification.status': overall,
    // The Master Admin decision is FINAL for both outcomes (web parity): mark
    // resolved + resolution metadata so rejected records stop clogging queues.
    'missedPunchRectification.resolved': true,
    'missedPunchRectification.resolvedAt': admin.firestore.FieldValue.serverTimestamp(),
    'missedPunchRectification.resolvedBy': context.auth!.uid,
    'missedPunchRectification.resolvedByName': reviewedByName,
    'missedPunchRectification.remark': String(reviewNote),
    'missedPunchRectification.masterAdminApproveStatus': action,
    'missedPunchRectification.masterAdminApprovedBy': context.auth!.uid,
    'missedPunchRectification.masterAdminApprovedByName': reviewedByName,
    'missedPunchRectification.masterAdminApprovedOn': new Date(),
    'missedPunchRectification.masterAdminNote': reviewNote,
    'missedPunchRectification.approvalLog': admin.firestore.FieldValue.arrayUnion({
      tier: 'masterAdmin', status: action, approvedBy: context.auth!.uid,
      approvedByName: reviewedByName, approvedOn: new Date(), note: reviewNote,
    }),
  });

  // If approved, apply the corrected checkout
  if (overall === 'Approved' && mp.correctedCheckOut) {
    await docRef.update({
      checkOut: mp.correctedCheckOut,
      status: 'Approved',
    });
  }

  return { success: true, status: overall };
});

// ============================================
// USER PROFILE UPDATES
// ============================================

/** Update user profile (self or admin) */
export const mobileUpdateUserProfile = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { userId, updates } = data;
  if (!userId || !updates) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const targetId = userId;
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  const isSelf = targetId === context.auth!.uid;
  const isManagement = ['master-admin', 'company-admin'].includes(callerRole);

  if (!isSelf && !isManagement) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot update other users');
  }

  // Whitelist allowed fields
  const allowedSelf = ['name', 'phone', 'avatar', 'address', 'emergencyContactName', 'emergencyContactPhone'];
  const allowedAdmin = [...allowedSelf, 'designation', 'departmentId', 'department', 'status', 'employmentType'];
  const allowedFields = isManagement ? allowedAdmin : allowedSelf;

  const safeUpdates: Record<string, any> = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) safeUpdates[key] = updates[key];
  }
  safeUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('users').doc(targetId).update(safeUpdates);
  return { success: true };
});

// ============================================
// ATTENDANCE UPDATES
// ============================================

/** Update attendance record (admin operations) */
export const mobileUpdateAttendance = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { attendanceId, updates } = data;
  if (!attendanceId || !updates) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized');
  }

  await db.collection('attendance').doc(attendanceId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// PAYROLL OPERATIONS
// ============================================

/** Save a payroll run */
export const mobileSavePayrollRun = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized');
  }

  const { payrollData } = data;
  if (!payrollData) throw new functions.https.HttpsError('invalid-argument', 'Missing payroll data');

  const docRef = await db.collection('payrollRuns').add({
    ...payrollData,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a payroll run */
export const mobileUpdatePayrollRun = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { runId, updates } = data;
  if (!runId || !updates) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  await db.collection('payrollRuns').doc(runId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Disburse payroll run (create salary slips) */
export const mobileDisbursePayroll = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized');
  }

  const { runId } = data;
  if (!runId) throw new functions.https.HttpsError('invalid-argument', 'Missing runId');

  const runSnap = await db.collection('payrollRuns').doc(runId).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Payroll run not found');

  const run = runSnap.data()!;
  const batch = db.batch();

  for (const item of (run.items || [])) {
    const slipRef = db.collection('salarySlips').doc();
    batch.set(slipRef, {
      userId: item.userId,
      employeeName: item.employeeName,
      employeeEmail: item.employeeEmail,
      employeeId: item.employeeId,
      month: run.month,
      year: run.year,
      basicSalary: item.grossSalary,
      allowances: item.totalEarnings,
      deductions: item.totalDeductions,
      netSalary: item.netSalary,
      status: 'Paid',
      paidOn: admin.firestore.FieldValue.serverTimestamp(),
      companyId: run.companyId,
      breakdown: {
        hra: item.hra,
        da: item.da,
        pf: item.pf,
        tax: item.professionalTax,
        otherDeductions: item.otherDeductions,
      },
    });
  }

  batch.update(runSnap.ref, {
    status: 'Disbursed',
    disbursedOn: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { success: true };
});

// ============================================
// TASK OPERATIONS
// ============================================

/** Create a task */
export const mobileCreateTask = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { taskData } = data;
  if (!taskData) throw new functions.https.HttpsError('invalid-argument', 'Missing task data');

  const docRef = await db.collection('tasks').add({
    ...taskData,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a task */
export const mobileUpdateTask = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { taskId, updates } = data;
  if (!taskId || !updates) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  await db.collection('tasks').doc(taskId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// TICKET / SUPPORT OPERATIONS
// ============================================

/** Create a support ticket */
export const mobileCreateTicket = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { ticketData } = data;
  if (!ticketData) throw new functions.https.HttpsError('invalid-argument', 'Missing ticket data');

  const docRef = await db.collection('tickets').add({
    ...ticketData,
    createdById: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a ticket */
export const mobileUpdateTicket = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { ticketId, updates } = data;
  if (!ticketId || !updates) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  await db.collection('tickets').doc(ticketId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// ANNOUNCEMENT OPERATIONS
// ============================================

/** Create an announcement */
export const mobileCreateAnnouncement = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { announcementData } = data;
  if (!announcementData) throw new functions.https.HttpsError('invalid-argument', 'Missing data');

  const docRef = await db.collection('announcements').add({
    ...announcementData,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

// ============================================
// NOTIFICATION OPERATIONS
// ============================================

/** Mark notification as read */
export const mobileMarkNotificationRead = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { notificationId } = data;
  if (!notificationId) throw new functions.https.HttpsError('invalid-argument', 'Missing notificationId');

  await db.collection('notifications').doc(notificationId).update({ read: true });
  return { success: true };
});

/** Mark all notifications as read */
export const mobileMarkAllNotificationsRead = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const snap = await db.collection('notifications').where('userId', '==', context.auth!.uid).where('read', '==', false).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
  return { success: true, count: snap.size };
});

// ============================================
// EMPLOYEE OPERATIONS
// ============================================

/** Create an employee (Admin SDK bypass) */
export const mobileCreateEmployee = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin or company-admin can create employees');
  }

  const { userData, employeeData } = data;
  if (!userData || !employeeData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userData or employeeData');
  }

  try {
    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email: userData.email,
      password: userData.password || 'temp123456',
      displayName: userData.name,
      phoneNumber: userData.phone || undefined,
    });

    const uid = userRecord.uid;
    const companyId = userData.companyId || callerDoc.data()?.companyId || '';

    // Create user document
    const userDoc: Record<string, any> = {
      uid,
      id: uid,
      name: userData.name,
      email: userData.email,
      phone: userData.phone || '',
      role: userData.role || 'employee',
      companyId,
      departmentId: userData.departmentId || null,
      department: userData.department || '',
      designation: userData.designation || '',
      status: 'Active',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=f97316&color=fff`,
      isActive: true,
      requirePasswordChange: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('users').doc(uid).set(userDoc);

    // Set custom claims
    try {
      await auth.setCustomUserClaims(uid, {
        role: userData.role || 'employee',
        companyId,
      });
    } catch { /* non-fatal */ }

    // Create employee document
    const empDoc: Record<string, any> = {
      ...employeeData,
      userId: uid,
      companyId,
      name: userData.name,
      email: userData.email,
      phone: userData.phone || '',
      role: userData.role || 'employee',
      status: 'Active',
      createdBy: context.auth!.uid,
      createdByName: callerDoc.data()?.name || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const empRef = await db.collection('employees').add(empDoc);
    await db.collection('employees').doc(empRef.id).update({ id: empRef.id });

    return { success: true, uid, id: empRef.id };
  } catch (error: any) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', `Failed to create employee: ${error.message}`);
  }
});

/** Update an employee document */
export const mobileUpdateEmployee = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update employees');
  }

  const { employeeId, updates } = data;
  if (!employeeId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing employeeId or updates');
  }

  await db.collection('employees').doc(employeeId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Also update the linked user document if relevant fields changed
  if (updates.userId) {
    const userUpdates: Record<string, any> = {};
    if (updates.name) userUpdates.name = updates.name;
    if (updates.email) userUpdates.email = updates.email;
    if (updates.phone) userUpdates.phone = updates.phone;
    if (updates.designation) userUpdates.designation = updates.designation;
    if (updates.departmentId) userUpdates.departmentId = updates.departmentId;
    if (updates.department) userUpdates.department = updates.department;
    if (updates.status) userUpdates.status = updates.status;
    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(updates.userId).update(userUpdates);
    }
  }

  return { success: true };
});

// ============================================
// SALARY STRUCTURE OPERATIONS
// ============================================

/** Create a salary structure */
export const mobileCreateSalaryStructure = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to create salary structures');
  }

  const { structureData } = data;
  if (!structureData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing structure data');
  }

  const docRef = await db.collection('salaryStructures').add({
    ...structureData,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a salary structure */
export const mobileUpdateSalaryStructure = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update salary structures');
  }

  const { structureId, updates } = data;
  if (!structureId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing structureId or updates');
  }

  await db.collection('salaryStructures').doc(structureId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Delete a salary structure */
export const mobileDeleteSalaryStructure = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete salary structures');
  }

  const { structureId } = data;
  if (!structureId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing structureId');
  }

  await db.collection('salaryStructures').doc(structureId).delete();

  return { success: true };
});

// ============================================
// SALARY SLIP OPERATIONS
// ============================================

/** Mark a salary slip as paid */
export const mobileMarkSalarySlipPaid = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update salary slips');
  }

  const { slipId } = data;
  if (!slipId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing slipId');
  }

  await db.collection('salarySlips').doc(slipId).update({
    status: 'Paid',
    paidOn: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Delete a salary slip */
export const mobileDeleteSalarySlip = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete salary slips');
  }

  const { slipId } = data;
  if (!slipId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing slipId');
  }

  await db.collection('salarySlips').doc(slipId).delete();

  return { success: true };
});

// ============================================
// PAYROLL RUN DELETION
// ============================================

/** Delete a payroll run and associated salary slips */
export const mobileDeletePayrollRun = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete payroll runs');
  }

  const { runId } = data;
  if (!runId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing runId');
  }

  const runSnap = await db.collection('payrollRuns').doc(runId).get();
  if (!runSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Payroll run not found');
  }

  // Delete associated salary slips
  const slipsSnap = await db.collection('salarySlips').where('payrollRunId', '==', runId).get();
  const batch = db.batch();
  slipsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection('payrollRuns').doc(runId));
  await batch.commit();

  return { success: true, deletedSlips: slipsSnap.size };
});

// ============================================
// COMPANY OPERATIONS
// ============================================

/** Create a company (master-admin only) */
export const mobileCreateCompany = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can create companies');
  }

  const { companyData } = data;
  if (!companyData || !companyData.name) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing company data');
  }

  const docRef = await db.collection('companies').add({
    ...companyData,
    active: true,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a company document */
export const mobileUpdateCompany = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update companies');
  }

  const { companyId, updates } = data;
  if (!companyId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing companyId or updates');
  }

  // Company admins can only update their own company
  if (callerRole === 'company-admin' && callerDoc.data()?.companyId !== companyId) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot update another company');
  }

  await db.collection('companies').doc(companyId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Delete a company (master-admin only) */
export const mobileDeleteCompany = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can delete companies');
  }

  const { companyId } = data;
  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing companyId');
  }

  await db.collection('companies').doc(companyId).delete();

  return { success: true };
});

/** Onboard a company — batch create company + departments + attendance settings */
export const mobileOnboardCompany = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can onboard companies');
  }

  const { companyData, departments, attendanceSettings } = data;
  if (!companyData || !companyData.name) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing company data');
  }

  const batch = db.batch();

  // Create company
  const companyRef = db.collection('companies').doc();
  batch.set(companyRef, {
    ...companyData,
    active: true,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const companyId = companyRef.id;

  // Create departments
  if (Array.isArray(departments)) {
    for (const dept of departments) {
      const deptRef = db.collection('departments').doc();
      batch.set(deptRef, {
        ...dept,
        companyId,
        createdBy: context.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // Create attendance settings
  if (attendanceSettings && typeof attendanceSettings === 'object') {
    const attRef = db.collection('attendanceSettings').doc(companyId);
    batch.set(attRef, {
      ...attendanceSettings,
      companyId,
      createdBy: context.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  return { success: true, companyId };
});

// ============================================
// DEPARTMENT OPERATIONS
// ============================================

/** Create a department */
export const mobileCreateDepartment = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to create departments');
  }

  const { departmentData } = data;
  if (!departmentData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing department data');
  }

  const docRef = await db.collection('departments').add({
    ...departmentData,
    companyId: departmentData.companyId || callerDoc.data()?.companyId || '',
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update a department */
export const mobileUpdateDepartment = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update departments');
  }

  const { departmentId, updates } = data;
  if (!departmentId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing departmentId or updates');
  }

  await db.collection('departments').doc(departmentId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Delete a department */
export const mobileDeleteDepartment = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete departments');
  }

  const { departmentId } = data;
  if (!departmentId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing departmentId');
  }

  await db.collection('departments').doc(departmentId).delete();

  return { success: true };
});

// ============================================
// ATTENDANCE SETTINGS
// ============================================

/** Save attendance policy (create or update) */
export const mobileSaveAttendancePolicy = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to save attendance policy');
  }

  const { policyData, policyId } = data;
  if (!policyData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing policy data');
  }

  const companyId = policyData.companyId || callerDoc.data()?.companyId || '';

  if (policyId) {
    // Update existing
    await db.collection('attendanceSettings').doc(policyId).update({
      ...policyData,
      companyId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, id: policyId };
  } else {
    // Create new
    const docRef = await db.collection('attendanceSettings').add({
      ...policyData,
      companyId,
      createdBy: context.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, id: docRef.id };
  }
});

// ============================================
// COMPANY ADMIN APPROVAL
// ============================================

/** Approve a company admin (master-admin only) */
export const mobileApproveCompanyAdmin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can approve company admins');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId');
  }

  await db.collection('users').doc(userId).update({
    status: 'Active',
    active: true,
    approvedBy: context.auth!.uid,
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify user
  try {
    await db.collection('notifications').add({
      userId,
      type: 'account_approved',
      title: 'Account Approved',
      body: 'Your company admin account has been approved by the master admin.',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* non-fatal */ }

  return { success: true };
});

/** Reject a company admin (master-admin only) */
export const mobileRejectCompanyAdmin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can reject company admins');
  }

  const { userId, reason } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId');
  }

  await db.collection('users').doc(userId).update({
    status: 'Rejected',
    active: false,
    rejectedBy: context.auth!.uid,
    rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    rejectionReason: reason || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify user
  try {
    await db.collection('notifications').add({
      userId,
      type: 'account_rejected',
      title: 'Account Rejected',
      body: `Your company admin account has been rejected. ${reason || ''}`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* non-fatal */ }

  return { success: true };
});

/** Suspend a company admin (master-admin only) */
export const mobileSuspendCompanyAdmin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can suspend company admins');
  }

  const { userId, reason } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId');
  }

  await db.collection('users').doc(userId).update({
    status: 'Suspended',
    active: false,
    suspendedBy: context.auth!.uid,
    suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
    suspensionReason: reason || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify user
  try {
    await db.collection('notifications').add({
      userId,
      type: 'account_suspended',
      title: 'Account Suspended',
      body: `Your company admin account has been suspended. ${reason || ''}`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* non-fatal */ }

  return { success: true };
});

/** Reactivate a company admin (master-admin only) */
export const mobileReactivateCompanyAdmin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can reactivate company admins');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId');
  }

  await db.collection('users').doc(userId).update({
    status: 'Active',
    active: true,
    reactivatedBy: context.auth!.uid,
    reactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify user
  try {
    await db.collection('notifications').add({
      userId,
      type: 'account_reactivated',
      title: 'Account Reactivated',
      body: 'Your company admin account has been reactivated by the master admin.',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* non-fatal */ }

  return { success: true };
});

/** Delete a company admin (master-admin only) */
export const mobileDeleteCompanyAdmin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can delete company admins');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId');
  }

  // Prevent deleting self
  if (userId === context.auth!.uid) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot delete your own account');
  }

  // Delete user doc
  await db.collection('users').doc(userId).delete();

  // Delete linked Auth account
  try {
    await auth.deleteUser(userId);
  } catch { /* may not exist */ }

  return { success: true };
});

// ============================================
// SUPPORT TICKET OPERATIONS
// ============================================

/** Update ticket status */
export const mobileUpdateTicketStatus = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to update ticket status');
  }

  const { ticketId, status } = data;
  if (!ticketId || !status) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing ticketId or status');
  }

  await db.collection('tickets').doc(ticketId).update({
    status,
    updatedBy: context.auth!.uid,
    updatedByName: callerDoc.data()?.name || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Add a message to a ticket conversation */
export const mobileAddTicketMessage = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { ticketId, message, attachments } = data;
  if (!ticketId || !message) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing ticketId or message');
  }

  // Verify the user has access to this ticket
  const ticketSnap = await db.collection('tickets').doc(ticketId).get();
  if (!ticketSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Ticket not found');
  }

  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  const ticket = ticketSnap.data()!;
  const isManagement = ['master-admin', 'company-admin', 'executive', 'team-leader'].includes(callerRole);
  const isOwner = ticket.createdById === context.auth!.uid;

  if (!isManagement && !isOwner) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to comment on this ticket');
  }

  const messageData: Record<string, any> = {
    ticketId,
    senderId: context.auth!.uid,
    senderName: callerDoc.data()?.name || callerDoc.data()?.email || 'Unknown',
    senderRole: callerRole,
    message,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (Array.isArray(attachments) && attachments.length > 0) {
    messageData.attachments = attachments;
  }

  const docRef = await db.collection('ticketMessages').add(messageData);

  // Update ticket's last message
  await db.collection('tickets').doc(ticketId).update({
    lastMessage: message,
    lastMessageBy: context.auth!.uid,
    lastMessageByName: callerDoc.data()?.name || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Delete a ticket */
export const mobileDeleteTicket = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete tickets');
  }

  const { ticketId } = data;
  if (!ticketId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing ticketId');
  }

  // Delete ticket
  await db.collection('tickets').doc(ticketId).delete();

  // Delete associated messages
  const messagesSnap = await db.collection('ticketMessages').where('ticketId', '==', ticketId).get();
  const batch = db.batch();
  messagesSnap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  return { success: true, deletedMessages: messagesSnap.size };
});

// ============================================
// NOTIFICATION OPERATIONS (Extended)
// ============================================

/** Create a notification */
export const mobileCreateNotification = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  // Accept BOTH shapes: the wrapped { notificationData: {...} } form and the
  // flat payload ({ userId, type, title, ... }) that several mobile callers
  // (createNotification, notifyLeaveCascade, notifyTaskAssigned,
  // notifyMissedPunchSubmittedToTiers) send — flat payloads previously failed
  // with 400 "Missing notification data or userId" on every call.
  const notificationData = data?.notificationData ?? data;
  if (!notificationData || !notificationData.userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing notification data or userId');
  }

  const docRef = await db.collection('notifications').add({
    ...notificationData,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Delete a notification */
export const mobileDeleteNotification = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { notificationId } = data;
  if (!notificationId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing notificationId');
  }

  await db.collection('notifications').doc(notificationId).delete();

  return { success: true };
});

/** Create an admin alert (master-admin only) */
export const mobileCreateAdminAlert = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can create admin alerts');
  }

  const { alertData } = data;
  if (!alertData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing alert data');
  }

  const docRef = await db.collection('adminAlerts').add({
    ...alertData,
    read: false,
    createdBy: context.auth!.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Mark an admin alert as read (master-admin only) */
export const mobileMarkAdminAlertRead = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can mark admin alerts');
  }

  const { alertId } = data;
  if (!alertId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing alertId');
  }

  await db.collection('adminAlerts').doc(alertId).update({
    read: true,
    readAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Mark all admin alerts as read (master-admin only) */
export const mobileMarkAllAdminAlertsRead = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  if (callerDoc.data()?.role !== 'master-admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only master-admin can mark all admin alerts');
  }

  const snap = await db.collection('adminAlerts').where('read', '==', false).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, {
    read: true,
    readAt: admin.firestore.FieldValue.serverTimestamp(),
  }));
  await batch.commit();

  return { success: true, count: snap.size };
});

// ============================================
// ANNOUNCEMENT OPERATIONS (Extended)
// ============================================

/** Delete an announcement */
export const mobileDeleteAnnouncement = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
  const callerRole = callerDoc.data()?.role || 'employee';
  if (!['master-admin', 'company-admin'].includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete announcements');
  }

  const { announcementId } = data;
  if (!announcementId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing announcementId');
  }

  await db.collection('announcements').doc(announcementId).delete();

  return { success: true };
});

// ============================================
// AUTH OPERATIONS
// ============================================

/** Update last login timestamp */
export const mobileUpdateLastLogin = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const uid = context.auth!.uid;

  await db.collection('users').doc(uid).update({
    lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Update auth profile (self or admin) */
export const mobileUpdateAuthProfile = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { userId, updates } = data;
  if (!userId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing userId or updates');
  }

  const targetId = userId;
  const isSelf = targetId === context.auth!.uid;

  if (!isSelf) {
    const callerDoc = await db.collection('users').doc(context.auth!.uid).get();
    const callerRole = callerDoc.data()?.role || 'employee';
    if (!['master-admin', 'company-admin'].includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot update another user\'s profile');
    }
  }

  // Whitelist safe fields
  const allowedFields = ['name', 'phone', 'avatar', 'address', 'emergencyContactName', 'emergencyContactPhone'];
  const safeUpdates: Record<string, any> = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) safeUpdates[key] = updates[key];
  }
  safeUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('users').doc(targetId).update(safeUpdates);

  // Also update Firebase Auth profile
  try {
    await auth.updateUser(targetId, {
      displayName: safeUpdates.name || undefined,
      phoneNumber: safeUpdates.phone || undefined,
    });
  } catch { /* non-fatal */ }

  return { success: true };
});

// ============================================
// EMAIL OPERATIONS
// ============================================

/** Save (create) an email */
export const mobileSaveEmail = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailData } = data;
  if (!emailData) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing email data');
  }

  const docRef = await db.collection('emails').add({
    ...emailData,
    fromUserId: context.auth!.uid,
    read: false,
    starred: false,
    deleted: false,
    archived: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: docRef.id };
});

/** Update an email */
export const mobileUpdateEmail = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailId, updates } = data;
  if (!emailId || !updates) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing emailId or updates');
  }

  await db.collection('emails').doc(emailId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Soft-delete an email */
export const mobileDeleteEmail = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailId } = data;
  if (!emailId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing emailId');
  }

  await db.collection('emails').doc(emailId).update({
    deleted: true,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Archive an email */
export const mobileArchiveEmail = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailId } = data;
  if (!emailId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing emailId');
  }

  await db.collection('emails').doc(emailId).update({
    archived: true,
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Toggle star on an email */
export const mobileToggleStarEmail = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailId, starred } = data;
  if (!emailId || typeof starred !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing emailId or starred flag');
  }

  await db.collection('emails').doc(emailId).update({
    starred,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/** Mark an email as read */
export const mobileMarkEmailRead = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const { emailId } = data;
  if (!emailId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing emailId');
  }

  await db.collection('emails').doc(emailId).update({
    read: true,
    readAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// ACCOUNT DELETION REQUEST (Public — for Play Store compliance)
// ============================================

export const requestAccountDeletion = functions.https.onCall(async (data, context) => {
  // Auth required
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { email, employeeId, reason } = data;
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  }

  // Create deletion request document
  const requestRef = await db.collection('accountDeletionRequests').add({
    email,
    employeeId: employeeId || null,
    reason: reason || null,
    requestedBy: context.auth.uid,
    requestedByEmail: context.auth.token.email || email,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify all master admins
  const maSnapshot = await db.collection('users').where('role', '==', 'master-admin').get();
  const batch = db.batch();
  for (const maDoc of maSnapshot.docs) {
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      userId: maDoc.id,
      title: 'Account Deletion Request',
      message: `User ${email} has requested account deletion. Reason: ${reason || 'Not specified'}`,
      type: 'account_deletion_request',
      read: false,
      relatedId: requestRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  // Send email notification to admin
  try {
    const configDoc = await db.collection('emailSystemConfig').doc('default').get();
    const config = configDoc.data();
    if (config?.smtpHost) {
      const sgMail = require('@sendgrid/mail');
      await sgMail.setApiKey(config.apiKey);
      await sgMail.send({
        to: 'info@hrmax.in',
        from: config.fromEmail || 'noreply@hrmax.in',
        subject: `⚠️ Account Deletion Request — ${email}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #dc2626; color: #fff; padding: 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">Account Deletion Request</h2>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Employee ID:</strong> ${employeeId || 'N/A'}</p>
              <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
              <p><strong>Requested at:</strong> ${new Date().toISOString()}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;"/>
              <p style="color: #6b7280; font-size: 14px;">Please review this request in the HR MAX admin panel and process the deletion within <strong>30 business days</strong> as per Google Play Store policy.</p>
            </div>
          </div>
        `,
      });
    }
  } catch (e) {
    console.warn('Failed to send deletion notification email:', e);
  }

  return { success: true, requestId: requestRef.id };
});
