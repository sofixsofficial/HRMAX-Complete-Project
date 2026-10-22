/**
 * Shared user-facing error taxonomy for the whole application.
 *
 * Every API / network / auth failure is normalized here so no screen ever
 * shows raw backend output, tokens, stack traces, or provider details.
 * The exact message strings below are the product-wide standard — keep
 * them in sync with the mobile app (mobile-app/src/aws/errors.ts).
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

const SESSION_EXPIRED_KEY = 'hrmax_session_expired';

/** Remember that the user was bounced out by an expired session, so the
 * login page can explain the redirect instead of showing a silent form. */
export function markSessionExpired(): void {
  try {
    localStorage.setItem(SESSION_EXPIRED_KEY, '1');
  } catch {
    /* storage unavailable — notice is best-effort */
  }
}

/** Read-and-clear the session-expired flag (called once by the login page). */
export function consumeSessionExpired(): boolean {
  try {
    if (localStorage.getItem(SESSION_EXPIRED_KEY) === '1') {
      localStorage.removeItem(SESSION_EXPIRED_KEY);
      return true;
    }
  } catch {
    /* storage unavailable */
  }
  return false;
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

/** Pass `msg` through when it is display-safe, otherwise the generic message. */
export function safeDisplayText(msg: unknown): string {
  return isSafeDisplayMessage(msg) ? msg : ERROR_MESSAGES.generic;
}

/**
 * Normalize any thrown value to a display-safe message for catch blocks.
 *
 * Use this INSTEAD of raw `err.message` so backend/provider details (tokens,
 * stack traces, Firebase internals) are never surfaced. It routes through
 * `toDisplayError`, so network / session-expired / access-denied errors get
 * their exact taxonomy message, and unsafe backend text falls back to `fallback`
 * (a contextual hint like 'Failed to send email') rather than a raw leak.
 *
 *   catch (err) { setToast({ message: errText(err, 'Failed to send email'), type: 'error' }) }
 */
export function errText(err: unknown, fallback: string = ERROR_MESSAGES.generic): string {
  const e = toDisplayError(err);
  // toDisplayError resolves unsafe/unknown errors to the generic message — in
  // that case prefer the caller's contextual fallback for a clearer hint.
  return e.message === ERROR_MESSAGES.generic ? fallback : e.message;
}
