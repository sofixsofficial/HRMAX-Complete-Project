import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

export const ACTION_MODULES = [
  'All', 'Employees', 'Attendance', 'Leave', 'Payroll', 'Roles & Permissions',
  'Companies', 'Departments', 'Tasks', 'Documents', 'Transfer Management',
  'Settings', 'Announcements', 'Emails', 'Support Tickets', 'Authentication',
] as const;

export const ACTION_TYPES = [
  'All', 'create', 'update', 'delete', 'approve', 'reject',
  'assign', 'transfer', 'login', 'logout', 'export',
] as const;

export const STATUS_OPTIONS = ['All', 'success', 'failure', 'warning'] as const;

export const actionLabel = (type: string) => {
  const labels: Record<string, string> = {
    create: 'Created', update: 'Updated', delete: 'Deleted', approve: 'Approved',
    reject: 'Rejected', assign: 'Assigned', transfer: 'Transferred',
    login: 'Logged In', logout: 'Logged Out', export: 'Exported',
  };
  return labels[type] || type;
};

export const statusBadge = (status: string) => {
  const m: Record<string, { bg: string; text: string }> = {
    success: { bg: '#dcfce7', text: '#16a34a' },
    failure: { bg: '#fee2e2', text: '#ef4444' },
    warning: { bg: '#fef3c7', text: '#d97706' },
  };
  return m[status] || { bg: '#f3f4f6', text: '#6b7280' };
};

/**
 * Log an audit event directly to the `audit_logs` collection — the exact same
 * path the website uses (frontend/src/services/auditLogService.ts), so entries
 * show up in the Audit Logs screen on both platforms.
 *
 * (This previously routed through the `mobileCreateNotification` Cloud Function
 * with a flat payload the function rejected with 400 "Missing notification data
 * or userId", and would have written to the wrong collection even on success.)
 */
export const logAudit = async (params: {
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  actionType: string;
  module: string;
  targetEntity?: string;
  status?: 'success' | 'failure' | 'warning';
}): Promise<void> => {
  try {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    const logId = `${ts}_${rand}`;
    const payload: Record<string, unknown> = {
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action: params.action,
      actionType: params.actionType,
      module: params.module,
      targetEntity: params.targetEntity || '',
      status: params.status || 'success',
      id: logId,
      timestamp: serverTimestamp(),
    };
    await setDoc(
      doc(db, 'audit_logs', logId),
      Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
    );
  } catch (err: any) {
    console.warn('logAudit failed:', err?.message || err);
  }
};
