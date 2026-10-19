/**
 * AWS auth module — drop-in replacement for the firebase/auth API surface
 * used by the HR MAX frontend (signInWithEmailAndPassword, signOut,
 * onAuthStateChanged, getIdToken…). Backed by Amazon Cognito.
 *
 * The 30+ call-sites keep working because function signatures match; only
 * the import path changes: `from 'firebase/auth'` → `from '../aws/auth'`.
 */

import { AWS_CONFIG } from './config';

// ---------------------------------------------------------------------------
// Minimal Cognito REST client (USER_PASSWORD_AUTH + refresh), no SDK needed.
// ---------------------------------------------------------------------------

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

let currentTokens: TokenSet | null = loadTokens();
let currentUser: AwsUser | null = null;
let listeners: Array<(user: AwsUser | null) => void> = [];
let initialized = false;

function loadTokens(): TokenSet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: TokenSet | null) {
  if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  else localStorage.removeItem(STORAGE_KEY);
  currentTokens = t;
}

function decodeJwt(token: string): Record<string, string> {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

async function cognitoCall(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify({ ClientId: AWS_CONFIG.clientId, ...params }),
    },
  );
  const data = (await res.json()) as Record<string, unknown>;
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
    // NEW_PASSWORD_REQUIRED or no tokens → surface as unsupported challenge
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
  if (!currentTokens?.refreshToken) throw new Error('Not signed in');
  const res = await cognitoCall('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: currentTokens.refreshToken },
  });
  const t = await tokensFromAuthResult({ ...res, AuthenticationResult: { ...(res.AuthenticationResult as Record<string, string>), RefreshToken: currentTokens.refreshToken } });
  saveTokens(t);
  return t;
}

export async function getIdToken(force = false): Promise<string> {
  if (!currentTokens) throw new Error('Not signed in');
  const expired = Date.now() > currentTokens.obtainedAt + (currentTokens.expiresIn - 60) * 1000;
  if (force || expired) {
    try {
      currentTokens = await refreshTokens();
    } catch {
      // refresh failed → sign out
      await signOut();
      throw new Error('Session expired');
    }
  }
  return currentTokens.idToken;
}

function buildUser(tokens: TokenSet): AwsUser {
  const claims = decodeJwt(tokens.idToken);
  const user: AwsUser = {
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
  return user;
}

// ---------------------------------------------------------------------------
// firebase/auth-compatible surface
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

/** Map Cognito error codes to the Firebase-style codes the UI already handles. */
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

export async function signInWithEmailAndPassword(
  _auth: unknown,
  email: string,
  password: string,
): Promise<UserCredential> {
  try {
    const res = await cognitoCall('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    const tokens = await tokensFromAuthResult(res);
    saveTokens(tokens);
    currentUser = buildUser(tokens);
    return { user: currentUser };
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export async function createUserWithEmailAndPassword(
  _auth: unknown,
  email: string,
  password: string,
): Promise<UserCredential> {
  // Self sign-up is disabled; user creation happens server-side via the API.
  // Kept for signature compatibility.
  void email;
  void password;
  throw new AuthError('auth/operation-not-allowed', 'Contact your administrator to create an account.');
}

export async function signOut(_auth?: unknown): Promise<void> {
  saveTokens(null);
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
  // Cognito needs the username; callers pass it via the email param slot in
  // the adapted service — see aws/authService adapter.
  try {
    await cognitoCall('ConfirmForgotPassword', {
      Username: email ?? '',
      ConfirmationCode: code,
      Password: newPassword,
    });
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
}

export async function updatePassword(user: AwsUser, newPassword: string): Promise<void> {
  const token = await user.getIdToken();
  void token;
  // Access-token based ChangePassword
  if (!currentTokens) throw new Error('Not signed in');
  await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.ChangePassword',
      authorization: `Bearer ${currentTokens.accessToken}`,
    },
    body: JSON.stringify({ PreviousPassword: (user as unknown as { _pw?: string })._pw, ProposedPassword: newPassword }),
  }).then(async (r) => {
    if (!r.ok) throw mapError(new Error((await r.json()).message) as Error & { code?: string });
  });
}

export async function updateProfile(user: AwsUser, profile: { displayName?: string }): Promise<void> {
  if (!currentTokens) throw new Error('Not signed in');
  await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.UpdateUserAttributes',
      authorization: `Bearer ${currentTokens.accessToken}`,
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
  if (!initialized) {
    initialized = true;
    // Restore session
    (async () => {
      if (currentTokens) {
        try {
          await getIdToken(); // auto-refresh if expired
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
    // already initialized — emit current state
    setTimeout(() => callback(currentUser), 0);
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
  // Verify the current password by attempting auth
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
