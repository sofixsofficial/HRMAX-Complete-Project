import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from '../aws/firestore-compat';
import { db } from '../aws/clients';
import type { AppNotification, NotificationType } from '../types/user';

const notificationsRef = collection(db, 'notifications');

// Create a notification
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link: string,
  companyId: string
): Promise<string> {
  const docRef = await addDoc(notificationsRef, {
    userId,
    type,
    title,
    body,
    read: false,
    link,
    companyId,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

// Get user's notifications (real-time) — no orderBy to avoid composite index requirement
export function subscribeToNotifications(
  userId: string,
  callback: (notifications: AppNotification[]) => void
): () => void {
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    limit(50)
  );

  return onSnapshot(q, (snapshot) => {
    const notifications = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date()
      })) as AppNotification[];
    // Sort client-side
    notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    callback(notifications);
  }, (err) => {
    console.error('Notification subscription error:', err);
    callback([]);
  });
}

// Mark notification as read
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const notificationRef = doc(db, 'notifications', notificationId);
  await updateDoc(notificationRef, { read: true });
}

// Mark all notifications as read
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    where('read', '==', false)
  );
  const snapshot = await getDocs(q);

  const batch: Promise<void>[] = [];
  snapshot.docs.forEach(doc => {
    batch.push(updateDoc(doc.ref, { read: true }));
  });

  await Promise.all(batch);
}

// Delete a notification
export async function deleteNotification(notificationId: string): Promise<void> {
  await deleteDoc(doc(db, 'notifications', notificationId));
}

// Get unread notification count
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    where('read', '==', false)
  );
  const snapshot = await getDocs(q);
  return snapshot.size;
}

// Subscribe to unread count (real-time)
export function subscribeToUnreadCount(
  userId: string,
  callback: (count: number) => void
): () => void {
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    where('read', '==', false)
  );

  return onSnapshot(q, (snapshot) => {
    callback(snapshot.size);
  }, (err) => {
    console.error('Unread count subscription error:', err);
    callback(0);
  });
}

// Helper: Create leave notification
export async function notifyLeaveEvent(
  userId: string,
  approverName: string,
  status: 'approved' | 'rejected',
  companyId: string
): Promise<void> {
  const title = status === 'approved' ? 'Leave Approved' : 'Leave Rejected';
  const body = status === 'approved'
    ? `${approverName} approved your leave request.`
    : `${approverName} rejected your leave request.`;

  await createNotification(userId, `leave_${status}` as NotificationType, title, body, '/leave', companyId);
}

// Helper: Create task notification
export async function notifyTaskAssigned(
  userId: string,
  assignerName: string,
  taskTitle: string,
  companyId: string
): Promise<void> {
  await createNotification(
    userId,
    'task_assigned',
    'Task Assigned',
    `${assignerName} assigned you a task: ${taskTitle}`,
    '/tasks',
    companyId
  );
}

// ── Team Leader action fan-out ──

export interface StakeholderUser {
  id: string;
  role?: string;
  assignedCompanyIds?: string[];
}

/**
 * Fan out a notification to the executives handling a company plus all master
 * admins, so leadership stays informed of team-leader CRUD operations.
 * Pass an in-memory user list when available; otherwise pass [] to query
 * Firestore for the relevant roles.
 */
export async function notifyTlAction(
  companyId: string,
  type: string,
  title: string,
  body: string,
  link: string,
  users: StakeholderUser[]
): Promise<void> {
  let candidates = users;
  if (candidates.length === 0) {
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('role', 'in', ['executive', 'master-admin']));
      const snap = await getDocs(q);
      candidates = snap.docs.map(d => ({ id: d.id, ...d.data() } as StakeholderUser));
    } catch {}
  }
  const ids = candidates
    .filter(u => {
      if (u.role === 'master-admin') return true;
      if (u.role === 'executive') return (u.assignedCompanyIds || []).includes(companyId);
      return false;
    })
    .map(u => u.id);
  for (const id of new Set(ids)) {
    if (id) {
      await createNotification(id, type as NotificationType, title, body, link, companyId).catch(() => {});
    }
  }
}

/** Notify all master admins (used when no in-memory user list is available). */
export async function notifyMasterAdmins(
  companyId: string,
  type: string,
  title: string,
  body: string,
  link: string
): Promise<void> {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('role', '==', 'master-admin'));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await createNotification(d.id, type as NotificationType, title, body, link, companyId).catch(() => {});
    }
  } catch {}
}

// ── Attendance Notification Helpers ──

export async function notifyMissedPunch(
  userId: string,
  employeeName: string,
  date: string,
  companyId: string,
  tlUserIds: string[],
  executiveUserIds: string[],
  adminUserIds: string[],
  rmUserIds: string[] = []
): Promise<void> {
  await createNotification(
    userId,
    'missed_punch',
    'Missed Punch Detected',
    `You missed your checkout on ${date}. Please submit a rectification request.`,
    '/attendance',
    companyId
  );
  const title = `Missed Punch: ${employeeName}`;
  const body = `${employeeName} missed their checkout on ${date}.`;
  for (const id of [...tlUserIds, ...executiveUserIds, ...adminUserIds, ...rmUserIds]) {
    if (id && id !== userId) {
      await createNotification(id, 'missed_punch', title, body, '/attendance', companyId).catch(() => {});
    }
  }
  await createAdminAlert('missed_punch', title, body, '/attendance', 'normal', {
    companyId,
    companyName: '',
  });
}

export async function notifyPunchRectificationRequested(
  userId: string,
  employeeName: string,
  date: string,
  companyId: string,
  managerIds: string[]
): Promise<void> {
  const title = `Punch Rectification: ${employeeName}`;
  const body = `${employeeName} submitted a missed punch correction for ${date}.`;
  for (const id of managerIds) {
    if (id) {
      await createNotification(id, 'punch_rectification_requested', title, body, '/attendance', companyId).catch(() => {});
    }
  }
}

export async function notifyPunchRectificationResolved(
  userId: string,
  resolverName: string,
  date: string,
  companyId: string
): Promise<void> {
  await createNotification(
    userId,
    'punch_rectification_resolved',
    'Punch Rectified',
    `${resolverName} approved your missed punch correction for ${date}.`,
    '/attendance',
    companyId
  );
}

// Helper: Create attendance late notification
export async function notifyAttendanceLate(
  userId: string,
  employeeName: string,
  date: string,
  lateMinutes: number,
  companyId: string
): Promise<void> {
  await createNotification(
    userId,
    'attendance_late',
    'Late Check-In',
    `You checked in ${lateMinutes} minutes late on ${date}. This has been auto-approved.`,
    '/attendance',
    companyId
  );
}

// ── Leave Tier Approval Notification Helpers ──

const TIER_LABEL_MAP: Record<string, string> = {
  reportingManager: 'Reporting Manager',
  companyAdmin: 'Company Admin',
  teamLeader: 'Team Leader',
  executive: 'Executive',
};

export async function notifyLeaveSubmittedToTier(
  approverUserId: string,
  employeeName: string,
  tier: string,
  companyId: string
): Promise<void> {
  const tierLabel = TIER_LABEL_MAP[tier] || tier;
  await createNotification(
    approverUserId,
    'leave_tier_approved',
    'Leave Request Pending Your Review',
    `${employeeName} has submitted a leave request that requires your review as ${tierLabel}.`,
    '/leave',
    companyId
  ).catch(() => {});
}

export async function notifyLeaveTierApproved(
  nextApproverUserId: string,
  approverName: string,
  tier: string,
  companyId: string
): Promise<void> {
  const tierLabel = TIER_LABEL_MAP[tier] || tier;
  await createNotification(
    nextApproverUserId,
    'leave_tier_approved',
    'Leave Awaiting Your Approval',
    `${approverName} approved the leave at the previous level. Please review as ${tierLabel}.`,
    '/leave',
    companyId
  ).catch(() => {});
}

export async function notifyLeaveRejectedByTier(
  employeeUserId: string,
  rejectorName: string,
  tier: string,
  companyId: string,
  note?: string
): Promise<void> {
  const tierLabel = TIER_LABEL_MAP[tier] || tier;
  const noteSuffix = note ? ` Reason: ${note}` : '';
  await createNotification(
    employeeUserId,
    'leave_rejected_by_tier',
    'Leave Rejected',
    `${rejectorName} (${tierLabel}) rejected your leave request.${noteSuffix}`,
    '/leave',
    companyId
  ).catch(() => {});
}

export async function notifyLeaveFullyApproved(
  employeeUserId: string,
  companyId: string
): Promise<void> {
  await createNotification(
    employeeUserId,
    'leave_fully_approved',
    'Leave Fully Approved',
    'Your leave request has been approved by all levels.',
    '/leave',
    companyId
  ).catch(() => {});
}

// ── Missed Punch Tier Approval Notification Helpers ──

export async function notifyMissedPunchSubmittedToTier(
  approverUserId: string,
  employeeName: string,
  companyId: string
): Promise<void> {
  await createNotification(
    approverUserId,
    'punch_rectification_requested',
    'Missed Punch Pending Your Review',
    `${employeeName} has submitted a missed punch correction that requires your verification.`,
    '/attendance',
    companyId
  ).catch(() => {});
}

export async function notifyMissedPunchSubmitted(
  companyId: string,
  employeeUserId: string,
  employeeName: string,
  correctedCheckOut: Date,
): Promise<void> {
  const dateLabel = correctedCheckOut.toLocaleDateString();
  await createNotification(
    employeeUserId,
    'punch_rectification_requested',
    'Rectification Submitted',
    `Your missed punch correction for ${dateLabel} has been submitted for manager verification.`,
    '/attendance',
    companyId
  ).catch(() => {});
}

export async function notifyMissedPunchTierApproved(
  nextApproverUserId: string,
  approverName: string,
  tier: string,
  companyId: string
): Promise<void> {
  const tierLabel = TIER_LABEL_MAP[tier] || tier;
  await createNotification(
    nextApproverUserId,
    'punch_rectification_requested',
    'Missed Punch Awaiting Your Verification',
    `${approverName} approved the missed punch at the previous level. Please review as ${tierLabel}.`,
    '/attendance',
    companyId
  ).catch(() => {});
}

export async function notifyMissedPunchRejectedByTier(
  employeeUserId: string,
  rejectorName: string,
  tier: string,
  companyId: string,
  note?: string
): Promise<void> {
  const tierLabel = TIER_LABEL_MAP[tier] || tier;
  const noteSuffix = note ? ` Reason: ${note}` : '';
  await createNotification(
    employeeUserId,
    'punch_rectification_resolved',
    'Missed Punch Rejected',
    `${rejectorName} (${tierLabel}) rejected your missed punch correction.${noteSuffix}`,
    '/attendance',
    companyId
  ).catch(() => {});
}

export async function notifyMissedPunchFullyApproved(
  employeeUserId: string,
  companyId: string
): Promise<void> {
  await createNotification(
    employeeUserId,
    'punch_rectification_resolved',
    'Missed Punch Verified',
    'Your missed punch correction has been approved by all verification levels and applied to your attendance.',
    '/attendance',
    companyId
  ).catch(() => {});
}

// ── Admin / Global Alerts ──

export type AlertPriority = 'high' | 'normal' | 'low'

export interface AdminAlert {
  id: string
  type: string
  title: string
  body: string
  link: string
  read: boolean
  priority: AlertPriority
  createdAt: Date
  actionBy?: string
  actionByName?: string
  companyId?: string
  companyName?: string
}

export async function createAdminAlert(
  type: string,
  title: string,
  body: string,
  link: string,
  priority: AlertPriority = 'normal',
  options?: { actionBy?: string; actionByName?: string; companyId?: string; companyName?: string }
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'adminAlerts'), {
      type,
      title,
      body,
      link,
      read: false,
      priority,
      createdAt: serverTimestamp(),
      actionBy: options?.actionBy || null,
      actionByName: options?.actionByName || null,
      companyId: options?.companyId || null,
      companyName: options?.companyName || null,
    })
    return docRef.id
  } catch (err) {
    console.error('Error creating admin alert:', err)
    return ''
  }
}

export function subscribeToAdminAlerts(callback: (alerts: AdminAlert[]) => void): () => void {
  const q = query(
    collection(db, 'adminAlerts'),
    orderBy('createdAt', 'desc'),
    limit(100)
  )

  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
    })) as AdminAlert[]
    callback(alerts)
  }, (err) => {
    console.error('Admin alerts subscription error:', err)
    callback([])
  })
}

export async function markAdminAlertAsRead(alertId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'adminAlerts', alertId), { read: true })
  } catch (err) {
    console.error('Error marking admin alert as read:', err)
  }
}

export async function markAllAdminAlertsAsRead(): Promise<void> {
  try {
    const q = query(collection(db, 'adminAlerts'), where('read', '==', false))
    const snapshot = await getDocs(q)
    await Promise.all(snapshot.docs.map(d => updateDoc(d.ref, { read: true })))
  } catch (err) {
    console.error('Error marking all admin alerts as read:', err)
  }
}

export async function deleteAdminAlert(alertId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'adminAlerts', alertId))
  } catch (err) {
    console.error('Error deleting admin alert:', err)
  }
}

