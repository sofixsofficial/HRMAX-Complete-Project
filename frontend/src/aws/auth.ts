/**
 * AWS auth module — auth API surface consumed by the app
 * used by the HR MAX frontend (signInWithEmailAndPassword, signOut,
 * onAuthStateChanged, getIdToken…). Backed by Amazon Cognito.
 *
 * The 30+ call-sites keep working because function signatures match; only
 * app code imports the compat module at `../aws/auth-compat`.
 */

import { AWS_CONFIG } from './config';
import { FriendlyError, ERROR_CODES, ERROR_MESSAGES, markSessionExpired, safeDisplayText } from './errors';

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
  let res: Response;
  try {
    res = await fetch(
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
  if (!currentTokens) {
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  const expired = Date.now() > currentTokens.obtainedAt + (currentTokens.expiresIn - 60) * 1000;
  if (force || expired) {
    try {
      currentTokens = await refreshTokens();
    } catch {
      // refresh failed → sign out and tell the user why
      await signOut();
      markSessionExpired();
      throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
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
// auth-compat surface
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

/**
 * Current Cognito access token, or null when signed out.
 * Cognito's user-context operations (UpdateUserAttributes, ChangePassword,
 * GetUser, ...) take it as a request BODY member, not as an Authorization
 * header - helpers that talk to Cognito directly need it via this getter.
 */
export function getAccessToken(): string | null {
  return currentTokens?.accessToken ?? null;
}

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

/** Map Cognito error codes to the auth-style codes the UI already handles. */
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
  saveTokens(tokens);
  currentUser = buildUser(tokens);
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
    const base = AWS_CONFIG.apiUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/api/auth/resolve-username`, {
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

export async function signInWithEmailAndPassword(
  _auth: unknown,
  email: string,
  password: string,
): Promise<UserCredential> {
  try {
    return await initiateAuthWithPassword(email, password);
  } catch (err) {
    // The sign-in box also accepts a System Username. Cognito HIDES whether
    // a username exists on this app client (PreventUserExistenceErrors): an
    // unknown name comes back as NotAuthorizedException "Incorrect username
    // or password", not UserNotFoundException — so both codes can mean
    // "maybe a System Username". Skip the retry when Cognito is throttling
    // attempts (nothing to resolve) or when resolution yields nothing / the
    // same email (that was a genuinely wrong password for a real login id).
    const raw = err as Error & { code?: string };
    const maybeUnknownUser =
      raw.code === 'UserNotFoundException' ||
      (raw.code === 'NotAuthorizedException' && !/attempts exceeded|limit exceeded/i.test(raw.message ?? ''));
    if (maybeUnknownUser) {
      const resolved = await resolveSystemUsername(email);
      if (resolved && resolved !== email) {
        return await initiateAuthWithPassword(resolved, password);
      }
    }
    throw mapError(raw);
  }
}

export async function createUserWithEmailAndPassword(
  _auth: unknown,
  email: string,
  password: string,
): Promise<UserCredential> {
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
  if (!currentTokens) {
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  let r: Response;
  try {
    r = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.ChangePassword',
        authorization: `Bearer ${currentTokens.accessToken}`,
      },
      // Cognito reads the caller's identity for user-context operations from
      // the request BODY (the `AccessToken` member). The Authorization header
      // is ignored here, so without AccessToken in the payload Cognito
      // answers 400: "Value at 'accessToken' failed to satisfy constraint:
      // Member must not be null" - which surfaced on Save Changes as a raw
      // AWS validation error.
      body: JSON.stringify({
        AccessToken: currentTokens.accessToken,
        PreviousPassword: (user as unknown as { _pw?: string })._pw,
        ProposedPassword: newPassword,
      }),
    });
  } catch {
    throw new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw mapError(new Error(body.message) as Error & { code?: string });
  }
}

export async function updateProfile(user: AwsUser, profile: { displayName?: string }): Promise<void> {
  if (!currentTokens) {
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  let r: Response;
  try {
    r = await fetch(`https://cognito-idp.${AWS_CONFIG.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.UpdateUserAttributes',
        authorization: `Bearer ${currentTokens.accessToken}`,
      },
      // `AccessToken` must travel in the payload - see updatePassword above.
      body: JSON.stringify({
        AccessToken: currentTokens.accessToken,
        UserAttributes: [{ Name: 'name', Value: profile.displayName ?? '' }],
      }),
    });
  } catch {
    throw new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
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
  // Cognito's ChangePassword requires PreviousPassword; stash the password we
  // just verified so the subsequent updateUserPassword() call can supply it
  // (call sites always reauthenticate first — Settings & ForcePasswordChange).
  (user as unknown as { _pw?: string })._pw = credential.password;
}

export const EmailAuthProvider = {
  credential: (email: string, password: string) => ({ email, password }),
};
