import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const MANAGEMENT_ROLES = [
  'master-admin', 'company-admin', 'executive', 'team-leader', 'reporting-manager',
];

const isExpoPushToken = (token: string): boolean =>
  token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');

async function sendExpoPush(token: string, title: string, body: string, data?: Record<string, string>, ownerUserId?: string) {
  if (!isExpoPushToken(token)) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title,
      body,
      sound: 'default',
      data: data || {},
    }),
  });
  const result: any = await res.json();
  const receipt = result?.data?.[0];
  if (!res.ok || receipt?.status === 'error') {
    functions.logger.warn('Expo push rejected', { result, tokenPrefix: token.slice(0, 18) });
    // Stale/revoked device token — stop trying this token going forward
    if (receipt?.details?.error === 'DeviceNotRegistered' && ownerUserId) {
      try {
        await db.collection('users').doc(ownerUserId).update({
          pushToken: admin.firestore.FieldValue.delete(),
        });
        functions.logger.info('Cleared stale push token for user', { userId: ownerUserId });
      } catch (err) {
        functions.logger.warn('Failed to clear stale push token', { userId: ownerUserId, error: err });
      }
    }
  }
  return result;
}

/**
 * Firestore trigger: any notification written to the `notifications` collection
 * is forwarded as a push notification to the recipient's registered device.
 * This wires every existing web/mobile `createNotification` call site to push
 * without client changes. Skips users without a registered push token.
 */
export const onNotificationCreated = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    const userId = data?.userId;
    if (!userId) return;

    const userDoc = await db.collection('users').doc(userId).get();
    const pushToken = userDoc.data()?.pushToken;
    if (!pushToken) return;

    try {
      await sendExpoPush(
        pushToken,
        String(data.title || 'New notification'),
        String(data.body || ''),
        {
          link: String(data.link || ''),
          notificationId: snap.id,
          type: String(data.type || 'general'),
        },
        userId,
      );
    } catch (err) {
      functions.logger.warn('Push notification delivery failed', { userId, error: err });
    }
  });

/**
 * Callable: explicitly deliver a push to a single user. Management roles may
 * push to users within their own company; master-admin may push to anyone.
 */
export const sendPushNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { userId, title, body, link } = data || {};
  if (!userId || !title || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'userId, title and body are required');
  }

  const [callerDoc, targetDoc] = await Promise.all([
    db.collection('users').doc(context.auth.uid).get(),
    db.collection('users').doc(userId).get(),
  ]);
  const caller = callerDoc.data();
  const target = targetDoc.data();
  if (!caller) throw new functions.https.HttpsError('not-found', 'Caller not found');
  if (!target) throw new functions.https.HttpsError('not-found', 'Target user not found');

  const callerRole = caller.role;
  const isSuper = callerRole === 'master-admin';
  const sameCompany = caller.companyId && caller.companyId === target.companyId;
  if (!isSuper && !(MANAGEMENT_ROLES.includes(callerRole) && sameCompany)) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to send push notifications');
  }

  const pushToken = target.pushToken;
  if (!pushToken) {
    return { success: false, message: 'Target user has no registered device' };
  }

  await sendExpoPush(pushToken, title, body, { link: link || '' }, userId);
  return { success: true, message: 'Push notification sent' };
});
