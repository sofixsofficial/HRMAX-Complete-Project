import * as admin from 'firebase-admin';
import { resolveManagementStakeholders, ManagementStakeholders } from './stakeholderResolver';

const db = admin.firestore();

export type MissedPunchStakeholders = ManagementStakeholders;

/**
 * Resolve every stakeholder who must be alerted about an employee's missed
 * punch / failed attendance, scoped strictly to the employee's company and its
 * permission hierarchy.
 * Shared implementation: see `resolveManagementStakeholders`.
 */
export const resolveMissedPunchStakeholders = resolveManagementStakeholders;

const ATTR_KEYS: Record<string, (s: MissedPunchStakeholders) => string[]> = {
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
export async function notifyMissedPunchToStakeholders(params: {
  companyId: string;
  employeeUserId: string;
  employeeName: string;
  dateLabel: string;
  kind: 'checkout' | 'checkin';
  attendanceId?: string | null;
  dedupeKey: string;
}): Promise<void> {
  const s = await resolveMissedPunchStakeholders(params.companyId, params.employeeUserId, params.employeeName);

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

  const recipients = new Map<string, string>();
  for (const key of ['reporting-manager', 'executive', 'team-leader', 'company-admin', 'master-admin']) {
    for (const id of ATTR_KEYS[key](s)) {
      if (id && id !== s.employeeUserId) recipients.set(id, key);
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
    } catch {
      /* record may have been deleted */
    }
  }
}

export const dateKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
