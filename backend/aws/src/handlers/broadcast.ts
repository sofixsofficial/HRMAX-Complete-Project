/**
 * Company-admin broadcast — email + notification fan-out to a company.
 * (Port of broadcastFunctions.ts.)
 */

import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { assertCompanyScope } from '../lib/auth.js';
import { putEntity, queryEntities } from '../lib/db.js';
import { sendEmailCentral, templates } from '../lib/email.js';
import { fanOutNotifications } from '../lib/notify.js';
import { newId, isoNow } from '../lib/types.js';

export const broadcastRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/broadcast',
    handler: async (req) => {
      const caller = must(req);
      const { companyId, title, message, sendEmail, sendPush } = req.body as {
        companyId: string; title: string; message: string; sendEmail?: boolean; sendPush?: boolean;
      };
      if (!title || !message) throw new ApiErrorLike('title and message required');
      assertCompanyScope(caller, companyId);

      const jobId = newId();
      const users = await queryEntities<Record<string, unknown>>({ entity: 'user', companyId, filters: { status: 'Active' } });
      let emailSent = 0;

      if (sendEmail !== false) {
        const t = templates.broadcast(title, message);
        const emails = users.map((u) => String(u.email ?? '')).filter(Boolean);
        const res = await sendEmailCentral({
          companyId, to: emails, subject: t.subject, html: t.html,
          type: 'alert', dedupKey: `broadcast:${jobId}`, triggeredBy: caller.uid,
        });
        if (res.success) emailSent = emails.length;
      }

      if (sendPush !== false) {
        await fanOutNotifications(users.map((u) => String(u.id)), {
          companyId, type: 'company_broadcast', title, message, link: '/announcements', priority: 'normal',
        }, caller.uid);
      }

      await putEntity(
        { id: jobId, companyId, title, message, createdBy: caller.uid, createdByName: caller.name, emailSent, userCount: users.length, createdAt: isoNow() },
        { entity: 'broadcastJob', tsField: 'createdAt' },
      );
      return { jobId, emailSent, userCount: users.length };
    },
  },

  {
    method: 'GET',
    path: '/api/broadcast',
    handler: async (req) => {
      const caller = must(req);
      const companyId = req.query.companyId ?? caller.companyId;
      assertCompanyScope(caller, companyId);
      const jobs = await queryEntities<Record<string, unknown>>({ entity: 'broadcastJob', companyId, orderBy: { field: 'createdAt', desc: true }, limit: 100 });
      return { jobs };
    },
  },
];

// Small local error to avoid importing ApiError at top for one use
class ApiErrorLike extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
