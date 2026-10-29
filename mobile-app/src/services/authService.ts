import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  onAuthStateChanged,
  getIdTokenResult,
} from '../aws/auth-compat';
import type { AuthError } from '../aws/auth-compat';
import { doc, getDoc } from '../aws/firestore-compat';
import { auth, db } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { ERROR_MESSAGES } from '../aws/errors';
import { functions } from '../aws/clients';
import type { User, UserRole } from '../types/user';

interface CustomClaims {
  role: UserRole;
  companyId: string;
  permissions: string[];
}

const handleAuthError = (error: AuthError): void => {
  const errorMessages: Record<string, string> = {
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': ERROR_MESSAGES.invalidCredentials,
    'auth/invalid-email': ERROR_MESSAGES.invalidEmail,
    'auth/user-disabled': 'This account has been disabled.',
    'auth/invalid-credential': ERROR_MESSAGES.invalidCredentials,
    'auth/too-many-requests': 'Too many attempts — please wait a minute and try again.',
    'auth/network-error': ERROR_MESSAGES.network,
    'auth/session-expired': ERROR_MESSAGES.sessionExpired,
    'auth/access-denied': ERROR_MESSAGES.accessDenied,
  };
  const message = errorMessages[error.code] || error.message || ERROR_MESSAGES.generic;
  throw new Error(message);
};

export const signIn = async (email: string, password: string): Promise<User> => {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPassword = password.trim();

  const attempt = async (): Promise<User> => {
    const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
    const remoteUser = userCredential.user;

    const tokenResult = await getIdTokenResult(remoteUser, true);
    const claims = tokenResult.claims as unknown as CustomClaims;

    const userDoc = await getDoc(doc(db, 'users', remoteUser.uid));
    if (!userDoc.exists()) {
      throw new Error('User profile not found. Please contact support.');
    }

    const userData = userDoc.data() as User;

    if (userData.role === 'company-admin') {
      const status = userData.status || 'Approved';
      if (status === 'Pending') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account is pending approval from the Master Admin.');
      }
      if (status === 'Rejected') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account request has been rejected.');
      }
      if (status === 'Suspended') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account has been suspended.');
      }
    }

    try {
      const callableFn = httpsCallable(functions, 'mobileUpdateLastLogin');
      await callableFn({ userId: remoteUser.uid });
    } catch {}

    return userData;
  };

  try {
    return await attempt();
  } catch (error) {
    const authErr = error as AuthError;
    if (authErr.code === 'auth/invalid-credential') {
      try {
        await signOut(auth);
      } catch {}
      try {
        return await attempt();
      } catch (retryErr) {
        handleAuthError(retryErr as AuthError);
        throw retryErr;
      }
    }
    console.error('[AuthService] Sign in error:', error);
    handleAuthError(authErr);
    throw error;
  }
};

export const logOut = async (): Promise<void> => {
  await signOut(auth);
};

export const resetPassword = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

export const confirmResetPassword = async (code: string, newPassword: string, email?: string): Promise<void> => {
  try {
    await confirmPasswordReset(auth, code, newPassword, email);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

/**
 * Server-verified password change (parity with web Settings).
 * The backend verifies the current password, enforces the shared policy,
 * records an audit event and sends a security email — so genuine messages
 * ("Current password is incorrect", policy specifics) come straight from it.
 * Errors are already normalized by httpsCallable's toFriendlyError.
 */
export const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  const fn = httpsCallable(functions, 'changePassword');
  await fn({ currentPassword, newPassword });
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, async (remoteUser) => {
    if (!remoteUser) {
      callback(null);
      return;
    }
    try {
      const userDoc = await getDoc(doc(db, 'users', remoteUser.uid));
      if (!userDoc.exists()) {
        callback(null);
        return;
      }
      const userData = userDoc.data() as User;
      callback(userData);
    } catch (error) {
      console.error('Auth change error:', error);
      callback(null);
    }
  });
};

export const updateUserProfile = async (updates: { name?: string; phone?: string; avatar?: string }): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  try {
    const callableFn = httpsCallable(functions, 'mobileUpdateAuthProfile');
    await callableFn({ userId: user.uid, ...updates });
  } catch (error) {
    console.error('Update profile error:', error);
    throw error;
  }
};
