/**
 * httpsCallable-style wrapper → REST API POST.
 * Every original callable maps to a REST route (or a /fn/ legacy shim).
 */

import { getIdToken } from './auth';
import { AWS_CONFIG } from './config';
import { networkError, toFriendlyError } from './errors';

interface Callable<T, R> {
  (data?: T): Promise<{ data: R }>;
}

const API = () => AWS_CONFIG.apiUrl.replace(/\/$/, '');

/**
 * Legacy callable name → REST path mapping.
 *
 * Only entries that match a real backend route (with the correct HTTP
 * method) live here. Every other callable name falls through to
 * `POST /fn/{name}`, which the backend's legacy dispatcher handles by name —
 * so a name is never silently pointed at a route that does not exist.
 */
const ROUTE_MAP: Record<string, { path: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' }> = {
  // auth
  createStaffUser: { path: '/api/users/create-staff' },
  // Admin-triggered reset for any managed role (employee / company admin /
  // executive / team leader) — issues the SAME code the self-service
  // /forgot-password flow validates, so it always works.
  sendAdminResetCode: { path: '/api/users/reset-password' },
  changePassword: { path: '/api/auth/change-password' },
  sendResetCode: { path: '/api/auth/forgot-password' },
  verifyResetCode: { path: '/api/auth/verify-reset-code' },
  resetPasswordWithCode: { path: '/api/auth/reset-password' },
  markAllNotificationsRead: { path: '/api/notifications/read-all' },
  // attendance
  markAttendance: { path: '/api/attendance/mark' },
  // payroll
  previewBulkPayroll: { path: '/api/payroll/calculate' },
  generateBulkPayroll: { path: '/api/payroll/calculate' },
  // email
  sendEmail: { path: '/api/email/send' },
  getEmailSystemConfig: { path: '/api/email/config', method: 'GET' },
  sendEmailSystemTest: { path: '/api/email/test' },
  listEmailLogs: { path: '/api/email/logs', method: 'GET' },
  // broadcast
  companyAdminBroadcast: { path: '/api/broadcast' },
  listBroadcastJobs: { path: '/api/broadcast', method: 'GET' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function httpsCallable<T = any, R = any>(functions: unknown, name: string): Callable<T, R> {
  void functions;
  return async (data?: T) => {
    const route = ROUTE_MAP[name] ?? { path: `/fn/${name}`, method: 'POST' as const };
    // No session? Send the request UNAUTHENTICATED instead of failing locally.
    // Routes marked `public: true` on the backend (contact form, corporate
    // inquiry, forgot-password) deliberately skip the auth check, so an
    // anonymous visitor must be able to reach them — previously getIdToken()
    // threw "session expired" here and those forms never submitted at all.
    // getIdToken() already marks a session expired when a real token refresh
    // fails; genuinely protected routes then answer 401, which
    // toFriendlyError() below maps to the same correct message.
    let token: string | undefined;
    try {
      token = await getIdToken();
    } catch {
      token = undefined;
    }
    const method = route.method ?? 'POST';

    // GET routes carry their (flat, scalar) params in the query string;
    // everything else sends a JSON body.
    const params = new URLSearchParams();
    if (method === 'GET' && data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (v !== undefined && v !== null && typeof v !== 'object') params.set(k, String(v));
      }
    }
    const qs = params.toString();
    const url = `${API()}${route.path}${qs ? `?${qs}` : ''}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) }),
      });
    } catch {
      throw networkError(); // offline / DNS / TLS — never surface raw fetch errors
    }

    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; data?: unknown } | null;
    if (!res.ok) {
      const friendly = toFriendlyError(res.status, body);
      const err = new Error(friendly.message) as Error & { code: string };
      err.code = friendly.code;
      throw err;
    }
    return { data: (body?.data ?? body) as R };
  };
}
