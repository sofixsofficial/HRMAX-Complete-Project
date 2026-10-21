/**
 * Generic CRUD routes for the core HR collections.
 * Each collection declares its entity name, permission keys, and scoping so
 * the same handler shape serves employees, departments, tasks, holidays,
 * announcements, notifications, tickets, assets, salary structures etc.
 * (Replaces the per-collection Firestore-direct client access.)
 */

import type { Route } from '../lib/http.js';
import { must, equalityFilters, parseOrderBy } from '../lib/http.js';
import { writeUserDoc } from './auth.js';
import { assertCompanyScope, assertPermission, assertRole, hasPermission, isSuperAdmin, readPartitions } from '../lib/auth.js';
import { putEntity, getEntity, patchEntity, deleteEntity, queryEntities, queryEntitiesAcross, locateEntityAcross, allPartitions, getUserDoc } from '../lib/db.js';
import { ApiError, newId, isoNow, type UserRole } from '../lib/types.js';

interface CollectionConfig {
  /** URL prefix, e.g. /api/employees */
  url: string;
  /** DynamoDB entity name */
  entity: string;
  /** Permission required for read (optional â€” some are open to all authed) */
  readPerm?: string;
  /** Permission required for create/update */
  writePerm?: string;
  /** Permission required for delete (defaults to writePerm) */
  deletePerm?: string;
  /** Index user-scoped queries on GSI1 */
  userIdField?: string;
  /** Timestamp field for ordering */
  tsField?: string;
  /** Employees-style records that must belong to caller's company on create */
  requireCompanyOnCreate?: boolean;
  /** Field whitelist for non-admin updates */
  editableFields?: string[];
}

export function crudRoutes(cfg: CollectionConfig): Route[] {
  const tsField = cfg.tsField ?? 'createdAt';
  const storeOpts = { entity: cfg.entity, userIdField: cfg.userIdField, tsField };

  return [
    // ------------------------------------------------------------------ list
    {
      method: 'GET',
      path: `${cfg.url}`,
      handler: async (req) => {
        const caller = must(req);
        if (cfg.readPerm) assertPermission(caller, cfg.readPerm);
        const explicit = req.query.companyId || undefined;
        const orderBy = parseOrderBy(req.query, tsField);
        const filters = equalityFilters(req.query);

        const base: Omit<Parameters<typeof queryEntities>[0], 'companyId'> = {
          entity: cfg.entity,
          orderBy,
          ...(filters ? { filters } : {}),
        };
        if (req.query.userId) base.userId = req.query.userId;

        let docs: Record<string, unknown>[];
        if (base.userId) {
          // GSI1 is already cross-partition (per-user collections).
          docs = await queryEntities<Record<string, unknown>>(base as Parameters<typeof queryEntities>[0]);
        } else if (explicit) {
          if (!isSuperAdmin(caller)) assertCompanyScope(caller, explicit);
          docs = await queryEntities<Record<string, unknown>>({ ...base, companyId: explicit });
        } else {
          // No explicit scope: super-admin (and team-leader's dynamic scope)
          // previously read the whole Firestore collection â€” union the
          // partitions they may see instead of defaulting to caller.companyId
          // (which silently emptied every master-admin dashboard list).
          const partitions = await readPartitions(caller);
          docs = partitions.length === 1
            ? await queryEntities<Record<string, unknown>>({ ...base, companyId: partitions[0] })
            : await queryEntitiesAcross<Record<string, unknown>>(base, partitions);
        }
        const limit = Number(req.query.limit ?? 0);
        if (limit) docs = docs.slice(0, limit);
        return { [`${cfg.entity}s`]: docs };
      },
    },

    // ------------------------------------------------------------------ read
    {
      method: 'GET',
      path: `${cfg.url}/:id`,
      handler: async (req) => {
        const caller = must(req);
        if (cfg.readPerm) assertPermission(caller, cfg.readPerm);
        // The shim derives ?companyId from the document path (a doc id for
        // flat paths), so resolve across the caller's readable partitions.
        const found = await locateEntityAcross<Record<string, unknown>>(cfg.entity, req.params.id, await readPartitions(caller));
        if (!found) throw new ApiError('not-found', `${cfg.entity} not found`);
        return { [cfg.entity]: found.doc };
      },
    },

    // ---------------------------------------------------------------- create
    {
      method: 'POST',
      path: `${cfg.url}`,
      handler: async (req) => {
        const caller = must(req);
        const data = { ...req.body } as Record<string, unknown>;
        const companyId = String(data.companyId || caller.companyId);
        if (cfg.writePerm) assertPermission(caller, cfg.writePerm);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);

        const id = String(data.id ?? newId());
        const doc_ = {
          ...data,
          id,
          companyId,
          createdById: caller.uid,
          createdByName: caller.name,
          [tsField]: isoNow(),
          updatedAt: isoNow(),
        };
        const saved = await putEntity(doc_ as never, storeOpts);
        return { id, [cfg.entity]: saved };
      },
    },

    // ---------------------------------------------------------------- update
    {
      method: 'PUT',
      path: `${cfg.url}/:id`,
      handler: async (req) => {
        const caller = must(req);
        if (cfg.writePerm) assertPermission(caller, cfg.writePerm);

        const patch = { ...req.body } as Record<string, unknown>;
        delete patch.id;
        delete patch.companyId;
        if (cfg.editableFields && !isSuperAdmin(caller)) {
          for (const k of Object.keys(patch)) {
            if (!cfg.editableFields.includes(k)) delete patch[k];
          }
        }
        // Never trust ?companyId for flat paths (it carries the doc id) â€”
        // locate the existing document inside the caller's scope first.
        const found = await locateEntityAcross<Record<string, unknown>>(cfg.entity, req.params.id, await readPartitions(caller));
        if (found) {
          if (!isSuperAdmin(caller)) assertCompanyScope(caller, found.companyId);
          const updated = await patchEntity<Record<string, unknown>>(cfg.entity, found.companyId, req.params.id, patch, storeOpts);
          return { [cfg.entity]: updated };
        }
        // Firestore setDoc parity: PUT is an upsert â€” setDoc on a brand-new
        // document id creates it.
        const companyId = String(req.body.companyId || caller.companyId);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
        const created = {
          ...patch,
          id: req.params.id,
          companyId,
          createdById: caller.uid,
          createdByName: caller.name,
          [tsField]: isoNow(),
          updatedAt: isoNow(),
        };
        const saved = await putEntity(created as never, storeOpts);
        return { [cfg.entity]: saved };
      },
    },

    // -------------------------------------------------------------- partial update
    {
      method: 'PATCH',
      path: `${cfg.url}/:id`,
      handler: async (req) => {
        const caller = must(req);
        if (cfg.writePerm) assertPermission(caller, cfg.writePerm);

        const patch = { ...req.body } as Record<string, unknown>;
        delete patch.id;
        delete patch.companyId;
        if (cfg.editableFields && !isSuperAdmin(caller)) {
          for (const k of Object.keys(patch)) {
            if (!cfg.editableFields.includes(k)) delete patch[k];
          }
        }
        const found = await locateEntityAcross<Record<string, unknown>>(cfg.entity, req.params.id, await readPartitions(caller));
        if (!found) throw new ApiError('not-found', `${cfg.entity} not found`);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, found.companyId);
        const updated = await patchEntity<Record<string, unknown>>(cfg.entity, found.companyId, req.params.id, patch, storeOpts);
        if (!updated) throw new ApiError('not-found', `${cfg.entity} not found`);
        return { [cfg.entity]: updated };
      },
    },

    // ---------------------------------------------------------------- delete
    {
      method: 'DELETE',
      path: `${cfg.url}/:id`,
      handler: async (req) => {
        const caller = must(req);
        if (cfg.deletePerm ?? cfg.writePerm) assertPermission(caller, (cfg.deletePerm ?? cfg.writePerm)!);
        const found = await locateEntityAcross<Record<string, unknown>>(cfg.entity, req.params.id, await readPartitions(caller));
        if (found) {
          if (!isSuperAdmin(caller)) assertCompanyScope(caller, found.companyId);
          await deleteEntity(cfg.entity, found.companyId, req.params.id);
        }
        // Firestore deleteDoc is idempotent â€” deleting a missing doc succeeds.
        return { success: true };
      },
    },
  ];
}

/** Standard collection configs covering the original Firestore collections. */
export const coreCrudRoutes: Route[] = [
  ...crudRoutes({ url: '/api/employees', entity: 'employee', readPerm: 'employees.view', writePerm: 'employees.create', userIdField: 'userId', editableFields: ['name', 'email', 'phone', 'designation', 'departmentId', 'status', 'reportingManagerId', 'avatar', 'address', 'dateOfJoining', 'salary', 'shiftStart', 'shiftEnd', 'shiftType', 'aadharDoc', 'panDoc', 'joiningLetterDoc', 'offerLetterDoc', 'slug'] }),
  ...crudRoutes({ url: '/api/departments', entity: 'department', readPerm: 'departments.view', writePerm: 'departments.create' }),
  ...crudRoutes({ url: '/api/tasks', entity: 'task', readPerm: 'tasks.view', writePerm: 'tasks.create', userIdField: 'assignedToId', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/holidays', entity: 'holiday', readPerm: 'holidays.view', writePerm: 'holidays.create', tsField: 'date' }),
  ...crudRoutes({ url: '/api/announcements', entity: 'announcement', writePerm: 'announcements.create', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/tickets', entity: 'ticket', userIdField: 'createdById', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/assets', entity: 'asset', readPerm: 'assets.view', writePerm: 'assets.create' }),
  ...crudRoutes({ url: '/api/salary-structures', entity: 'salaryStructure', readPerm: 'salary.view', writePerm: 'salary.edit' }),
  ...crudRoutes({ url: '/api/leave-policies', entity: 'leavePolicy', readPerm: 'leave.view', writePerm: 'settings.edit' }),
  ...crudRoutes({ url: '/api/shift-configs', entity: 'shiftConfig', writePerm: 'attendance.manage' }),
  ...crudRoutes({ url: '/api/company-settings', entity: 'companySettings', writePerm: 'settings.edit' }),
  ...crudRoutes({ url: '/api/attendance-settings', entity: 'attendanceSettings', writePerm: 'attendance.manage' }),
  ...crudRoutes({ url: '/api/transfers', entity: 'transfer', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/performance', entity: 'performance', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/documents', entity: 'document', userIdField: 'uploadedBy', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/salary-slips', entity: 'salarySlip', readPerm: 'payroll.view', userIdField: 'userId', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/payroll-runs', entity: 'payrollRun', readPerm: 'payroll.view', writePerm: 'payroll.calculate', tsField: 'createdAt' }),
  ...crudRoutes({ url: '/api/attendance-logs', entity: 'attendanceLog', userIdField: 'userId', tsField: 'timestamp' }),

  // ------------------------------------------------------------------ users
  {
    method: 'GET',
    path: '/api/users',
    handler: async (req) => {
      const caller = must(req);
      const { allUsers, queryEntities, queryEntitiesAcross, allPartitions } = await import('../lib/db.js');
      if (isSuperAdmin(caller) && req.query.all === 'true') {
        return { users: await allUsers() };
      }
      const orderBy = parseOrderBy(req.query, 'createdAt');
      const filters = equalityFilters(req.query);
      const base: Omit<Parameters<typeof queryEntities>[0], 'companyId'> = {
        entity: 'user',
        orderBy,
        ...(filters ? { filters } : {}),
      };
      if (req.query.userId) base.userId = req.query.userId;

      let docs: Record<string, unknown>[];
      if (base.userId) {
        docs = await queryEntities<Record<string, unknown>>(base as Parameters<typeof queryEntities>[0]);
      } else if (req.query.companyId) {
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, req.query.companyId);
        docs = await queryEntities<Record<string, unknown>>({ ...base, companyId: req.query.companyId });
      } else if (isSuperAdmin(caller)) {
        // Master-admin with no filter saw only COMPANY#master-admin before â€”
        // the real company users live under their own partitions, and
        // writeUserDoc dual-writes platform users under 'global' too, so the
        // union must be id-deduped.
        docs = await queryEntitiesAcross<Record<string, unknown>>(base, await allPartitions());
      } else {
        const partitions = await readPartitions(caller);
        docs = partitions.length === 1
          ? await queryEntities<Record<string, unknown>>({ ...base, companyId: partitions[0] })
          : await queryEntitiesAcross<Record<string, unknown>>(base, partitions);
      }
      // Non-admins only see users in their company scope
      const visible = isSuperAdmin(caller) ? docs : docs.filter((d) => {
        const c = String(d.companyId ?? '');
        return !c || c === caller.companyId || caller.assignedCompanyIds.includes(c);
      });
      return { users: visible };
    },
  },
  {
    method: 'GET',
    path: '/api/users/:uid',
    handler: async (req) => {
      const caller = must(req);
      const { getUserDoc } = await import('../lib/db.js');
      const uid = req.params.uid;
      if (uid !== caller.uid && !isSuperAdmin(caller) && !hasPermission(caller, 'employees.view')) {
        throw new ApiError('permission-denied', 'Cannot view this user');
      }
      const doc_ = await getUserDoc(uid);
      if (!doc_) throw new ApiError('not-found', 'User not found');
      return { user: doc_ };
    },
  },
  {
    method: 'PUT',
    path: '/api/users/:uid',
    bootstrap: true,
    handler: async (req) => {
      const caller = must(req);
      const uid = req.params.uid;
      const isSelf = uid === caller.uid;
      if (!isSelf && !isSuperAdmin(caller) && !hasPermission(caller, 'employees.edit')) {
        throw new ApiError('permission-denied', 'Cannot write this user');
      }
      const data = { ...req.body } as Record<string, unknown>;
      delete data.id;
      const existing = await getUserDoc(uid);
      if (!existing) {
        // Bootstrap creation (signUpCompany writes the first doc for a fresh
        // sign-up; admins provision staff the same way). One hard line:
        // nobody may create a master admin without already being one.
        if (String(data.role) === 'master-admin' && !isSuperAdmin(caller)) {
          throw new ApiError('permission-denied', 'Cannot create a master admin here');
        }
        const saved = await writeUserDoc(uid, {
          ...data,
          email: String(data.email ?? ''),
          role: String(data.role ?? 'employee'),
          companyId: String(data.companyId ?? ''),
        });
        return { user: saved };
      }
      // Update path: self-service whitelist (parity with PATCH) unless MA/CA selfâ€¦ keep parity â€” self = whitelist.
      if (isSelf && !isSuperAdmin(caller)) {
        const allowed = ['name', 'phone', 'avatar', 'address', 'emergencyContactName', 'emergencyContactPhone', 'pushToken'];
        for (const k of Object.keys(data)) if (!allowed.includes(k)) delete data[k];
      }
      if (String(data.role) === 'master-admin' && !isSuperAdmin(caller)) delete data.role;
      const saved = await writeUserDoc(uid, {
        ...existing,
        ...data,
        email: String(data.email ?? existing.email ?? ''),
        role: String(data.role ?? existing.role ?? 'employee'),
        companyId: String(data.companyId ?? existing.companyId ?? ''),
      });
      return { user: saved };
    },
  },
  {
    method: 'PATCH',
    path: '/api/users/:uid',
    handler: async (req) => {
      const caller = must(req);
      const { patchEntity } = await import('../lib/db.js');
      const uid = req.params.uid;
      const patch = { ...req.body } as Record<string, unknown>;
      if (uid === caller.uid) {
        // Self-service whitelist
        const allowed = ['name', 'phone', 'avatar', 'address', 'emergencyContactName', 'emergencyContactPhone', 'pushToken'];
        for (const k of Object.keys(patch)) if (!allowed.includes(k)) delete patch[k];
      } else if (!isSuperAdmin(caller) && !hasPermission(caller, 'employees.edit')) {
        throw new ApiError('permission-denied', 'Cannot edit this user');
      }
      // No privilege escalation: only a master admin may grant master admin.
      if (String(patch.role) === 'master-admin' && !isSuperAdmin(caller)) delete patch.role;
      const user = await (await import('../lib/db.js')).getUserDoc(uid);
      if (!user) throw new ApiError('not-found', 'User not found');
      let updated = await patchEntity('user', String(user.companyId ?? 'global'), uid, patch, { entity: 'user' });
      // Re-sync the USER#{uid}/PROFILE copy that resolveCaller reads on
      // every authenticated request.
      if (updated) {
        updated = (await writeUserDoc(uid, updated as unknown as Parameters<typeof writeUserDoc>[1])) as Record<string, unknown>;
      }
      return { user: updated };
    },
  },
  {
    method: 'DELETE',
    path: '/api/users/:uid/remove',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller)) throw new ApiError('permission-denied', 'Master admin only');
      const { getUserDoc, deleteUserDoc } = await import('../lib/db.js');
      const uid = req.params.uid;
      const user = await getUserDoc(uid);
      await deleteUserDoc(uid);
      void user;
      return { success: true };
    },
  },
];

/** Companies (master-admin + scoped). */
export const companyRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/companies',
    handler: async (req) => {
      const caller = must(req);
      const { listCompanies } = await import('../lib/db.js');
      if (isSuperAdmin(caller)) return { companies: await listCompanies() };
      const scoped = caller.assignedCompanyIds.length ? caller.assignedCompanyIds : caller.companyId ? [caller.companyId] : [];
      const all = await listCompanies();
      return { companies: all.filter((c) => scoped.includes(String(c.id))) };
    },
  },
  {
    method: 'GET',
    path: '/api/companies/:id',
    handler: async (req) => {
      const caller = must(req);
      const { getEntity } = await import('../lib/db.js');
      // companies are stored with companyId = their own id
      const doc_ = await getEntity<Record<string, unknown>>('company', req.params.id, req.params.id);
      if (!doc_) throw new ApiError('not-found', 'Company not found');
      if (!isSuperAdmin(caller)) assertCompanyScope(caller, req.params.id);
      return { company: doc_ };
    },
  },
  {
    method: 'POST',
    path: '/api/companies',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller) && !hasPermission(caller, 'companies.create')) throw new ApiError('permission-denied', 'Cannot create companies');
      const { putEntity: put } = await import('../lib/db.js');
      const data = req.body as Record<string, unknown>;
      const id = String(data.id ?? newId());
      const doc_ = { ...data, id, companyId: id, status: data.status ?? 'Approved', createdOn: isoNow(), createdAt: isoNow(), updatedAt: isoNow(), createdById: caller.uid };
      await put(doc_ as never, { entity: 'company', globalList: true });
      return { id, company: doc_ };
    },
  },
  {
    method: 'PUT',
    path: '/api/companies/:id',
    bootstrap: true,
    handler: async (req) => {
      const caller = must(req);
      const bootstrap = caller.role === 'unprovisioned';
      if (!bootstrap && !isSuperAdmin(caller) && !hasPermission(caller, 'companies.create') && !hasPermission(caller, 'companies.edit')) {
        throw new ApiError('permission-denied', 'Cannot write companies');
      }
      const { getEntity: get, putEntity: put } = await import('../lib/db.js');
      const id = req.params.id;
      const data = { ...req.body } as Record<string, unknown>;
      delete data.id;
      delete data.companyId;
      const existing = await get<Record<string, unknown>>('company', id, id);
      const doc_ = {
        ...data,
        id,
        companyId: id,
        status: data.status ?? 'Approved',
        createdOn: existing?.createdOn ?? isoNow(),
        createdAt: existing?.createdAt ?? isoNow(),
        createdBy: existing?.createdBy ?? caller.uid,
        createdById: existing?.createdById ?? caller.uid,
        updatedAt: isoNow(),
      };
      await put(doc_ as never, { entity: 'company', globalList: true });
      return { company: doc_ };
    },
  },
  {
    method: 'PATCH',
    path: '/api/companies/:id',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller) && !hasPermission(caller, 'companies.edit')) throw new ApiError('permission-denied', 'Cannot edit companies');
      const { patchEntity: patch } = await import('../lib/db.js');
      const updated = await patch('company', req.params.id, req.params.id, req.body as Record<string, unknown>, { entity: 'company', globalList: true });
      if (!updated) throw new ApiError('not-found', 'Company not found');
      return { company: updated };
    },
  },
  {
    method: 'DELETE',
    path: '/api/companies/:id',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller)) throw new ApiError('permission-denied', 'Master admin only');
      const { deleteEntity: del } = await import('../lib/db.js');
      await del('company', req.params.id, req.params.id);
      return { success: true };
    },
  },
];

/** Notifications (owner-scoped). */
export const notificationRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/notifications',
    handler: async (req) => {
      const caller = must(req);
      const want = req.query.userId;
      // Firestore list rule: non-super-admins only ever see their own
      // notifications â€” asking for someone else's returns an empty set.
      if (!isSuperAdmin(caller) && want && want !== caller.uid) return { notifications: [] };
      const docs = await queryEntities<Record<string, unknown>>({
        entity: 'notification', companyId: 'global', userId: want || caller.uid,
      });
      docs.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return { notifications: (req.query.limit ? docs.slice(0, Number(req.query.limit)) : docs) };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications',
    handler: async (req) => {
      const caller = must(req);
      void caller;
      const data = { ...req.body } as Record<string, unknown>;
      const userId = String(data.userId ?? '');
      if (!userId) throw new ApiError('bad-request', 'userId required');
      const id = String(data.id ?? newId());
      const doc_ = {
        ...data,
        id,
        read: data.read ?? false,
        createdAt: data.createdAt ?? isoNow(),
      };
      await putEntity(doc_ as never, { entity: 'notification', userIdField: 'userId', keyCompanyId: 'global' });
      return { id, notification: doc_ };
    },
  },
  {
    method: 'PATCH',
    path: '/api/notifications/:id',
    handler: async (req) => {
      const caller = must(req);
      // Firestore update rule (notifications): owner-only â€” backs the app's
      // updateDoc(ref, { read: true }) mark-read path. Notifications can live
      // in 'global' (migrated + current notify.ts) or in the creating
      // company's partition (older runtime writes), so locate across all.
      // The shim's ?companyId=<docId> query param is deliberately ignored.
      const found = await locateEntityAcross<{ userId: string }>('notification', req.params.id, await allPartitions());
      if (!found) throw new ApiError('not-found', 'Notification not found');
      if (!isSuperAdmin(caller) && found.doc.userId !== caller.uid) {
        throw new ApiError('permission-denied', 'Not your notification');
      }
      const patch = { ...req.body } as Record<string, unknown>;
      delete patch.id;
      delete patch.companyId;
      await patchEntity('notification', found.companyId, req.params.id, patch, {
        entity: 'notification', userIdField: 'userId',
      });
      return { success: true };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications/:id/read',
    handler: async (req) => {
      const caller = must(req);
      const found = await locateEntityAcross<{ userId: string }>('notification', req.params.id, await allPartitions());
      if (!found) throw new ApiError('not-found', 'Notification not found');
      if (!isSuperAdmin(caller) && found.doc.userId !== caller.uid) {
        throw new ApiError('permission-denied', 'Not your notification');
      }
      await patchEntity('notification', found.companyId, req.params.id, { read: true, readAt: isoNow() }, { entity: 'notification', userIdField: 'userId' });
      void caller;
      return { success: true };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications/read-all',
    handler: async (req) => {
      const caller = must(req);
      const unread = await queryEntities<{ id: string }>({ entity: 'notification', companyId: 'global', userId: caller.uid, filters: { read: false } });
      for (const n of unread) {
        await patchEntity('notification', 'global', n.id, { read: true, readAt: isoNow() }, { entity: 'notification', userIdField: 'userId' });
      }
      return { success: true, count: unread.length };
    },
  },
  {
    method: 'DELETE',
    path: '/api/notifications/:id',
    handler: async (req) => {
      const caller = must(req);
      // Locate across partitions (same rationale as PATCH): a 'global'-only
      // lookup silently no-op'd deletes of company-partitioned notifications.
      const found = await locateEntityAcross<{ userId: string }>('notification', req.params.id, await allPartitions());
      if (!found) return { success: true }; // Firestore delete is idempotent
      if (!isSuperAdmin(caller) && found.doc.userId !== caller.uid) {
        throw new ApiError('permission-denied', 'Not your notification');
      }
      await deleteEntity('notification', found.companyId, req.params.id);
      return { success: true };
    },
  },
];

// ---------------------------------------------------------------------------
// Admin alerts â€” shared partition, management-readable, master-admin-mutable
// (Firestore rules 574-604: list open to management roles with no company
// filter; create needs a scoped companyId for non-super-admins; update/delete
// are super-admin only).
// ---------------------------------------------------------------------------

const ALERT_ROLES: UserRole[] = ['master-admin', 'company-admin', 'executive', 'team-leader', 'reporting-manager'];

export const adminAlertRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/admin-alerts',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ALERT_ROLES);
      const orderBy = parseOrderBy(req.query, 'createdAt');
      const filters = equalityFilters(req.query);
      // Firestore list has no company constraint for management roles, and
      // legacy mobile writes may sit in company partitions â€” union them all.
      let docs = await queryEntitiesAcross<Record<string, unknown>>(
        { entity: 'adminAlert', orderBy, ...(filters ? { filters } : {}) },
        await allPartitions(),
      );
      const limit = Number(req.query.limit ?? 0);
      if (limit) docs = docs.slice(0, limit);
      return { adminAlerts: docs };
    },
  },
  {
    method: 'POST',
    path: '/api/admin-alerts',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ALERT_ROLES);
      const data = { ...req.body } as Record<string, unknown>;
      const companyId = String(data.companyId ?? '');
      if (!isSuperAdmin(caller)) {
        // Rules: create requires a non-empty companyId inside the caller's scope.
        if (!companyId) throw new ApiError('permission-denied', 'companyId required');
        assertCompanyScope(caller, companyId);
      }
      const id = String(data.id ?? newId());
      const doc_ = { ...data, id };
      // Every alert lives in the shared partition (matches the import, which
      // normalized migrated alerts to companyId 'global').
      await putEntity(doc_ as never, { entity: 'adminAlert', keyCompanyId: 'global' });
      return { id, adminAlert: doc_ };
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin-alerts/:id',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller)) throw new ApiError('permission-denied', 'Master admin only');
      // The shim appends a bogus ?companyId=<docid> for flat paths â€” ignore it
      // and locate the alert (mobile-era writes may sit in a company partition).
      const found = await locateEntityAcross<Record<string, unknown>>('adminAlert', req.params.id, await allPartitions());
      if (!found) throw new ApiError('not-found', 'Admin alert not found');
      const patch = { ...req.body } as Record<string, unknown>;
      delete patch.id;
      delete patch.companyId;
      const updated = await patchEntity<Record<string, unknown>>('adminAlert', found.companyId, req.params.id, patch, { entity: 'adminAlert' });
      if (!updated) throw new ApiError('not-found', 'Admin alert not found');
      return { adminAlert: updated };
    },
  },
  {
    method: 'DELETE',
    path: '/api/admin-alerts/:id',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller)) throw new ApiError('permission-denied', 'Master admin only');
      const found = await locateEntityAcross<Record<string, unknown>>('adminAlert', req.params.id, await allPartitions());
      if (found) await deleteEntity('adminAlert', found.companyId, req.params.id);
      return { success: true };
    },
  },
];

// ---------------------------------------------------------------------------
// Roles â€” global partition (the Role interface carries no companyId), any
// authenticated read; write per Firestore rules (1162-1169): super-admin, or
// company-admin with a companyId inside their scope; delete super-admin only.
// ---------------------------------------------------------------------------

const ROLE_STORE = { entity: 'role', keyCompanyId: 'global' } as const;

export const roleRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/roles',
    handler: async (req) => {
      must(req);
      const filters = equalityFilters(req.query);
      const docs = await queryEntities<Record<string, unknown>>({
        entity: 'role',
        companyId: 'global',
        orderBy: parseOrderBy(req.query, 'createdAt'),
        ...(filters ? { filters } : {}),
      });
      const limit = Number(req.query.limit ?? 0);
      return { roles: limit ? docs.slice(0, limit) : docs };
    },
  },
  {
    method: 'GET',
    path: '/api/roles/:id',
    handler: async (req) => {
      must(req);
      const doc_ = await getEntity<Record<string, unknown>>('role', 'global', req.params.id);
      if (!doc_) throw new ApiError('not-found', 'Role not found');
      return { role: doc_ };
    },
  },
  {
    method: 'POST',
    path: '/api/roles',
    handler: async (req) => {
      const caller = must(req);
      const data = { ...req.body } as Record<string, unknown>;
      const companyId = String(data.companyId ?? '');
      if (!isSuperAdmin(caller)) {
        if (caller.role !== 'company-admin') throw new ApiError('permission-denied', 'Master admin or company admin only');
        if (!companyId) throw new ApiError('permission-denied', 'companyId required');
        assertCompanyScope(caller, companyId);
      }
      const id = String(data.id ?? newId());
      const doc_ = { ...data, id, createdAt: data.createdAt ?? isoNow(), updatedAt: isoNow() };
      await putEntity(doc_ as never, ROLE_STORE);
      return { id, role: doc_ };
    },
  },
  {
    method: 'PATCH',
    path: '/api/roles/:id',
    handler: async (req) => {
      const caller = must(req);
      const existing = await getEntity<Record<string, unknown>>('role', 'global', req.params.id);
      if (!existing) throw new ApiError('not-found', 'Role not found');
      if (!isSuperAdmin(caller)) {
        if (caller.role !== 'company-admin') throw new ApiError('permission-denied', 'Master admin or company admin only');
        assertCompanyScope(caller, String(existing.companyId ?? ''));
      }
      const patch = { ...req.body } as Record<string, unknown>;
      delete patch.id;
      delete patch.companyId;
      const updated = await patchEntity<Record<string, unknown>>('role', 'global', req.params.id, patch, ROLE_STORE);
      if (!updated) throw new ApiError('not-found', 'Role not found');
      return { role: updated };
    },
  },
  {
    method: 'DELETE',
    path: '/api/roles/:id',
    handler: async (req) => {
      const caller = must(req);
      if (!isSuperAdmin(caller)) throw new ApiError('permission-denied', 'Master admin only');
      await deleteEntity('role', 'global', req.params.id);
      return { success: true };
    },
  },
];
