/**
 * Generic CRUD routes for the core HR collections.
 * Each collection declares its entity name, permission keys, and scoping so
 * the same handler shape serves employees, departments, tasks, holidays,
 * announcements, notifications, tickets, assets, salary structures etc.
 * (Replaces the per-collection Firestore-direct client access.)
 */

import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { assertCompanyScope, assertPermission, hasPermission, isSuperAdmin } from '../lib/auth.js';
import { putEntity, getEntity, patchEntity, deleteEntity, queryEntities } from '../lib/db.js';
import { ApiError, newId, isoNow } from '../lib/types.js';

interface CollectionConfig {
  /** URL prefix, e.g. /api/employees */
  url: string;
  /** DynamoDB entity name */
  entity: string;
  /** Permission required for read (optional — some are open to all authed) */
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
        const companyId = req.query.companyId ?? caller.companyId;
        if (cfg.readPerm) assertPermission(caller, cfg.readPerm);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);

        const q: Parameters<typeof queryEntities>[0] = { entity: cfg.entity, companyId, orderBy: { field: tsField, desc: true } };
        if (req.query.userId) q.userId = req.query.userId;
        if (req.query.status) q.filters = { status: req.query.status };
        if (req.query.departmentId) q.filters = { ...q.filters, departmentId: req.query.departmentId };
        if (req.query.assignedToId) q.filters = { ...q.filters, assignedToId: req.query.assignedToId };

        let docs = await queryEntities<Record<string, unknown>>(q);
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
        const companyId = req.query.companyId ?? caller.companyId;
        if (cfg.readPerm) assertPermission(caller, cfg.readPerm);
        const doc_ = await getEntity<Record<string, unknown>>(cfg.entity, companyId, req.params.id);
        if (!doc_) throw new ApiError('not-found', `${cfg.entity} not found`);
        return { [cfg.entity]: doc_ };
      },
    },

    // ---------------------------------------------------------------- create
    {
      method: 'POST',
      path: `${cfg.url}`,
      handler: async (req) => {
        const caller = must(req);
        const data = { ...req.body } as Record<string, unknown>;
        const companyId = String(data.companyId ?? caller.companyId);
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
        const companyId = String(req.body.companyId ?? req.query.companyId ?? caller.companyId);
        if (cfg.writePerm) assertPermission(caller, cfg.writePerm);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);

        const patch = { ...req.body } as Record<string, unknown>;
        delete patch.id;
        delete patch.companyId;
        if (cfg.editableFields && !isSuperAdmin(caller)) {
          for (const k of Object.keys(patch)) {
            if (!cfg.editableFields.includes(k)) delete patch[k];
          }
        }
        const updated = await patchEntity<Record<string, unknown>>(cfg.entity, companyId, req.params.id, patch, storeOpts);
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
        const companyId = req.query.companyId ?? caller.companyId;
        if (cfg.deletePerm ?? cfg.writePerm) assertPermission(caller, (cfg.deletePerm ?? cfg.writePerm)!);
        if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
        await deleteEntity(cfg.entity, companyId, req.params.id);
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
      const { allUsers, queryEntities } = await import('../lib/db.js');
      if (isSuperAdmin(caller) && req.query.all === 'true') {
        return { users: await allUsers() };
      }
      const role = req.query.role;
      const companyId = req.query.companyId ?? caller.companyId;
      const q: Parameters<typeof queryEntities>[0] = { entity: 'user', companyId, orderBy: { field: 'createdAt', desc: true } };
      if (role) q.filters = { role };
      if (req.query.userId) q.userId = req.query.userId;
      const docs = await queryEntities<Record<string, unknown>>(q);
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
      const user = await (await import('../lib/db.js')).getUserDoc(uid);
      if (!user) throw new ApiError('not-found', 'User not found');
      const updated = await patchEntity('user', String(user.companyId ?? 'global'), uid, patch, { entity: 'user' });
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
      const docs = await queryEntities<Record<string, unknown>>({
        entity: 'notification', companyId: 'global', userId: req.query.userId ?? caller.uid,
      });
      docs.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return { notifications: (req.query.limit ? docs.slice(0, Number(req.query.limit)) : docs) };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications/:id/read',
    handler: async (req) => {
      const caller = must(req);
      await patchEntity('notification', 'global', req.params.id, { read: true, readAt: isoNow() }, { entity: 'notification', userIdField: 'userId' });
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
      if (!isSuperAdmin(caller)) {
        const doc_ = await getEntity<{ userId: string }>('notification', 'global', req.params.id);
        if (doc_ && doc_.userId !== caller.uid) throw new ApiError('permission-denied', 'Not your notification');
      }
      await deleteEntity('notification', 'global', req.params.id);
      return { success: true };
    },
  },
];
