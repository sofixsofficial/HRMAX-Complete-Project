"use strict";
/**
 * CENTRAL EMAIL SERVICE
 * =====================
 * Single source of truth for ALL application emails.
 *
 * Every email in the system (registration, OTP, password reset, invites,
 * leave, attendance, payroll, approvals, alerts, manual campaigns and any
 * future email) MUST go through `sendEmailCentral`.
 *
 * Config resolution order:
 *   1. Firestore  -> mail_config/global   (managed from Dashboard)
 *   2. Company    -> companies/{id}.settings.smtp (legacy per-company override)
 *   3. Env        -> functions.config().smtp.*     (production secrets fallback)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryEmailLog = exports.listEmailLogs = exports.sendEmailSystemTest = exports.testEmailSystemConnection = exports.saveEmailSystemConfig = exports.getEmailSystemConfig = void 0;
exports.describeSmtpError = describeSmtpError;
exports.resolveEmailConfig = resolveEmailConfig;
exports.createTransporter = createTransporter;
exports.verifySmtp = verifySmtp;
exports.sendEmailCentral = sendEmailCentral;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const crypto = __importStar(require("crypto"));
const DEDUP_WINDOW_MS = 60 * 1000; // 1 minute
const MAIL_CONFIG_DOC = 'mail_config/global';
const lazyDb = () => admin.firestore();
// ============================================
// FRIENDLY ERROR MESSAGES (no more silent failures)
// ============================================
function describeSmtpError(err) {
    const code = err?.code || '';
    const msg = err?.message || String(err);
    if (code === 'EAUTH')
        return `SMTP authentication failed (${msg}). Check username/password.`;
    if (code === 'ESOCKET' || code === 'ECONNECTION')
        return `Could not connect to SMTP server (${msg}). Check host/port/encryption.`;
    if (code === 'ETIMEDOUT' || code === 'ETIMEDOUTSOCKET')
        return `Connection timed out (${msg}). Check host/port and firewall rules.`;
    if (code === 'EDNS')
        return `DNS lookup failed for the SMTP host (${msg}).`;
    if (code === 'EMESSAGE')
        return `Message rejected by server (${msg}).`;
    if (code === 'EENVELOPE')
        return `Invalid recipient address (${msg}).`;
    if (/self[- ]signed|certificate/i.test(msg))
        return `TLS certificate error (${msg}). Enable "Accept self-signed certificates" or use a valid certificate.`;
    return msg;
}
// ============================================
// CONFIG RESOLUTION
// ============================================
function normalizePort(port) {
    const p = parseInt(String(port ?? '587'), 10);
    return Number.isFinite(p) && p > 0 ? p : 587;
}
function normalizeEncryption(enc, port) {
    if (enc === 'ssl' || enc === 'tls' || enc === 'none')
        return enc;
    // Infer from port when not specified
    if (port === 465)
        return 'ssl';
    if (port === 25)
        return 'none';
    return 'tls';
}
function sanitizeConfig(raw) {
    if (!raw || !raw.host || !raw.user || !raw.pass)
        return null;
    const port = normalizePort(raw.port);
    return {
        enabled: raw.enabled !== false,
        host: String(raw.host).trim(),
        port,
        encryption: normalizeEncryption(raw.encryption, port),
        user: String(raw.user).trim(),
        pass: String(raw.pass),
        fromName: String(raw.fromName || raw.from || raw.user || 'HR MAX').trim(),
        fromEmail: String(raw.fromEmail || raw.from || raw.user).trim(),
        replyTo: raw.replyTo ? String(raw.replyTo).trim() : undefined,
        rejectUnauthorized: raw.rejectUnauthorized === true,
    };
}
async function getDashboardConfig() {
    try {
        const snap = await lazyDb().doc(MAIL_CONFIG_DOC).get();
        if (!snap.exists)
            return null;
        return sanitizeConfig(snap.data());
    }
    catch {
        return null;
    }
}
async function getCompanyConfig(companyId) {
    if (!companyId)
        return null;
    try {
        const snap = await lazyDb().collection('companies').doc(companyId).get();
        const data = snap.data();
        if (!data?.settings?.smtp)
            return null;
        return sanitizeConfig({ ...data.settings.smtp, fromName: data.settings.smtp.fromName || `${data.name || 'HR MAX'}` });
    }
    catch {
        return null;
    }
}
function getEnvConfig() {
    const cfg = functions.config();
    if (!cfg.smtp?.host || !cfg.smtp?.user || !cfg.smtp?.pass)
        return null;
    return sanitizeConfig({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        user: cfg.smtp.user,
        pass: cfg.smtp.pass,
        fromName: cfg.smtp.fromName || cfg.smtp.fromname,
        fromEmail: cfg.smtp.from,
        replyTo: cfg.smtp.replyTo,
        encryption: cfg.smtp.encryption,
    });
}
/** Resolve the active SMTP configuration (Dashboard -> Company -> Env). */
async function resolveEmailConfig(companyId) {
    const dashboard = await getDashboardConfig();
    if (dashboard)
        return { source: 'dashboard', config: dashboard };
    const company = await getCompanyConfig(companyId);
    if (company)
        return { source: 'company', config: company };
    const env = getEnvConfig();
    if (env)
        return { source: 'env', config: env };
    return { source: 'none', config: null };
}
// ============================================
// TRANSPORTER
// ============================================
function createTransporter(cfg) {
    const useSsl = cfg.encryption === 'ssl' || cfg.port === 465;
    return nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: useSsl,
        // STARTTLS for 587; plain only when explicitly 'none'
        ignoreTLS: cfg.encryption === 'none',
        requireTLS: cfg.encryption === 'tls',
        auth: { user: cfg.user, pass: cfg.pass },
        tls: { rejectUnauthorized: cfg.rejectUnauthorized !== true ? false : true },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
    });
}
async function verifySmtp(cfg) {
    const transporter = createTransporter(cfg);
    await transporter.verify();
}
// ============================================
// DEDUP HELPERS
// ============================================
function computeDedupKey(opts) {
    if (opts.dedupKey)
        return opts.dedupKey;
    const to = Array.isArray(opts.to) ? [...opts.to].sort().join(',') : opts.to;
    return crypto
        .createHash('sha256')
        .update(`${opts.companyId || ''}|${to}|${opts.subject}|${opts.html.slice(0, 512)}`)
        .digest('hex');
}
async function findRecentDuplicate(dedupKey) {
    try {
        const since = new Date(Date.now() - DEDUP_WINDOW_MS);
        const snap = await lazyDb()
            .collection('email_logs')
            .where('dedupKey', '==', dedupKey)
            .where('status', '==', 'success')
            .where('createdAt', '>=', since)
            .limit(1)
            .get();
        return !snap.empty;
    }
    catch {
        return false; // never block sending because of dedup infra failure
    }
}
// ============================================
// THE ONE EMAIL FUNCTION
// ============================================
async function sendEmailCentral(opts) {
    const dbRef = lazyDb();
    const toArray = Array.isArray(opts.to) ? opts.to : [opts.to];
    // Firestore rejects undefined values — normalize optional recipients.
    const cc = opts.cc ?? '';
    const bcc = opts.bcc ?? '';
    const text = opts.text || '';
    const type = opts.type || 'system';
    const dedupKey = computeDedupKey(opts);
    const logRef = dbRef.collection('email_logs').doc();
    const writeLog = (data) => logRef.set({
        dedupKey,
        type,
        companyId: opts.companyId || '',
        triggeredBy: opts.triggeredBy || 'system',
        linkedEmailId: opts.emailId || '',
        attempts: 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...data,
    });
    // 0. Dedup guard
    if (!opts.force && (await findRecentDuplicate(dedupKey))) {
        await writeLog({ to: toArray, subject: opts.subject, status: 'skipped-duplicate', error: 'Duplicate suppressed (same email sent moments ago)' });
        return { success: true, delivered: false, skipped: 'duplicate', logId: logRef.id };
    }
    // 1. Resolve config
    const resolved = await resolveEmailConfig(opts.companyId);
    const cfg = resolved.config;
    if (!cfg) {
        const err = 'No SMTP configured. Set up SMTP in Dashboard > Email System.';
        await writeLog({ to: toArray, subject: opts.subject, status: 'failed', error: err, configSource: 'none' });
        console.error('[central-email]', err);
        return { success: false, delivered: false, skipped: 'no-config', error: err, logId: logRef.id };
    }
    if (!cfg.enabled) {
        await writeLog({ to: toArray, subject: opts.subject, status: 'disabled', error: 'Email service is disabled in Dashboard', configSource: resolved.source });
        return { success: true, delivered: false, skipped: 'disabled', logId: logRef.id };
    }
    // 2. Send
    try {
        const transporter = createTransporter(cfg);
        const info = await transporter.sendMail({
            from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
            to: toArray.join(', '),
            cc,
            bcc,
            replyTo: opts.replyTo || cfg.replyTo || undefined,
            subject: opts.subject,
            html: opts.html,
            text,
            ...(opts.attachments && opts.attachments.length ? { attachments: opts.attachments } : {}),
        });
        await writeLog({
            to: toArray,
            cc,
            bcc,
            subject: opts.subject,
            status: 'success',
            messageId: info.messageId,
            response: info.response,
            configSource: resolved.source,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Keep legacy EmailCenter doc in sync
        // NOTE: the frontend Email type expects ISO date STRINGS (it calls .startsWith),
        // so never write Firestore Timestamps into the legacy collection.
        if (opts.emailId) {
            const nowIso = new Date().toISOString();
            await dbRef.collection('emails').doc(opts.emailId).update({
                status: 'Sent',
                sentAt: nowIso,
                deliveredAt: nowIso,
                messageId: info.messageId,
                updatedAt: nowIso,
            }).catch(() => { });
        }
        return { success: true, delivered: true, messageId: info.messageId, logId: logRef.id };
    }
    catch (err) {
        const friendly = describeSmtpError(err);
        console.error('[central-email] send failed:', friendly);
        await writeLog({
            to: toArray,
            cc,
            bcc,
            subject: opts.subject,
            status: 'failed',
            error: friendly,
            errorCode: err?.code || '',
            configSource: resolved.source,
            payload: { to: toArray, cc, bcc, subject: opts.subject, html: opts.html, text },
        });
        if (opts.emailId) {
            await dbRef.collection('emails').doc(opts.emailId).update({
                status: 'Failed',
                error: friendly,
                updatedAt: new Date().toISOString(),
            }).catch(() => { });
        }
        return { success: false, delivered: false, error: friendly, logId: logRef.id };
    }
}
// ============================================
// ADMIN CALLABLES (Dashboard)
// ============================================
const isManagement = (role) => ['master-admin', 'company-admin'].includes(role);
const assertAdmin = (context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    const role = context.auth.token.role;
    if (!isManagement(role))
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    return context.auth;
};
const assertMasterAdmin = (context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    if (context.auth.token.role !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Master admin access required');
    }
    return context.auth;
};
/** Get current central SMTP config (password masked). */
exports.getEmailSystemConfig = functions.https.onCall(async (_data, context) => {
    assertAdmin(context);
    const dashboard = await getDashboardConfig();
    const env = getEnvConfig();
    return {
        dashboard: dashboard ? { ...dashboard, pass: '', hasPassword: true } : null,
        envFallback: env ? { host: env.host, port: env.port, user: env.user } : null,
    };
});
/** Save central SMTP config from Dashboard. Validates by connecting before saving. */
exports.saveEmailSystemConfig = functions.https.onCall(async (data, context) => {
    assertMasterAdmin(context);
    const incoming = sanitizeConfig(data?.config);
    if (!incoming) {
        throw new functions.https.HttpsError('invalid-argument', 'Host, Port, Username and Password are required.');
    }
    // If password left blank on edit, keep existing stored password
    if (!data.config.pass && data.keepExistingPassword) {
        const existing = await getDashboardConfig();
        if (existing)
            incoming.pass = existing.pass;
    }
    if (!incoming.pass) {
        throw new functions.https.HttpsError('invalid-argument', 'Password is required.');
    }
    // Validate configuration before saving (unless explicitly disabled)
    if (data.validate !== false) {
        try {
            await verifySmtp(incoming);
        }
        catch (err) {
            throw new functions.https.HttpsError('failed-precondition', `SMTP validation failed: ${describeSmtpError(err)}`);
        }
    }
    await lazyDb().doc(MAIL_CONFIG_DOC).set({
        ...incoming,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: context.auth.token.email || context.auth.uid,
    }, { merge: true });
    await lazyDb().collection('audit_logs').add({
        userId: context.auth.uid,
        userName: context.auth.token.name || '',
        userRole: context.auth.token.role || '',
        action: 'EMAIL_CONFIG_UPDATED',
        entity: 'mail_config',
        description: `Updated central SMTP settings (${incoming.host}:${incoming.port})`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => { });
    return { success: true, validated: data.validate !== false };
});
/** Test SMTP connection using either saved config or unsaved form values. */
exports.testEmailSystemConnection = functions.https.onCall(async (data, context) => {
    assertAdmin(context);
    let cfg = null;
    if (data?.config) {
        cfg = sanitizeConfig(data.config);
        if (cfg && !cfg.pass && data.keepExistingPassword) {
            const existing = await getDashboardConfig();
            if (existing)
                cfg.pass = existing.pass;
        }
    }
    else {
        cfg = (await resolveEmailConfig()).config;
    }
    if (!cfg) {
        return { success: false, error: 'No SMTP configuration found. Configure SMTP first.' };
    }
    try {
        await verifySmtp(cfg);
        return { success: true, message: `Connected to ${cfg.host}:${cfg.port} successfully.` };
    }
    catch (err) {
        return { success: false, error: describeSmtpError(err) };
    }
});
/** Send a test email through the central service. */
exports.sendEmailSystemTest = functions.https.onCall(async (data, context) => {
    const auth = assertAdmin(context);
    const to = String(data?.to || '').trim();
    if (!to)
        throw new functions.https.HttpsError('invalid-argument', 'Recipient email required');
    const result = await sendEmailCentral({
        to,
        subject: 'HR MAX — Test Email',
        type: 'test',
        triggeredBy: auth.uid,
        force: true, // tests should always send
        html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
        <div style="background:#f97316;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Test Email</h2>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
          <p>Your centralized SMTP configuration is working correctly.</p>
          <p style="color:#6b7280;font-size:13px;">Sent at ${new Date().toISOString()} via the HR MAX central email service.</p>
        </div>
      </div>`,
    });
    if (!result.success) {
        throw new functions.https.HttpsError('internal', result.error || 'Failed to send test email');
    }
    if (result.skipped === 'disabled') {
        throw new functions.https.HttpsError('failed-precondition', 'Email service is disabled. Enable it in Email System settings.');
    }
    return result;
});
/** List email logs for the Dashboard (newest first). */
exports.listEmailLogs = functions.https.onCall(async (data, context) => {
    assertAdmin(context);
    const limit = Math.min(Number(data?.limit) || 50, 200);
    const statusFilter = data?.status || undefined;
    let q = lazyDb().collection('email_logs');
    if (statusFilter && statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
    }
    const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
    return {
        logs: snap.docs.map((d) => {
            const data = d.data();
            // Never expose stored payloads to the client list view
            const { payload, ...rest } = data;
            return { id: d.id, ...rest };
        }),
    };
});
/** Retry a failed email using its stored payload. */
exports.retryEmailLog = functions.https.onCall(async (data, context) => {
    const auth = assertAdmin(context);
    const logId = String(data?.logId || '');
    if (!logId)
        throw new functions.https.HttpsError('invalid-argument', 'logId required');
    const logSnap = await lazyDb().collection('email_logs').doc(logId).get();
    if (!logSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Email log not found');
    const log = logSnap.data();
    if (!log?.payload?.subject) {
        throw new functions.https.HttpsError('failed-precondition', 'No stored payload for this log entry — cannot retry automatically.');
    }
    const result = await sendEmailCentral({
        companyId: log.companyId,
        to: log.payload.to,
        cc: log.payload.cc,
        bcc: log.payload.bcc,
        subject: log.payload.subject,
        html: log.payload.html,
        text: log.payload.text,
        type: log.type,
        triggeredBy: auth.uid,
        force: true,
    });
    await logSnap.ref.update({
        attempts: (log.attempts || 1) + 1,
        lastRetryAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRetriedBy: auth.uid,
        ...(result.success ? { status: 'success', sentAt: admin.firestore.FieldValue.serverTimestamp(), error: '' } : { error: result.error }),
    }).catch(() => { });
    if (!result.success) {
        throw new functions.https.HttpsError('internal', result.error || 'Retry failed');
    }
    return result;
});
//# sourceMappingURL=emailService.js.map