/**
 * AWS auth module for mobile (React Native) — firebase/auth-compatible
 * surface backed by Amazon Cognito. Tokens persist in SecureStore via
 * safeStore; everything else mirrors the web shim.
 */

import { AWS_CONFIG } from './config';
import { safeStore } from '../utils/safeStorage';

interface TokenSet {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainedAt: number;
}

export interface AwsUser {
  uid: string;
  email: string;
  name: string;
  displayName: string;
  getIdToken(force?: boolean): Promise<string>;
  getIdTokenResult(force?: boolean): Promise<{ token: string; claims: Record<string, string> }>;
  reload(): Promise<void>;
  delete(): Promise<void>;
}

/** firebase/auth-compatible credential result (the app reads `.user`). */
export interface UserCredential {
  user: AwsUser;
  operationType?: string;
  providerId?: string;
  additionalUserInfo?: unknown;
  credential?: unknown;
}

/** firebase/auth-compatible Auth instance (the app reads `auth.currentUser`). */
export interface Auth {
  currentUser: AwsUser | null;
}

const STORAGE_KEY = 'hrmax_aws_tokens';

let currentTokens: TokenSet | null = null;
let currentUser: AwsUser | null = null;
let listeners: Array<(user: AwsUser | null) => void> = [];
let restorePromise: Promise<void> | null = null;

async function loadTokens(): Promise<TokenSet | null> {
  if (currentTokens) return currentTokens;
  try {
    const raw = await safeStore.getItem(STORAGE_KEY);
    currentTokens = raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    currentTokens = null;
  }
  return currentTokens;
}

async function saveTokens(t: TokenSet | null): Promise<void> {
  if (t) await safeStore.setItem(STORAGE_KEY, JSON.stringify(t));
  else await safeStore.deleteItem(STORAGE_KEY);
  currentTokens = t;
}

function decodeJwt(token: string): Record<string, string> {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const atobFn = typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary');
    return JSON.parse(atobFn(base64)) as Record<string, string>;
  } catch {
    return {};
  }
}

async function cognitoCall(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify({ ClientId: AWS_CONFIG.clientId, ...params }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error((data?.message as string) ?? `${action} failed`) as Error & { code: string };
    err.code = (data?.__type as string) ?? 'UnknownError';
    throw err;
  }
  return data;
}

async function tokensFromAuthResult(res: Record<string, unknown>): Promise<TokenSet> {
  const ar = res.AuthenticationResult as Record<string, string> | undefined;
  if (!ar?.IdToken) {
    const err = new Error('Password change required') as Error & { code: string };
    err.code = 'NEW_PASSWORD_REQUIRED';
    throw err;
  }
  return {
    idToken: ar.IdToken,
    accessToken: ar.AccessToken,
    refreshToken: ar.RefreshToken ?? currentTokens?.refreshToken ?? '',
    expiresIn: Number(ar.ExpiresIn ?? 3600),
    obtainedAt: Date.now(),
  };
}

export async function refreshTokens(): Promise<TokenSet> {
  const existing = await loadTokens();
  if (!existing?.refreshToken) throw new Error('Not signed in');
  const res = await cognitoCall('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: existing.refreshToken },
  });
  const t = await tokensFromAuthResult({
    AuthenticationResult: { ...(res.AuthenticationResult as Record<string, string>), RefreshToken: existing.refreshToken },
  });
  await saveTokens(t);
  return t;
}

export async function getIdToken(force = false): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Not signed in');
  const expired = Date.now() > tokens.obtainedAt + (tokens.expiresIn - 60) * 1000;
  if (force || expired) {
    try {
      currentTokens = await refreshTokens();
    } catch {
      await signOut();
      throw new Error('Session expired');
    }
  }
  return currentTokens!.idToken;
}

function buildUser(tokens: TokenSet): AwsUser {
  const claims = decodeJwt(tokens.idToken);
  return {
    uid: claims.sub ?? '',
    email: claims.email ?? '',
    name: claims.name ?? '',
    displayName: claims.name ?? '',
    getIdToken: (force?: boolean) => getIdToken(force),
    getIdTokenResult: async (force?: boolean) => {
      const token = await getIdToken(force);
      return { token, claims: decodeJwt(token) };
    },
    reload: async () => undefined,
    delete: async () => {
      throw new Error('Account deletion is handled via the API');
    },
  };
}

// ---------------------------------------------------------------------------
// firebase/auth-compatible exports
// ---------------------------------------------------------------------------

/**
 * Live Auth singleton — `getAuth()` hands out this object so `auth.currentUser`
 * always reflects the current session (mirrors the Firebase SDK).
 */
const authInstance: Auth = {
  get currentUser(): AwsUser | null {
    return currentUser;
  },
};

export function getAuthInstance(): Auth {
  return authInstance;
}

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function mapError(err: Error & { code?: string }): AuthError {
  const map: Record<string, [string, string]> = {
    UserNotFoundException: ['auth/user-not-found', 'No account found with this email.'],
    NotAuthorizedException: ['auth/invalid-credential', 'Invalid email or password.'],
    PasswordResetRequiredException: ['auth/user-disabled', 'Password reset required.'],
    UserNotConfirmedException: ['auth/user-not-found', 'Email not verified.'],
    LimitExceededException: ['auth/too-many-requests', 'Too many attempts. Try again later.'],
    InvalidPasswordException: ['auth/weak-password', 'Password is too weak (min 8 chars, upper+lower+number).'],
    UsernameExistsException: ['auth/email-already-in-use', 'An account already exists with this email.'],
    CodeMismatchException: ['auth/invalid-credential', 'Invalid verification code.'],
    ExpiredCodeException: ['auth/invalid-credential', 'Verification code expired.'],
  };
  const hit = map[err.code ?? ''] ?? [err.code ?? 'auth/internal-error', err.message];
  return new AuthError(hit[0], hit[1]);
}

export async function signInWithEmailAndPassword(_auth: unknown, email: string, password: string): Promise<UserCredential> {
  try {
    const res = await cognitoCall('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    const tokens = await tokensFromAuthResult(res);
    await saveTokens(tokens);
    currentUser = buildUser(tokens);
    emit(currentUser);
    return { user: currentUser };
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export async function createUserWithEmailAndPassword(_auth: unknown, _email: string, _password: string): Promise<UserCredential> {
  throw new AuthError('auth/operation-not-allowed', 'Contact your administrator to create an account.');
}

export async function signOut(_auth?: unknown): Promise<void> {
  await saveTokens(null);
  currentUser = null;
  emit(null);
}

export async function sendPasswordResetEmail(_auth: unknown, email: string): Promise<void> {
  try {
    await cognitoCall('ForgotPassword', { Username: email });
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export async function confirmPasswordReset(_auth: unknown, code: string, newPassword: string, email?: string): Promise<void> {
  try {
    await cognitoCall('ConfirmForgotPassword', {
      Username: email ?? '', ConfirmationCode: code, Password: newPassword,
    });
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export async function updatePassword(_user: AwsUser, newPassword: string): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Not signed in');
  const res = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.ChangePassword',
      authorization: `Bearer ${tokens.accessToken}`,
    },
    body: JSON.stringify({ ProposedPassword: newPassword }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw mapError(new Error(body.message ?? 'Password change failed') as Error & { code?: string });
  }
}

export async function updateProfile(user: AwsUser, profile: { displayName?: string }): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Not signed in');
  await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.UpdateUserAttributes',
      authorization: `Bearer ${tokens.accessToken}`,
    },
    body: JSON.stringify({ UserAttributes: [{ Name: 'name', Value: profile.displayName ?? '' }] }),
  });
  user.displayName = profile.displayName ?? user.displayName;
}

export function onAuthStateChanged(
  _auth: unknown,
  callback: (user: AwsUser | null) => void,
  _error?: (error: Error) => void,
  _completed?: () => void,
): () => void {
  listeners.push(callback);
  if (!restorePromise) {
    restorePromise = (async () => {
      const tokens = await loadTokens();
      if (tokens) {
        try {
          await getIdToken();
          currentUser = buildUser(currentTokens!);
          emit(currentUser);
        } catch {
          emit(null);
        }
      } else {
        emit(null);
      }
    })();
  } else {
    void restorePromise.then(() => callback(currentUser));
  }
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

function emit(user: AwsUser | null) {
  for (const l of listeners) l(user);
}

export function getCurrentUser(): AwsUser | null {
  return currentUser;
}

export async function getIdTokenResult(user: AwsUser, force = false) {
  return user.getIdTokenResult(force);
}

export async function reauthenticateWithCredential(user: AwsUser, credential: { password: string }): Promise<void> {
  try {
    await cognitoCall('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: user.email, PASSWORD: credential.password },
    });
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export const EmailAuthProvider = {
  credential: (email: string, password: string) => ({ email, password }),
};
