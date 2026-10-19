/**
 * `firebase/auth` compatibility module → Amazon Cognito.
 * Re-exports the aws/auth surface under the exact names the app imports,
 * plus no-op emulator/config helpers.
 */

export {
  AuthError,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  updatePassword,
  updateProfile,
  onAuthStateChanged,
  getCurrentUser as currentUser,
  getIdTokenResult,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type AwsUser as User,
  type UserCredential,
  type Auth,
} from './auth';

import { getAuthInstance } from './auth';
import type { AwsUser, Auth } from './auth';

/** Firebase-typed alias (app code types uid/email off User). */
export type FirebaseUser = AwsUser;

/** No-op: AWS build has no emulator. */
export function connectAuthEmulator(): void {}

/** Live Auth instance — the app reads `auth.currentUser` off the result. */
export function getAuth(_app?: unknown): Auth {
  return getAuthInstance();
}

/** updateEmail — Cognito attribute update via profile endpoint. */
export async function updateEmail(user: AwsUser, newEmail: string): Promise<void> {
  const { getIdToken } = await import('./auth');
  const token = await getIdToken();
  const res = await fetch(
    `https://cognito-idp.${(await import('./config')).AWS_CONFIG.region}.amazonaws.com/`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.UpdateUserAttributes',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ UserAttributes: [{ Name: 'email', Value: newEmail }] }),
    },
  );
  if (!res.ok) throw new Error('Failed to update email');
  user.email = newEmail;
}

export type { AuthError as AuthErrorType } from './auth';
