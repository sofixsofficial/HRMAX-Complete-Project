import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  onAuthStateChanged,
  getIdTokenResult,
} from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import type { User, UserRole } from '../types/user';

interface CustomClaims {
  role: UserRole;
  companyId: string;
  permissions: string[];
}

const handleAuthError = (error: AuthError): void => {
  const errorMessages: Record<string, string> = {
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password. Try again or use Forgot Password.',
    'auth/invalid-email': 'Invalid email address format.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many failed attempts. Try again later.',
  };
  const message = errorMessages[error.code] || error.message || 'An unexpected error occurred';
  throw new Error(message);
};

export const signIn = async (email: string, password: string): Promise<User> => {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPassword = password.trim();

  const attempt = async (): Promise<User> => {
    const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
    const firebaseUser = userCredential.user;

    const tokenResult = await getIdTokenResult(firebaseUser, true);
    const claims = tokenResult.claims as unknown as CustomClaims;

    const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
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
      await callableFn({ userId: firebaseUser.uid });
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

export const confirmResetPassword = async (code: string, newPassword: string): Promise<void> => {
  try {
    await confirmPasswordReset(auth, code, newPassword);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    try {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
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
