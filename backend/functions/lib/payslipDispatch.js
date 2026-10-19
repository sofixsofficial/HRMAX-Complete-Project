"use strict";
/**
 * PAYSLIP EMAIL DISPATCH (server-side)
 * ====================================
 * Generates a salary-slip PDF for each paid salary slip and dispatches it
 * securely and INDIVIDUALLY to the employee, CC-ing that employee's Company
 * Admin(s) only (no shared recipient lists, no cross-slip leakage).
 *
 * Also provides:
 *   - regeneratePayslip  — correction flow (5 WORKING-days window). A corrected
 *     slip is saved as a NEW version (superseding the previous version, which
 *     is retained for audit), a fresh PDF is generated and emailed only to that
 *     employee + their Company Admin. After the window the run is locked;
 *     only a Master Admin may override with a mandatory reason.
 *   - retryFailedPayslipEmails — re-send only slips whose last dispatch failed.
 *
 * Correction-closing uses WORKING DAYS (weekends + company holidays), mirroring
 * the frontend workingDays util.
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
exports.retryFailedPayslipEmails = exports.regeneratePayslip = exports.dispatchPayslips = void 0;
exports.emailBodyEmployee = emailBodyEmployee;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const emailService_1 = require("./emailService");
const payslipPdf_1 = require("./payslipPdf");
const workingDays_1 = require("./workingDays");
const db = () => admin.firestore();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
async function getCompanyContext(companyId) {
    const company = await getCompanyOptions(companyId);
    let weekendDays = [0, 6];
    let holidayKeys = [];
    try {
        const snap = await db().collection('companies').doc(companyId).get();
        if (snap.exists) {
            const c = snap.data() || {};
            weekendDays = (0, workingDays_1.parseWeekendDays)(c.payrollSettings?.weekends);
        }
    }
    catch { /* defaults */ }
    try {
        const holSnap = await db().collection('holidays').where('companyId', '==', companyId).get();
        holidayKeys = holSnap.docs.map((d) => (0, workingDays_1.toDateKey)(new Date(d.data().date))).filter(Boolean);
    }
    catch { /* no holidays */ }
    return { company, weekendDays, holidayKeys };
}
async function loadCompanySlips(companyId, monthIndex, year) {
    const snap = await db().collection('salarySlips').where('companyId', '==', companyId).get();
    let docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    if (typeof monthIndex === 'number' && typeof year === 'number') {
        const monthName = MONTHS[monthIndex];
        docs = docs.filter((d) => d.data.month === monthName && d.data.year === year);
    }
    return docs;
}
async function getCompanyAdminEmails(companyId) {
    const emails = [];
    const caSnap = await db().collection('users')
        .where('companyId', '==', companyId)
        .where('role', '==', 'company-admin')
        .get();
    caSnap.forEach((d) => {
        const u = d.data();
        if (u && u.email)
            emails.push(String(u.email));
    });
    try {
        const compSnap = await db().collection('companies').doc(companyId).get();
        if (compSnap.exists) {
            const c = compSnap.data();
            if (c && c.adminEmail && !emails.includes(String(c.adminEmail)))
                emails.push(String(c.adminEmail));
            if (c && c.adminId) {
                const adminUser = await db().collection('users').doc(String(c.adminId)).get();
                if (adminUser.exists && adminUser.data()?.email && !emails.includes(String(adminUser.data().email))) {
                    emails.push(String(adminUser.data().email));
                }
            }
        }
    }
    catch { /* ignore lookup errors */ }
    return emails;
}
async function getCompanyOptions(companyId) {
    try {
        const snap = await db().collection('companies').doc(companyId).get();
        if (!snap.exists)
            return {};
        const c = snap.data() || {};
        return {
            companyName: c.name,
            companyAddress: c.address,
            companyCity: c.city,
            companyState: c.state,
            companyZip: c.zipCode,
            companyCountry: c.country,
            companyLogo: c.logoUrl,
            companyCurrency: c.currency || 'INR',
        };
    }
    catch {
        return { companyCurrency: 'INR' };
    }
}
function slipToPayslipData(slip, company) {
    const breakdown = slip.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 };
    const payroll = slip.payroll || {};
    const createdAt = slip.createdAt?.toDate ? slip.createdAt.toDate() : (slip.createdAt || new Date());
    return {
        companyName: company.companyName,
        companyAddress: company.companyAddress,
        companyCity: company.companyCity,
        companyState: company.companyState,
        companyZip: company.companyZip,
        companyCountry: company.companyCountry,
        companyLogo: company.companyLogo,
        companyCurrency: company.companyCurrency,
        employeeName: slip.employeeName || 'Employee',
        employeeId: slip.employeeId,
        department: slip.department,
        designation: slip.designation,
        dateOfJoining: slip.dateOfJoining,
        month: slip.month || MONTHS[createdAt.getMonth()],
        year: slip.year || createdAt.getFullYear(),
        payDate: slip.paidOn?.toDate ? slip.paidOn.toDate().toISOString() : (slip.paidOn || null),
        basicSalary: slip.basicSalary || 0,
        allowances: slip.allowances || 0,
        deductions: slip.deductions || 0,
        netSalary: slip.netSalary || 0,
        breakdown,
        payrollRef: slip.payrollRef,
        version: slip.version,
        workingDays: payroll.workingDays ?? slip.workingDays,
        presentDays: payroll.presentDays,
        paidDays: payroll.paidLeaveDays ?? slip.paidDays,
        halfDays: payroll.halfDays,
        unpaidLeaveDays: payroll.unpaidLeaveDays,
        holidayDays: payroll.holidayDays,
        absentDays: payroll.absentDays,
        overtimeHours: payroll.overtimeHours,
        lopDays: payroll.unpaidLeaveDays ?? slip.lopDays,
    };
}
// ---- Email body (simple, email-safe, always consistent) ----
// Deliberately separate from the attached PDF. Uses only inline styles, so it
// renders identically in Gmail, Outlook, Apple Mail and Yahoo.
const escHtml = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const emailMoney = (n) => {
    const f = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
    return `\u20B9 ${f.format(n || 0)}`;
};
function emailBodyEmployee(slip, company) {
    const net = slip.netSalary || 0;
    const corrected = slip.version && slip.version > 1;
    const emp = escHtml(slip.employeeName || 'Employee');
    const payPeriod = `${slip.month || ''} ${slip.year || ''}`.trim();
    const versionTag = slip.version && slip.version > 1 ? ` (v${slip.version})` : '';
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#374151;line-height:1.6">
      <div style="font-size:18px;font-weight:bold;color:#ff6b00;margin:0 0 16px 0;">Digital HR</div>
      ${corrected ? `<p style="margin:0 0 12px 0;">A <strong>corrected/regenerated salary slip</strong> has been issued for the month below.</p>` : ''}
      <p style="margin:0 0 12px 0;">Dear <strong>${emp}</strong>,</p>
      <p style="margin:0 0 12px 0;">Please find attached your salary slip for <strong>${payPeriod}</strong>${versionTag}.</p>
      <p style="margin:0 0 12px 0;">Your net pay for this period is <strong style="color:#ea580c;">${emailMoney(net)}</strong>.</p>
      <p style="font-size:11px;color:#777777;margin:20px 0 0 0;">This email is confidential and intended solely for the recipient (and your Company Admin in copy).</p>
    </div>`;
}
async function dispatchSingleSlip(slip, ctx, options) {
    const s = slip.data;
    if (!s.employeeEmail)
        return 'no-email';
    const company = ctx.company;
    const slipSubj = `Salary Slip for ${s.month || ''} ${s.year || ''}${s.version && s.version > 1 ? ' (Corrected v' + s.version + ')' : ''}${company.companyName ? ' - ' + company.companyName : ''}`;
    try {
        if (!s.designation || !s.dateOfJoining) {
            try {
                const empSnap = await db()
                    .collection('employees')
                    .where('companyId', '==', s.companyId)
                    .where('userId', '==', s.userId)
                    .limit(1)
                    .get();
                const emp = empSnap.docs[0]?.data?.();
                if (emp) {
                    if (!s.designation && emp.designation)
                        s.designation = String(emp.designation);
                    if (!s.dateOfJoining && (emp.joinDate || emp.joiningDate))
                        s.dateOfJoining = emp.joinDate || emp.joiningDate;
                    if (s.designation || s.dateOfJoining) {
                        await db()
                            .collection('salarySlips')
                            .doc(slip.id)
                            .set({ designation: s.designation || '', dateOfJoining: s.dateOfJoining || '' }, { merge: true })
                            .catch(() => { });
                    }
                }
            }
            catch {
                // best-effort backfill — old master records may be missing
            }
        }
        const pdf = await (0, payslipPdf_1.generateSalarySlipPdf)(slipToPayslipData(s, company), company);
        const raw = pdf.toString('latin1');
        if (!raw.startsWith('%PDF') || pdf.length < 1000) {
            throw new Error('Generated payslip PDF is invalid (not a PDF or too small) — refusing to send');
        }
        if (!raw.includes('DejaVuSansCondensed')) {
            throw new Error('Generated payslip PDF is missing the embedded Unicode font — refusing to send a broken PDF');
        }
        const nameParts = (s.employeeName || 'Employee').trim().split(/\s+/);
        const capName = nameParts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
        const filename = `payslip-${capName}-${s.month || ''}-${s.year || ''}${s.version && s.version > 1 ? `-v${s.version}` : ''}.pdf`;
        const res = await (0, emailService_1.sendEmailCentral)({
            companyId: s.companyId,
            to: String(s.employeeEmail),
            cc: options?.cc && options.cc.length ? options.cc : '', // CC = that employee's Company Admin(s) only
            bcc: options?.bcc && options.bcc.length ? options.bcc : '',
            subject: slipSubj,
            html: emailBodyEmployee(s, company),
            text: `Dear ${s.employeeName}, please find attached your salary slip for ${s.month} ${s.year}.`,
            attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
            type: 'payroll',
            force: options?.force,
        });
        if (!res.success) {
            await updateSlipEmailState(slip.id, 'failed', res.error, s.status);
            return 'failed';
        }
        if (res.skipped === 'no-config' || res.skipped === 'disabled') {
            await updateSlipEmailState(slip.id, 'failed', res.error || res.skipped || 'Email not configured', s.status);
            return 'failed';
        }
        await updateSlipEmailState(slip.id, 'sent', undefined, s.status);
        // Log into the EmailCenter inbox so the dashboard Mail section shows it,
        // filterable by company + month + year.
        await recordEmailsDoc({
            from: company.companyName || 'HR MAX',
            fromEmail: company.email || 'no-reply@company.com',
            to: s.employeeName || 'Employee',
            toEmail: String(s.employeeEmail),
            cc: options?.cc && options.cc.length ? options.cc.join(', ') : '',
            bcc: options?.bcc && options.bcc.length ? options.bcc.join(', ') : '',
            subject: slipSubj,
            body: `Dear ${s.employeeName}, please find attached your salary slip for ${s.month} ${s.year}.`,
            type: 'Employee',
            status: 'Sent',
            read: false,
            starred: false,
            companyId: s.companyId,
            payrollRunId: s.payrollRunId || '',
            payrollMonth: MONTHS.indexOf(String(s.month || '')),
            payrollYear: s.year || '',
            recipientGroup: 'Individual Employee',
        });
        return 'sent';
    }
    catch (e) {
        console.error('[payslip-dispatch] failed for', s.employeeName, e);
        await updateSlipEmailState(slip.id, 'failed', e?.message || 'Dispatch error', s.status);
        return 'failed';
    }
}
async function updateSlipEmailState(slipId, status, error, prevStatus) {
    const patch = {
        emailStatus: status,
        payslipEmailStatus: status === 'sent' ? 'sent' : 'failed',
    };
    if (status === 'sent') {
        patch.emailSentAt = admin.firestore.FieldValue.serverTimestamp();
        patch.payslipEmailAt = admin.firestore.FieldValue.serverTimestamp();
        patch.emailError = '';
        // WORKFLOW: a successful dispatch promotes the slip's PRIMARY record status
        // (Pending/Processing → Emailed) so the UI badge flips immediately instead
        // of staying "Pending" next to the "Email sent" label. 'Paid' is a stronger
        // terminal state and is intentionally left untouched.
        if (prevStatus && prevStatus !== 'Paid' && prevStatus !== 'Emailed') {
            patch.status = 'Emailed';
        }
    }
    else if (error) {
        patch.emailError = String(error).slice(0, 500);
    }
    await db().collection('salarySlips').doc(slipId).update(patch).catch(() => { });
}
/** Authorize a caller against a company for payroll/slip operations. */
async function assertCompanyAuth(context, companyId, allowExecTl) {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    const callerSnap = await db().collection('users').doc(context.auth.uid).get();
    if (!callerSnap.exists)
        throw new functions.https.HttpsError('permission-denied', 'User not found.');
    const caller = callerSnap.data();
    const role = caller?.role;
    // Executives operate across ALL companies (matches the deployed Firestore
    // rules' unbound isExecutiveForCompany); Team Leaders stay scoped to their
    // own or assigned company. Previously execs were still bound by
    // assignedCompanyIds here, so all-companies execs got 403
    // "Not authorized for this company" on payslip retries.
    const executiveAllCompanies = role === 'executive';
    const tlScoped = role === 'team-leader' &&
        ((Array.isArray(caller?.assignedCompanyIds) && caller.assignedCompanyIds.includes(String(companyId))) ||
            String(caller?.companyId) === String(companyId));
    const authorized = role === 'master-admin' ||
        (role === 'company-admin' && String(caller?.companyId) === String(companyId)) ||
        (allowExecTl && (executiveAllCompanies || tlScoped));
    if (!authorized)
        throw new functions.https.HttpsError('permission-denied', 'Not authorized for this company.');
    return caller;
}
/** Load a payroll run a slip belongs to (if any). */
// Record a dispatched payroll email into the legacy EmailCenter `emails`
// collection so the dashboard Mail section can list + filter it by company,
// month and year after a payroll run. Firestore rejects undefined values.
async function recordEmailsDoc(docData) {
    try {
        await db().collection('emails').add({
            ...docData,
            date: docData.date || new Date().toISOString().split('T')[0],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.error('[payslip-dispatch] email record write failed:', e?.message || e);
    }
}
async function getSlipRun(runId) {
    if (!runId)
        return null;
    try {
        const snap = await db().collection('payrollRuns').doc(String(runId)).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }
    catch {
        return null;
    }
}
// ============================================
// dispatchPayslips — send salary-slip PDFs on disbursement
// ============================================
exports.dispatchPayslips = functions.https.onCall(async (payload, context) => {
    const companyId = payload?.companyId;
    const monthIndex = payload?.monthIndex;
    const year = payload?.year;
    const slipIds = Array.isArray(payload?.slipIds) ? payload.slipIds : [];
    // Send only to the given employees (by user id) — the "email filter" like the
    // Email Center recipient picker. Empty = send to everyone in the selection.
    const employeeIds = Array.isArray(payload?.employeeIds) ? payload.employeeIds : [];
    // Allow dispatching slips that are not yet 'Paid' (e.g. right after a bulk
    // generation). Default = 'Paid' to preserve prior behavior.
    const payStatus = String(payload?.payStatus || 'Paid').toLowerCase();
    if (!companyId)
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
    await assertCompanyAuth(context, String(companyId), true);
    let slips;
    if (slipIds.length) {
        const snap = await db().collection('salarySlips').where('companyId', '==', companyId).get();
        slips = snap.docs.filter((d) => slipIds.includes(d.id)).map((d) => ({ id: d.id, data: d.data() }));
    }
    else {
        slips = await loadCompanySlips(companyId, monthIndex, year);
    }
    slips = slips.filter((s) => (payStatus === 'all' ? true : String(s.data.status || '').toLowerCase() === payStatus));
    if (employeeIds.length) {
        slips = slips.filter((s) => employeeIds.includes(String(s.data.userId || '')));
    }
    if (slips.length === 0) {
        return { success: true, dispatched: 0, failed: 0, message: 'No salary slips found to dispatch for this selection.' };
    }
    const ctx = await getCompanyContext(companyId);
    const adminEmails = await getCompanyAdminEmails(companyId);
    // BCC = the sender (admin) keeps a record copy — never mixed between employees.
    const bcc = Array.isArray(payload?.bcc) ? payload.bcc.map((x) => String(x)).filter(Boolean) : [];
    let dispatched = 0;
    let failed = 0;
    for (const slip of slips) {
        // Individual email to EACH employee — only that one employee's slip, with
        // their Company Admin(s) in CC and the sender in BCC (fully isolated).
        const result = await dispatchSingleSlip(slip, ctx, { force: true, cc: adminEmails.length ? adminEmails : [], bcc });
        if (result === 'failed')
            failed++;
        else if (result === 'sent')
            dispatched++;
    }
    // Full-payroll summary email to the Company Admin(s) + the Company itself:
    // shows the total employee count and one row per employee.
    let summarySent = 0;
    try {
        const companySnap = await db().collection('companies').doc(companyId).get();
        const companyData = companySnap.exists ? companySnap.data() : undefined;
        const companyEmail = companyData?.email ? String(companyData.email) : '';
        const recipients = Array.from(new Set([...adminEmails, ...(companyEmail ? [companyEmail] : [])]));
        if (recipients.length > 0) {
            const cur = '\u20B9';
            const monthLabel = slips[0]?.data?.month || MONTHS[(typeof monthIndex === 'number' ? monthIndex : new Date().getMonth())] || '';
            const slipYear = slips[0]?.data?.year || year || '';
            const totalNet = slips.reduce((s, x) => s + (Number(x.data.netSalary) || 0), 0);
            const rows = slips.map((sl) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${sl.data.employeeName || 'Employee'}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${sl.data.employeeId || '-'}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${sl.data.department || '-'}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${cur} ${Number(sl.data.netSalary || 0).toLocaleString('en-IN')}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${sl.data.payrollRef || '-'}</td>
        </tr>`).join('');
            const res = await (0, emailService_1.sendEmailCentral)({
                companyId,
                to: recipients,
                subject: `[Payroll] ${monthLabel} ${slipYear} - ${ctx.company.companyName || ''} - ${slips.length} salary slips`,
                html: `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#374151;">
            <h2 style="color:#f97316;margin:0 0 6px">${ctx.company.companyName || 'HRMAX'}</h2>
            <p>The <strong>${monthLabel} ${slipYear}</strong> payroll for <strong>${slips.length} employees</strong> (total net <strong style="color:#ea580c">${cur} ${totalNet.toLocaleString('en-IN')}</strong>) has been processed. Every employee has received their own salary slip by email.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <thead>
                <tr>
                  <th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;">Employee</th>
                  <th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;">ID</th>
                  <th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;">Department</th>
                  <th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;">Net</th>
                  <th style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;text-align:left;">Ref</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#9ca3af;font-size:12px">Sent automatically by HR MAX.</p>
          </div>`,
                text: `${monthLabel} ${slipYear} payroll — ${slips.length} employees, total net ${cur} ${totalNet.toLocaleString('en-IN')}.`,
                type: 'payroll',
                force: true,
                dedupKey: `payroll-summary-${companyId}-${monthLabel}-${slipYear}`,
            });
            if (res.success && res.skipped !== 'no-config' && res.skipped !== 'disabled') {
                summarySent = recipients.length;
                // Log the summary into the EmailCenter inbox (filterable by period).
                await recordEmailsDoc({
                    from: ctx.company.companyName || 'HR MAX',
                    fromEmail: companyData?.email || 'no-reply@company.com',
                    to: recipients.join(', '),
                    toEmail: recipients.join(', '),
                    cc: '',
                    bcc: '',
                    subject: `[Payroll] ${monthLabel} ${slipYear} - ${ctx.company.companyName || ''} - ${slips.length} salary slips`,
                    body: `${monthLabel} ${slipYear} payroll — ${slips.length} employees, total net ${cur} ${totalNet.toLocaleString('en-IN')}.`,
                    type: 'Company',
                    status: 'Sent',
                    read: false,
                    starred: false,
                    companyId,
                    payrollRunId: String(payload?.runId || ''),
                    payrollMonth: typeof monthIndex === 'number' ? monthIndex : MONTHS.indexOf(String(slips[0]?.data?.month || '')),
                    payrollYear: slipYear,
                    recipientGroup: 'Company Admin',
                });
            }
        }
    }
    catch (summaryErr) {
        console.error('[payslip-dispatch] summary email failed:', summaryErr?.message || summaryErr);
    }
    const runId = payload?.runId;
    if (runId) {
        await db().collection('payrollRuns').doc(String(runId)).update({
            payslipEmailsDispatched: true,
            payslipEmailCount: dispatched,
            payslipEmailFailed: failed,
            payslipEmailsAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'Emailed',
        }).catch(() => { });
    }
    const summaryText = summarySent > 0
        ? ` Company admin & company received the full payroll summary (${summarySent} recipient${summarySent === 1 ? '' : 's'}).`
        : ' Admin/company summary email unavailable (configure SMTP).';
    return {
        success: true,
        dispatched,
        failed,
        total: slips.length,
        adminCc: adminEmails.length,
        summarySent,
        message: failed > 0 ? `Sent ${dispatched}, ${failed} failed. Use "Retry failed emails".${summaryText}` : `Sent ${dispatched} salary slips.${summaryText}`,
    };
});
// ============================================
// regeneratePayslip — correction within the 5-WORKING-day window
// ============================================
exports.regeneratePayslip = functions.https.onCall(async (payload, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    const slipId = payload?.slipId;
    if (!slipId)
        throw new functions.https.HttpsError('invalid-argument', 'slipId is required.');
    const correctionPayload = payload?.correction || {};
    const overrideReason = String(payload?.overrideReason || '').trim();
    const slipRef = db().collection('salarySlips').doc(String(slipId));
    const slipSnap = await slipRef.get();
    if (!slipSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Salary slip not found.');
    const old = slipSnap.data();
    if (!old)
        throw new functions.https.HttpsError('not-found', 'Salary slip not found.');
    const companyId = old.companyId;
    if (!companyId)
        throw new functions.https.HttpsError('invalid-argument', 'Slip has no company.');
    const caller = await assertCompanyAuth(context, String(companyId), false);
    const role = caller?.role;
    const isMasterAdmin = role === 'master-admin';
    const run = await getSlipRun(old.payrollRunId);
    const runLocked = !!run?.locked;
    // Correction window = 5 WORKING days from slip creation (weekends + company
    // holidays are excluded). After the window the payroll run is LOCKED.
    const ctx = await getCompanyContext(companyId);
    const createdAt = old.createdAt?.toDate ? old.createdAt.toDate() : new Date(old.createdAt || Date.now());
    const withinWindow = (0, workingDays_1.isWithinSlipCorrectionWindow)(createdAt, Date.now(), ctx.weekendDays, ctx.holidayKeys);
    const deadline = (0, workingDays_1.correctionDeadline)(createdAt, workingDays_1.SLIP_CORRECTION_WORKING_DAYS, ctx.weekendDays, ctx.holidayKeys);
    if (!withinWindow || runLocked) {
        if (!isMasterAdmin) {
            throw new functions.https.HttpsError('failed-precondition', runLocked
                ? 'This payroll is locked (correction window closed). Only the Master Admin can override with a reason.'
                : `The ${workingDays_1.SLIP_CORRECTION_WORKING_DAYS}-working-day salary slip correction window has expired (${deadline.toLocaleDateString()}). Only the Master Admin can override with a reason.`);
        }
        if (!overrideReason) {
            throw new functions.https.HttpsError('invalid-argument', 'Correction window expired. A mandatory override reason is required from the Master Admin.');
        }
    }
    // Determine the new slip content: keep original unless a correction payload
    // was provided (edit form within the window).
    const previous = { basicSalary: old.basicSalary || 0, allowances: old.allowances || 0, deductions: old.deductions || 0, netSalary: old.netSalary || 0 };
    let next;
    if (correctionPayload && (payload?.correction?.basicSalary !== undefined)) {
        const basicSalary = Number(correctionPayload.basicSalary) || 0;
        const allowances = Number(correctionPayload.allowances) || 0;
        const deductions = Number(correctionPayload.deductions) || 0;
        const breakdown = correctionPayload.breakdown || old.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 };
        next = { basicSalary, allowances, deductions, netSalary: Math.max(0, basicSalary + allowances - deductions), breakdown };
    }
    else {
        next = {
            basicSalary: old.basicSalary || 0,
            allowances: old.allowances || 0,
            deductions: old.deductions || 0,
            netSalary: old.netSalary || 0,
            breakdown: old.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 },
        };
    }
    const version = Number(old.version || 1) + 1;
    const newRef = db().collection('salarySlips').doc();
    const newDoc = {
        // Identity
        userId: old.userId,
        employeeName: old.employeeName,
        employeeEmail: old.employeeEmail,
        avatar: old.avatar,
        employeeId: old.employeeId,
        department: old.department,
        departmentColor: old.departmentColor,
        designation: old.designation || '',
        month: old.month,
        year: old.year,
        companyId,
        payrollRunId: old.payrollRunId || '',
        payrollRef: old.payrollRef || '',
        // Values
        basicSalary: next.basicSalary,
        allowances: next.allowances,
        deductions: next.deductions,
        netSalary: next.netSalary,
        breakdown: next.breakdown,
        payroll: old.payroll || {},
        // Versioning / auditable correction chain
        version,
        supersedesId: slipSnap.id,
        status: 'Paid',
        paidOn: old.paidOn || admin.firestore.FieldValue.serverTimestamp(),
        correction: {
            reason: String(correctionPayload.reason || 'Regenerated salary slip').slice(0, 2000),
            correctedBy: context.auth.uid,
            correctedByName: caller?.name || caller?.email || 'Admin',
            correctedAt: admin.firestore.FieldValue.serverTimestamp(),
            previous,
            current: { basicSalary: next.basicSalary, allowances: next.allowances, deductions: next.deductions, netSalary: next.netSalary },
            ...(overrideReason ? { overrideReason: overrideReason.slice(0, 2000) } : {}),
            payrollRef: old.payrollRef || '',
        },
        emailStatus: 'not-sent',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const batch = db().batch();
    batch.set(newRef, newDoc);
    batch.update(slipRef, {
        superseded: true,
        supersededBy: newRef.id,
        supersededAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (run) {
        batch.update(db().collection('payrollRuns').doc(run.id), {
            status: 'Corrected',
            correctedAt: admin.firestore.FieldValue.serverTimestamp(),
            correctedBy: context.auth.uid,
            correctedByName: caller?.name || 'Admin',
            ...(overrideReason ? { lockOverrideReason: overrideReason } : {}),
        });
    }
    await batch.commit();
    // Email ONLY this employee (+ their Company Admin in CC) the NEW slip.
    const newSlip = {
        id: newRef.id,
        data: { ...old, ...newDoc, correction: undefined, createdAt: new Date() },
    };
    const adminEmails = await getCompanyAdminEmails(companyId);
    const result = await dispatchSingleSlip(newSlip, ctx, { force: true, cc: adminEmails.length ? adminEmails : [] });
    return {
        success: true,
        slipId: newRef.id,
        supersedesId: slipSnap.id,
        version,
        emailed: result === 'sent',
        emailStatus: result === 'failed' ? 'failed' : 'sent',
        withinWindow,
        deadline: deadline.toISOString(),
    };
});
// ============================================
// retryFailedPayslipEmails — resend slips whose email dispatch failed
// ============================================
exports.retryFailedPayslipEmails = functions.https.onCall(async (payload, context) => {
    const companyId = payload?.companyId;
    const monthIndex = payload?.monthIndex;
    const year = payload?.year;
    const slipIds = Array.isArray(payload?.slipIds) ? payload.slipIds : [];
    if (!companyId)
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
    await assertCompanyAuth(context, String(companyId), true);
    let slips;
    if (slipIds.length) {
        const snap = await db().collection('salarySlips').where('companyId', '==', companyId).get();
        slips = snap.docs.filter((d) => slipIds.includes(d.id)).map((d) => ({ id: d.id, data: d.data() }));
    }
    else {
        slips = await loadCompanySlips(companyId, monthIndex, year);
    }
    // Only slips whose LAST dispatch failed (emailStatus failed/retrying, or the
    // legacy payslipEmailStatus === 'failed'), and only paid/emailed slips
    // ('Emailed' = promoted after an earlier successful dispatch — a later
    // re-send may have failed and must still be retryable).
    slips = slips.filter((s) => {
        if (s.data.status !== 'Paid' && s.data.status !== 'Emailed')
            return false;
        const es = s.data.emailStatus;
        if (es === 'failed' || es === 'retrying')
            return true;
        return s.data.payslipEmailStatus === 'failed';
    });
    const ctx = await getCompanyContext(companyId);
    const adminEmails = await getCompanyAdminEmails(companyId);
    const cc = adminEmails.length ? adminEmails : [];
    const bcc = Array.isArray(payload?.bcc) ? payload.bcc.map((x) => String(x)).filter(Boolean) : [];
    let dispatched = 0;
    let failed = 0;
    for (const slip of slips) {
        await updateSlipEmailState(slip.id, 'retrying');
        const result = await dispatchSingleSlip(slip, ctx, { force: true, cc, bcc });
        if (result === 'failed')
            failed++;
        else if (result === 'sent')
            dispatched++;
    }
    return { success: true, dispatched, failed, total: slips.length };
});
//# sourceMappingURL=payslipDispatch.js.map