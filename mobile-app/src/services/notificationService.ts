import { collection, doc, getDocs, getDoc, query, where, orderBy, limit, onSnapshot, invalidateSnapshots } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  link: string;
  companyId: string;
  createdAt: Date;
}

const notificationsRef = collection(db, 'notifications');

export const createNotification = async (
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string,
  companyId?: string
): Promise<string> => {
  if (!userId) return '';
  const callableFn = httpsCallable(functions, 'mobileCreateNotification');
  const result = await callableFn({
    userId, type, title, body, link: link || '', companyId: companyId || '',
  });
  return result.data as string;
};

export const subscribeToNotifications = (userId: string, callback: (notifications: AppNotification[]) => void): (() => void) => {
  const q = query(notificationsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({
      id: d.id,
      userId: d.data().userId || '',
      type: d.data().type || 'general',
      title: d.data().title || '',
      body: d.data().body || '',
      read: d.data().read || false,
      link: d.data().link || '',
      companyId: d.data().companyId || '',
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || new Date(),
    })) as AppNotification[];
    callback(items);
  }, () => callback([]));
};

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileMarkNotificationRead');
  await callableFn({ notificationId });
  // Callable writes server-side (no shim write path) — refresh badges now.
  invalidateSnapshots();
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileMarkAllNotificationsRead');
  await callableFn({ userId });
  invalidateSnapshots();
};

export const deleteNotification = async (notificationId: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteNotification');
  await callableFn({ notificationId });
  invalidateSnapshots();
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> => {
  const q = query(notificationsRef, where('userId', '==', userId), where('read', '==', false));
  const snap = await getDocs(q);
  return snap.size;
};

export const subscribeToUnreadCount = (userId: string, callback: (count: number) => void): (() => void) => {
  const q = query(notificationsRef, where('userId', '==', userId), where('read', '==', false));
  return onSnapshot(q, (snap) => callback(snap.size), () => callback(0));
};

const adminAlertsRef = collection(db, 'adminAlerts');

export const createAdminAlert = async (
  type: string, title: string, body: string, link?: string, priority?: 'high' | 'normal' | 'low'
): Promise<string> => {
  try {
    const callableFn = httpsCallable(functions, 'mobileCreateAdminAlert');
    const result = await callableFn({
      type, title, body, link: link || '', priority: priority || 'normal',
    });
    return result.data as string;
  } catch { return ''; }
};

export const subscribeToAdminAlerts = (callback: (alerts: any[]) => void): (() => void) => {
  const q = query(adminAlertsRef, orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(items);
  }, () => callback([]));
};

export const markAdminAlertAsRead = async (alertId: string): Promise<void> => {
  try {
    const callableFn = httpsCallable(functions, 'mobileMarkAdminAlertRead');
    await callableFn({ alertId });
  } catch {}
};

export const markAllAdminAlertsAsRead = async (): Promise<void> => {
  try {
    const callableFn = httpsCallable(functions, 'mobileMarkAllAdminAlertsRead');
    await callableFn({});
  } catch {}
};

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

async function notifyRecipients(
  recipients: Iterable<string>,
  type: string,
  title: string,
  body: string,
  link: string,
  companyId?: string | null
): Promise<void> {
  const seen = new Set<string>();
  for (const id of recipients) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    await createNotification(id, type, title, body, link, companyId || '');
  }
}

export async function getMasterAdminIds(): Promise<string[]> {
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.id);
  } catch { return []; }
}

/**
 * Notify the executives + master-admins overseeing a team-leader action.
 * Only fires when the actor is a team-leader.
 */
export async function notifyTLAction(
  actorUserId: string,
  type: string,
  title: string,
  body: string,
  companyId?: string | null,
  extraRecipients?: string[]
): Promise<void> {
  if (!actorUserId) return;
  try {
    const actorSnap = await getDoc(doc(db, 'users', actorUserId));
    const actor = actorSnap.data();
    if (actor?.role !== 'team-leader') return;
    const execIds: string[] = Array.isArray(actor.linkedExecutiveIds)
      ? actor.linkedExecutiveIds
      : actor.reportingExecutiveId
        ? [actor.reportingExecutiveId]
        : [];
    const masterAdmins = await getMasterAdminIds();
    await notifyRecipients([...execIds, ...masterAdmins, ...(extraRecipients || [])], type, title, body, '/notifications', companyId);
  } catch {}
}

export async function notifyTeamLeaderCreated(
  tlName: string,
  companyId: string | null,
  execUserIds: string[],
  masterAdminIds: string[]
): Promise<void> {
  await notifyRecipients(
    [...execUserIds, ...masterAdminIds],
    'team_leader_created',
    'New Team Leader',
    `${tlName} was added as a Team Leader.`,
    '/team-leaders',
    companyId
  );
}

export async function notifyTeamLeaderUpdated(
  tlName: string,
  companyId: string | null,
  execUserIds: string[],
  masterAdminIds: string[]
): Promise<void> {
  await notifyRecipients(
    [...execUserIds, ...masterAdminIds],
    'team_leader_updated',
    'Team Leader Updated',
    `${tlName}'s team leader profile was updated.`,
    '/team-leaders',
    companyId
  );
}

export async function notifyTeamLeaderDeactivated(
  tlName: string,
  companyId: string | null,
  execUserIds: string[],
  masterAdminIds: string[]
): Promise<void> {
  await notifyRecipients(
    [...execUserIds, ...masterAdminIds],
    'team_leader_deactivated',
    'Team Leader Deactivated',
    `${tlName}'s team leader account was deactivated.`,
    '/team-leaders',
    companyId
  );
}

export async function notifyExecutiveChanged(
  action: 'created' | 'updated' | 'deactivated',
  execName: string,
  companyId: string | null,
  masterAdminIds: string[],
  execUserId?: string
): Promise<void> {
  const title = `Executive ${action === 'created' ? 'Created' : action === 'updated' ? 'Updated' : 'Deactivated'}`;
  await notifyRecipients(
    [...(execUserId ? [execUserId] : []), ...masterAdminIds],
    `executive_${action}`,
    title,
    `${execName}'s executive account was ${action}.`,
    '/executives',
    companyId
  );
}

// ── Notification Cascade Functions (via Cloud Functions) ──

/**
 * Send cascade notifications for leave events (submitted, tier-approved, tier-rejected).
 * Uses the mobileCreateNotification Cloud Function.
 */
export async function notifyLeaveCascade(
  leaveData: {
    id: string;
    userId: string;
    employeeName: string;
    companyId: string;
    leaveType?: string;
    nextApproverId?: string;
    nextApproverTier?: string;
    rejectedByTier?: string;
    rejectorName?: string;
    note?: string;
    masterAdminRequired?: boolean;
  },
  eventType: 'submitted' | 'tier-approved' | 'tier-rejected' | 'fully-approved' | 'master-admin-approved' | 'master-admin-rejected'
): Promise<void> {
  try {
    const createNotif = httpsCallable(functions, 'mobileCreateNotification');
    await createNotif({
      type: 'leave_cascade',
      eventType,
      userId: leaveData.userId,
      employeeName: leaveData.employeeName,
      companyId: leaveData.companyId,
      leaveType: leaveData.leaveType,
      nextApproverId: leaveData.nextApproverId,
      nextApproverTier: leaveData.nextApproverTier,
      rejectedByTier: leaveData.rejectedByTier,
      rejectorName: leaveData.rejectorName,
      note: leaveData.note,
      masterAdminRequired: leaveData.masterAdminRequired,
    });
  } catch (err: any) {
    console.warn('notifyLeaveCascade failed:', err?.message || err);
  }
}

/**
 * Send cascade notifications for attendance rectification events.
 */
export async function notifyAttendanceCascade(
  attendanceData: {
    id: string;
    userId: string;
    employeeName: string;
    companyId: string;
    date: string;
    lateMinutes?: number;
    nextApproverId?: string;
    rejectorName?: string;
    note?: string;
    resolved?: boolean;
  },
  eventType: 'rectification-requested' | 'rectification-resolved' | 'rectification-rejected' | 'late-checkin'
): Promise<void> {
  try {
    // Same server-side cascade the website uses (frontend attendanceNotifier.ts):
    // the CF resolves the employee's whole same-company chain (RM, CA, Exec, TL,
    // Master Admin) and writes every notification — the flat-payload
    // mobileCreateNotification path previously failed with 400.
    const cascadeFn = httpsCallable(functions, 'notifyAttendanceCascade');
    const isReject = eventType === 'rectification-rejected';
    const kind =
      eventType === 'late-checkin' ? 'late-checkin'
      : eventType === 'rectification-requested' ? 'rectification-requested'
      : 'rectification-resolved';
    const note = [
      attendanceData.lateMinutes ? `${attendanceData.lateMinutes} min late.` : '',
      isReject
        ? `Rejected${attendanceData.rejectorName ? ` by ${attendanceData.rejectorName}` : ''}`
        : attendanceData.rejectorName
          ? `Resolved by ${attendanceData.rejectorName}`
          : '',
      attendanceData.note || '',
    ].filter(Boolean).join(' · ');
    await cascadeFn({
      companyId: attendanceData.companyId,
      employeeUserId: attendanceData.userId,
      employeeName: attendanceData.employeeName,
      kind,
      dateLabel: attendanceData.date,
      note,
      actorName: attendanceData.rejectorName || attendanceData.employeeName,
    });
  } catch (err: any) {
    console.warn('notifyAttendanceCascade failed:', err?.message || err);
  }
}

/**
 * Notify the assigned employee when a task is assigned.
 */
export async function notifyTaskAssigned(
  taskData: {
    assignedToId: string;
    assignerName: string;
    taskTitle: string;
    companyId: string;
  }
): Promise<void> {
  try {
    const createNotif = httpsCallable(functions, 'mobileCreateNotification');
    await createNotif({
      type: 'task_assigned',
      userId: taskData.assignedToId,
      title: 'Task Assigned',
      body: `${taskData.assignerName} assigned you a task: ${taskData.taskTitle}`,
      companyId: taskData.companyId,
      link: '/tasks',
    });
  } catch (err: any) {
    console.warn('notifyTaskAssigned failed:', err?.message || err);
  }
}

/**
 * Notify all tiers in the chain when a missed punch rectification is submitted.
 */
export async function notifyMissedPunchSubmittedToTiers(
  attendanceData: {
    userId: string;
    employeeName: string;
    companyId: string;
    tierApproverIds: Record<string, string>;
  }
): Promise<void> {
  try {
    const createNotif = httpsCallable(functions, 'mobileCreateNotification');
    await createNotif({
      type: 'missed_punch_tiers',
      userId: attendanceData.userId,
      employeeName: attendanceData.employeeName,
      companyId: attendanceData.companyId,
      tierApproverIds: attendanceData.tierApproverIds,
    });
  } catch (err: any) {
    console.warn('notifyMissedPunchSubmittedToTiers failed:', err?.message || err);
  }
}
