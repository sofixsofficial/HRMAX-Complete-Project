/**
 * Central email service — Amazon SES (replaces nodemailer/SMTP).
 * Config lives in SSM Parameter Store (/hrmax/email-config), editable from
 * the dashboard's Email System page. Logging goes to the email_logs table.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createHash } from 'node:crypto';
import { putEntity, queryEntities } from './db.js';
import { newId, type BaseEntity } from './types.js';

const ses = new SESv2Client({});

export interface EmailConfig {
  enabled: boolean;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  configurationSet?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailOptions {
  companyId?: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  type?: string;
  dedupKey?: string;
  triggeredBy?: string;
  emailId?: string;
  force?: boolean;
}

export interface EmailLogDoc extends BaseEntity {
  id: string;
  companyId: string;
  dedupKey: string;
  type?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  status: 'success' | 'failed' | 'skipped-duplicate';
  messageId?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  sentAt?: string;
  /** Stored send payload so failed entries can be retried verbatim (parity with the original email_logs). */
  payload?: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    text?: string;
  };
}

// Config resolution is env + optional per-deployment override; SES is the
// transport regardless (no per-tenant SMTP in the AWS architecture).
export async function getEmailConfig(): Promise<EmailConfig> {
  return {
    enabled: process.env.EMAIL_ENABLED !== 'false',
    fromEmail: process.env.EMAIL_FROM ?? 'info@hrmax.in',
    fromName: process.env.EMAIL_FROM_NAME ?? 'HR MAX',
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    configurationSet: process.env.EMAIL_CONFIG_SET || undefined,
  };
}

function dedupHash(opts: SendEmailOptions): string {
  const to = ([] as string[]).concat(opts.to).sort().join(',');
  return createHash('sha256')
    .update(`${opts.companyId ?? ''}|${to}|${opts.subject}|${opts.html.slice(0, 512)}`)
    .digest('hex');
}

/**
 * Send an email through SES with 60-second dedup + logging (parity with the
 * original sendEmailCentral contract).
 */
export async function sendEmailCentral(opts: SendEmailOptions): Promise<{
  success: boolean;
  delivered?: boolean;
  logId?: string;
  messageId?: string;
  skipped?: 'duplicate' | 'disabled';
  error?: string;
}> {
  const config = await getEmailConfig();
  const dedupKey = opts.dedupKey ?? dedupHash(opts);
  const logId = newId();

  if (!config.enabled && !opts.force) {
    await logEmail({ ...opts, logId, dedupKey, status: 'failed', error: 'Email disabled in config' });
    return { success: false, skipped: 'disabled', logId, error: 'Email disabled' };
  }

  // dedup: same key succeeded within 60s → skip
  if (!opts.force) {
    const recent = await queryEntities<EmailLogDoc>({
      entity: 'emailLog',
      companyId: opts.companyId ?? 'global',
      filters: { dedupKey, status: 'success' },
      limit: 5,
    });
    const cutoff = Date.now() - 60_000;
    if (recent.some((l) => l.sentAt && new Date(l.sentAt).getTime() > cutoff)) {
      return { success: true, skipped: 'duplicate', logId };
    }
  }

  try {
    const toList = ([] as string[]).concat(opts.to);
    let messageId: string | undefined;

    if (opts.attachments?.length) {
      // Raw message with MIME attachments (payslips)
      const boundary = `----hrmax-${logId}`;
      const headers = [
        `From: ${config.fromName} <${config.fromEmail}>`,
        `To: ${toList.join(', ')}`,
        ...(opts.cc?.length ? [`Cc: ${opts.cc.join(', ')}`] : []),
        `Subject: ${opts.subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ];
      const parts: string[] = [];
      parts.push(`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${opts.text ?? ''}`);
      parts.push(`--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${opts.html}`);
      for (const att of opts.attachments ?? []) {
        const b64 = Buffer.isBuffer(att.content) ? att.content.toString('base64') : Buffer.from(att.content).toString('base64');
        parts.push(
          `--${boundary}\r\nContent-Type: ${att.contentType ?? 'application/octet-stream'}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${att.filename}"\r\n\r\n${b64}`,
        );
      }
      parts.push(`--${boundary}--`);
      const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, 'utf8');

      const res = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `${config.fromName} <${config.fromEmail}>`,
          Destination: {
            ToAddresses: toList,
            ...(opts.cc?.length ? { CcAddresses: opts.cc } : {}),
            ...(opts.bcc?.length ? { BccAddresses: opts.bcc } : {}),
          },
          Content: { Raw: { Data: raw } },
          ...(config.configurationSet ? { ConfigurationSetName: config.configurationSet } : {}),
        }),
      );
      messageId = res.MessageId;
    } else {
      const res = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `${config.fromName} <${config.fromEmail}>`,
          Destination: {
            ToAddresses: toList,
            ...(opts.cc?.length ? { CcAddresses: opts.cc } : {}),
            ...(opts.bcc?.length ? { BccAddresses: opts.bcc } : {}),
          },
          ReplyToAddresses: opts.replyTo || config.replyTo ? [opts.replyTo ?? config.replyTo!] : undefined,
          Content: {
            Simple: {
              Subject: { Data: opts.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: opts.html, Charset: 'UTF-8' },
                ...(opts.text ? { Text: { Data: opts.text, Charset: 'UTF-8' } } : {}),
              },
            },
          },
          ...(config.configurationSet ? { ConfigurationSetName: config.configurationSet } : {}),
        }),
      );
      messageId = res.MessageId;
    }

    await logEmail({ ...opts, logId, dedupKey, status: 'success', messageId });
    return { success: true, delivered: true, logId, messageId };
  } catch (err) {
    const message = (err as Error).message;
    await logEmail({ ...opts, logId, dedupKey, status: 'failed', error: message });
    return { success: false, logId, error: message };
  }
}

async function logEmail(
  opts: SendEmailOptions & { logId: string; dedupKey: string; status: 'success' | 'failed'; messageId?: string; error?: string },
): Promise<void> {
  await putEntity<EmailLogDoc>(
    {
      id: opts.logId,
      companyId: opts.companyId ?? 'global',
      dedupKey: opts.dedupKey,
      type: opts.type,
      to: ([] as string[]).concat(opts.to),
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      status: opts.status,
      messageId: opts.messageId,
      error: opts.error,
      payload: {
        to: ([] as string[]).concat(opts.to),
        cc: opts.cc,
        bcc: opts.bcc,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      },
      attempts: 1,
      createdAt: new Date().toISOString(),
      sentAt: opts.status === 'success' ? new Date().toISOString() : undefined,
    },
    { entity: 'emailLog' },
  );
}

// ---------------------------------------------------------------------------
// Templates (parity with the original inline-HTML templates, HRMAX brand)
// ---------------------------------------------------------------------------

const brand = (title: string, bodyHtml: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background:#FF6600;padding:24px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px">HR MAX</h1>
  </div>
  <div style="padding:28px;color:#333;font-size:14px;line-height:1.6">
    <h2 style="color:#111;margin-top:0">${title}</h2>
    ${bodyHtml}
  </div>
  <div style="padding:16px 28px;color:#999;font-size:11px;border-top:1px solid #eee">
    This is a system-generated email from HR MAX by Sofixs. Please do not reply to this message.
  </div>
</div>`;

export const templates = {
  invitation: (name: string, inviteLink: string, inviterName: string) => ({
    subject: 'You are invited to join HR MAX',
    html: brand(
      `Hello ${name},`,
      `<p><b>${inviterName}</b> has invited you to join their team on <b>HR MAX</b>.</p>
       <p style="text-align:center;margin:28px 0">
         <a href="${inviteLink}" style="background:#FF6600;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Accept Invitation</a>
       </p>
       <p>This invitation expires in 7 days. If the button doesn't work, copy this link:<br>
       <span style="color:#888;word-break:break-all">${inviteLink}</span></p>`,
    ),
  }),

  resetCode: (code: string) => ({
    subject: 'Your Password Reset Code',
    html: brand(
      'Password Reset',
      `<p>Use the following code to reset your password (valid for 10 minutes):</p>
       <p style="text-align:center;margin:24px 0">
         <span style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#FF6600">${code}</span>
       </p>
       <p>If you didn't request this, you can safely ignore this email.</p>`,
    ),
  }),

  welcome: (name: string, tempPassword: string) => ({
    subject: 'Welcome to HR MAX — your login credentials',
    html: brand(
      `Welcome, ${name}!`,
      `<p>Your account has been created.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;border:1px solid #eee;color:#777">Temporary password</td>
             <td style="padding:8px;border:1px solid #eee;font-weight:bold">${tempPassword}</td></tr>
       </table>
       <p>You will be asked to change this password on first sign-in.</p>`,
    ),
  }),

  payslip: (employeeName: string, monthName: string, year: number, netSalary: number, version?: number) => ({
    subject: `Your salary slip for ${monthName} ${year}`,
    html: brand(
      `Hello ${employeeName},`,
      `<p>Please find attached your salary slip for <b>${monthName} ${year}</b>${version ? ` (corrected version ${version})` : ''}.</p>
       <p style="font-size:18px;font-weight:bold;color:#111">Net Pay: ₹ ${netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
       <p>This is a confidential document. Please do not share it with anyone.</p>`,
    ),
  }),

  broadcast: (title: string, message: string) => ({
    subject: title,
    html: brand(title, `<p>${message.replace(/\n/g, '<br>')}</p>`),
  }),
};
