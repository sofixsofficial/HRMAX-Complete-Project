/**
 * firebase/functions compatibility (mobile) → REST API callables.
 */

import { getIdToken } from './auth';
import { AWS_CONFIG } from './config';

const API = () => AWS_CONFIG.apiUrl;

/**
 * Legacy callable name → REST path mapping (POST-only, mobile).
 *
 * Only entries that match a real POST backend route live here; every other
 * callable name falls through to `POST /fn/{name}`, handled by the backend's
 * legacy dispatcher (GET routes and routes that need an :id segment are
 * dispatched by name instead of being pointed at a URL that would 404).
 */
const ROUTE_MAP: Record<string, string> = {
  // auth
  createStaffUser: '/api/users/create-staff',
  sendResetCode: '/api/auth/forgot-password',
  resetPasswordWithCode: '/api/auth/reset-password',
  // attendance
  markAttendance: '/api/attendance/mark',
  // payroll
  previewBulkPayroll: '/api/payroll/calculate',
  generateBulkPayroll: '/api/payroll/calculate',
  // email
  sendEmail: '/api/email/send',
  sendEmailSystemTest: '/api/email/test',
  // broadcast
  companyAdminBroadcast: '/api/broadcast',
  // mobile parity endpoints
  mobileUpdateLastLogin: '/api/auth/last-login',
  mobileCreateLeaveRequest: '/api/leave-requests',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function httpsCallable<T = any, R = any>(_functions: unknown, name: string) {
  return async (data?: T): Promise<{ data: R }> => {
    const path = ROUTE_MAP[name] ?? `/fn/${name}`;
    const token = await getIdToken();
    const res = await fetch(`${API()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(data ?? {}),
    });
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; data?: unknown } | null;
    if (!res.ok) {
      const err = new Error(body?.error?.message ?? `Callable failed (${res.status})`) as Error & { code: string };
      err.code = body?.error?.code ?? 'internal';
      throw err;
    }
    return { data: (body?.data ?? body) as R };
  };
}

export function getFunctions(_app?: unknown): unknown {
  return {};
}
