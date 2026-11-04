/**
 * Lambda entry point — API Gateway HTTP API → route table.
 * Single routed API for the whole product (one Lambda replaced the original
 * per-feature serverless function set.)
 */

import { makeRouter } from './lib/http.js';
import { authRoutes } from './handlers/auth.js';
import { leaveRoutes } from './handlers/leave.js';
import { attendanceRoutes } from './handlers/attendance.js';
import { coreCrudRoutes, companyRoutes, notificationRoutes, adminAlertRoutes, roleRoutes } from './handlers/crud.js';
import { payrollRoutes } from './handlers/payroll.js';
import { emailRoutes } from './handlers/email.js';
import { broadcastRoutes } from './handlers/broadcast.js';
import { storageRoutes } from './handlers/storage.js';
import { legacyRoutes } from './handlers/legacy.js';

export const handler = makeRouter([
  // Health (public)
  { method: 'GET', path: '/api/health', public: true, handler: async () => ({ ok: true, service: 'hrmax-api', ts: new Date().toISOString() }) },

  ...authRoutes,
  ...leaveRoutes,
  ...attendanceRoutes,
  ...coreCrudRoutes,
  ...companyRoutes,
  ...notificationRoutes,
  ...adminAlertRoutes,
  ...roleRoutes,
  ...payrollRoutes,
  ...emailRoutes,
  ...broadcastRoutes,
  ...storageRoutes,

  // Legacy callable dispatcher — POST /fn/:name
  ...legacyRoutes,
]);
