/**
 * AWS auth module for mobile (React Native) — auth-compat
 * surface backed by Amazon Cognito. Tokens persist in SecureStore via
 * safeStore; everything else mirrors the web shim.
 */

import { AWS_CONFIG } from './config';
import { safeStore } from '../utils/safeStorage';
import { FriendlyError, ERROR_CODES, ERROR_MESSAGES, markSessionExpired, safeDisplayText } from './errors';

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

/** auth-compat credential result (the app reads `.user`). */
export interface UserCredential {
  user: AwsUser;
  operationType?: string;
  providerId?: string;
  additionalUserInfo?: unknown;
  credential?: unknown;
}

/** auth-compat Auth instance (the app reads `auth.currentUser`). */
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
    return JSON.parse(b64Decode(base64)) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Base64 decode without Node's Buffer (Hermes ships atob; manual fallback). */
function b64Decode(input: string): string {
  if (typeof atob === 'function') return atob(input);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/=+$/, '');
  let bits = 0;
  let bitCount = 0;
  let out = '';
  for (const ch of clean) {
    const val = chars.indexOf(ch);
    if (val === -1) continue;
    bits = (bits << 6) | val;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }
  return out;
}

async function cognitoCall(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify({ ClientId: AWS_CONFIG.clientId, ...params }),
    });
  } catch {
    throw new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(safeDisplayText(data?.message)) as Error & { code: string };
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
  if (!tokens) {
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  const expired = Date.now() > tokens.obtainedAt + (tokens.expiresIn - 60) * 1000;
  if (force || expired) {
    try {
      currentTokens = await refreshTokens();
    } catch {
      await signOut();
      markSessionExpired();
      throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
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
// auth-compat exports
// ---------------------------------------------------------------------------

/**
 * Live Auth singleton — `getAuth()` hands out this object so `auth.currentUser`
 * always reflects the current session (mirrors standard auth-SDK behaviour).
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
  if (err instanceof FriendlyError) {
    return new AuthError(err.code, err.message); // already normalized (network/session)
  }
  const map: Record<string, [string, string]> = {
    UserNotFoundException: ['auth/user-not-found', 'No account found with this email.'],
    NotAuthorizedException: ['auth/invalid-credential', ERROR_MESSAGES.invalidCredentials],
    PasswordResetRequiredException: ['auth/user-disabled', 'Password reset required.'],
    UserNotConfirmedException: ['auth/user-not-found', 'Email not verified.'],
    LimitExceededException: ['auth/too-many-requests', 'Too many attempts — please wait a minute and try again.'],
    InvalidPasswordException: ['auth/weak-password', 'Password is too weak (min 8 chars, upper+lower+number).'],
    UsernameExistsException: ['auth/email-already-in-use', 'An account already exists with this email.'],
    CodeMismatchException: ['auth/invalid-credential', 'Invalid verification code.'],
    ExpiredCodeException: ['auth/invalid-credential', 'Verification code expired.'],
  };
  // Cognito reports temporary lockouts as NotAuthorizedException with a
  // distinct message ("Password attempts exceeded"). Map that to the
  // rate-limit message instead of the wrong-credentials text so the user is
  // told the truth: waiting, not re-typing the password.
  if (err.code === 'NotAuthorizedException' && /attempts exceeded|limit exceeded/i.test(err.message ?? '')) {
    return new AuthError('auth/too-many-requests', 'Too many attempts — please wait a minute and try again.');
  }
  const hit = map[err.code ?? ''] ?? [err.code ?? 'auth/internal-error', safeDisplayText(err.message)];
  return new AuthError(hit[0], hit[1]);
}

async function initiateAuthWithPassword(identifier: string, password: string): Promise<UserCredential> {
  const res = await cognitoCall('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: identifier, PASSWORD: password },
  });
  const tokens = await tokensFromAuthResult(res);
  await saveTokens(tokens);
  currentUser = buildUser(tokens);
  emit(currentUser);
  return { user: currentUser };
}

/**
 * Map a System Username (the `username` field admins set in Companies ->
 * Account Credentials, e.g. info@sofixs.com) to the account email. Cognito
 * only knows emails (pool username attribute = email; aliases are not
 * possible in that mode), so the sign-in flow tries the typed name first and
 * — when Cognito reports no such username — asks the API which email it
 * belongs to. Returns null when the name matches no account (or the API is
 * unreachable) so the caller can surface the original error.
 */
async function resolveSystemUsername(typed: string): Promise<string | null> {
  try {
    const res = await fetch(`${AWS_CONFIG.apiUrl}/api/auth/resolve-username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: typed }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { email?: string | null };
    return data?.email ? String(data.email) : null;
  } catch {
    return null;
  }
}

export async function signInWithEmailAndPassword(_auth: unknown, email: string, password: string): Promise<UserCredential> {
  try {
    return await initiateAuthWithPassword(email, password);
  } catch (err) {
    // The sign-in box also accepts a System Username. Cognito only knows
    // emails, so UserNotFoundException can mean "the typed name is a System
    // Username": resolve it to the account email and retry once with that.
    // Names that match nothing keep the original "no account found" error.
    const raw = err as Error & { code?: string };
    if (raw.code === 'UserNotFoundException') {
      const resolved = await resolveSystemUsername(email);
      if (resolved && resolved !== email) {
        return await initiateAuthWithPassword(resolved, password);
      }
    }
    throw mapError(raw);
  }
}

export async function createUserWithEmailAndPassword(_auth: unknown, email: string, password: string): Promise<UserCredential> {
  try {
    // Cognito self sign-up. The pool's PreSignUp trigger auto-confirms the
    // user and marks the email verified (parity: no code-entry step).
    await cognitoCall('SignUp', {
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    });
  } catch (err) {
    throw mapError(err as Error & { code?: string });
  }
  // Parity: createUserWithEmailAndPassword returns an already
  // signed-in credential; the PreSignUp trigger guarantees sign-in succeeds.
  return signInWithEmailAndPassword(_auth, email, password);
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
  if (!tokens) {
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.ChangePassword',
        authorization: `Bearer ${tokens.accessToken}`,
      },
      // Cognito reads the caller's token from the BODY (AccessToken member);
      // the Authorization header is ignored, so omitting it made Cognito
      // answer 400 "Value at 'accessToken' failed to satisfy constraint".
      body: JSON.stringify({ AccessToken: tokens.accessToken, ProposedPassword: newPassword }),
    });
  } catch {
    throw new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw mapError(new Error(body.message) as Error & { code?: string });
  }
}

export async function updateProfile(user: AwsUser, profile: { displayName?: string }): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) {
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.UpdateUserAttributes',
        authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        AccessToken: tokens.accessToken,
        UserAttributes: [{ Name: 'name', Value: profile.displayName ?? '' }],
      }),
    });
  } catch {
    throw new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw mapError(new Error(body.message) as Error & { code?: string });
  }
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
