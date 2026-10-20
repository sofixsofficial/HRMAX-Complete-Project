/**
 * Shared user-facing error taxonomy for the whole mobile application.
 *
 * Every API / network / auth failure is normalized here so no screen ever
 * shows raw backend output, tokens, stack traces, or provider details.
 * The exact message strings below are the product-wide standard — keep
 * them in sync with the web app (frontend/src/aws/errors.ts).
 *
 * Difference from web: React Native has no synchronous localStorage, so the
 * session-expired notice lives in module memory for the app session.
 */

export const ERROR_MESSAGES = {
  invalidCredentials: 'Invalid username or password. Please try again.',
  missingCredentials: 'Please enter your username and password.',
  invalidEmail: 'Please enter a valid email address.',
  network: 'Network error. Please check your internet connection and try again.',
  sessionExpired: 'Your session has expired. Please log in again.',
  accessDenied: 'You do not have permission to access this section.',
  generic: 'Something went wrong. Please try again.',
} as const;

/** Firebase-style codes carried on thrown errors so existing UI switches keep working. */
export const ERROR_CODES = {
  invalidCredential: 'auth/invalid-credential',
  invalidEmail: 'auth/invalid-email',
  network: 'auth/network-error',
  sessionExpired: 'auth/session-expired',
  accessDenied: 'auth/access-denied',
} as const;

let sessionExpiredFlag = false;

/** Remember that the user was bounced out by an expired session, so the
 * login screen can explain the redirect instead of showing a silent form. */
export function markSessionExpired(): void {
  sessionExpiredFlag = true;
}

/** Read-and-clear the session-expired flag (called once by the login screen). */
export function consumeSessionExpired(): boolean {
  const v = sessionExpiredFlag;
  sessionExpiredFlag = false;
  return v;
}

/** Normalized, display-safe error. `.code` mirrors Firebase-style codes. */
export class FriendlyError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * True when a backend message is safe to show verbatim: short, single-line,
 * free of provider/infra vocabulary and token-looking payloads. Anything
 * else falls back to a generic message — backend errors are never exposed.
 */
function isSafeDisplayMessage(msg: unknown): msg is string {
  if (typeof msg !== 'string') return false;
  if (!msg || msg.length > 180 || /[\r\n]/.test(msg)) return false;
  const forbidden =
    /exception|arn:aws|bearer\s|eyJ[A-Za-z0-9_-]{10,}|stack|dynamodb|cognito|lambda|api gateway|unauthorized user|invalid parameter structure|\{|\}/i;
  return !forbidden.test(msg);
}

/** Pass `msg` through when it is display-safe, otherwise the generic message. */
export function safeDisplayText(msg: unknown): string {
  return isSafeDisplayMessage(msg) ? msg : ERROR_MESSAGES.generic;
}

/** Map an HTTP failure to a user-safe code + message. */
export function friendlyMessage(
  status: number,
  body: unknown,
): { code: string; message: string } {
  if (status === 401) {
    markSessionExpired();
    return { code: ERROR_CODES.sessionExpired, message: ERROR_MESSAGES.sessionExpired };
  }
  if (status === 403) {
    return { code: ERROR_CODES.accessDenied, message: ERROR_MESSAGES.accessDenied };
  }
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (isSafeDisplayMessage(err?.message)) {
    return { code: err?.code ?? 'invalid-argument', message: err.message };
  }
  if (status === 429) {
    return { code: 'too-many-requests', message: 'Too many attempts. Please wait a moment and try again.' };
  }
  if (status >= 500) return { code: 'internal', message: ERROR_MESSAGES.generic };
  return { code: err?.code ?? 'unknown', message: ERROR_MESSAGES.generic };
}

/** Build the error to throw for a failed HTTP response. */
export function toFriendlyError(status: number, body: unknown): FriendlyError {
  const { code, message } = friendlyMessage(status, body);
  return new FriendlyError(code, message, status);
}

/** The error to throw when `fetch` itself rejects (offline, DNS, TLS, CORS). */
export function networkError(): FriendlyError {
  return new FriendlyError(ERROR_CODES.network, ERROR_MESSAGES.network);
}

/** Normalize any thrown value into a display-safe error (for catch blocks). */
export function toDisplayError(err: unknown): FriendlyError {
  if (err instanceof FriendlyError) return err;
  if (err instanceof TypeError) return networkError(); // fetch() rejection
  const anyErr = err as { code?: string; message?: string } | null;
  const code = anyErr?.code ?? 'unknown';
  if (code === ERROR_CODES.network) return networkError();
  if (code === ERROR_CODES.sessionExpired) {
    return new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  if (code === ERROR_CODES.accessDenied) {
    return new FriendlyError(ERROR_CODES.accessDenied, ERROR_MESSAGES.accessDenied);
  }
  if (isSafeDisplayMessage(anyErr?.message)) {
    return new FriendlyError(code, anyErr.message);
  }
  return new FriendlyError(code, ERROR_MESSAGES.generic);
}

/** Basic email shape check used by every auth form. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the taxonomy message when `email` is not a valid address, else null. */
export function validateEmail(email: string): string | null {
  return EMAIL_PATTERN.test(email.trim()) ? null : ERROR_MESSAGES.invalidEmail;
}
