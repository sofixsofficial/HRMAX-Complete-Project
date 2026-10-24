import { httpsCallable } from '../aws/functions-compat';
import { functions, db } from '../aws/clients';
import { collection, query, getDocs, where, doc, getDoc } from '../aws/firestore-compat';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as Device from 'expo-device';
import type { ApprovalTier, ApprovalLevel } from '../types/user';
import { resolveApplicantRole, resolveMasterAdminApproverId, findManagingTeamLeaderForExec } from './leaveService';
import { createNotification } from './notificationService';

const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

export interface CheckInResult {
  id: string;
  status: string;
  lateMinutes?: number;
  message?: string;
}

export interface CheckOutResult {
  id: string;
  status: string;
  workHours?: number;
  overtimeHours?: number;
  message?: string;
}

const markAttendanceFn = httpsCallable(functions, 'markAttendance');

const getDeviceContext = async () => {
  let latitude: number | null = null;
  let longitude: number | null = null;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    }
  } catch {}

  let networkType: string | null = null;
  let wifiSsid: string | null = null;
  try {
    const state = await NetInfo.fetch();
    networkType =
      state.type === 'wifi' ? 'wifi' : state.type === 'cellular' ? 'mobile' : state.type === 'other' ? 'other' : null;
    if (state.type === 'wifi' && state.details && 'ssid' in state.details) {
      wifiSsid = (state.details as any).ssid ?? null;
    }
  } catch {}

  let deviceId: string | null = null;
  let deviceModel: string | null = null;
  try {
    deviceId = Device.osBuildId || Device.osInternalBuildId || null;
    deviceModel = Device.modelName || null;
  } catch {}

  return { latitude, longitude, networkType, wifiSsid, deviceId, deviceModel };
};

export const markCheckIn = async (
  companyId: string,
  opts?: { selfieUri?: string }
): Promise<CheckInResult> => {
  const ctx = await getDeviceContext();
  const res = await markAttendanceFn({
    action: 'check-in',
    companyId,
    selfieUri: opts?.selfieUri ?? null,
    ...ctx,
  });
  return res.data as CheckInResult;
};

export const markCheckOut = async (companyId: string, attendanceId: string): Promise<CheckOutResult> => {
  const ctx = await getDeviceContext();
  const res = await markAttendanceFn({ action: 'check-out', companyId, attendanceId, ...ctx });
  return res.data as CheckOutResult;
};

export const requestPunchRectification = async (
  attendanceId: string,
  correctedCheckOut: Date,
  opts?: { companyId?: string; userId?: string; employeeRemark?: string }
): Promise<void> => {
  // Approver ids are resolved + stamped authoritatively by the backend trigger
  // (`onMissedPunchAttendanceUpdated`); here we init the 4-tier chain so the
  // UI can show progress immediately and non-self tiers start Pending.
  const docRef = doc(db, 'attendance', attendanceId);
  const snap = await getDoc(docRef);
  const data = (snap.exists() ? snap.data() : ({} as any)) as any;
  const companyId = opts?.companyId || data.companyId || '';
  const userId = opts?.userId || data.userId || '';

  const INITIAL: Record<ApprovalTier, ApprovalLevel> = {
    reportingManager: 'Pending', companyAdmin: 'Pending', executive: 'Pending', teamLeader: 'Pending',
  };
  const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
  const approverIds = await resolveApproverIds(companyId, userId);

  // Master Admin final gate for Team Leader / Executive self-applications.
  const applicantRole = await resolveApplicantRole(userId);
  const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
  const masterAdminApproverId = masterAdminRequired ? await resolveMasterAdminApproverId() : '';

  // For Executive self-apps: resolve the specific managing TL who will be Tier 1.
  const isExecSelfApp = masterAdminRequired && applicantRole === 'executive';
  if (isExecSelfApp) {
    const managingTL = await findManagingTeamLeaderForExec(userId, companyId);
    if (managingTL) approverIds.teamLeader = managingTL;
  }

  const approvalStatus: Record<ApprovalTier, ApprovalLevel> = { ...INITIAL };
  for (const tier of TIER_ORDER) {
    // Auto-skip tiers whose approver is the applicant, plus auto-skip the
    // Reporting Manager tier when the applicant has no manager above them
    // (self-managed / top-of-chain, e.g. an RM submitting their own correction).
    const isSelfApprover = approverIds[tier] && approverIds[tier] === userId;
    const isUnassignedRmTier = tier === 'reportingManager' && !approverIds[tier];

    if (isExecSelfApp) {
      // Executive 2-tier: auto-skip RM + Admin + Executive, keep TL active
      // so the assigned Team Leader must verify before Master Admin final gate.
      if (tier !== 'teamLeader') approvalStatus[tier] = 'Approved';
    } else if (masterAdminRequired) {
      // Team Leader self-app: auto-skip ALL tiers (routes directly to Master Admin)
      approvalStatus[tier] = 'Approved';
    } else {
      // Reporting Manager / HR self-app: their own tier always auto-completes
      // (mirrors the web service) -> 3-tier chain: Company Admin → Exec → TL.
      const isSelfReportingManager = tier === 'reportingManager' &&
        (applicantRole === 'reporting-manager' || applicantRole === 'hr-manager');
      if (isSelfApprover || isUnassignedRmTier || isSelfReportingManager) approvalStatus[tier] = 'Approved';
    }
  }
  // §8 / §21: never create an approval step with an unassigned approver — the
  // chain would silently stall. Block submission with a clear configuration
  // error instead; auto-skipped tiers are already 'Approved' and exempt.
  const TIER_LABELS: Record<ApprovalTier, string> = {
    reportingManager: 'Reporting Manager', companyAdmin: 'Company Admin', executive: 'Executive', teamLeader: 'Team Leader',
  };
  const effectiveTiers: ApprovalTier[] =
    applicantRole === 'reporting-manager' || applicantRole === 'hr-manager' ? ['companyAdmin', 'executive', 'teamLeader']
      : applicantRole === 'executive' ? ['teamLeader']
        : applicantRole === 'team-leader' ? []
          : [...TIER_ORDER];
  const missingApprovers: string[] = [];
  if (masterAdminRequired && !masterAdminApproverId) missingApprovers.push('Master Admin');
  for (const t of effectiveTiers) {
    if (approvalStatus[t] === 'Pending' && !approverIds[t]) missingApprovers.push(TIER_LABELS[t]);
  }
  if (missingApprovers.length > 0) {
    throw new Error(
      `Unable to submit Missed Punch. ${missingApprovers.join(', ')} ${missingApprovers.length === 1 ? 'is' : 'are'} not assigned. Please contact your administrator to complete the company approval configuration.`
    );
  }

  const overall = computeOverallMissedPunchStatus(approvalStatus, masterAdminRequired, 'Pending');

  const callableFn = httpsCallable(functions, 'mobileRequestPunchRectification');
  await callableFn({
    attendanceId,
    correctedCheckOut: correctedCheckOut.toISOString(),
    employeeRemark: opts?.employeeRemark || '',
    companyId,
    userId,
    approvalStatus,
    approverIds: { ...approverIds, masterAdmin: masterAdminApproverId || '' },
    applicantRole,
    masterAdminRequired,
    masterAdminApproverId,
    masterAdminApproveStatus: masterAdminRequired ? 'Pending' : undefined,
    overallStatus: overall,
    approvalCount: computeMissedPunchCount(approvalStatus),
    reportingManagerApproved: approvalStatus.reportingManager === 'Approved',
    companyAdminApproved: approvalStatus.companyAdmin === 'Approved',
    executiveApproved: approvalStatus.executive === 'Approved',
    teamLeaderApproved: approvalStatus.teamLeader === 'Approved',
  });
};

const resolveApproverIds = async (companyId: string, userId: string): Promise<Record<ApprovalTier, string>> => {
  const ids: Record<ApprovalTier, string> = { reportingManager: '', companyAdmin: '', executive: '', teamLeader: '' };
  try {
    const empSnap = await getDocs(query(collection(db, 'employees'), where('userId', '==', userId)));
    if (!empSnap.empty && empSnap.docs[0].data().reportingManagerId) ids.reportingManager = empSnap.docs[0].data().reportingManagerId;
  } catch {}
  try {
    const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'company-admin'), where('companyId', '==', companyId)));
    if (!adminSnap.empty) ids.companyAdmin = adminSnap.docs[0].id;
  } catch {}
  try {
    const tlSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'team-leader')));
    const tls = tlSnap.docs;
    // Authoritative Team Leader resolution, mirroring the web service + backend
    // trigger. The TL must be the one linked to this company's Executive(s) —
    // NOT an arbitrary "first TL in the database". Without this, a stale TL is
    // stamped at request time and an Executive-approved RM / HR submission
    // would never land in the *assigned* Team Leader's pending queue.
    const execIds = new Set<string>();
    try {
      const co = await getDoc(doc(db, 'companies', companyId)).catch(() => null);
      if (co?.exists()) {
        const c = co.data() || {};
        if (c.assignedExecutiveId) execIds.add(String(c.assignedExecutiveId));
        if (Array.isArray(c.assignedExecutiveIds)) (c.assignedExecutiveIds as string[]).forEach((e) => execIds.add(String(e)));
      }
    } catch {}
    try {
      const execSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'executive')));
      for (const d of execSnap.docs) {
        if (Array.isArray(d.data().assignedCompanyIds) && (d.data().assignedCompanyIds as string[]).includes(companyId)) execIds.add(d.id);
      }
    } catch {}
    try {
      if (execIds.size > 0) {
        for (const eid of execIds) {
          const edoc = await getDoc(doc(db, 'users', eid)).catch(() => null);
          if (edoc?.exists()) {
            const assigned: string[] = Array.isArray(edoc.data().assignedTeamLeaderIds) ? edoc.data().assignedTeamLeaderIds : [];
            if (assigned.length > 0) { ids.teamLeader = String(assigned[0]); break; }
          }
        }
      }
      if (!ids.teamLeader) {
        for (const d of tls) {
          const tl = d.data();
          const linked: string[] = Array.isArray(tl.linkedExecutiveIds) ? tl.linkedExecutiveIds
            : (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : []);
          if (linked.some((le) => execIds.has(String(le)))) { ids.teamLeader = d.id; break; }
        }
      }
      if (!ids.teamLeader) {
        for (const d of tls) {
          if (Array.isArray(d.data().assignedCompanyIds) && (d.data().assignedCompanyIds as string[]).includes(companyId)) {
            ids.teamLeader = d.id; break;
          }
        }
      }
    } catch {}
  } catch {}
  try {
    const execSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'executive')));
    for (const d of execSnap.docs) {
      if (d.data().assignedCompanyIds?.includes(companyId)) { ids.executive = d.id; break; }
    }
  } catch {}
  return ids;
};

export const MISSED_PUNCH_TIER_ORDER: ApprovalTier[] = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];

export const MISSED_PUNCH_TIER_LABELS: Record<ApprovalTier, string> = {
  reportingManager: 'Reporting Manager',
  companyAdmin: 'Company Admin',
  executive: 'Executive',
  teamLeader: 'Team Leader',
};

export const MISSED_PUNCH_MASTER_ADMIN_LABEL = 'Master Admin';

/** Role-aware display label for a verification tier (mirrors the web service). */
export const missedPunchTierLabel = (tier: string): string =>
  MISSED_PUNCH_TIER_LABELS[tier as ApprovalTier] || (tier === 'masterAdmin' ? MISSED_PUNCH_MASTER_ADMIN_LABEL : tier);

/**
 * Effective missed-punch verification tiers for an applicant role:
 * - Reporting Manager / HR self-app: 3 tiers (CA → Exec → TL, RM self-tier auto-completes)
 * - Executive self-app: Team Leader only (Exec → TL → Master Admin)
 * - Team Leader self-app: none (direct to Master Admin)
 * - Normal employee: all 4 tiers (RM → CA → Exec → TL)
 */
export const getEffectiveMissedPunchTiers = (applicantRole?: string): ApprovalTier[] => {
  if (applicantRole === 'reporting-manager' || applicantRole === 'hr-manager') return ['companyAdmin', 'executive', 'teamLeader'];
  if (applicantRole === 'executive') return ['teamLeader'];
  if (applicantRole === 'team-leader') return [];
  return [...MISSED_PUNCH_TIER_ORDER];
};

/**
 * Record-aware effective verification tiers for a missed-punch document.
 * Starts from the role-based chain, then trims the Reporting Manager step whenever
 * it was system-auto-completed instead of going through a real human review
 * (phantom/ghost RM — "Approved but no audit-log entry" — so the progress header,
 * modal title and chip track stay in strict agreement with the actual audit chain).
 */
export const getRecordEffectiveMissedPunchTiers = (mp?: {
  applicantRole?: string;
  approvalStatus?: Partial<Record<ApprovalTier, ApprovalLevel>>;
  approvalLog?: Array<{ tier?: ApprovalTier | string }>;
}): ApprovalTier[] => {
  const tiers = getEffectiveMissedPunchTiers(mp?.applicantRole);
  if (!tiers.includes('reportingManager')) return tiers;
  const rmPhantom =
    mp?.approvalStatus?.reportingManager === 'Approved' &&
    !(mp?.approvalLog || []).some((e) => e?.tier === 'reportingManager');
  return rmPhantom ? tiers.filter((t) => t !== 'reportingManager') : tiers;
};

/** Progress over only the effective steps plus the Master Admin final gate. */
export const computeMissedPunchProgress = (mp?: {
  applicantRole?: string;
  approvalStatus?: Partial<Record<ApprovalTier, ApprovalLevel>>;
  approvalLog?: Array<{ tier?: ApprovalTier | string }>;
  masterAdminRequired?: boolean;
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null;
}): number => {
  if (!mp?.approvalStatus) return 0;
  const tiers = getRecordEffectiveMissedPunchTiers(mp);
  const tierDone = tiers.filter((t) => mp.approvalStatus?.[t] === 'Approved' || mp.approvalStatus?.[t] === 'Rejected').length;
  const maDone = mp.masterAdminRequired && (mp.masterAdminApproveStatus === 'Approved' || mp.masterAdminApproveStatus === 'Rejected');
  return tierDone + (maDone ? 1 : 0);
};

/** Total verification steps rendered (effective tiers + optional Master Admin gate). */
export const computeMissedPunchTotalTiers = (mp?: {
  applicantRole?: string;
  approvalStatus?: Partial<Record<ApprovalTier, ApprovalLevel>>;
  approvalLog?: Array<{ tier?: ApprovalTier | string }>;
  masterAdminRequired?: boolean;
}): number => {
  const tiers = getRecordEffectiveMissedPunchTiers(mp);
  return tiers.length + (mp?.masterAdminRequired ? 1 : 0);
};

export const computeMissedPunchCount = (approvalStatus?: Record<ApprovalTier, ApprovalLevel>): number => {
  const s: Record<ApprovalTier, ApprovalLevel> = approvalStatus ?? ({} as Record<ApprovalTier, ApprovalLevel>);
  return MISSED_PUNCH_TIER_ORDER.filter((t) => s[t] === 'Approved' || s[t] === 'Rejected').length;
};

export const computeMissedPunchStatus = (approvalStatus?: Record<ApprovalTier, ApprovalLevel>): 'Pending' | 'Approved' | 'Rejected' => {
  const s: Record<ApprovalTier, ApprovalLevel> = approvalStatus ?? ({} as Record<ApprovalTier, ApprovalLevel>);
  for (const t of MISSED_PUNCH_TIER_ORDER) if (s[t] === 'Rejected') return 'Rejected';
  return MISSED_PUNCH_TIER_ORDER.every((t) => s[t] === 'Approved') ? 'Approved' : 'Pending';
};

/** Overall missed-punch status with the Master Admin final gate applied. */
export const computeOverallMissedPunchStatus = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): 'Pending' | 'Approved' | 'Rejected' => {
  for (const t of MISSED_PUNCH_TIER_ORDER) if (approvalStatus[t] === 'Rejected') return 'Rejected';
  if (masterAdminRequired && masterAdminApproveStatus === 'Rejected') return 'Rejected';
  if (!MISSED_PUNCH_TIER_ORDER.every((t) => approvalStatus[t] === 'Approved')) return 'Pending';
  if (masterAdminRequired) {
    return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
  }
  return 'Approved';
};

export const getNextPendingMissedPunchTier = (approvalStatus?: Record<ApprovalTier, ApprovalLevel>): ApprovalTier | null => {
  const s: Record<ApprovalTier, ApprovalLevel> = approvalStatus ?? ({} as Record<ApprovalTier, ApprovalLevel>);
  for (const t of MISSED_PUNCH_TIER_ORDER) if (s[t] === 'Pending') return t;
  return null;
};

/**
 * The missed-punch verification tier (if any) that currently awaits THIS
 * user's decision on a record: the next Pending tier for which the user is the
 * stamped approver, or — for legacy records with no stamped approver — the
 * natural role holder of the tier. Mirrors the web's
 * `getActionableMissedPunchTier` so dashboard counters equal the actionable
 * rows in the Attendance management queues on both platforms.
 */
export const getActionableMissedPunchTier = (
  rec: {
    companyId?: string;
    missedPunchRectification?: {
      requested?: boolean;
      resolved?: boolean;
      approvalStatus?: Record<ApprovalTier, ApprovalLevel>;
      approverIds?: Partial<Record<ApprovalTier, string>>;
    };
  },
  uid: string,
  role: string | undefined,
  scopeCompanyIds?: string[],
): ApprovalTier | null => {
  const mp = rec?.missedPunchRectification;
  if (!mp?.requested || !mp?.approvalStatus) return null;
  if (scopeCompanyIds && scopeCompanyIds.length > 0 && (!rec?.companyId || !scopeCompanyIds.includes(rec.companyId))) return null;
  const next = getNextPendingMissedPunchTier(mp.approvalStatus);
  if (!next) return null;
  const approverId = mp.approverIds?.[next];
  if (approverId === uid) return next;
  if (approverId) return null;
  if ((role === 'reporting-manager' || role === 'hr-manager') && next === 'reportingManager') return next;
  if (role === 'company-admin' && next === 'companyAdmin') return next;
  if (role === 'executive' && next === 'executive') return next;
  if (role === 'team-leader' && next === 'teamLeader') return next;
  return null;
};

/**
 * 4-tier sequential missed-punch review. Strictly gated: a tier may only be
 * acted on when every preceding tier is Approved. The backend trigger
 * reconciles the flat flags + count authoritatively.
 */
export const reviewMissedPunchTier = async (
  attendanceId: string,
  tier: ApprovalTier,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote: string,
): Promise<void> => {
  const docRef = doc(db, 'attendance', attendanceId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Attendance record not found');
  const mp = (snap.data().missedPunchRectification || {}) as Record<string, any>;
  const current: Record<ApprovalTier, ApprovalLevel> = mp.approvalStatus || {};
  if (current[tier] && current[tier] !== 'Pending') throw new Error(`This tier has already been ${current[tier]}`);

  const idx = MISSED_PUNCH_TIER_ORDER.indexOf(tier);
  if (idx > 0) {
    for (let i = 0; i < idx; i++) {
      if (current[MISSED_PUNCH_TIER_ORDER[i]] !== 'Approved') {
        throw new Error('Previous verification tiers must be completed before acting on this tier');
      }
    }
  }

  // Only the currently assigned approver of this step may act (mirrors the web
  // service + Firestore rules). Legacy docs with an empty approver stamp remain
  // open to their natural role holder.
  const assignedApprover = mp.approverIds?.[tier];
  if (assignedApprover && assignedApprover !== reviewedBy) {
    throw new Error('You are not authorized to review this verification step.');
  }
  if (mp.resolved) {
    throw new Error('This request has already been resolved.');
  }

  const callableFn = httpsCallable(functions, 'mobileReviewMissedPunchTier');
  await callableFn({
    attendanceId,
    tier,
    action,
    reviewedBy,
    reviewedByName,
    reviewNote,
  });
};

/**
 * Master Admin final review for a Team Leader / Executive missed-punch
 * self-correction. Requires the full 4-tier chain to be approved and a
 * mandatory remark, then finalizes the nested rectification status. The backend
 * trigger applies the corrected checkout on full approval.
 */
export const reviewMasterAdminMissedPunch = async (
  attendanceId: string,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote: string,
): Promise<void> => {
  const docRef = doc(db, 'attendance', attendanceId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Attendance record not found');
  const mp = (snap.data().missedPunchRectification || {}) as Record<string, any>;
  if (!mp.masterAdminRequired) {
    throw new Error('This missed punch does not require Master Admin verification.');
  }
  if (mp.masterAdminApproverId && mp.masterAdminApproverId !== reviewedBy) {
    throw new Error('You are not the assigned Master Admin for this request.');
  }
  if (mp.masterAdminApproveStatus && mp.masterAdminApproveStatus !== 'Pending') {
    throw new Error(`Master Admin verification has already been ${mp.masterAdminApproveStatus}.`);
  }
  if (!reviewNote || !reviewNote.trim()) {
    throw new Error('A mandatory remark is required for Master Admin review.');
  }
  const current: Record<ApprovalTier, ApprovalLevel> = mp.approvalStatus || {};
  // For Executive self-apps only the Team Leader tier needs verification; for
  // Team Leader self-apps all tiers are auto-completed. Validate only the tiers
  // that actually required action.
  const effectiveTiers: ApprovalTier[] = mp.applicantRole === 'executive'
    ? ['teamLeader']
    : mp.applicantRole === 'team-leader'
      ? []
      : [...MISSED_PUNCH_TIER_ORDER];
  if (effectiveTiers.length > 0 && !effectiveTiers.every((t) => current[t] === 'Approved')) {
    throw new Error('The required verification tiers must be fully approved before Master Admin review.');
  }

  const callableFn = httpsCallable(functions, 'mobileReviewMasterAdminMissedPunch');
  await callableFn({
    attendanceId,
    action,
    reviewedBy,
    reviewedByName,
    reviewNote,
  });
};
