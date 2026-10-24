/**
 * `firebase/auth` compatibility (mobile) → Amazon Cognito.
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
  getCurrentUser,
  getIdTokenResult,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type AwsUser as User,
  type UserCredential,
  type Auth,
} from './auth';

import { getAuthInstance } from './auth';
import type { Auth } from './auth';

export type FirebaseUser = import('./auth').AwsUser;

/** Live Auth instance — the app reads `auth.currentUser` off the result. */
export function getAuth(_app?: unknown): Auth {
  return getAuthInstance();
}
