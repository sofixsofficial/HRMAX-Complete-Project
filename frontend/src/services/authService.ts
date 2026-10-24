/**
 * Authentication Service (Cognito)
 * Handles auth operations with custom claims
 */

import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  updatePassword,
  updateEmail,
  updateProfile,
  onAuthStateChanged,
  getIdTokenResult
} from '../aws/auth-compat';
import type { User as AuthUser, AuthError } from '../aws/auth-compat';
import type { PermissionScopeMap } from './permissionConfig';
import { 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  updateDoc, 
  addDoc,
  collection,
  query,
  where,
  serverTimestamp,
  deleteField
} from '../aws/firestore-compat';
import { httpsCallable } from '../aws/functions-compat';
import { auth, db, functions } from '../aws/clients';
import { ERROR_MESSAGES } from '../aws/errors';
import type { User, UserRole } from '../types/user';

// Extended User interface for auth service
interface AuthUser extends User {
  uid?: string;
  emailVerified?: boolean;
}

// Auth result interface
interface CustomClaims {
  role: UserRole;
  companyId: string;
  permissions: string[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export const getPermissionArray = (role: UserRole): string[] => {
  const rolePerms: Record<UserRole, string[]> = {
    'master-admin': ['*'],
    'company-admin': [
      // View-only permissions for all operational modules (incl. leave)
      'employees.view', 'departments.view',
      'salary.view',
      // Salary-slip corrections: Company Admin may edit + regenerate corrected
      // payslips within the 5-day correction window (rules still scope updates
      // to their own company).
      'salary.edit',
      'payroll.view',
      'attendance.view',
      'leave.view',
      'reports.view',
      'settings.view',
      'company.view',
      'tasks.view',
    ],
    'team-leader': ['*'],
    'executive': ['*'],
    'reporting-manager': [
      'leave.view', 'leave.apply', 'leave.create', 'leave.manage',
      'employees.view',
      'attendance.view',
      'reports.view',
    ],
    'employee': [
      'employees.view',
      'departments.view',
      'attendance.view',
      'payroll.view',
      'leave.view', 'leave.apply',
      'company.view',
      'tasks.view',
    ],
  };
  
  return rolePerms[role] || [];
};

const handleAuthError = (error: AuthError): void => {
  const errorMessages: Record<string, string> = {
    'auth/user-not-found': 'No account found with this email. Please verify your email or contact your admin.',
    'auth/wrong-password': ERROR_MESSAGES.invalidCredentials,
    'auth/invalid-email': ERROR_MESSAGES.invalidEmail,
    'auth/user-disabled': 'This account has been disabled. Contact your admin.',
    'auth/email-already-in-use': 'An account already exists with this email.',
    'auth/weak-password': 'Password is too weak (min 6 characters).',
    'auth/invalid-credential': ERROR_MESSAGES.invalidCredentials,
    'auth/requires-recent-login': ERROR_MESSAGES.sessionExpired,
    'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
    'auth/network-error': ERROR_MESSAGES.network,
    'auth/session-expired': ERROR_MESSAGES.sessionExpired,
    'auth/access-denied': ERROR_MESSAGES.accessDenied,
  };
  
  const message = errorMessages[error.code] || error.message || ERROR_MESSAGES.generic;
  throw new Error(message);
};

// ============================================
// AUTH SERVICE
// ============================================

export interface AuthResult {
  user: User;
  claims: CustomClaims;
}

/**
 * Sign up a new company and admin (Direct Firestore version - no Cloud Functions needed)
 */
export const signUpCompany = async (
  email: string,
  password: string,
  companyName: string,
  adminName: string
): Promise<AuthResult> => {
  try {
    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const remoteUser = userCredential.user;
    
    // Update profile
    await updateProfile(remoteUser, { displayName: adminName });
    
    // Create company directly in Firestore
    const companyRef = doc(collection(db, 'companies'));
    const companyId = companyRef.id;
    
    await setDoc(companyRef, {
      id: companyId,
      name: companyName,
      slug: companyName.toLowerCase().replace(/\s+/g, '-'),
      email: email,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: remoteUser.uid,
      employeeCount: 1,
    });
    
    // Create user document with company-admin role — default to Pending approval
    const permissions = getPermissionArray('company-admin');
    const userData: User = {
      id: remoteUser.uid,
      email,
      name: adminName,
      role: 'company-admin',
      companyId,
      departmentId: null,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(adminName)}&background=random`,
      permissions,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'Pending',
      isApproved: false,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      suspendedAt: null,
    };
    
    await setDoc(doc(db, 'users', remoteUser.uid), {
      ...userData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Notify master admin about new registration
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'master-admin'));
      const masterSnapshot = await getDocs(q);
      const { createNotification } = await import('./notificationService');
      masterSnapshot.docs.forEach(masterDoc => {
        const masterData = masterDoc.data();
        createNotification(
          masterDoc.id,
          'general',
          'New Company Admin Registration',
          `${adminName} (${email}) registered as Company Admin for ${companyName}. Account is pending approval.`,
          '/company-admin-approvals',
          masterData.companyId || 'master-admin'
        ).catch(() => {});
      });
    } catch (_e) {
      // Notification is best-effort
    }
    
    return { user: userData, claims: { role: 'company-admin', companyId, permissions } };
  } catch (error) {
    console.error('Sign up error:', error);
    handleAuthError(error as AuthError);
    throw error;
  }
};

/**
 * Sign in existing user
 */
export const signIn = async (email: string, password: string): Promise<User> => {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPassword = password.trim();

  console.log('[AuthService] signIn called:', { email: trimmedEmail, passwordLength: trimmedPassword.length });

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

    // Company Admin approval status check
    if (userData.role === 'company-admin') {
      const status = userData.status || 'Approved';
      if (status === 'Pending') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account is pending approval from the Master Admin. Please wait for activation.');
      }
      if (status === 'Rejected') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account request has been rejected. Please contact the system administrator.');
      }
      if (status === 'Suspended') {
        await signOut(auth).catch(() => {});
        throw new Error('Your account has been suspended. Please contact the system administrator.');
      }
    }

    // Non-critical: update lastLogin timestamp (failure should not block sign-in)
    try {
      await updateDoc(doc(db, 'users', remoteUser.uid), {
        lastLoginAt: serverTimestamp(),
        lastLoginIp: '',
      });
    } catch {
      // Login-tracking write is best-effort
    }

    return userData;
  };

  try {
    return await attempt();
  } catch (error) {
    const authErr = error as AuthError;
    if (authErr.code === 'auth/invalid-credential') {
      console.log('[AuthService] First attempt failed with invalid-credential. Signing out stale session and retrying once.');
      try { await signOut(auth); } catch {}
      try {
        return await attempt();
      } catch (retryErr) {
        console.error('[AuthService] Retry also failed:', retryErr);
        handleAuthError(retryErr as AuthError);
        throw retryErr;
      }
    }
    console.error('[AuthService] Sign in error:', error);
    handleAuthError(authErr);
    throw error;
  }
};

/**
 * Sign out
 */
export const signOutUser = async (): Promise<void> => {
  await signOut(auth);
};

/**
 * Alias for signOutUser (backward compatibility)
 */
export const logOut = signOutUser;

// Alias for backward compatibility with existing code
export const signUp = signUpCompany;

/**
 * Get user data (alias for backward compatibility)
 */
export const getUserData = async (remoteUser: any): Promise<User> => {
  const userDoc = await getDoc(doc(db, 'users', remoteUser.uid));
  if (!userDoc.exists()) {
    throw new Error('User not found');
  }
  return userDoc.data() as User;
};

/**
 * Send password reset email
 */
export const resetPassword = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

/**
 * Confirm password reset with code
 */
export const confirmResetPassword = async (code: string, newPassword: string): Promise<void> => {
  try {
    await confirmPasswordReset(auth, code, newPassword);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

/**
 * Generate a 6-digit reset code and store it in Firestore with a 10-minute expiration
 */
export const generateResetCode = async (email: string): Promise<{ code: string; expiresAt: Date }> => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const resetCodeRef = doc(collection(db, 'resetCodes'));
  await setDoc(resetCodeRef, {
    email: email.toLowerCase(),
    code,
    expiresAt,
    used: false,
    createdAt: serverTimestamp(),
  });

  return { code, expiresAt };
};

/**
 * Verify a 6-digit reset code from Firestore
 */
export const verifyResetCode = async (email: string, code: string): Promise<boolean> => {
  const q = query(
    collection(db, 'resetCodes'),
    where('email', '==', email.toLowerCase()),
    where('code', '==', code),
    where('used', '==', false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return false;

  const data = snap.docs[0].data();
  const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;
  if (expiresAt && new Date() > expiresAt) {
    await snap.docs[0].ref.update({ used: true }).catch(() => {});
    return false;
  }

  return true;
};

/**
 * Invalidate all reset codes for a given email
 */
export const invalidateResetCodes = async (email: string): Promise<void> => {
  const q = query(collection(db, 'resetCodes'), where('email', '==', email.toLowerCase()));
  const snap = await getDocs(q);
  const batch = snap.docs.map(d => d.ref.update({ used: true }));
  await Promise.all(batch);
};

/**
 * Re-authenticate current user with their password (for sensitive operations)
 */
export const reauthenticateUser = async (currentPassword: string): Promise<void> => {
  const { reauthenticateWithCredential, EmailAuthProvider } = await import('../aws/auth-compat');
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('No user signed in');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
};

/**
 * Update user password
 */
export const updateUserPassword = async (newPassword: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  
  try {
    await updatePassword(user, newPassword);
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

/**
 * Update user email
 */
export const updateUserEmail = async (newEmail: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  
  try {
    await updateEmail(user, newEmail);
    
    // Update in Firestore
    await updateDoc(doc(db, 'users', user.uid), {
      email: newEmail,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleAuthError(error as AuthError);
  }
};

/**
 * Update user profile
 */
export const updateUserProfile = async (updates: { name?: string; phone?: string; avatar?: string }): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  
  try {
    if (updates.name) {
      await updateProfile(user, { displayName: updates.name });
    }
    
    // Update in Firestore
    await updateDoc(doc(db, 'users', user.uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    throw error;
  }
};

/**
 * Get current user with claims
 */
export const getCurrentUser = async (): Promise<AuthResult | null> => {
  const user = auth.currentUser;
  if (!user) return null;
  
  try {
    const tokenResult = await getIdTokenResult(user, true);
    const claims = tokenResult.claims as unknown as CustomClaims;
    
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;
    
    const userData = userDoc.data() as User;
    return { user: userData, claims };
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
};

/**
 * Refresh user token and claims
 */
export const refreshUserClaims = async (): Promise<AuthResult | null> => {
  const user = auth.currentUser;
  if (!user) return null;
  
  try {
    // Force token refresh
    const tokenResult = await getIdTokenResult(user, true);
    const claims = tokenResult.claims as unknown as CustomClaims;
    
    // Get fresh user data
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;
    
    const userData = userDoc.data() as User;
    return { user: userData, claims };
  } catch (error) {
    console.error('Refresh claims error:', error);
    return null;
  }
};

/**
 * Subscribe to auth state changes
 */
export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, async (remoteUser) => {
    if (!remoteUser) {
      callback(null);
      return;
    }
    
    try {
      const tokenResult = await getIdTokenResult(remoteUser, true);
      const claims = tokenResult.claims as unknown as CustomClaims;
      
      const userDoc = await getDoc(doc(db, 'users', remoteUser.uid));
      if (!userDoc.exists()) {
        callback(null);
        return;
      }
      
      const userData = userDoc.data() as User;
      callback(userData);
    } catch (error) {
      console.error('Auth change error:', error);
      // A transient token-refresh / user-doc read failure must NOT invalidate a
      // live session. If we called callback(null) the app logs the user out and
      // the dashboard renders its fatal "Session expired" fallback on the very
      // first load (e.g. offline, slow network, momentary permission hiccup).
      // Instead emit a minimal least-privilege user; the AuthContext realtime
      // user-doc listener replaces it with the full profile once reads recover.
      const fallback: User = {
        id: remoteUser.uid,
        email: remoteUser.email || '',
        name: remoteUser.displayName || remoteUser.email || 'User',
        role: 'employee',
        companyId: null,
        departmentId: null,
        avatar: '',
        permissions: [
          'employees.view',
          'departments.view',
          'attendance.view',
          'payroll.view',
          'leave.view', 'leave.apply',
          'company.view',
          'tasks.view',
        ],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      callback(fallback);
    }
  });
};

/**
 * Update user role and permissions (admin only)
 */
export const updateUserRole = async (userId: string, newRole: UserRole): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user signed in');
  
  // Verify current user has permission to assign roles
  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  
  const currentUserData = currentUserDoc.data() as User;
  const isManagement = ['master-admin', 'team-leader', 'executive'].includes(currentUserData.role);
  const isExecOrTl = currentUserData.role === 'executive' || currentUserData.role === 'team-leader';

  if (!isManagement) {
    throw new Error('You do not have permission to assign roles');
  }
  // Executives / Team Leaders may only manage their own staff roles
  if (isExecOrTl && !['employee', 'reporting-manager'].includes(newRole)) {
    throw new Error('You can only assign employee or reporting manager roles');
  }
  
  // Get permissions for the new role
  const permissions = getPermissionArray(newRole);
  
  try {
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      await updateDoc(userDocRef, {
        role: newRole,
        permissions: permissions,
        updatedAt: serverTimestamp(),
      });
    } else {
      // Document doesn't exist — likely a stale Auth user without Firestore record.
      // Create the document so role assignment works atomically.
      await setDoc(userDocRef, {
        id: userId,
        email: '',
        name: 'Unknown',
        role: newRole,
        companyId: null,
        departmentId: null,
        avatar: `https://ui-avatars.com/api/?name=Unknown&background=random`,
        permissions,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    
    // Note: In a production app, you would also update custom claims via Cloud Function
    // For now, permissions are checked from Firestore on each login
  } catch (error) {
    console.error('Update user role error:', error);
    throw error;
  }
};

/**
 * Update the permission matrix of a Team Leader or Executive (master admin only)
 * @param userId      target user document
 * @param permissions permission array (core CRUD keys + preserved non-core grants)
 * @param scopes      kept for call-site compatibility; scope controls were removed
 *                    from the UI, so any stored scope overrides are cleared.
 */
export const updateUserPermissions = async (
  userId: string,
  permissions: string[],
  scopes?: PermissionScopeMap
): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user signed in');

  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  const currentUserData = currentUserDoc.data() as User;
  if (currentUserData.role !== 'master-admin') {
    throw new Error('Only the Master Admin can configure permissions');
  }

  const targetDocRef = doc(db, 'users', userId);
  const targetDoc = await getDoc(targetDocRef);
  if (!targetDoc.exists()) throw new Error('User not found');
  const targetData = targetDoc.data() as User;

  if (!['team-leader', 'executive'].includes(targetData.role)) {
    throw new Error('Permissions can only be configured for Team Leaders and Executives');
  }

  try {
    const payload: Record<string, unknown> = {
      permissions,
      permissionsConfigured: true,
      permissionScopes: deleteField(),
      permissionsUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await updateDoc(targetDocRef, payload);
  } catch (error) {
    console.error('Update user permissions error:', error);
    throw error;
  }
};

/**
 * Get all users for role assignment (admin only)
 */
export const getAllUsers = async (): Promise<User[]> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user signed in');
  
  const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!currentUserDoc.exists()) throw new Error('Current user not found');
  
  const currentUserData = currentUserDoc.data() as User;
  const isManagement = ['master-admin', 'company-admin', 'team-leader', 'executive'].includes(currentUserData.role);
  
  if (!isManagement) {
    throw new Error('You do not have permission to view all users');
  }
  
  try {
    let q;
    if (currentUserData.role === 'master-admin') {
      // Master admin sees all users
      q = query(collection(db, 'users'));
    } else {
      // Company admin sees only their company users
      q = query(collection(db, 'users'), where('companyId', '==', currentUserData.companyId));
    }
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as User[];
  } catch (error) {
    console.error('Get all users error:', error);
    throw error;
  }
};

// ============================================
// INVITATION SERVICE
// ============================================

/**
 * Accept invitation and create account (client-side implementation)
 */
export const acceptInvitation = async (
  token: string,
  email: string,
  password: string,
  name: string
): Promise<AuthResult> => {
  try {
    // Get invitation by token
    const q = query(
      collection(db, 'invitations'),
      where('token', '==', token),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      throw new Error('Invalid or expired invitation');
    }
    
    const inviteDocRef = snapshot.docs[0].ref;
    const inviteData = snapshot.docs[0].data();
    
    // Check expiration
    if (inviteData.expiresAt?.toDate) {
      const expiresAt = inviteData.expiresAt.toDate();
      if (new Date() > expiresAt) {
        throw new Error('Invitation has expired');
      }
    }
    
    // Verify email matches
    if (inviteData.email !== email) {
      throw new Error('Email does not match the invitation');
    }
    
    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const remoteUser = userCredential.user;
    
    // Update profile
    await updateProfile(remoteUser, { displayName: name });
    
    // Get permissions for role
    const permissions = getPermissionArray(inviteData.role as UserRole);
    
    // Create user document
    const userData: User = {
      id: remoteUser.uid,
      email,
      name,
      role: inviteData.role as UserRole,
      companyId: inviteData.companyId || null,
      departmentId: inviteData.departmentId || null,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      permissions,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await setDoc(doc(db, 'users', remoteUser.uid), {
      ...userData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    // Link or create employee record
    if (inviteData.employeeId) {
      // Update existing employee with new userId and role details
      const existingEmpRef = doc(db, 'employees', inviteData.employeeId as string);
      const existingEmpDoc = await getDoc(existingEmpRef);
      if (existingEmpDoc.exists()) {
        await updateDoc(existingEmpRef, {
          userId: remoteUser.uid,
          email,
          avatar: userData.avatar,
          designation: inviteData.role === 'team-leader' ? 'Team Leader' : 'Executive',
          updatedAt: serverTimestamp(),
        });
      }
    } else if (inviteData.role === 'team-leader' || inviteData.role === 'executive') {
      // Create new employee record
      let departmentName = 'General';
      let departmentColor = '#3b82f6';
      if (inviteData.departmentId) {
        const deptDoc = await getDoc(doc(db, 'departments', inviteData.departmentId));
        if (deptDoc.exists()) {
          const dept = deptDoc.data();
          departmentName = dept.name || 'General';
          departmentColor = dept.color || '#3b82f6';
        }
      }
      
      const employeeData = {
        userId: remoteUser.uid,
        name,
        email,
        avatar: userData.avatar,
        employeeId: `EMP-${remoteUser.uid.slice(-4).toUpperCase()}`,
        department: departmentName,
        departmentId: inviteData.departmentId || '',
        departmentColor,
        designation: inviteData.role === 'team-leader' ? 'Team Leader' : 'Executive',
        phone: '',
        status: 'Active' as const,
        joinDate: new Date(),
        companyId: inviteData.companyId || '',
        employmentType: 'Full-time' as const,
      };
      
      await addDoc(collection(db, 'employees'), employeeData);
    }
    
    // Update invitation status
    await updateDoc(inviteDocRef, {
      status: 'accepted',
      acceptedBy: remoteUser.uid,
      acceptedAt: serverTimestamp(),
    });
    
    // Get token with claims
    const tokenResult = await getIdTokenResult(remoteUser, true);
    const claims = tokenResult.claims as unknown as CustomClaims;
    
    return { user: userData, claims };
  } catch (error) {
    console.error('Accept invitation error:', error);
    handleAuthError(error as AuthError);
    throw error;
  }
};

/**
 * Invite a new user (client-side implementation - no Cloud Functions required)
 */
export const inviteUser = async (
  email: string,
  role: UserRole,
  name?: string,
  departmentId?: string,
  employeeId?: string
): Promise<{ inviteId: string; inviteLink: string }> => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be signed in to invite users');
    
    // Get current user data to verify permissions
    const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (!currentUserDoc.exists()) throw new Error('Current user not found');
    
    const currentUserData = currentUserDoc.data() as User;
    const canInvite = ['master-admin', 'company-admin', 'team-leader', 'executive'].includes(currentUserData.role);
    if (!canInvite) throw new Error('You do not have permission to invite users');
    
    const companyId = currentUserData.companyId || 'master-admin';
    
    // Generate secure random token
    const tokenArray = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(tokenArray);
    } else {
      for (let i = 0; i < tokenArray.length; i++) {
        tokenArray[i] = Math.floor(Math.random() * 256);
      }
    }
    const token = Array.from(tokenArray, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Create invitation document
    const inviteRef = doc(collection(db, 'invitations'));
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://sofixs-hrm.web.app';
    const inviteLink = `${baseUrl}/accept-invite?token=${token}`;
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    await setDoc(inviteRef, {
      id: inviteRef.id,
      email,
      name: name || '',
      role,
      companyId,
      departmentId: departmentId || null,
      employeeId: employeeId || null,
      token,
      status: 'pending',
      invitedBy: currentUser.uid,
      invitedByName: currentUserData.name,
      createdAt: serverTimestamp(),
      expiresAt,
    });
    
    return { inviteId: inviteRef.id, inviteLink };
  } catch (error: any) {
    console.error('Invite user error:', error);
    throw new Error(error.message || 'Failed to send invitation');
  }
};

/**
 * Setup first master admin account (can only be used once)
 */
export const setupMasterAdmin = async (
  email: string,
  password: string,
  name: string
): Promise<AuthResult> => {
  try {
    // Create auth user first (needed for the bootstrap session)
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const remoteUser = userCredential.user;
    
    // Now check if any master admin already exists (we're authenticated, query will work)
    const q = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const snapshot = await getDocs(q);
    const existingAdmins = snapshot.docs.filter(d => d.id !== remoteUser.uid);
    
    if (existingAdmins.length > 0) {
      // A master admin already exists — clean up the auth user we just created
      await remoteUser.delete().catch(() => {});
      throw new Error('A master admin already exists. Please contact them for access.');
    }
    
    // Update profile
    await updateProfile(remoteUser, { displayName: name });
    
    // Create user document
    const permissions = getPermissionArray('master-admin');
    const userData: User = {
      id: remoteUser.uid,
      email,
      name,
      role: 'master-admin',
      companyId: 'master-admin',
      departmentId: null,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      permissions,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await setDoc(doc(db, 'users', remoteUser.uid), {
      ...userData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    return { user: userData, claims: { role: 'master-admin', companyId: 'master-admin', permissions } };
  } catch (error) {
    console.error('Setup master admin error:', error);
    handleAuthError(error as AuthError);
    throw error;
  }
};

/**
 * Check if a master admin exists
 */
export const checkMasterAdminExists = async (): Promise<boolean> => {
  try {
    if (!auth.currentUser) {
      return false;
    }
    const q = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    console.error('Check master admin error:', error);
    return false;
  }
};

/**
 * Get invitation by token
 */
export const getInvitationByToken = async (token: string) => {
  const q = query(
    collection(db, 'invitations'),
    where('token', '==', token),
    where('status', '==', 'pending')
  );
  
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    throw new Error('Invalid or expired invitation');
  }
  
  const data = snapshot.docs[0].data();
  
  // Check expiration
  if (data.expiresAt?.toDate) {
    const expiresAt = data.expiresAt.toDate();
    if (new Date() > expiresAt) {
      throw new Error('Invitation has expired');
    }
  }
  
  return {
    id: snapshot.docs[0].id,
    ...data,
  };
};

// ============================================
// AUDIT LOGGING
// ============================================

/**
 * Log audit event
 */
export const logAuditEvent = async (
  action: string,
  entity: string,
  entityId: string,
  description: string,
  previousData?: any,
  newData?: any
): Promise<void> => {
  try {
    const logFn = httpsCallable(functions, 'logAuditEvent');
    await logFn({
      action,
      entity,
      entityId,
      description,
      previousData,
      newData,
    });
  } catch (error) {
    console.error('Audit log error:', error);
    // Don't throw - audit logging should not break the app
  }
};
