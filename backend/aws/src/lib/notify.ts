/**
 * Notifications — writes + Expo push (port of notificationFunctions.ts).
 * Push stays on the Expo Push API (works exactly as before on AWS).
 */

import { putEntity, getUserDoc } from './db.js';
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
    { entity: 'notification', userIdField: 'userId' },
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
