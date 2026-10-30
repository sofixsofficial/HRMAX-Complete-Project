/**
 * Notifications — writes + Expo push (port of notificationFunctions.ts).
 * Push stays on the Expo Push API (works exactly as before on AWS).
 */

import { putEntity, getUserDoc, queryEntities } from './db.js';
import { newId, isoNow, type NotificationDoc } from './types.js';

export interface CreateNotificationInput {
  userId: string;
  companyId?: string;
  type: string;
  title: string;
  message?: string;
  body?: string;
  link?: string;
  priority?: 'low' | 'normal' | 'high';
}

export async function createNotification(input: CreateNotificationInput): Promise<string> {
  const id = newId();
  await putEntity<NotificationDoc>(
    {
      id,
      userId: input.userId,
      companyId: input.companyId ?? 'global',
      type: input.type,
      title: input.title,
      message: input.message,
      body: input.body ?? input.message,
      link: input.link,
      read: false,
      priority: input.priority ?? 'normal',
      createdAt: isoNow(),
    },
    // Always in the shared partition — the read/mark-read/delete routes patch
    // at 'global', so runtime-created notifications must live there with the
    // migrated ones (userId access goes through GSI1 either way).
    { entity: 'notification', userIdField: 'userId', keyCompanyId: 'global' },
  );
  // Fire-and-forget push
  void sendExpoPushToUser(input.userId, input);
  return id;
}

/** Fan out to many users, skipping the initiator. */
export async function fanOutNotifications(
  userIds: string[],
  input: Omit<CreateNotificationInput, 'userId'>,
  skipUserId?: string,
): Promise<void> {
  const seen = new Set<string>();
  for (const uid of userIds) {
    if (!uid || uid === skipUserId || seen.has(uid)) continue;
    seen.add(uid);
    await createNotification({ ...input, userId: uid });
  }
}

export interface ApprovalDecisionInput {
  companyId: string;
  action: 'Approved' | 'Rejected';
  /** Overall status AFTER this decision — false = an intermediate tier approved. */
  isFinal?: boolean;
  /** The requester whose leave / missed-punch is being decided. */
  subjectId?: string;
  subjectName?: string;
  /** Set when the caller already sent the subject its outcome notification. */
  subjectAlreadyNotified?: boolean;
  /** Override the subject message (e.g. "awaits Master Admin verification"). */
  subjectMessage?: string;
  /** The reviewer making this decision. */
  approverId?: string;
  approverName: string;
  approverLabel?: string;
  /** 'leave' | 'punch' — wording only. */
  kind?: string;
  /** Human description, e.g. "Casual leave (Oct 30 → Oct 30)". */
  detail: string;
  link: string;
  /** Caller sent its own actionable MA notice (e.g. "awaiting your verification"). */
  skipMasterAdmins?: boolean;
}

/**
 * The three-way approval notification fan-out (requirement):
 *  1. The SUBJECT hears about EVERY decision — intermediate tier approvals
 *     included, not just the final outcome.
 *  2. The APPROVER gets an explicit confirmation of their own action.
 *  3. ALL master admins get every approval event (actor skipped — they
 *     already received #2), unless the caller sent its own MA notice.
 * Never throws: notification failures must not block the review itself.
 */
export async function notifyApprovalDecision(i: ApprovalDecisionInput): Promise<void> {
  try {
    const kindLabel = i.kind === 'punch' ? 'missed punch correction' : 'leave request';
    const capKind = kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);
    const tier = i.approverLabel ? ` (${i.approverLabel})` : '';
    const verb = i.action === 'Approved' ? 'approved' : 'rejected';
    const who = i.subjectName || 'an employee';

    // ── 1. Subject ──
    if (!i.subjectAlreadyNotified && i.subjectId && i.subjectId !== i.approverId) {
      const message = i.subjectMessage ?? (
        i.action === 'Rejected'
          ? `${i.approverName}${tier} rejected your ${i.detail}.`
          : i.isFinal
            ? `Your ${i.detail} has been approved by all levels.`
            : `${i.approverName}${tier} approved your ${i.detail}. It now awaits the next approval.`
      );
      const title = i.action === 'Rejected'
        ? (i.kind === 'punch' ? 'Missed Punch Rejected' : 'Leave Rejected')
        : i.isFinal
          ? (i.kind === 'punch' ? 'Missed Punch Approved' : 'Leave Approved')
          : (i.kind === 'punch' ? 'Missed Punch Tier Approved' : 'Leave Tier Approved');
      const type = i.kind === 'punch'
        ? 'punch_rectification_resolved'
        : (i.action === 'Rejected' ? 'leave_rejected_by_tier' : i.isFinal ? 'leave_fully_approved' : 'leave_tier_approved');
      await createNotification({
        userId: i.subjectId, companyId: i.companyId, type, title, message, link: i.link,
      }).catch(() => {});
    }

    // ── 2. Approver self-confirmation ──
    if (i.approverId && i.approverId !== i.subjectId) {
      await createNotification({
        userId: i.approverId,
        companyId: i.companyId,
        type: i.kind === 'punch' ? 'punch_rectification_requested' : 'leave_tier_approved',
        title: i.subjectName ? `You ${verb} ${i.subjectName}'s ${kindLabel}` : `You ${verb} a ${kindLabel}`,
        message: `${i.detail}${tier}`,
        link: i.link,
      }).catch(() => {});
    }

    // ── 3. Every master admin ──
    if (!i.skipMasterAdmins) {
      const mas = await queryEntities<Record<string, unknown>>({
        entity: 'user', companyId: 'global', filters: { role: 'master-admin' }, limit: 100,
      }).catch(() => []);
      const skip = new Set<string>([i.approverId ?? '', i.subjectId ?? '']);
      for (const ma of mas) {
        const id = String(ma.id ?? '');
        if (!id || skip.has(id)) continue;
        await createNotification({
          userId: id,
          companyId: i.companyId,
          type: i.kind === 'punch' ? 'punch_rectification_requested' : 'leave_tier_approved',
          title: `${capKind} ${verb}`,
          message: `${i.approverName}${tier} ${verb} ${who}'s ${i.detail}.`,
          link: i.link,
        }).catch(() => {});
      }
    }
  } catch {
    // Notification fan-out must never block the approval itself.
  }
}

/** Send an Expo push message to a user's registered token. */
export async function sendExpoPushToUser(
  userId: string,
  payload: { title: string; message?: string; body?: string; link?: string; type?: string; notificationId?: string },
): Promise<void> {
  try {
    const user = await getUserDoc(userId);
    const token = (user?.pushToken as string) ?? null;
    if (!token) return;
    if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) return;

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: token,
        sound: 'default',
        title: payload.title,
        body: payload.body ?? payload.message ?? '',
        data: { link: payload.link, type: payload.type, notificationId: payload.notificationId },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { data?: { details?: { error?: string } } } | null;
      const error = data?.data?.details?.error;
      if (error === 'DeviceNotRegistered') {
        // stale token — clear it
        const { patchEntity } = await import('./db.js');
        await patchEntity('user', String(user?.companyId ?? 'global'), userId, { pushToken: null }, { entity: 'user' });
      }
    }
  } catch (err) {
    console.error('push failed', err);
  }
}
