import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';

export type AttendanceCascadeKind =
  | 'missed-punch-marked'
  | 'rectification-requested'
  | 'rectification-resolved'
  | 'late-checkin';

interface CascadeParams {
  companyId: string;
  employeeUserId: string;
  employeeName?: string;
  kind: AttendanceCascadeKind;
  dateLabel?: string;
  note?: string;
  actorName?: string;
}

/**
 * Trigger the server-side, same-company notification cascade for a real-time
 * attendance event. The cloud function (`notifyAttendanceCascade`) resolves the
 * employee's Reporting Manager, Company Admin, assigned Executive(s), linked
 * Team Leader(s) and Master Admins strictly within the employee's company and
 * notifies the whole chain. Falls back silently if the callable is unavailable.
 */
export async function notifyAttendanceCascade(params: CascadeParams): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'notifyAttendanceCascade');
    await fn(params);
  } catch (err: any) {
    // Non-fatal: notification failures must never break the primary action
    // (marking attendance, rectification, check-in). Log for diagnostics only.
    console.warn('[attendanceNotifier] notifyAttendanceCascade failed:', err?.message || err);
  }
}
