/**
 * Attendance — check-in/out with validation chain, geofence, auto-approval,
 * and the missed-punch rectification tier flow.
 * (Port of attendanceFunctions.ts + attendanceEngine.ts + missedPunchFunctions.ts.)
 */

import type { Route } from '../lib/http.js';
import { must, equalityFilters, parseOrderBy } from '../lib/http.js';
import { assertCompanyScope, hasPermission, isSuperAdmin, readPartitions } from '../lib/auth.js';
import { putEntity, patchEntity, deleteEntity, queryEntities, queryEntitiesAcross, locateEntityAcross, allPartitions } from '../lib/db.js';
import { resolveStakeholders } from '../lib/stakeholders.js';
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { ApiError, newId, isoNow, TIER_ORDER, type AttendanceDoc, type AttendanceStatus, type LeaveTier, type UserRole } from '../lib/types.js';

const GRACE_PERIOD_MINUTES = 15;
const OVERTIME_THRESHOLD_MINUTES = 30;
const EARTH_RADIUS_M = 6371000;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
}

async function getPolicy(companyId: string): Promise<AttendancePolicy> {
  const docs = await queryEntities<AttendancePolicy & { id: string }>({
    entity: 'attendanceSettings', companyId, limit: 1,
  });
  const doc_ = docs[0];
  return {
    defaultShiftStart: doc_?.defaultShiftStart ?? '09:00',
    defaultShiftEnd: doc_?.defaultShiftEnd ?? '18:00',
    gracePeriodMinutes: doc_?.gracePeriodMinutes ?? GRACE_PERIOD_MINUTES,
    officeLocation: doc_?.officeLocation,
    requireSelfie: doc_?.requireSelfie ?? false,
    requireGeofence: doc_?.requireGeofence ?? false,
  };
}

function determineStatus(checkInMin: number, shiftStartMin: number, grace: number): { status: AttendanceStatus; lateMinutes: number } {
  if (checkInMin <= shiftStartMin) return { status: 'Present', lateMinutes: 0 };
  if (checkInMin - shiftStartMin <= grace) return { status: 'Present', lateMinutes: 0 };
  return { status: 'Late', lateMinutes: checkInMin - shiftStartMin };
}

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
        companyId, type, selfieUrl, latitude, longitude, networkType, wifiSsid,
      } = req.body as {
        companyId: string; type: 'check-in' | 'check-out'; selfieUrl?: string;
        latitude?: number; longitude?: number; networkType?: string; wifiSsid?: string;
      };
      // Clients (web/mobile callable shim) send `action`; older payloads send `type`.
      // Accept both so the check-in/check-out contract is stable across platforms.
      const markType = type ?? (req.body as { action?: 'check-in' | 'check-out' }).action;
      if (!companyId || !markType) throw new ApiError('bad-request', 'companyId and type required');
      assertCompanyScope(caller, companyId);

      const policy = await getPolicy(companyId);
      const today = todayKey();
      const now = new Date();
      const nowIso = now.toISOString();
      const nowMin = now.getHours() * 60 + now.getMinutes();

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

        // Geofence
        if (policy.requireGeofence) {
          if (!policy.officeLocation) return fail('NO_OFFICE_LOCATION', 'No office location configured');
          if (latitude === undefined || longitude === undefined) return fail('GPS_REQUIRED', 'Location required for check-in');
          const dist = haversine(latitude, longitude, policy.officeLocation.latitude, policy.officeLocation.longitude);
          if (dist > (policy.officeLocation.radiusMeters ?? 100)) {
            return fail('GPS_OUT_OF_BOUNDS', `You are ${Math.round(dist)}m away from the office (allowed ${policy.officeLocation.radiusMeters ?? 100}m)`);
          }
        }

        // Selfie — clients send `selfieUri`, older payloads send `selfieUrl`.
        const selfie = selfieUrl ?? (req.body as { selfieUri?: string }).selfieUri;
        if (policy.requireSelfie) {
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
          workHours: 0, overtimeHours: 0,
          isAutoApproved: true, approved: true, approvedByName: 'System (Auto-Approved)',
          createdAt: existing?.createdAt ?? isoNow(), updatedAt: isoNow(),
        };
        await putEntity<AttendanceDoc>(doc_, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
        await writeLog({ companyId, userId: caller.uid, action: 'check-in', status: 'success', date: today });

        if (status === 'Late') {
          const stakeholders = await resolveStakeholders(companyId, caller.uid, caller.name);
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

      const updated = await patchEntity<AttendanceDoc>('attendance', companyId, existing.id, {
        checkOut: nowIso,
        workHours: Math.round((workMinutes / 60) * 100) / 100,
        overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
        status: isEarly ? 'Early Checkout' : existing.status,
      }, { entity: 'attendance', userIdField: 'userId', tsField: 'date' });
      await writeLog({ companyId, userId: caller.uid, action: 'check-out', status: 'success', date: today });
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
        reportingManager: 'Pending', companyAdmin: 'Pending', executive: 'Pending', teamLeader: 'Pending',
      };
      const approverIds: Partial<Record<LeaveTier, string | null>> = {
        reportingManager: stakeholders.reportingManagerId,
        companyAdmin: stakeholders.companyAdminIds[0] ?? null,
        executive: stakeholders.executiveIds[0] ?? null,
        teamLeader: stakeholders.teamLeaderIds[0] ?? null,
      };
      for (const t of TIER_ORDER) if (!approverIds[t]) status[t] = 'Skipped';

      // Per-role auto-skip (parity with missedPunchFunctions)
      const role = caller.role as UserRole;
      if (role === 'team-leader') {
        for (const t of TIER_ORDER) status[t] = 'Approved';
      } else if (role === 'executive') {
        status.reportingManager = 'Approved'; status.companyAdmin = 'Approved'; status.executive = 'Approved';
      } else if (role === 'reporting-manager') {
        status.reportingManager = 'Skipped';
      }
      const masterAdminRequired = role === 'team-leader' || role === 'executive';

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
          const roleForTier: Record<string, UserRole[]> = { reportingManager: ['reporting-manager'], companyAdmin: ['company-admin'], executive: ['executive'], teamLeader: ['team-leader'] };
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
