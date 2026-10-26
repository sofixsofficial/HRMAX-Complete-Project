/**
 * Email system admin routes — config, test, logs, retry.
 * (Port of emailService.ts callables; transport is SES.)
 */

import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { assertRole, assertPermission } from '../lib/auth.js';
import { queryEntities, patchEntity } from '../lib/db.js';
import { sendEmailCentral, getEmailConfig } from '../lib/email.js';
import type { EmailAttachment } from '../lib/email.js';
import { ApiError } from '../lib/types.js';

export const emailRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/email/config',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin']);
      const config = await getEmailConfig();
      return { config };
    },
  },

  {
    method: 'POST',
    path: '/api/email/test',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin']);
      const to = String(req.body.to ?? caller.email);
      const res = await sendEmailCentral({
        to, subject: 'HR MAX test email',
        html: `<p>Test email sent at ${new Date().toISOString()}.</p>`,
        type: 'test', force: true,
      });
      if (!res.success) throw new ApiError('failed-precondition', res.error ?? 'Send failed');
      return res;
    },
  },

  {
    method: 'POST',
    path: '/api/email/send',
    handler: async (req) => {
      const caller = must(req);
      // BUG FIXED: this route only authenticated, so ANY signed-in user
      // (including an employee) could send arbitrary mail from the platform.
      // Gate it with the same permission that gates the mailbox collection
      // (`/api/emails` → support.view): MA/CA auto-grant it, employees don't.
      assertPermission(caller, 'support.view');
      const { to, subject, html, text, companyId, body, cc, bcc, emailId, attachments } = req.body as {
        to: string; subject: string; html?: string; text?: string; companyId?: string;
        body?: string; cc?: string; bcc?: string; emailId?: string;
        attachments?: Array<{ filename: string; content: string; contentType?: string }>;
      };
      // The web client sends the HTML under `body`; accept `html` too (parity).
      const content = html ?? body;
      if (!to || !subject || !content) throw new ApiError('bad-request', 'to, subject, html required');

      // Decode any client-uploaded attachments (base64) into Buffers for the MIME
      // Raw send. Guard total size so we stay under the API Gateway 10 MB payload
      // cap (base64 inflates ~33%) and SES's per-message limits.
      let decodedAttachments: EmailAttachment[] | undefined;
      if (Array.isArray(attachments) && attachments.length > 0) {
        const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB across all attachments
        let total = 0;
        decodedAttachments = attachments.map((att) => {
          const buf = Buffer.from(String(att.content ?? ''), 'base64');
          total += buf.length;
          return { filename: String(att.filename ?? 'attachment'), content: buf, contentType: att.contentType };
        });
        if (total > MAX_TOTAL_BYTES) throw new ApiError('bad-request', 'Attachments exceed the 5 MB total limit');
      }

      return sendEmailCentral({ to, subject, html: content, text, cc: cc ? [cc] : undefined, bcc: bcc ? [bcc] : undefined, emailId, attachments: decodedAttachments, companyId: companyId ?? caller.companyId, type: 'manual', triggeredBy: caller.uid });
    },
  },

  {
    method: 'GET',
    path: '/api/email/logs',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin']);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const logs = await queryEntities<Record<string, unknown>>({
        entity: 'emailLog',
        companyId: caller.role === 'master-admin' ? 'global' : caller.companyId,
        global: caller.role === 'master-admin',
        orderBy: { field: 'createdAt', desc: true },
        limit,
      });
      return { logs };
    },
  },

  {
    method: 'POST',
    path: '/api/email/logs/:id/retry',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin']);
      const logs = await queryEntities<Record<string, unknown>>({
        entity: 'emailLog', companyId: 'global', filters: { id: req.params.id }, limit: 1,
      }).catch(() => [] as Record<string, unknown>[]);
      let log = logs[0];
      if (!log) {
        const all = await queryEntities<Record<string, unknown>>({ entity: 'emailLog', companyId: caller.companyId, filters: { id: req.params.id }, limit: 1 });
        log = all[0];
      }
      if (!log) throw new ApiError('not-found', 'Log not found');
      const to = ([] as string[]).concat(log.to as string[]);
      const res = await sendEmailCentral({
        companyId: String(log.companyId), to,
        subject: String(log.subject), html: String((log.payload as Record<string, string>)?.html ?? '(retries require stored payload)'),
        force: true, triggeredBy: caller.uid,
      });
      await patchEntity('emailLog', String(log.companyId), String(log.id), { attempts: Number(log.attempts ?? 1) + 1, lastRetryAt: new Date().toISOString(), lastRetriedBy: caller.uid }, { entity: 'emailLog' });
      return res;
    },
  },
];
