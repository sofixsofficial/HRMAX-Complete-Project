/**
 * Attendance — check-in/out with validation chain, geofence, auto-approval,
 * and the missed-punch rectification tier flow.
 * (Port of attendanceFunctions.ts + attendanceEngine.ts + missedPunchFunctions.ts.)
 */

import type { Route } from '../lib/http.js';
import { must, equalityFilters, parseOrderBy } from '../lib/http.js';
import { assertCompanyScope, hasPermission, isSuperAdmin, readPartitions, resolvePersonalCompanyId } from '../lib/auth.js';
import { putEntity, patchEntity, deleteEntity, queryEntities, queryEntitiesAcross, locateEntityAcross, allPartitions, getCompanyMeta, getEntity, getUserDoc, ConditionalWriteFailed } from '../lib/db.js';
import { resolveStakeholders } from '../lib/stakeholders.js';
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { ApiError, newId, isoNow, TIER_ORDER, resolveApprovalChain, type ApprovalChainConfig, type AttendanceDoc, type AttendanceStatus, type LeaveTier, type UserRole } from '../lib/types.js';

const GRACE_PERIOD_MINUTES = 15;
const OVERTIME_THRESHOLD_MINUTES = 30;
const EARTH_RADIUS_M = 6371000;

/** Product default zone — matches the nightly sweep and the web client default. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the company's IANA timezone (company settings → product default).
 * The backend previously had NO timezone concept at all: `todayKey()` used the
 * Lambda's UTC clock while the sweeper used Asia/Kolkata, and lateness was
 * computed from UTC hours — so a 09:15 IST check-in (03:45 UTC) was never late.
 */
export async function resolveCompanyTimezone(companyId: string): Promise<string> {
  try {
    const company = await getCompanyMeta(companyId);
    const settings = (company?.settings ?? {}) as Record<string, unknown>;
    const candidates = [settings.timeZone, settings.timezone, company?.timezone];
    for (const c of candidates) {
      if (typeof c === 'string' && c && isValidTimeZone(c)) return c;
    }
  } catch {
    // fall through to the default zone
  }
  return DEFAULT_TIMEZONE;
}

/** Calendar date (YYYY-MM-DD) in the given zone — not the Lambda's UTC clock. */
export function dateKeyInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Minutes since local midnight in the given zone — drives Present vs Late. */
export function minutesInZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const val = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (val('hour') % 24) * 60 + val('minute');
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface AttendancePolicy {
  defaultShiftStart: string;
  defaultShiftEnd: string;
  gracePeriodMinutes: number;
  officeLocation?: { latitude: number; longitude: number; radiusMeters: number };
  requireSelfie?: boolean;
  requireGeofence?: boolean;
  /** Company policy: check-in must present the branch's QR code. */
  requireQr?: boolean;
  /** Company policy: face verification (selfie) is required at punch time. */
  requireFace?: boolean;
}

/**
 * Policy flags as the UI writes them vs as the server reads them.
 * BUG FIXED: the settings screen writes `enableGeofence` while this handler
 * read only `requireGeofence`, so the server-side geofence was ALWAYS off and
 * only the (client-bypassable) check ran. Accept both spellings.
 */
export function normalizePolicyFlags(raw: (Partial<AttendancePolicy> & { enableGeofence?: boolean; enableSelfie?: boolean }) | undefined): {
  requireSelfie: boolean;
  requireGeofence: boolean;
} {
  return {
    requireSelfie: Boolean(raw?.requireSelfie ?? raw?.enableSelfie ?? false),
    requireGeofence: Boolean(raw?.requireGeofence ?? raw?.enableGeofence ?? false),
  };
}

async function getPolicy(companyId: string): Promise<AttendancePolicy> {
  const docs = await queryEntities<(Partial<AttendancePolicy> & {
    id: string;
    enableGeofence?: boolean;
    enableSelfie?: boolean;
    enableQr?: boolean;
    requireQr?: boolean;
    enableFace?: boolean;
    requireFace?: boolean;
  })>({
    entity: 'attendanceSettings', companyId, limit: 1,
  });
  let doc_ = docs[0];
  if (!doc_) {
    // Companies onboarded before the policy-row sync only carry the policy
    // INSIDE the company document — fall back to it so the server-side
    // checks apply to them too.
    const meta = await getCompanyMeta(companyId).catch(() => null);
    const embedded = meta?.attendanceSettings as Record<string, unknown> | undefined;
    if (embedded && typeof embedded === 'object') {
      doc_ = {
        id: 'embedded',
        defaultShiftStart: String(embedded.defaultShiftStart ?? ''),
        defaultShiftEnd: String(embedded.defaultShiftEnd ?? ''),
        gracePeriodMinutes: Number(embedded.gracePeriodMinutes ?? GRACE_PERIOD_MINUTES),
        officeLocation: embedded.officeLocation && typeof embedded.officeLocation === 'object'
          ? (embedded.officeLocation as AttendancePolicy['officeLocation'])
          : {
              latitude: Number(embedded.latitude ?? 0),
              longitude: Number(embedded.longitude ?? 0),
              radiusMeters: Number(embedded.radiusInMeters ?? 100),
            },
        requireGeofence: Boolean(embedded.requireGps ?? embedded.enableGeofence ?? embedded.requireGeofence ?? false),
        requireSelfie: Boolean(embedded.requireSelfie ?? embedded.requireFace ?? false),
        requireQr: Boolean(embedded.requireQr ?? embedded.enableQr ?? false),
        requireFace: Boolean(embedded.requireFace ?? embedded.requireSelfie ?? false),
        // Drop a zeroed placeholder office so NO_OFFICE_LOCATION still fires.
        ...(Number(embedded.latitude ?? 0) === 0 && Number(embedded.longitude ?? 0) === 0
          ? { officeLocation: undefined }
          : {}),
      } as typeof doc_;
    }
  }
  const flags = normalizePolicyFlags(doc_);
  return {
    defaultShiftStart: doc_?.defaultShiftStart ?? '09:00',
    defaultShiftEnd: doc_?.defaultShiftEnd ?? '18:00',
    gracePeriodMinutes: doc_?.gracePeriodMinutes ?? GRACE_PERIOD_MINUTES,
    // A zeroed placeholder office (lat/lon 0,0) means the location was never
    // picked — drop it so geofencing reports NO_OFFICE_LOCATION ("No office
    // location configured") instead of measuring distance from (0,0) and
    // returning a misleading "Location required for check-in". The embedded
    // company fallback above applies the same rule.
    officeLocation:
      Number(doc_?.officeLocation?.latitude ?? 0) === 0 && Number(doc_?.officeLocation?.longitude ?? 0) === 0
        ? undefined
        : doc_?.officeLocation,
    requireQr: Boolean(doc_?.requireQr ?? doc_?.enableQr ?? false),
    requireFace: Boolean(doc_?.requireFace ?? doc_?.enableFace ?? false),
    ...flags,
  };
}

export function determineStatus(checkInMin: number, shiftStartMin: number, grace: number): { status: AttendanceStatus; lateMinutes: number } {
  if (checkInMin <= shiftStartMin) return { status: 'Present', lateMinutes: 0 };
  if (checkInMin - shiftStartMin <= grace) return { status: 'Present', lateMinutes: 0 };
  return { status: 'Late', lateMinutes: checkInMin - shiftStartMin };
}

/**
 * Punch-once / close-once guards.
 *
 * Two traps live here, both hit in production before being caught:
 *  - `data` and `PK` are DynamoDB RESERVED WORDS → must be aliased (#d/#pk),
 *    otherwise the request fails with ValidationException (HTTP 500).
 *  - values must be JS `null` (the DocumentClient marshals it to NULL). The
 *    wire form `{ NULL: true }` gets marshalled as a Map, so the equality never
 *    matches and every check-out was wrongly rejected as "already checked out".
 */
export const CHECK_IN_CONDITION = {
  expression: 'attribute_not_exists(#pk) OR attribute_not_exists(#d.checkIn) OR #d.checkIn = :noPunch',
  names: { '#pk': 'PK', '#d': 'data' },
  values: { ':noPunch': null as unknown },
};

export const CHECK_OUT_CONDITION = {
  expression: 'attribute_not_exists(#d.checkOut) OR #d.checkOut = :noOut',
  names: { '#d': 'data' },
  values: { ':noOut': null as unknown },
};

async function writeLog(entry: Record<string, unknown>): Promise<void> {
  await putEntity(
    { id: newId(), companyId: String(entry.companyId ?? 'global'), createdAt: isoNow(), timestamp: isoNow(), ...entry },
    { entity: 'attendanceLog', userIdField: 'userId', tsField: 'timestamp' },
  );
}

export const attendanceRoutes: Route[] = [
  // ----------------------------------------------------------- mark attendance
  {
    method: 'POST',
    path: '/api/attendance/mark',
    handler: async (req) => {
      const caller = must(req);
      const {
        companyId: rawCompanyId, type, selfieUrl, latitude, longitude, networkType, wifiSsid,
      } = req.body as {
        companyId: string; type: 'check-in' | 'check-out'; selfieUrl?: string;
        latitude?: number; longitude?: number; networkType?: string; wifiSsid?: string;
      };
      // Clients (web/mobile callable shim) send `action`; older payloads send `type`.
      // Accept both so the check-in/check-out contract is stable across platforms.
      const markType = type ?? (req.body as { action?: 'check-in' | 'check-out' }).action;
      // All-Companies mode (web + mobile) sends the `global` placeholder —
      // resolve it to the caller's own company so Executive/Team-Leader
      // personal punches hit a real partition instead of 403-ing scope.
      let companyId = String(rawCompanyId ?? '').trim();
      if (!companyId || companyId === 'global') {
        const resolved = await resolvePersonalCompanyId(caller);
        if (resolved) companyId = resolved;
        else if (caller.role === 'executive' || caller.role === 'team-leader') {
          throw new ApiError('failed-precondition', 'No company is assigned to your account. Ask your master admin to assign one.');
        }
        // Master Admin keeps the `global` placeholder: scope allows it and the
        // personal-attendance guard below returns the proper product error.
      }
      if (!companyId || !markType) throw new ApiError('bad-request', 'companyId and type required');
      assertCompanyScope(caller, companyId);

      // Product rule: Company Admin and Master Admin have NO personal
      // attendance — they administer the module, they never appear in it as a
      // subject. Enforced server-side so no client can punch for them.
      if (caller.role === 'company-admin' || caller.role === 'master-admin') {
        throw new ApiError('permission-denied', 'Company Admin and Master Admin do not have personal attendance records.');
      }

      const policy = await getPolicy(companyId);
      const now = new Date();
      const tz = await resolveCompanyTimezone(companyId);
      const today = dateKeyInZone(now, tz);
      const nowIso = now.toISOString();
      const nowMin = minutesInZone(now, tz);

      const existingList = await queryEntities<AttendanceDoc>({
        entity: 'attendance', companyId, filters: { userId: caller.uid, date: today }, limit: 1,
      });
      const existing = existingList[0] ?? null;

      const fail = async (reasonCode: string, message: string) => {
        await writeLog({
          companyId, userId: caller.uid, action: markType, status: 'failed',
          reasonCode, reason: message, date: today,
        });
        throw new ApiError('failed-precondition', message);
      };

      if (markType === 'check-in') {
        if (existing?.checkIn) return fail('ALREADY_CHECKED_IN', 'Already checked in today');

        // ---- branch assignment (primary + additional authorized branches) ----
        const body = req.body as { branchId?: string; qrToken?: string };
        const requestedBranch = String(body.branchId ?? '').trim();
        const qrToken = String(body.qrToken ?? '').trim();
        const empRows = await queryEntities<Record<string, unknown>>({
          entity: 'employee', companyId, filters: { userId: caller.uid }, limit: 1,
        }).catch(() => [] as Record<string, unknown>[]);
        const emp = empRows[0] ?? null;
        const profile = emp ? null : await getUserDoc(caller.uid).catch(() => null);
        const primaryBranch = String(emp?.primaryBranchId ?? profile?.primaryBranchId ?? '');
        const extraRaw = (emp?.branchIds ?? profile?.branchIds ?? []) as unknown[];
        const extraBranches = Array.isArray(extraRaw) ? extraRaw.map(String).filter(Boolean) : [];
        const authorized = [...new Set([primaryBranch, ...extraBranches].filter(Boolean))];

        let branchId = requestedBranch || primaryBranch;
        let branch: Record<string, unknown> | null = null;
        if (branchId) {
          if (authorized.length > 0 && !authorized.includes(branchId)) {
            return fail('BRANCH_NOT_AUTHORIZED', 'You are not assigned to this branch.');
          }
          branch = await getEntity<Record<string, unknown>>('branch', companyId, branchId);
          if (!branch) return fail('BRANCH_NOT_FOUND', 'Your assigned branch no longer exists.');
          if (branch.isActive === false) return fail('BRANCH_INACTIVE', 'This branch is not active.');
        } else {
          branchId = '';
        }

        // Executives / team leaders have no branch of their own — their punch
        // anchors to the master-admin-set office location, so the branch QR
        // and selfie gates must not lock them out of their own attendance.
        const branchlessManagement =
          (caller.role === 'executive' || caller.role === 'team-leader') && !branchId;

        // ---- QR attendance (company policy) ----
        if (policy.requireQr && !branchlessManagement) {
          if (!branchId) return fail('BRANCH_REQUIRED', 'No branch is assigned to your account. Ask your admin to assign one.');
          if (!qrToken) return fail('QR_REQUIRED', 'Scan the branch QR code to check in.');
          const expected = String(branch?.qrToken ?? '').trim();
          if (!expected || qrToken.toLowerCase() !== expected.toLowerCase()) {
            return fail('QR_INVALID', 'This QR code is not valid for your branch.');
          }
        }

        // ---- Geofence: the BRANCH's own coordinates win over the company office ----
        if (policy.requireGeofence) {
          const bLat = Number(branch?.latitude ?? 0);
          const bLon = Number(branch?.longitude ?? 0);
          const loc = branch && (bLat !== 0 || bLon !== 0)
            // Both spellings accepted: the web Branches form writes
            // `radiusInMeters`, mobile/backend use `radiusMeters` — without the
            // fallback a web-configured per-branch radius was silently ignored
            // and the company-office radius applied instead.
            ? { latitude: bLat, longitude: bLon, radiusMeters: Number(branch.radiusMeters ?? branch.radiusInMeters ?? policy.officeLocation?.radiusMeters ?? 100) }
            : policy.officeLocation;
          // A zeroed office placeholder (lat/lon 0,0) means the master admin
          // never picked a real location — nothing to fence against. A
          // branchless management punch then proceeds instead of failing on
          // coordinates that do not exist; a REAL office is enforced as usual.
          const officeReal = Boolean(loc) && (Number(loc?.latitude ?? 0) !== 0 || Number(loc?.longitude ?? 0) !== 0);
          if (!(branchlessManagement && !officeReal)) {
            if (!loc) return fail('NO_OFFICE_LOCATION', 'No office location configured');
            if (latitude === undefined || longitude === undefined) return fail('GPS_REQUIRED', 'Location required for check-in');
            const dist = haversine(latitude, longitude, loc.latitude, loc.longitude);
            if (dist > (loc.radiusMeters ?? 100)) {
              return fail('GPS_OUT_OF_BOUNDS', `You are ${Math.round(dist)}m away from the ${branchId ? 'branch' : 'office'} (allowed ${loc.radiusMeters ?? 100}m)`);
            }
          }
        }

        // Selfie — clients send `selfieUri`, older payloads send `selfieUrl`.
        // Face verification is the same capture, toggled by requireFace
        // (new) or requireSelfie (legacy) at company-policy level. Branchless
        // management punchers have no capture flow of their own — skipped.
        const selfie = selfieUrl ?? (req.body as { selfieUri?: string }).selfieUri;
        if ((policy.requireSelfie || policy.requireFace) && !branchlessManagement) {
          if (!selfie) return fail('SELFIE_REQUIRED', 'Selfie is required for check-in');
          const decoded = decodeURIComponent(selfie);
          if (!decoded.includes(`/selfies/${companyId}/${caller.uid}`)) {
            return fail('INVALID_SELFIE', 'Selfie does not match your identity');
          }
        }

        const { status, lateMinutes } = determineStatus(nowMin, hhmmToMinutes(policy.defaultShiftStart), policy.gracePeriodMinutes);
        const doc_: AttendanceDoc = {
          id: existing?.id ?? newId(),
          companyId, userId: caller.uid, employeeName: caller.name, date: today,
          checkIn: nowIso, checkOut: existing?.checkOut ?? null,
          status, lateMinutes,
          ...(branchId ? { branchId, branchName: String(branch?.name ?? '') } : {}),
          workHours: 0, overtimeHours: 0,
          isAutoApproved: true, approved: true, approvedByName: 'System (Auto-Approved)',
          createdAt: existing?.createdAt ?? isoNow(), updatedAt: isoNow(),
        };
        try {
          // Punch-once guard: the write only lands if no check-in exists yet
          // (or the row is a null/absent one the nightly sweep created). Two
          // concurrent taps → the loser gets ConditionalCheckFailed → 412,
          // instead of both "succeeding" on a read-then-put race.
          // NOTE: `data` and `PK` are DynamoDB reserved words — they MUST be
          // aliased, otherwise the condition is rejected with a ValidationException.
          await putEntity<AttendanceDoc>(doc_, {
            entity: 'attendance', userIdField: 'userId', tsField: 'date',
            condition: CHECK_IN_CONDITION,
          });
        } catch (err) {
          if (err instanceof ConditionalWriteFailed) return fail('ALREADY_CHECKED_IN', 'Already checked in today');
          throw err;
        }
        await writeLog({ companyId, userId: caller.uid, action: 'check-in', status: 'success', date: today });

        // Check-in notifications: a confirmation in the puncher's own inbox
        // and a live heads-up to THEIR reporting manager (the attendance
        // approver). The bell used to move only for late punches — every
        // punch is now visible to the people tracking attendance.
        const checkInTime = new Date(nowIso).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
        await createNotification({
          userId: caller.uid, companyId, type: 'attendance_checkin',
          title: 'Checked in',
          message: `You checked in at ${checkInTime} (${status}).`,
          link: '/my-attendance',
        });
        const stakeholders = await resolveStakeholders(companyId, caller.uid, caller.name);
        if (stakeholders.reportingManagerId && stakeholders.reportingManagerId !== caller.uid) {
          await createNotification({
            userId: stakeholders.reportingManagerId, companyId, type: 'attendance_checkin',
            title: 'Check-in',
            message: `${caller.name} checked in at ${checkInTime} (${status}).`,
            link: '/attendance',
          });
        }

        if (status === 'Late') {
          await fanOutNotifications(
            [stakeholders.reportingManagerId ?? '', ...stakeholders.teamLeaderIds, ...stakeholders.executiveIds],
            { companyId, type: 'attendance_late', title: 'Late check-in', message: `${caller.name} checked in late (${lateMinutes} min).`, link: '/attendance' },
            caller.uid,
          );
        }
        return { attendance: doc_ };
      }

      // check-out
      if (!existing?.checkIn) return fail('NO_RECORD', 'No check-in found for today');
      if (existing.checkOut) return fail('ALREADY_CHECKED_OUT', 'Already checked out today');

      const shiftEndMin = hhmmToMinutes(policy.defaultShiftEnd);
      const checkInTime = new Date(existing.checkIn!).getTime();
      const workMinutes = Math.round((now.getTime() - checkInTime) / 60000);
      const overtimeMinutes = Math.max(0, nowMin - shiftEndMin - OVERTIME_THRESHOLD_MINUTES);
      const isEarly = nowMin < shiftEndMin - 30 && existing.status !== 'Late';

      let updated: AttendanceDoc | null;
      try {
        // Close-once guard: even if two requests both read "not checked out",
        // DynamoDB rejects the second write (same race as check-in above).
        updated = await patchEntity<AttendanceDoc>('attendance', companyId, existing.id, {
          checkOut: nowIso,
          workHours: Math.round((workMinutes / 60) * 100) / 100,
          overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
          status: isEarly ? 'Early Checkout' : existing.status,
        }, {
          entity: 'attendance', userIdField: 'userId', tsField: 'date',
          condition: CHECK_OUT_CONDITION,
        });
      } catch (err) {
        if (err instanceof ConditionalWriteFailed) return fail('ALREADY_CHECKED_OUT', 'Already checked out today');
        throw err;
      }
      await writeLog({ companyId, userId: caller.uid, action: 'check-out', status: 'success', date: today });
      // Check-out notifications (parity with check-in): own confirmation
      // with today's worked hours + a heads-up to the reporting manager.
      const checkOutTime = new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      await createNotification({
        userId: caller.uid, companyId, type: 'attendance_checkout',
        title: 'Checked out',
        message: `You checked out at ${checkOutTime} (${updated?.workHours ?? 0} h worked).`,
        link: '/my-attendance',
      });
      const outStakeholders = await resolveStakeholders(companyId, caller.uid, caller.name);
      if (outStakeholders.reportingManagerId && outStakeholders.reportingManagerId !== caller.uid) {
        await createNotification({
          userId: outStakeholders.reportingManagerId, companyId, type: 'attendance_checkout',
          title: 'Check-out',
          message: `${caller.name} checked out at ${checkOutTime}.`,
          link: '/attendance',
        });
      }
      return { attendance: updated };
    },
  },

  // ------------------------------------------------------------------ query
  {
    method: 'GET',
    path: '/api/attendance',
    handler: async (req) => {
      const caller = must(req);
      const orderBy = parseOrderBy(req.query, 'date', false);
      const filters = equalityFilters(req.query);
      const base: Omit<Parameters<typeof queryEntities>[0], 'companyId'> = {
        entity: 'attendance',
        orderBy,
        ...(filters ? { filters } : {}),
      };
      if (req.query.userId) base.userId = req.query.userId;

      let docs: AttendanceDoc[];
      if (base.userId) {
        docs = await queryEntities<AttendanceDoc>(base as Parameters<typeof queryEntities>[0]);
      } else if (req.query.companyId) {
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, req.query.companyId);
        docs = await queryEntities<AttendanceDoc>({ ...base, companyId: req.query.companyId });
      } else if (isSuperAdmin(caller)) {
        docs = await queryEntitiesAcross<AttendanceDoc>(base, await allPartitions());
      } else {
        const partitions = await readPartitions(caller);
        docs = partitions.length === 1
          ? await queryEntities<AttendanceDoc>({ ...base, companyId: partitions[0] })
          : await queryEntitiesAcross<AttendanceDoc>(base, partitions);
      }
      if (req.query.from) docs = docs.filter((d) => d.date >= req.query.from);
      if (req.query.to) docs = docs.filter((d) => d.date <= req.query.to);
      if (['employee', 'reporting-manager'].includes(caller.role) && req.query.userId !== caller.uid) {
        if (caller.role === 'employee') docs = docs.filter((d) => d.userId === caller.uid);
      }
      const limit = Number(req.query.limit ?? 0);
      return { attendance: limit ? docs.slice(0, limit) : docs };
    },
  },

  // ------------------------------------------------- request rectification
  {
    method: 'POST',
    path: '/api/attendance/:id/rectification',
    handler: async (req) => {
      const caller = must(req);
      const { correctedCheckOut, kind } = req.body as { correctedCheckOut: string; kind?: 'checkin' | 'checkout' };
      if (!correctedCheckOut) throw new ApiError('bad-request', 'correctedCheckOut required');

      const found = await locateEntityAcross<AttendanceDoc>('attendance', req.params.id, await readPartitions(caller));
      const rec = found?.doc;
      if (!rec) throw new ApiError('not-found', 'Attendance record not found');
      if (rec.userId !== caller.uid && caller.role !== 'master-admin') throw new ApiError('permission-denied', 'Can only request for your own record');

      const stakeholders = await resolveStakeholders(rec.companyId, rec.userId, rec.employeeName ?? '');
      const status: Record<LeaveTier, 'Pending' | 'Approved' | 'Rejected' | 'Skipped'> = {
        reportingManager: 'Pending', hr: 'Pending', companyAdmin: 'Pending', executive: 'Pending', teamLeader: 'Pending',
      };
      const approverIds: Partial<Record<LeaveTier, string | null>> = {
        reportingManager: stakeholders.reportingManagerId,
        hr: stakeholders.hrIds?.[0] ?? null,
        companyAdmin: stakeholders.companyAdminIds[0] ?? null,
        executive: stakeholders.executiveIds[0] ?? null,
        teamLeader: stakeholders.teamLeaderIds[0] ?? null,
      };

      // Configurable per-role chain (parity with the leave flow). Safety rules
      // (unassigned-tier skip, self-approver skip) always apply.
      //   employee -> reporting manager -> HR -> company admin
      //   reporting manager -> HR -> company admin
      //   HR -> company admin
      //   executive -> team leader -> master admin gate
      //   team leader -> master admin gate
      const role = caller.role as UserRole;
      const companyMeta = await getCompanyMeta(rec.companyId).catch(() => null);
      const chains = (companyMeta?.approvalChains ?? null) as ApprovalChainConfig | null;
      const liveChain = resolveApprovalChain(role, chains);
      const masterAdminRequired = role === 'team-leader' || role === 'executive';
      const subjectUid = String(rec.userId ?? '');
      for (const tier of TIER_ORDER) {
        const inChain = liveChain.includes(tier);
        const approver = approverIds[tier] ?? null;
        const isSelfApprover = !!approver && !!subjectUid && approver === subjectUid;
        if (inChain && approver && !isSelfApprover) {
          status[tier] = 'Pending';
        } else if (!inChain) {
          status[tier] = masterAdminRequired ? 'Approved' : 'Skipped';
        } else {
          status[tier] = 'Skipped';
        }
      }

      const updated = await patchEntity<AttendanceDoc>('attendance', rec.companyId, rec.id, {
        missedPunchRectification: {
          requested: true,
          requestedAt: isoNow(),
          correctedCheckOut,
          kind: kind ?? 'checkout',
          resolved: false,
          approvalStatus: status,
          approverIds,
          masterAdminRequired,
          masterAdminApproveStatus: masterAdminRequired ? 'Pending' : undefined,
        },
      }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });

      const targets = Object.values(approverIds).filter((v): v is string => Boolean(v));
      await fanOutNotifications(targets, {
        companyId: rec.companyId, type: 'punch_rectification_requested',
        title: 'Punch rectification requested',
        message: `${caller.name} requested a correction for ${rec.date}.`, link: '/attendance',
      }, caller.uid);
      await createNotification({
        userId: caller.uid, companyId: rec.companyId, type: 'punch_rectification_requested',
        title: 'Rectification submitted', message: `Your correction request for ${rec.date} is under review.`, link: '/my-attendance',
      });

      return { attendance: updated };
    },
  },

  // ---------------------------------------------------------- tier review
  {
    method: 'POST',
    path: '/api/attendance/:id/rectification/review',
    handler: async (req) => {
      const caller = must(req);
      const { tier, decision, note } = req.body as { tier: LeaveTier | 'masterAdmin'; decision: 'Approved' | 'Rejected'; note?: string };
      const found = await locateEntityAcross<AttendanceDoc>('attendance', req.params.id, await readPartitions(caller));
      const rec = found?.doc;
      if (!rec?.missedPunchRectification) throw new ApiError('not-found', 'No rectification on this record');
      const rect = rec.missedPunchRectification;

      let patch: Record<string, unknown>;
      if (tier === 'masterAdmin') {
        if (caller.role !== 'master-admin') throw new ApiError('permission-denied', 'Master admin only');
        patch = { 'missedPunchRectification.masterAdminApproveStatus': decision, 'missedPunchRectification.masterAdminApprovedOn': isoNow() };
      } else {
        if (!TIER_ORDER.includes(tier)) throw new ApiError('bad-request', 'Invalid tier');
        const idx = TIER_ORDER.indexOf(tier);
        for (let i = 0; i < idx; i++) {
          const prev = rect.approvalStatus?.[TIER_ORDER[i]];
          if (prev !== 'Approved' && prev !== 'Skipped') throw new ApiError('failed-precondition', 'Earlier tiers must decide first');
        }
        if (rect.approvalStatus?.[tier] !== 'Pending') throw new ApiError('failed-precondition', 'Tier already decided');
        const stamped = rect.approverIds?.[tier];
        if (stamped !== caller.uid && caller.role !== 'master-admin') {
          const roleForTier: Record<string, UserRole[]> = { reportingManager: ['reporting-manager'], hr: ['hr'], companyAdmin: ['company-admin'], executive: ['executive'], teamLeader: ['team-leader'] };
          if (!roleForTier[tier]?.includes(caller.role)) throw new ApiError('permission-denied', 'Not the approver for this tier');
        }
        patch = { [`missedPunchRectification.approvalStatus.${tier}`]: decision };
      }

      let updated = await patchEntity<AttendanceDoc>('attendance', rec.companyId, rec.id, patch, {
        entity: 'attendance', userIdField: 'userId', tsField: 'date',
      });
      if (!updated?.missedPunchRectification) throw new ApiError('internal', 'Update failed');
      const r = updated.missedPunchRectification;

      // Terminal rejection
      if (decision === 'Rejected') {
        updated = await patchEntity<AttendanceDoc>('attendance', rec.companyId, rec.id, {
          'missedPunchRectification.resolved': true,
          'missedPunchRectification.resolution': 'Rejected',
          'missedPunchRectification.resolvedAt': isoNow(),
          'missedPunchRectification.resolvedByName': caller.name,
        }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
      } else {
        // Check if all gates passed → apply resolution
        const tiersDone = TIER_ORDER.every((t) => {
          const s = r.approvalStatus?.[t];
          return s === 'Approved' || s === 'Skipped';
        });
        const maDone = !r.masterAdminRequired || r.masterAdminApproveStatus === 'Approved';
        if (tiersDone && maDone && r.correctedCheckOut) {
          const checkInTime = rec.checkIn ? new Date(rec.checkIn).getTime() : null;
          const corrected = new Date(r.correctedCheckOut).getTime();
          const workHours = checkInTime ? Math.round(((corrected - checkInTime) / 3600000) * 100) / 100 : 0;
          const policy = await getPolicy(rec.companyId);
          const correctedMin = new Date(r.correctedCheckOut).getHours() * 60 + new Date(r.correctedCheckOut).getMinutes();
          const otMin = Math.max(0, correctedMin - hhmmToMinutes(policy.defaultShiftEnd) - OVERTIME_THRESHOLD_MINUTES);
          updated = await patchEntity<AttendanceDoc>('attendance', rec.companyId, rec.id, {
            checkOut: r.correctedCheckOut,
            workHours,
            overtimeHours: Math.round((otMin / 60) * 100) / 100,
            status: 'Approved',
            approved: true,
            isAutoApproved: true,
            approvedByName: 'All verification levels',
            'missedPunchRectification.resolved': true,
            'missedPunchRectification.resolution': 'Approved',
            'missedPunchRectification.resolvedAt': isoNow(),
            'missedPunchRectification.resolvedByName': caller.name,
          }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
        } else if (tiersDone && r.masterAdminRequired && r.masterAdminApproveStatus !== 'Approved') {
          await createNotification({
            userId: r.approverIds?.teamLeader ?? rec.userId, companyId: rec.companyId,
            type: 'punch_rectification_master_admin',
            title: 'Rectification needs master-admin approval',
            message: `All tiers approved; awaiting master-admin decision for ${rec.date}.`, link: '/attendance',
          });
        }
      }

      await fanOutNotifications([rec.userId], {
        companyId: rec.companyId,
        type: 'punch_rectification_resolved',
        title: `Rectification ${decision.toLowerCase()}`,
        message: `Your punch correction for ${rec.date} was ${decision.toLowerCase()}.`, link: '/my-attendance',
      });

      return { attendance: updated };
    },
  },

  // ------------------------------------------------------------ read by id
  {
    method: 'GET',
    path: '/api/attendance/:id',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<AttendanceDoc>('attendance', req.params.id, await readPartitions(caller));
      if (!found) throw new ApiError('not-found', 'Attendance record not found');
      const rec = found.doc;
      const canRead =
        isSuperAdmin(caller) ||
        rec.userId === caller.uid ||
        hasPermission(caller, 'attendance.view') ||
        hasPermission(caller, 'attendance.manage');
      if (!canRead) throw new ApiError('permission-denied', 'Cannot view this attendance record');
      return { attendance: rec };
    },
  },

  // ------------------------------------------------------- partial update
  {
    method: 'PATCH',
    path: '/api/attendance/:id',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<AttendanceDoc>('attendance', req.params.id, await readPartitions(caller));
      if (!found) throw new ApiError('not-found', 'Attendance record not found');
      const rec = found.doc;

      const patch = { ...req.body } as Record<string, unknown>;
      delete patch.id;
      delete patch.companyId;

      if (!isSuperAdmin(caller)) {
        // Firestore attendance update rule: manage permission, a stamped
        // missed-punch tier approver, or the owner touching only punch fields.
        const isOwn = rec.userId === caller.uid;
        const stampedApprover = Object.values(rec.missedPunchRectification?.approverIds ?? {}).includes(caller.uid);
        const canManage = hasPermission(caller, 'attendance.manage');
        const ownAllowed = ['checkOut', 'workHours', 'overtimeHours', 'isAutoApproved', 'approved', 'approvedOn', 'approvedByName', 'missedPunchRectification'];
        const ownPatch = isOwn && Object.keys(patch).every((k) => ownAllowed.includes(k));
        if (!canManage && !stampedApprover && !ownPatch) {
          throw new ApiError('permission-denied', 'Cannot update this attendance record');
        }
        if (!isOwn) assertCompanyScope(caller, String(rec.companyId ?? ''));
      }

      const updated = await patchEntity<AttendanceDoc>('attendance', found.companyId, rec.id, patch, {
        entity: 'attendance', userIdField: 'userId', tsField: 'date',
      });
      if (!updated) throw new ApiError('not-found', 'Attendance record not found');
      return { attendance: updated };
    },
  },

  // --------------------------------------------------------------- delete
  {
    method: 'DELETE',
    path: '/api/attendance/:id',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<AttendanceDoc>('attendance', req.params.id, await readPartitions(caller));
      if (found) {
        if (!isSuperAdmin(caller)) {
          assertCompanyScope(caller, String(found.doc.companyId ?? ''));
          if (!hasPermission(caller, 'attendance.manage')) {
            throw new ApiError('permission-denied', 'Cannot delete attendance records');
          }
        }
        await deleteEntity('attendance', found.companyId, found.doc.id);
      }
      return { success: true };
    },
  },
];
