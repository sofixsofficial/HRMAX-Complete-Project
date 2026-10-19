import * as admin from 'firebase-admin';
import { resolveManagementStakeholders, ManagementStakeholders } from './stakeholderResolver';

const db = admin.firestore();

export type LeaveStakeholders = ManagementStakeholders;

/**
 * Resolve every stakeholder who must be notified about a leave event, scoped
 * strictly to the employee's company and its permission hierarchy.
 * Shared implementation: see `resolveManagementStakeholders`.
 */
export const resolveLeaveStakeholders = resolveManagementStakeholders;

const ATTR_KEYS: Record<string, (s: LeaveStakeholders) => string[]> = {
  'reporting-manager': (s) => (s.reportingManagerId ? [s.reportingManagerId] : []),
  'executive': (s) => s.executiveIds,
  'team-leader': (s) => s.teamLeaderIds,
  'company-admin': (s) => s.companyAdminIds,
  'master-admin': (s) => s.masterAdminIds,
};

type LeaveEventKind = 'applied' | 'approved' | 'rejected';

function buildMessages(kind: LeaveEventKind, s: LeaveStakeholders, leave: LeaveSummary) {
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

interface LeaveSummary {
  companyId: string;
  leaveType: string;
  totalDays: string | number;
  startDateLabel: string;
  endDateLabel: string;
  reviewNote?: string;
}

/**
 * Notify every stakeholder about a leave event:
 *   applied  -> employee (confirmation) + RM, Executive, TL, Company Admin, Master Admin (pending review)
 *   approved / rejected -> employee + all management stakeholders
 * Also writes a dashboard `adminAlerts` entry. Written notifications are
 * automatically converted to mobile push by `onNotificationCreated`.
 */
export async function notifyLeaveToStakeholders(params: {
  companyId: string;
  employeeUserId: string;
  employeeName: string;
  kind: LeaveEventKind;
  leave: LeaveSummary;
  link: string;
}, preResolved?: LeaveStakeholders): Promise<void> {
  const s = preResolved ?? await resolveLeaveStakeholders(params.companyId, params.employeeUserId, params.employeeName);
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


