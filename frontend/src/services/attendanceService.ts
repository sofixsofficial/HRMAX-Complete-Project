import { 
  collection, query, where, onSnapshot, 
  doc, addDoc, updateDoc, getDocs, getDoc, deleteDoc,
  serverTimestamp 
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { AttendanceRecord, Employee, ApprovalTier, ApprovalLevel } from '../types/user';
import { getCompanySettings } from './shiftService';
import { getLeaveRequestsByUser, resolveApplicantRole, resolveMasterAdminApproverId, findManagingTeamLeaderForExec, getReviewerRole } from './leaveService';
import { getHolidaysByCompany } from './holidayService';
import { getCompanyById } from './companyService';
import { isWithinAttendanceCorrectionWindow, parseWeekendDays, toDateKey } from '../utils/workingDays';
import {
  notifyMissedPunchTierApproved,
  notifyMissedPunchRejectedByTier,
  notifyMissedPunchFullyApproved,
  notifyMissedPunchSubmitted,
  notifyMissedPunchSubmittedToTier,
  notifyMasterAdmins,
  notifyApprovalDecision,
} from './notificationService';

/** Human day label for notification copy. */
const fmtDay = (v: unknown): string => {
  if (!v) return '';
  const d: Date = v instanceof Date ? v : (typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate()
    : new Date(v as string | number));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

const COLLECTION_NAME = 'attendance';
const attendanceRef = collection(db, COLLECTION_NAME);

const mapRecord = (d: any): AttendanceRecord => {
  const data = d.data ? d.data() : d;
  return {
    id: d.id,
    ...data,
    date: data.date?.toDate ? data.date.toDate() : data.date || new Date(),
    checkIn: data.checkIn?.toDate ? data.checkIn.toDate() : data.checkIn || null,
    checkOut: data.checkOut?.toDate ? data.checkOut.toDate() : data.checkOut || null,
    approvedOn: data.approvedOn?.toDate ? data.approvedOn.toDate() : data.approvedOn || null,
    missedPunchRectification: data.missedPunchRectification ? {
      ...data.missedPunchRectification,
      requestedAt: data.missedPunchRectification.requestedAt?.toDate ? data.missedPunchRectification.requestedAt.toDate() : data.missedPunchRectification.requestedAt || null,
      correctedCheckOut: data.missedPunchRectification.correctedCheckOut?.toDate ? data.missedPunchRectification.correctedCheckOut.toDate() : data.missedPunchRectification.correctedCheckOut || null,
      resolvedAt: data.missedPunchRectification.resolvedAt?.toDate ? data.missedPunchRectification.resolvedAt.toDate() : data.missedPunchRectification.resolvedAt || null,
      approvalLog: (data.missedPunchRectification.approvalLog || []).map((e: any) => ({
        ...e,
        approvedOn: e.approvedOn?.toDate ? e.approvedOn.toDate() : new Date(),
      })),
    } : undefined,
  } as AttendanceRecord;
};

// ============================================
// HELPERS
// ============================================

function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function parseTimeString(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Check if an employee has an approved leave covering a given date */
async function hasApprovedLeaveForDate(userId: string, date: Date): Promise<boolean> {
  try {
    const leaves = await getLeaveRequestsByUser(userId);
    const dateStr = date.toDateString();
    return leaves.some(l =>
      l.status === 'Approved' &&
      new Date(l.startDate).toDateString() <= dateStr &&
      new Date(l.endDate).toDateString() >= dateStr
    );
  } catch {
    return false;
  }
}

// ============================================
// CRUD
// ============================================

export const getAllAttendance = async (): Promise<AttendanceRecord[]> => {
  const snapshot = await getDocs(attendanceRef);
  return snapshot.docs.map(mapRecord);
};

export const getAttendanceByCompany = async (companyId: string): Promise<AttendanceRecord[]> => {
  const q = query(attendanceRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapRecord);
};

export const getAttendanceByUser = async (userId: string): Promise<AttendanceRecord[]> => {
  const q = query(attendanceRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapRecord);
};

export const getAttendanceByDate = async (date: Date): Promise<AttendanceRecord[]> => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const q = query(
    attendanceRef,
    where('date', '>=', startOfDay),
    where('date', '<=', endOfDay)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapRecord);
};

export const hasCheckedInToday = async (userId: string): Promise<AttendanceRecord | null> => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const q = query(
    attendanceRef,
    where('userId', '==', userId),
    where('date', '>=', startOfDay),
    where('date', '<=', endOfDay)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return mapRecord(snapshot.docs[0]);
};

// ============================================
// SHIFT-AWARE CHECK-IN
// ============================================

export const checkIn = async (data: {
  userId: string;
  companyId: string;
  name: string;
  email: string;
  avatar: string;
  employeeId: string;
  department: string;
  departmentColor: string;
  departmentId?: string;
  date?: Date;
  latitude?: number;
  longitude?: number;
  /** Pass employee shift fields to enable late-detection */
  employee?: Employee;
}): Promise<AttendanceRecord> => {
  const existing = await hasCheckedInToday(data.userId);
  if (existing) {
    throw new Error('You have already checked in today. Please check out first.');
  }

  const now = data.date || new Date();

  // Check for approved leave → automatically mark as "On Leave"
  const onLeave = await hasApprovedLeaveForDate(data.userId, now);
  if (onLeave) {
    const leaveRecord = {
      userId: data.userId,
      companyId: data.companyId,
      name: data.name,
      email: data.email,
      avatar: data.avatar,
      employeeId: data.employeeId,
      department: data.department,
      departmentColor: data.departmentColor,
      departmentId: data.departmentId || null,
      date: now,
      checkIn: serverTimestamp(),
      checkOut: null,
      status: 'On Leave',
      workHours: 0,
    };
    const docRef = await addDoc(attendanceRef, leaveRecord);
    return { ...leaveRecord, id: docRef.id, checkIn: now, status: 'On Leave' as AttendanceRecord['status'] } as AttendanceRecord;
  }

  // Determine shift boundaries
  const emp = data.employee;
  const shiftStartStr = emp?.shiftStart || '09:00';
  const shiftEndStr = emp?.shiftEnd || '18:00';
  const shiftType = emp?.shiftType || 'Morning';

  let status: AttendanceRecord['status'] = 'Present';
  let lateMinutes = 0;

  // Get company's grace period setting
  let gracePeriod = 15;
  try {
    const settings = await getCompanySettings(data.companyId);
    if (settings) gracePeriod = settings.gracePeriodMinutes;
  } catch {}

  // Late detection: compare check-in time to shift start
  const checkInMinutes = getMinutesSinceMidnight(now);
  const shiftStartMinutes = parseTimeString(shiftStartStr);

  if (checkInMinutes > shiftStartMinutes) {
    const diff = checkInMinutes - shiftStartMinutes;
    if (diff <= gracePeriod) {
      status = 'Present'; // within grace → still present
    } else {
      status = 'Late';
      lateMinutes = diff;
    }
  }

  const newRecord = {
    userId: data.userId,
    companyId: data.companyId,
    name: data.name,
    email: data.email,
    avatar: data.avatar,
    employeeId: data.employeeId,
    department: data.department,
    departmentColor: data.departmentColor,
    departmentId: data.departmentId || null,
    date: now,
    checkIn: serverTimestamp(),
    checkOut: null,
    status,
    workHours: 0,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    shiftId: emp?.shiftId || null,
    shiftStart: shiftStartStr,
    shiftEnd: shiftEndStr,
    shiftType,
    isAutoApproved: true,
    approved: true,
    approvedByName: 'System (Auto-Approved)',
    lateMinutes: status === 'Late' ? lateMinutes : 0,
  };

  const docRef = await addDoc(attendanceRef, newRecord);

  return {
    id: docRef.id,
    ...newRecord,
    date: now,
    checkIn: now,
    checkOut: null,
  } as unknown as AttendanceRecord;
};

// ============================================
// SHIFT-AWARE CHECK-OUT WITH OVERTIME
// ============================================

export const checkOut = async (attendanceId: string): Promise<AttendanceRecord | null> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const snapshot = await getDoc(docRef);
  
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const checkInTime = data.checkIn?.toDate ? data.checkIn.toDate() : data.checkIn || new Date();
  const checkOutTime = new Date();
  const workHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

  // Overtime calculation: compare checkOut against shiftEnd
  const shiftEndStr: string = data.shiftEnd || '18:00';
  let overtimeHours = 0;
  const otThresholdMinutes = 30;

  if (shiftEndStr) {
    const [endH, endM] = shiftEndStr.split(':').map(Number);
    const shiftEndToday = new Date(checkOutTime);
    shiftEndToday.setHours(endH, endM, 0, 0);

    if (checkOutTime > shiftEndToday) {
      const diffMinutes = (checkOutTime.getTime() - shiftEndToday.getTime()) / (1000 * 60);
      if (diffMinutes > otThresholdMinutes) {
        overtimeHours = Math.round((diffMinutes / 60) * 100) / 100;
      }
    }
  }

  const updates: Record<string, any> = {
    checkOut: serverTimestamp(),
    workHours: Math.round(workHours * 100) / 100,
    overtimeHours,
  };

  if (checkOutTime > checkInTime) {
    updates.isAutoApproved = true;
    updates.approved = true;
    updates.approvedOn = serverTimestamp();
    updates.approvedByName = 'System (Auto-Approved)';
  }

  if (data.companyId) {
    try {
      const { httpsCallable } = await import('../aws/functions-compat');
      const { functions: fns } = await import('../aws/clients');
      const markAttendance = httpsCallable(fns, 'markAttendance');
      await markAttendance({
        action: 'check-out',
        companyId: data.companyId,
        attendanceId,
      });
    } catch (fnErr: any) {
      // Only business validations (already checked out, wrong company, failed
      // preconditions, etc.) should abort the check-out. Transport/availability
      // failures (function not deployed, CORS, timeouts, transient 5xx) fall
      // back to the direct client write so a check-out never bricks just
      // because the callable was unreachable or the region not found.
      const code = String(fnErr?.code || '');
      const msg = String(fnErr?.message || '');
      const transportFailure =
        code === 'functions-not-found' ||
        code === 'unavailable' ||
        code === 'deadline-exceeded' ||
        code === 'cancelled' ||
        code === 'internal' ||
        /cors/i.test(msg) ||
        /not found/i.test(msg);
      if (!transportFailure) {
        throw fnErr;
      }
      console.warn('[Attendance] Cloud function unavailable, using direct check-out:', msg);
      await updateDoc(docRef, updates);
    }
  } else {
    await updateDoc(docRef, updates);
  }

  const freshSnap = await getDoc(docRef);
  return freshSnap.exists() ? mapRecord(freshSnap) : null;
};

// ============================================
// 2-WORKING-DAY CORRECTION WINDOW
// ============================================

/** Resolve the company's weekend + holiday calendar for the attendance /
 *  missed-punch / leave re-submission correction window (2 working days). */
export const resolveAttendanceCorrectionWindow = async (companyId: string): Promise<{ weekendDays: number[]; holidayKeys: string[] }> => {
  let weekendDays: number[] = [0, 6]
  let holidayKeys: string[] = []
  try {
    const comp = await getCompanyById(companyId).catch(() => null)
    if (comp) weekendDays = parseWeekendDays((comp as any)?.payrollSettings?.weekends)
  } catch { /* default Sat+Sun */ }
  try {
    const holidays = await getHolidaysByCompany(companyId).catch(() => [])
    holidayKeys = holidays.map(h => toDateKey(h.date)).filter(Boolean)
  } catch { /* no holidays */ }
  return { weekendDays, holidayKeys }
}

/** Guard used by the attendance/missed-punch/leave self-correction flows. */
export const assertWithinAttendanceCorrectionWindow = (
  from: Date | string | number,
  weekendDays: number[],
  holidayKeys: string[],
): void => {
  if (!isWithinAttendanceCorrectionWindow(from, new Date(), weekendDays, holidayKeys)) {
    throw new Error('The 2-working-day correction window for this day has closed. Changes can no longer be made to this attendance record.')
  }
};

// ============================================
// MISSED PUNCH DETECTION
// ============================================

/** Check for missed punches (check-in without check-out after shift end + threshold) */
export const detectMissedPunches = async (companyId: string): Promise<AttendanceRecord[]> => {
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const records = await getAttendanceByCompany(companyId);

  const missed: AttendanceRecord[] = [];
  const now = new Date();

  for (const rec of records) {
    // Only consider today's records
    const recDate = new Date(rec.date);
    if (recDate.toDateString() !== today.toDateString()) continue;

    // Has check-in but no check-out
    if (rec.checkIn && !rec.checkOut) {
      const shiftEndStr = rec.shiftEnd || '18:00';
      const shiftEndMinutes = parseTimeString(shiftEndStr);
      const nowMinutes = getMinutesSinceMidnight(now);
      const nowDay = now.getDay();

      // Skip weekends if no shift defined
      if (nowDay === 0 || nowDay === 6) continue;

      // Only flag if current time is past shift end + threshold
      let threshold = 60;
      try {
        if (companyId) {
          const settings = await getCompanySettings(companyId);
          if (settings) threshold = settings.missedPunchThresholdMinutes;
        }
      } catch {}

      if (nowMinutes >= shiftEndMinutes + threshold) {
        if (rec.status !== 'Miss Punch' && rec.status !== 'On Leave') {
          await updateDoc(doc(db, COLLECTION_NAME, rec.id), { status: 'Miss Punch' });
          missed.push({ ...rec, status: 'Miss Punch' });
        }
      }
    }
  }

  return missed;
};

// ============================================
// MISSED PUNCH RECTIFICATION (STANDARDIZED TIER CHAIN)
// ============================================

/**
 * Standardized sequential verification chain matching the leave hierarchy:
 *   Employee  → 4-tier: Reporting Manager → Company Admin → Executive → Team Leader
 *   RM / HR   → 3-tier: Company Admin → Executive → Team Leader  (RM self-tier auto-completes)
 *   Executive → 2-tier: Team Leader → Master Admin  (RM/CA/Exec auto-complete, TL active)
 *   Team Lead → 1-tier: Master Admin  (all tiers auto-complete, direct MA gate)
 * Single source of truth for ordering, gating, next-pending tier, and progress.
 */
export const MISSED_PUNCH_TIER_ORDER: ApprovalTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];

export const MISSED_PUNCH_TIER_LABELS: Record<ApprovalTier, string> = {
  reportingManager: 'Reporting Manager',
  hr: 'HR',
  companyAdmin: 'Company Admin',
  executive: 'Executive',
  teamLeader: 'Team Leader',
};

const INITIAL_MP_APPROVAL_STATUS: Record<ApprovalTier, ApprovalLevel> = {
  reportingManager: 'Pending',
  hr: 'Pending',
  companyAdmin: 'Pending',
  executive: 'Pending',
  teamLeader: 'Pending',
};

/** A tier that needs no further decision: approved, or skipped for this role. */
const mpTierSettled = (level?: ApprovalLevel | string): boolean =>
  level === 'Approved' || level === 'Skipped';

export const computeMissedPunchStatus = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
): 'Pending' | 'Approved' | 'Rejected' => {
  for (const tier of MISSED_PUNCH_TIER_ORDER) {
    if (approvalStatus[tier] === 'Rejected') return 'Rejected';
  }
  return MISSED_PUNCH_TIER_ORDER.every(t => mpTierSettled(approvalStatus[t])) ? 'Approved' : 'Pending';
};

export const getNextPendingMissedPunchTier = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
): ApprovalTier | null => {
  for (const tier of MISSED_PUNCH_TIER_ORDER) {
    if (approvalStatus[tier] === 'Pending') return tier;
  }
  return null;
};

/**
 * The missed-punch verification tier (if any) that currently awaits THIS
 * user's decision on a record: the next Pending tier for which the user is the
 * stamped approver, or — for legacy records with no stamped approver — the
 * natural role holder of the tier. Mirrors the Attendance page row gating
 * (including the same company-scope check) so dashboard counters equal the
 * actionable rows in the Attendance management tables.
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
  if (scopeCompanyIds && scopeCompanyIds.length > 0 && (!rec?.companyId || !scopeCompanyIds.includes(rec?.companyId))) return null;
  const next = getNextPendingMissedPunchTier(mp.approvalStatus);
  if (!next) return null;
  const approverId = mp.approverIds?.[next];
  if (approverId === uid) return next;
  if (approverId) return null;
  if ((role === 'reporting-manager' || role === 'hr-manager') && next === 'reportingManager') return next;
  if (role === 'hr' && next === 'hr') return next;
  if (role === 'hr' && next === 'hr') return next;
  if (role === 'company-admin' && next === 'companyAdmin') return next;
  if (role === 'executive' && next === 'executive') return next;
  if (role === 'team-leader' && next === 'teamLeader') return next;
  return null;
};

/**
 * Returns the effective missed-punch verification tiers for a given applicant
 * role. The missed-punch chain (as documented on Attendance.tsx and in the
 * MyLeavesAttendance routing copy) is:
 * - Employee:             Reporting Manager -> Company Admin -> Executive -> Team Leader
 * - Reporting Manager:    Company Admin -> Executive -> Team Leader
 * - HR:                   Company Admin -> Executive -> Team Leader
 * - Executive self-app:   Team Leader -> Master Admin
 * - Team Leader self-app: none (direct to Master Admin)
 */
export const getEffectiveMissedPunchTiers = (applicantRole?: string): ApprovalTier[] => {
  if (applicantRole === 'reporting-manager') return ['companyAdmin', 'executive', 'teamLeader'];
  if (applicantRole === 'hr' || applicantRole === 'hr-manager') return ['companyAdmin', 'executive', 'teamLeader'];
  if (applicantRole === 'executive') return ['teamLeader'];
  if (applicantRole === 'team-leader') return [];
  if (applicantRole === 'employee') return ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'];
  return [...MISSED_PUNCH_TIER_ORDER];
};

/**
 * Record-aware effective verification tiers for a missed-punch document.
 * Starts from the role-based chain, then trims the Reporting Manager step whenever
 * it was system-auto-completed instead of going through a real human review:
 * - RM approver unassigned on the company → tier auto-advanced (no audit entry)
 * - RM / HR self-application → their own tier auto-completes (no audit entry)
 * Auto-completed tiers never appear in the approvalLog, so "Approved but no log
 * entry" reliably identifies the phantom step. Keeps the progress header, modal
 * title and chip track in strict agreement with the actual audit chain
 * (Employee w/ unassigned RM, RM, HR = 3/3; Employee w/ active RM = 4/4).
 */
export const getRecordEffectiveMissedPunchTiers = (mp?: {
  applicantRole?: string;
  approvalStatus?: Partial<Record<ApprovalTier, ApprovalLevel>>;
  approvalLog?: Array<{ tier?: ApprovalTier | string }>;
}): ApprovalTier[] => {
  const tiers = getEffectiveMissedPunchTiers(mp?.applicantRole);
  if (!tiers.includes('reportingManager')) return tiers;
  const rmPhantom =
    (mp?.approvalStatus?.reportingManager === 'Approved' || mp?.approvalStatus?.reportingManager === 'Skipped') &&
    !(mp?.approvalLog || []).some(e => e?.tier === 'reportingManager');
  return rmPhantom ? tiers.filter(t => t !== 'reportingManager') : tiers;
};

export const computeMissedPunchApprovalCount = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
): number =>
  MISSED_PUNCH_TIER_ORDER.filter(t => approvalStatus[t] === 'Approved' || approvalStatus[t] === 'Rejected').length;

// ============================================
// MASTER ADMIN FINAL-VERIFICATION (TL / EXEC self-applications)
// ============================================

const MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader', 'executive']);

/** Compute the final missed-punch status with the Master Admin gate applied. */
export const computeOverallMissedPunchStatus = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): 'Pending' | 'Approved' | 'Rejected' => {
  for (const tier of MISSED_PUNCH_TIER_ORDER) {
    if (approvalStatus[tier] === 'Rejected') return 'Rejected';
  }
  if (masterAdminRequired && masterAdminApproveStatus === 'Rejected') return 'Rejected';
  const allTiersApproved = MISSED_PUNCH_TIER_ORDER.every(t => mpTierSettled(approvalStatus[t]));
  if (!allTiersApproved) return 'Pending';
  if (masterAdminRequired) {
    return masterAdminApproveStatus === 'Approved' ? 'Approved' : 'Pending';
  }
  return 'Approved';
};

/** True when the TLS/Exec missed-punch still awaits a Master Admin decision. */
export const isAwaitingMissedPunchMasterAdmin = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  masterAdminRequired?: boolean,
  masterAdminApproveStatus?: 'Pending' | 'Approved' | 'Rejected' | null,
): boolean => {
  if (!masterAdminRequired) return false;
  if (masterAdminApproveStatus === 'Approved' || masterAdminApproveStatus === 'Rejected') return false;
  return MISSED_PUNCH_TIER_ORDER.every(t => mpTierSettled(approvalStatus[t]));
};

const areAllPreviousMissedPunchTiersApproved = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  targetTier: ApprovalTier,
): boolean => {
  const targetIndex = MISSED_PUNCH_TIER_ORDER.indexOf(targetTier);
  if (targetIndex <= 0) return true;
  for (let i = 0; i < targetIndex; i++) {
    const level = approvalStatus[MISSED_PUNCH_TIER_ORDER[i]];
    // Skipped tiers (not part of this requester's chain) block nobody.
    if (level !== 'Approved' && level !== 'Skipped') return false;
  }
  return true;
};

const computeMissedPunchFlags = (approvalStatus: Record<ApprovalTier, ApprovalLevel>) => ({
  reportingManagerApproved: approvalStatus.reportingManager === 'Approved',
  hrApproved: approvalStatus.hr === 'Approved',
  companyAdminApproved: approvalStatus.companyAdmin === 'Approved',
  executiveApproved: approvalStatus.executive === 'Approved',
  teamLeaderApproved: approvalStatus.teamLeader === 'Approved',
});

/**
 * Resolve the Team Leader assigned to a company's Executive (the tier-3
 * approver). Mirrors the backend `resolveManagementStakeholders` TL logic so the
 * same Linked-TL / assigned-TL hierarchy is used everywhere:
 *   1. Executive(s) for the company (company doc assignedExecutiveId/Ids, else
 *      users with assignedCompanyIds containing the company).
 *   2. The executive's own `assignedTeamLeaderIds`.
 *   3. Any TL whose `linkedExecutiveIds` / `reportingExecutiveId` matches.
 *   4. Any TL scoped to the company via `assignedCompanyIds`.
 * There is deliberately NO arbitrary "first TL in the database" fallback — an
 * unassigned company simply has no TL approver (chain then routes onward).
 */
const resolveTLForCompany = async (companyId: string): Promise<string> => {
  const execIds = new Set<string>()
  try {
    const comp: any = await getCompanyById(companyId).catch(() => null)
    if (comp) {
      if (comp.assignedExecutiveId) execIds.add(String(comp.assignedExecutiveId))
      if (Array.isArray(comp.assignedExecutiveIds)) (comp.assignedExecutiveIds as string[]).forEach((e: string) => execIds.add(String(e)))
    }
  } catch {}
  try {
    const execSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'executive')))
    for (const d of execSnap.docs) {
      const u = d.data()
      if (Array.isArray(u.assignedCompanyIds) && (u.assignedCompanyIds as string[]).includes(companyId)) execIds.add(d.id)
    }
  } catch {}
  try {
    const tlSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'team-leader')))
    const tls = tlSnap.docs.map(d => ({ id: d.id, data: d.data() }))
    if (execIds.size > 0) {
      for (const eid of execIds) {
        try {
          const eDoc = await getDoc(doc(db, 'users', eid)).catch(() => null)
          if (eDoc?.exists) {
            const assigned = eDoc.data()?.assignedTeamLeaderIds
            if (Array.isArray(assigned) && assigned.length > 0) return String(assigned[0])
          }
        } catch {}
      }
      for (const tl of tls) {
        const linked: string[] = tl.data.linkedExecutiveIds || (tl.data.reportingExecutiveId ? [tl.data.reportingExecutiveId] : [])
        if (linked.some((le: string) => execIds.has(String(le)))) return tl.id
      }
    }
    for (const tl of tls) {
      if (Array.isArray(tl.data.assignedCompanyIds) && (tl.data.assignedCompanyIds as string[]).includes(companyId)) return tl.id
    }
  } catch {}
  return ''
}

/**
 * Compute the workflow routing state for a missed-punch rectification: which
 * tier is awaiting action and who is assigned to that step. When every tier is
 * approved and a Master Admin gate is pending, routing points at the Master
 * Admin; when fully resolved, both fields are null/''.
 */
export const computeMissedPunchRouting = (
  approvalStatus: Record<ApprovalTier, ApprovalLevel>,
  approverIds: Record<ApprovalTier, string>,
  masterAdminRequired: boolean,
  masterAdminApproverId: string,
): { currentTier: ApprovalTier | 'masterAdmin' | null; assignee: string } => {
  const next = getNextPendingMissedPunchTier(approvalStatus)
  if (next) return { currentTier: next, assignee: approverIds[next] || '' }
  if (masterAdminRequired) return { currentTier: 'masterAdmin', assignee: masterAdminApproverId }
  return { currentTier: null, assignee: '' }
}

// Resolve the missed-punch approver ids (shared with the leave chain logic
// mirrored here so a single employee always has a consistent same-company chain).
const resolveMissedPunchApproverIds = async (companyId: string, employeeUserId: string): Promise<Record<ApprovalTier, string>> => {
  const ids: Record<ApprovalTier, string> = { reportingManager: '', hr: '', companyAdmin: '', executive: '', teamLeader: '' };

  // 1. Reporting Manager (live 1st tier for employees; auto-skipped when unassigned).
  const empQuery = query(collection(db, 'employees'), where('userId', '==', employeeUserId));
  const empSnap = await getDocs(empQuery);
  if (!empSnap.empty) {
    const empData = empSnap.docs[0].data();
    if (empData.reportingManagerId) ids.reportingManager = empData.reportingManagerId;
  }

  // 1b. HR — the tier between the reporting manager and the company admin.
  try {
    const hrQuery = query(collection(db, 'users'), where('role', '==', 'hr'), where('companyId', '==', companyId));
    const hrSnap = await getDocs(hrQuery);
    if (!hrSnap.empty) ids.hr = hrSnap.docs[0].id;
  } catch {}

  // 2. Company Admin
  try {
    const adminQuery = query(collection(db, 'users'), where('role', '==', 'company-admin'), where('companyId', '==', companyId));
    const adminSnap = await getDocs(adminQuery);
    if (!adminSnap.empty) ids.companyAdmin = adminSnap.docs[0].id;
  } catch {}

  // 3. Team Leader — assigned via the company's executive hierarchy (linked TLs).
  //    Never falls back to an arbitrary TL: an unassigned company simply has no
  //    TL approver, so the record routes onward instead of stalling.
  ids.teamLeader = await resolveTLForCompany(companyId);

  // 4. Executive
  try {
    const execQuery = query(collection(db, 'users'), where('role', '==', 'executive'));
    const execSnap = await getDocs(execQuery);
    for (const d of execSnap.docs) {
      const data = d.data();
      if (data.assignedCompanyIds?.includes(companyId)) {
        ids.executive = d.id;
        break;
      }
    }
  } catch {}

  return ids;
};

export const requestPunchRectification = async (
  attendanceId: string,
  correctedCheckOut: Date,
  employeeRemark?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) throw new Error('Attendance record not found');

  const data = snapshot.data();
  const companyId = data.companyId || '';

  // Missed-punch corrections only within the 2-working-day window.
  const recDate = data.date?.toDate ? data.date.toDate() : data.date || null
  if (recDate) {
    const { weekendDays, holidayKeys } = await resolveAttendanceCorrectionWindow(companyId)
    assertWithinAttendanceCorrectionWindow(recDate, weekendDays, holidayKeys)
  }

  const approverIds = await resolveMissedPunchApproverIds(companyId, data.userId || '');

  // Master Admin final-verification layer for Team Leader / Executive personal
  // submissions (they are also registered employees): their corrections route
  // DIRECTLY to the Master Admin as a single-step decision.
  const applicantRole = await resolveApplicantRole(data.userId || '');
  const masterAdminRequired = MANAGEMENT_SELF_SERVICE_ROLES.has(applicantRole);
  const masterAdminApproverId = masterAdminRequired ? await resolveMasterAdminApproverId() : '';

  // For Executive self-apps, keep the assigned managing TL recorded for
  // reference (the tier itself is auto-completed — only the MA gate applies).
  if (applicantRole === 'executive') {
    const managingTL = await findManagingTeamLeaderForExec(data.userId || '', data.companyId || '');
    if (managingTL) approverIds.teamLeader = managingTL;
  }

  // Mirror leave behaviour: auto-skip tiers whose approver is the submitting
  // employee, the RM tier when unassigned, and every tier outside this
  // requester's live chain (Skipped — nobody decided anything, so it must not
  // count as an approval in the x/N progress).
  const approvalStatus: Record<ApprovalTier, ApprovalLevel> = { ...INITIAL_MP_APPROVAL_STATUS };
  const liveTiers = getEffectiveMissedPunchTiers(applicantRole);
  for (const tier of MISSED_PUNCH_TIER_ORDER) {
    const isSelfApprover = approverIds[tier] && approverIds[tier] === data.userId;
    const isUnassignedRmTier = tier === 'reportingManager' && !approverIds[tier];
    const isSelfReportingManager = tier === 'reportingManager' && (applicantRole === 'reporting-manager' || applicantRole === 'hr-manager');

    if (masterAdminRequired && applicantRole === 'executive') {
      // Executive chain: Executive → Team Leader → Master Admin. Auto-skip
      // RM + HR + Admin + Executive tiers but KEEP the teamLeader tier active.
      approvalStatus[tier] = tier === 'teamLeader' ? 'Pending' : 'Approved';
    } else if (masterAdminRequired) {
      // Team Leader self-app: auto-skip ALL tiers (routes directly to Master Admin)
      approvalStatus[tier] = 'Approved';
    } else if (isSelfApprover || isUnassignedRmTier || isSelfReportingManager) {
      approvalStatus[tier] = 'Skipped';
    } else if (!liveTiers.includes(tier)) {
      // Chain truncation per requester role (mirrors the server exactly).
      approvalStatus[tier] = 'Skipped';
    }
  }

  // §8 / §21: Never create an approval step with an unassigned approver. When a
  // step that REQUIRES action (not auto-skipped) has no configured approver, the
  // chain would silently stall forever — block submission with a clear
  // configuration error instead. Auto-skipped tiers (self-approver, unassigned
  // Reporting Manager, RM/HR self-tier) are already 'Approved' here and exempt.
  const missingApprovers: string[] = [];
  if (masterAdminRequired && !masterAdminApproverId) missingApprovers.push('Master Admin');
  for (const tier of getEffectiveMissedPunchTiers(applicantRole)) {
    if (approvalStatus[tier] === 'Pending' && !approverIds[tier]) {
      missingApprovers.push(MISSED_PUNCH_TIER_LABELS[tier]);
    }
  }
  if (missingApprovers.length > 0) {
    throw new Error(
      `Unable to submit Missed Punch. ${missingApprovers.join(', ')} ${missingApprovers.length === 1 ? 'is' : 'are'} not assigned. Please contact your administrator to complete the company approval configuration.`
    );
  }

  const overallStatus = computeOverallMissedPunchStatus(approvalStatus, masterAdminRequired, 'Pending');

  await updateDoc(docRef, {
    'missedPunchRectification.requested': true,
    'missedPunchRectification.requestedAt': serverTimestamp(),
    'missedPunchRectification.correctedCheckOut': correctedCheckOut,
    'missedPunchRectification.employeeRemark': employeeRemark || '',
    'missedPunchRectification.resolved': overallStatus === 'Approved',
    'missedPunchRectification.approvalStatus': approvalStatus,
    'missedPunchRectification.approvalLog': [],
    'missedPunchRectification.approverIds': approverIds,
    'missedPunchRectification.approvalCount': computeMissedPunchApprovalCount(approvalStatus),
    'missedPunchRectification.status': overallStatus,
    'missedPunchRectification.applicantRole': applicantRole,
    'missedPunchRectification.masterAdminRequired': masterAdminRequired,
    'missedPunchRectification.masterAdminApproverId': masterAdminApproverId,
    ...(masterAdminRequired ? { 'missedPunchRectification.masterAdminApproveStatus': 'Pending' } : {}),
    ...Object.fromEntries(Object.entries(computeMissedPunchFlags(approvalStatus)).map(([k, v]) => [`missedPunchRectification.${k}`, v])),
  });

  // If the request fully resolved immediately (all approvers auto-skipped and no
  // Master Admin gate, or MA already auto-...) apply the corrected checkout.
  if (overallStatus === 'Approved') {
    await applyMissedPunchResolution(docRef, correctedCheckOut, 'System (Auto-Approved)', 'All approval tiers auto-completed');
  }

  try {
    await notifyMissedPunchSubmitted(data.companyId || '', data.userId || '', data.name || '', correctedCheckOut);
  } catch {}

  // Notify the first pending approver about the new missed punch request.
  // Management self-apps auto-complete every standard tier, so the Master Admin
  // is reached via the realtime queue / server fan-out rather than a tier
  // notification.
  try {
    const nextTier = getNextPendingMissedPunchTier(approvalStatus);
    if (nextTier && approverIds[nextTier]) {
      await notifyMissedPunchSubmittedToTier(approverIds[nextTier], data.name || '', data.companyId || '');
    }
  } catch {}
};

// Share the corrected checkout computation so both the tier review and the
// automatic all-approved path keep attendance consistent.
const applyMissedPunchResolution = async (
  docRef: ReturnType<typeof doc>,
  correctedCheckOut: Date,
  approvedByName: string,
  remark: string,
): Promise<void> => {
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return;
  const data = snapshot.data();

  const checkInTime = data.checkIn?.toDate ? data.checkIn.toDate() : data.checkIn || new Date();
  const workHours = (correctedCheckOut.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

  const shiftEndStr: string = data.shiftEnd || '18:00';
  let overtimeHours = 0;
  const otThresholdMinutes = 30;
  if (shiftEndStr) {
    const [endH, endM] = shiftEndStr.split(':').map(Number);
    const shiftEndToday = new Date(correctedCheckOut);
    shiftEndToday.setHours(endH, endM, 0, 0);
    if (correctedCheckOut > shiftEndToday) {
      const diffMinutes = (correctedCheckOut.getTime() - shiftEndToday.getTime()) / (1000 * 60);
      if (diffMinutes > otThresholdMinutes) {
        overtimeHours = Math.round((diffMinutes / 60) * 100) / 100;
      }
    }
  }

  const now = serverTimestamp();
  const approvedBy = data.userId || '';

  await updateDoc(docRef, {
    checkOut: correctedCheckOut,
    workHours: Math.round(workHours * 100) / 100,
    overtimeHours,
    status: 'Approved',
    approved: true,
    isAutoApproved: true,
    approvedBy,
    approvedByName,
    approvedOn: now,
    'missedPunchRectification.resolved': true,
    'missedPunchRectification.resolvedAt': now,
    'missedPunchRectification.resolvedBy': approvedBy,
    'missedPunchRectification.resolvedByName': approvedByName,
    'missedPunchRectification.remark': remark,
    'missedPunchRectification.status': 'Approved',
  });
};

/**
 * Sequential missed-punch tier review. Mirrors `reviewTierLeaveRequest`:
 * hard-blocks any tier unless every preceding tier is Approved, records the
 * action in approvalLog, updates the flat flags + approvalCount (progress
 * counter) so the "X/3" indicator is real-time, and fans out notifications.
 */
export const reviewMissedPunchTier = async (
  attendanceId: string,
  tier: ApprovalTier,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error('Attendance record not found');

  const data = docSnap.data();
  const mp = data.missedPunchRectification || {};
  const currentApprovalStatus: Record<ApprovalTier, ApprovalLevel> = mp.approvalStatus || { ...INITIAL_MP_APPROVAL_STATUS };
  const currentApprovalLog: Array<{ tier: ApprovalTier; status: 'Approved' | 'Rejected'; approvedBy: string; approvedByName: string; approvedOn: Date; note?: string }> = mp.approvalLog || [];

  if (currentApprovalStatus[tier] !== 'Pending') {
    throw new Error(`This tier has already been ${currentApprovalStatus[tier]}`);
  }
  if (!areAllPreviousMissedPunchTiersApproved(currentApprovalStatus, tier)) {
    throw new Error('Previous verification tiers must be completed before acting on this tier');
  }
  // §16 / §10: only the CURRENT assigned approver of this step may act. Firestore
  // rules enforce this at the database boundary; guard here so the UI also fails
  // fast with a clear message (e.g. a stale queue entry after the request already
  // moved to another approver). Legacy docs with an empty approver stamp remain
  // open to their natural role holder, matching the table-level fallback.
  const assignedApprover = mp.approverIds?.[tier];
  if (assignedApprover && assignedApprover !== reviewedBy) {
    throw new Error('You are not authorized to review this verification step.');
  }
  if (mp.resolved) {
    throw new Error('This request has already been resolved.');
  }

  const newApprovalStatus = { ...currentApprovalStatus, [tier]: action };
  const newEntry = {
    tier,
    status: action,
    approvedBy: reviewedBy,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...currentApprovalLog, newEntry];
  // With the Master Admin gate active, an all-tiers-approved remains Pending
  // until the Master Admin rules.
  const overallStatus = computeOverallMissedPunchStatus(
    newApprovalStatus,
    !!mp.masterAdminRequired,
    (mp.masterAdminApproveStatus as 'Pending' | 'Approved' | 'Rejected' | undefined) || 'Pending',
  );
  const flags = computeMissedPunchFlags(newApprovalStatus);

  const payload: Record<string, unknown> = {
    'missedPunchRectification.approvalStatus': newApprovalStatus,
    'missedPunchRectification.approvalLog': newApprovalLog,
    'missedPunchRectification.approvalCount': computeMissedPunchApprovalCount(newApprovalStatus),
    'missedPunchRectification.status': overallStatus,
  };
  for (const [k, v] of Object.entries(flags)) payload[`missedPunchRectification.${k}`] = v;

  await updateDoc(docRef, payload);

  const companyId = data.companyId || '';
  const employeeUserId = data.userId || '';
  const employeeName = data.name || '';
  const corrected = mp.correctedCheckOut?.toDate ? mp.correctedCheckOut.toDate() : mp.correctedCheckOut || null;

  try {
    if (action === 'Rejected') {
      await updateDoc(docRef, {
        'missedPunchRectification.resolved': true,
        'missedPunchRectification.resolvedAt': serverTimestamp(),
        'missedPunchRectification.resolvedBy': reviewedBy,
        'missedPunchRectification.resolvedByName': reviewedByName,
        'missedPunchRectification.remark': reviewNote || '',
      });
      await notifyMissedPunchRejectedByTier(employeeUserId, reviewedByName, tier, companyId, reviewNote);
    } else if (overallStatus === 'Approved') {
      await applyMissedPunchResolution(docRef, corrected || new Date(), reviewedByName, 'Approved by all verification tiers');
      await notifyMissedPunchFullyApproved(employeeUserId, companyId);
    } else if (isAwaitingMissedPunchMasterAdmin(newApprovalStatus, !!mp.masterAdminRequired, mp.masterAdminApproveStatus)) {
      // All active tiers verified — route to the Master Admin for final oversight
      // (Executive self-app: after the Team Leader's sign-off).
      await notifyMasterAdmins(
        companyId,
        'punch_rectification_requested',
        'Missed Punch Awaiting Master Admin',
        `${employeeName}'s missed punch correction has cleared ${MISSED_PUNCH_TIER_LABELS[tier]} verification and requires your final approval as Master Admin.`,
        '/attendance',
      );
    } else {
      const nextTier = getNextPendingMissedPunchTier(newApprovalStatus);
      if (nextTier && mp.approverIds?.[nextTier]) {
        await notifyMissedPunchTierApproved(mp.approverIds[nextTier], reviewedByName, nextTier, companyId);
      }
    }
    // Three-way fan-out: subject (intermediate steps too — unless already
    // notified above), approver self-confirmation, ALL master admins (the old
    // code only pinged them when the MA gate itself was next).
    const awaitingMaPunch = action === 'Approved'
      && overallStatus !== 'Approved'
      && isAwaitingMissedPunchMasterAdmin(newApprovalStatus, !!mp.masterAdminRequired, mp.masterAdminApproveStatus);
    await notifyApprovalDecision({
      companyId,
      action,
      isFinal: overallStatus === 'Approved' || overallStatus === 'Rejected',
      subjectId: employeeUserId,
      subjectName: employeeName || 'An employee',
      subjectAlreadyNotified: action === 'Rejected' || overallStatus === 'Approved',
      subjectMessage: awaitingMaPunch
        ? `${reviewedByName} (${MISSED_PUNCH_TIER_LABELS[tier]}) approved your missed punch correction. It now awaits Master Admin verification.`
        : undefined,
      approverId: reviewedBy,
      approverName: reviewedByName,
      approverLabel: MISSED_PUNCH_TIER_LABELS[tier],
      kind: 'punch',
      detail: `missed punch correction for ${fmtDay(data.date)}`,
      link: '/attendance',
      skipMasterAdmins: awaitingMaPunch, // the MA-gate branch above already notified them
    });
  } catch {
    // Notification / resolution failures must not block the tier action.
  }
};

/**
 * Master Admin final-verification for a Team Leader / Executive's personal
 * missed-punch correction. Requires all active tiers verified + mandatory remark,
 * then approves/rejects at the top-tier level (applying the corrected checkout
 * on approval).
 */
export const reviewMasterAdminMissedPunch = async (
  attendanceId: string,
  action: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewedByName: string,
  reviewNote?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) throw new Error('Attendance record not found');

  const data = docSnap.data();
  const mp = data.missedPunchRectification || {};
  if (!mp.masterAdminRequired) throw new Error('This missed punch does not require Master Admin verification.');
  const reviewerRole = await getReviewerRole(reviewedBy);
  if (reviewerRole !== 'master-admin') {
    throw new Error('Only a Master Admin can review this request.');
  }
  if (mp.masterAdminApproveStatus && mp.masterAdminApproveStatus !== 'Pending') {
    throw new Error(`Master Admin verification has already been ${mp.masterAdminApproveStatus}.`);
  }
  if (!reviewNote || !reviewNote.trim()) {
    throw new Error('A mandatory remark is required for Master Admin review.');
  }

  const currentApprovalStatus: Record<ApprovalTier, ApprovalLevel> = mp.approvalStatus || { ...INITIAL_MP_APPROVAL_STATUS };
  // Executive self-apps: only the assigned Team Leader tier must be verified
  // before the Master Admin final gate. Team Leader self-apps auto-complete all
  // tiers (direct routing), so nothing else needs verifying first. Use the
  // effective tiers to validate only the tiers that actually required action.
  const effectiveTiers: ApprovalTier[] = getEffectiveMissedPunchTiers(mp.applicantRole);
  if (effectiveTiers.length > 0 && !effectiveTiers.every(t => mpTierSettled(currentApprovalStatus[t]))) {
    throw new Error('The required verification tiers must be fully approved before Master Admin review.');
  }

  const overallStatus = computeOverallMissedPunchStatus(currentApprovalStatus, true, action);

  const newEntry = {
    tier: 'masterAdmin' as unknown as ApprovalTier,
    status: action,
    approvedBy: reviewedBy,
    approvedByName: reviewedByName,
    approvedOn: new Date(),
    note: reviewNote || '',
  };
  const newApprovalLog = [...(mp.approvalLog || []), newEntry];

  const companyId = data.companyId || '';
  const employeeUserId = data.userId || '';
  const corrected = mp.correctedCheckOut?.toDate ? mp.correctedCheckOut.toDate() : mp.correctedCheckOut || null;

  await updateDoc(docRef, {
    'missedPunchRectification.masterAdminApproveStatus': action,
    'missedPunchRectification.masterAdminApprovedBy': reviewedBy,
    'missedPunchRectification.masterAdminApprovedByName': reviewedByName,
    'missedPunchRectification.masterAdminApprovedOn': serverTimestamp(),
    'missedPunchRectification.masterAdminNote': reviewNote || '',
    'missedPunchRectification.approvalLog': newApprovalLog,
    'missedPunchRectification.status': overallStatus,
    'missedPunchRectification.resolved': overallStatus === 'Approved',
    'missedPunchRectification.resolvedAt': overallStatus === 'Approved' ? serverTimestamp() : null,
    'missedPunchRectification.resolvedBy': overallStatus === 'Approved' ? reviewedBy : null,
    'missedPunchRectification.resolvedByName': overallStatus === 'Approved' ? reviewedByName : null,
    'missedPunchRectification.remark': reviewNote || '',
  });

  try {
    if (action === 'Approved') {
      await applyMissedPunchResolution(docRef, corrected || new Date(), reviewedByName, reviewNote || '');
      await notifyMissedPunchFullyApproved(employeeUserId, companyId);
    } else {
      await notifyMissedPunchRejectedByTier(employeeUserId, reviewedByName, 'masterAdmin', companyId, reviewNote);
    }
    // Three-way fan-out: subject (final outcome already sent above → skip),
    // approver self-confirmation, ALL master admins (previously this path sent
    // them nothing at all).
    await notifyApprovalDecision({
      companyId,
      action,
      isFinal: true,
      subjectId: employeeUserId,
      subjectName: data.name || 'An employee',
      subjectAlreadyNotified: true,
      approverId: reviewedBy,
      approverName: reviewedByName,
      approverLabel: 'Master Admin',
      kind: 'punch',
      detail: `missed punch correction for ${fmtDay(data.date)}`,
      link: '/attendance',
    });
  } catch {
    // Notification / resolution failures must not block the review.
  }
};

// Backward-compatible single-step resolution that still writes a full
// Full approval record (all active tiers marked Approved) for older clients/UI.
export const resolvePunchRectification = async (
  attendanceId: string,
  resolvedBy: string,
  resolvedByName: string,
  action: 'approve',
  remark?: string
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return;

  if (!remark || !remark.trim()) {
    throw new Error('A remark is required to resolve a missed punch rectification.');
  }

  const data = snapshot.data();
  const corrected = data.missedPunchRectification?.correctedCheckOut?.toDate
    ? data.missedPunchRectification.correctedCheckOut.toDate()
    : data.missedPunchRectification?.correctedCheckOut || null;

  const approvalStatus: Record<ApprovalTier, ApprovalLevel> = { ...INITIAL_MP_APPROVAL_STATUS };
  for (const tier of MISSED_PUNCH_TIER_ORDER) approvalStatus[tier] = 'Approved';
  const flags = computeMissedPunchFlags(approvalStatus);

  const payload: Record<string, unknown> = {
    'missedPunchRectification.resolved': true,
    'missedPunchRectification.resolvedAt': serverTimestamp(),
    'missedPunchRectification.resolvedBy': resolvedBy,
    'missedPunchRectification.resolvedByName': resolvedByName,
    'missedPunchRectification.remark': remark || '',
    'missedPunchRectification.status': 'Approved',
    'missedPunchRectification.approvalStatus': approvalStatus,
    'missedPunchRectification.approvalCount': computeMissedPunchApprovalCount(approvalStatus),
  };
  for (const [k, v] of Object.entries(flags)) payload[`missedPunchRectification.${k}`] = v;

  if (corrected) {
    await applyMissedPunchResolution(docRef, corrected, resolvedByName, remark || '');
  } else {
    await updateDoc(docRef, payload);
  }

  // Three-way fan-out for the single-step resolution: subject + approver
  // self-confirmation + ALL master admins (this path previously sent NOTHING).
  try {
    await notifyApprovalDecision({
      companyId: data.companyId || '',
      action: 'Approved',
      isFinal: true,
      subjectId: data.userId || '',
      subjectName: data.name || 'An employee',
      subjectMessage: `${resolvedByName} approved your missed punch correction for ${fmtDay(data.date)}. It has been applied to your attendance.`,
      approverId: resolvedBy,
      approverName: resolvedByName,
      kind: 'punch',
      detail: `missed punch correction for ${fmtDay(data.date)}`,
      link: '/attendance',
    });
  } catch {
    // Notification failures must not block the resolution.
  }
};

/** Authorized managers can edit a rectification's corrected checkout + remark. */
export const editMissedPunch = async (
  attendanceId: string,
  correctedCheckOut: Date,
  remark: string,
  editedBy: string,
  editedByName: string,
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, attendanceId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return;
  const data = snapshot.data();
  const checkInTime = data.checkIn?.toDate ? data.checkIn.toDate() : data.checkIn || new Date();
  const workHours = (correctedCheckOut.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

  await updateDoc(docRef, {
    checkOut: correctedCheckOut,
    workHours: Math.round(workHours * 100) / 100,
    'missedPunchRectification.correctedCheckOut': correctedCheckOut,
    'missedPunchRectification.remark': remark || '',
    'missedPunchRectification.resolvedBy': editedBy,
    'missedPunchRectification.resolvedByName': editedByName,
    'missedPunchRectification.resolvedAt': serverTimestamp(),
  });
};

// ============================================
// STANDARD CRUD
// ============================================

export const updateAttendance = async (id: string, updates: Partial<AttendanceRecord>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, updates);
};

export const approveAttendance = async (id: string, approvedBy: string, approvedByName: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    status: 'Approved',
    approved: true,
    approvedBy,
    approvedByName,
    approvedOn: serverTimestamp(),
  });
};

export const getAttendanceByDepartment = async (departmentId: string): Promise<AttendanceRecord[]> => {
  const q = query(attendanceRef, where('departmentId', '==', departmentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapRecord);
};

export const deleteAttendance = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

export const getAttendanceStats = async (companyId?: string, date?: Date) => {
  if (!companyId) return { total: 0, approved: 0, present: 0, late: 0, onLeave: 0, missPunch: 0, absent: 0 };
  let records: AttendanceRecord[];
  
  if (date) {
    records = await getAttendanceByDate(date);
  } else {
    records = await getAttendanceByCompany(companyId);
  }
  
  return {
    total: records.length,
    approved: records.filter(r => r.status === 'Approved').length,
    present: records.filter(r => r.status === 'Present' || r.status === 'Approved').length,
    late: records.filter(r => r.status === 'Late').length,
    onLeave: records.filter(r => r.status === 'On Leave').length,
    missPunch: records.filter(r => r.status === 'Miss Punch').length,
    absent: records.filter(r => r.status === 'Absent').length,
  };
};

// ============================================
// MONTHLY ATTENDANCE SUMMARY (for Payroll)
// ============================================

export interface MonthlyAttendanceSummary {
  userId: string
  employeeName: string
  employeeId: string
  department: string
  presentDays: number
  lateDays: number
  approvedLeaveDays: number
  missPunchDays: number
  totalOvertimeHours: number
  unresolvedMissPunchDays: number
}

/** Build per-employee attendance summary for a given month/year */
export const getMonthlyAttendanceSummary = async (
  companyId: string,
  monthIndex: number,
  year: number,
): Promise<MonthlyAttendanceSummary[]> => {
  const startDate = new Date(year, monthIndex, 1);
  const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

  const q = query(
    attendanceRef,
    where('companyId', '==', companyId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  );
  const snapshot = await getDocs(q);
  const records = snapshot.docs.map(mapRecord);

  const map = new Map<string, {
    userId: string; employeeName: string; employeeId: string; department: string;
    presentDays: number; lateDays: number; approvedLeaveDays: number;
    missPunchDays: number; totalOvertimeHours: number; unresolvedMissPunchDays: number;
  }>();

  for (const r of records) {
    const key = r.userId;
    if (!map.has(key)) {
      map.set(key, {
        userId: r.userId,
        employeeName: r.name || '',
        employeeId: r.employeeId || '',
        department: r.department || '',
        presentDays: 0, lateDays: 0, approvedLeaveDays: 0,
        missPunchDays: 0, totalOvertimeHours: 0, unresolvedMissPunchDays: 0,
      });
    }
    const entry = map.get(key)!;

    if (r.status === 'Present' || r.status === 'Approved') entry.presentDays++;
    else if (r.status === 'Late') { entry.lateDays++; entry.presentDays++; }
    else if (r.status === 'On Leave') entry.approvedLeaveDays++;
    else if (r.status === 'Miss Punch') {
      entry.missPunchDays++;
      if (!r.missedPunchRectification?.resolved) entry.unresolvedMissPunchDays++;
    }

    entry.totalOvertimeHours += r.overtimeHours || 0;
  }

  return Array.from(map.values());
};

// ============================================
// REAL-TIME LISTENERS
// ============================================

export const subscribeAttendance = (
  callback: (records: AttendanceRecord[]) => void
): (() => void) => {
  const unsubscribe = onSnapshot(attendanceRef, (snapshot) => {
    const records = snapshot.docs.map(mapRecord);
    callback(records);
  }, (err) => {
    console.error('[subscribeAttendance] onSnapshot error:', err?.message || err);
  });
  return unsubscribe;
};

export const subscribeTodayAttendance = (
  callback: (records: AttendanceRecord[]) => void
): (() => void) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  
  const q = query(
    attendanceRef,
    where('date', '>=', startOfDay),
    where('date', '<=', endOfDay)
  );
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const records = snapshot.docs.map(mapRecord);
    callback(records);
  }, (err) => {
    console.error('[subscribeTodayAttendance] onSnapshot error:', err?.message || err);
  });
  return unsubscribe;
};

export const subscribeTodayAttendanceByCompany = (
  companyId: string,
  callback: (records: AttendanceRecord[]) => void
): (() => void) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const q = query(
    attendanceRef,
    where('companyId', '==', companyId),
    where('date', '>=', startOfDay),
    where('date', '<=', endOfDay)
  );
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const records = snapshot.docs.map(mapRecord);
    callback(records);
  }, (err) => {
    console.error('[subscribeTodayAttendanceByCompany] onSnapshot error:', err?.message || err);
  });
  return unsubscribe;
};
