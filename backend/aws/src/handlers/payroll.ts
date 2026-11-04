/**
 * Payroll — run calculation, submit-for-approval, payslip generation & SES
 * dispatch. (Port of payrollFunctions.ts + payslipDispatch.ts; PDF lib comes
 * from the shared payslip renderer.)
 */

import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { assertCompanyScope, assertPermission, isSuperAdmin } from '../lib/auth.js';
import { putEntity, patchEntity, queryEntities } from '../lib/db.js';
import { sendEmailCentral, templates } from '../lib/email.js';
import { generatePayslipPdf } from '../lib/payslipPdf.js';
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { ApiError, newId, isoNow } from '../lib/types.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PAID_LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'];
const DEFAULT_DIVISOR = 26;

interface PayrollItem {
  userId: string;
  /** Human-readable code (COMP-0002-2026-0002) — NEVER the Firestore doc-ID. */
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  designation?: string;
  /** Department display name (CSV export column). */
  department?: string;
  departmentId?: string | null;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  halfDays?: number;
  holidayDays: number;
  absentDays?: number;
  overtimeHours: number;
  totalPayableDays: number;
  // Structure snapshot (CSV export columns) — split mirrors calculateRun below.
  basicSalary?: number;
  hra?: number;
  da?: number;
  conveyance?: number;
  medical?: number;
  specialAllowance?: number;
  grossSalary: number;
  earnedGross: number;
  overtimePay: number;
  leaveEncashment?: number;
  pf: number;
  professionalTax: number;
  /** unpaidDeduction + absentDeduction — the CSV "Other Deductions" column. */
  otherDeductions?: number;
  unpaidDeduction: number;
  absentDeduction: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
}

interface PayrollRunDoc {
  id: string;
  companyId: string;
  month: string;
  year: number;
  monthIndex: number;
  status: string;
  payrollRef: string;
  workingDays: number;
  totalEmployees: number;
  totalNet: number;
  items: PayrollItem[];
  departmentId?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function countWorkingDays(year: number, monthIndex: number, holidays: Set<string>, weekends: number[]): number {
  let count = 0;
  for (let d = 1; d <= daysInMonth(year, monthIndex); d++) {
    const date = new Date(year, monthIndex, d);
    if (weekends.includes(date.getDay())) continue;
    const key = date.toISOString().slice(0, 10);
    if (holidays.has(key)) continue;
    count++;
  }
  return count;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function calculateRun(
  companyId: string,
  monthIndex: number,
  year: number,
  departmentId?: string | null,
  selectedEmployeeIds?: string[],
): Promise<{ items: PayrollItem[]; workingDays: number; holidayDays: number }> {
  const [employees, attendance, leaves, structures, companyDocs, holidays] = await Promise.all([
    queryEntities<Record<string, unknown>>({ entity: 'employee', companyId, filters: departmentId ? { departmentId } : undefined }),
    queryEntities<Record<string, unknown>>({ entity: 'attendance', companyId }),
    queryEntities<Record<string, unknown>>({ entity: 'leaveRequest', companyId, filters: { status: 'Approved' } }),
    queryEntities<Record<string, unknown>>({ entity: 'salaryStructure', companyId }),
    queryEntities<Record<string, unknown>>({ entity: 'companySettings', companyId, limit: 1 }),
    queryEntities<Record<string, unknown>>({ entity: 'holiday', companyId }),
  ]);

  const company = companyDocs[0] ?? {};
  const weekends: number[] = (company.payrollSettings as Record<string, unknown>)?.weekends as number[] ?? [6, 0];
  const divisor = Number((company.payrollSettings as Record<string, unknown>)?.workingDaysPerMonth ?? DEFAULT_DIVISOR);

  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const holidayKeys = new Set(
    holidays.filter((h) => String(h.date ?? '').startsWith(monthPrefix) && ![0, 6].includes(new Date(String(h.date)).getDay()))
      .map((h) => String(h.date)),
  );
  const allHolidayKeys = new Set(holidays.map((h) => String(h.date)));
  const workingDays = countWorkingDays(year, monthIndex, allHolidayKeys, weekends);

  const items: PayrollItem[] = [];
  for (const emp of employees) {
    const userId = String(emp.userId ?? '');
    if (!userId) continue;
    if (selectedEmployeeIds && !selectedEmployeeIds.includes(String(emp.id))) continue;
    if (emp.status && !['Active', 'On Leave'].includes(String(emp.status))) continue;

    const structure = structures.find((s) => s.userId === userId || s.employeeId === emp.id) ?? {};
    // The Employees form writes `monthlyGrossSalary`; no form writes the legacy
    // `salary` field any more. Reading `emp.salary` alone made EVERY payslip
    // ₹0 whenever no salary structure had been configured (structure → {} →
    // grossSalary 0). Prefer the structure, then the form-managed field, then
    // the legacy one.
    const grossSalary = Number(structure.grossSalary) || Number(emp.monthlyGrossSalary) || Number(emp.salary) || 0;
    const basicSalary = Number(structure.basicSalary ?? grossSalary * 0.4);
    const hra = Number(structure.hra ?? grossSalary * 0.2);
    const da = Number(structure.da ?? grossSalary * 0.1);
    const conveyance = Number(structure.conveyance ?? grossSalary * 0.1);
    const medical = Number(structure.medical ?? grossSalary * 0.05);
    const specialAllowance = Number(structure.specialAllowance ?? grossSalary - basicSalary - hra - da - conveyance - medical);
    const pf = Number(structure.pf ?? 0);
    const professionalTax = Number(structure.professionalTax ?? 0);
    const overtimeRate = Number(structure.overtimeRate ?? 0);

    const empAttendance = attendance.filter(
      (a) => a.userId === userId && String(a.date ?? '').startsWith(monthPrefix),
    );
    const presentDays = empAttendance.filter((a) => ['Present', 'Late', 'Approved'].includes(String(a.status))).length;
    const overtimeHours = round2(empAttendance.reduce((sum, a) => sum + Number(a.overtimeHours ?? 0), 0));

    const empLeaves = leaves.filter((l) => l.userId === userId);
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    for (const leave of empLeaves) {
      const start = new Date(String(leave.startDate));
      const end = new Date(String(leave.endDate));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getMonth() === monthIndex && d.getFullYear() === year) {
          if (PAID_LEAVE_TYPES.includes(String(leave.type)) || leave.isPaid) paidLeaveDays++;
          else unpaidLeaveDays++;
        }
      }
    }

    const holidayDays = holidayKeys.size;
    const totalPayableDays = presentDays + paidLeaveDays + holidayDays;
    const absentDays = Math.max(0, workingDays - totalPayableDays - unpaidLeaveDays);
    const dailyRate = grossSalary / divisor;

    const overtimePay = round2(overtimeHours * overtimeRate);
    const unpaidDeduction = round2(dailyRate * unpaidLeaveDays);
    const absentDeduction = round2(dailyRate * absentDays);
    const totalEarnings = round2(grossSalary + overtimePay);
    const totalDeductions = round2(pf + professionalTax + unpaidDeduction + absentDeduction);
    const netSalary = Math.max(0, round2(totalEarnings - totalDeductions));

    items.push({
      userId,
      // The Firestore doc-ID (emp.id) was leaking into CSV exports, PDFs and
      // payslip records here — always store the human-readable employee code.
      employeeId: String(emp.employeeId ?? '').trim(),
      employeeName: String(emp.name ?? ''),
      employeeEmail: String(emp.email ?? ''),
      designation: emp.designation as string | undefined,
      department: String(emp.department ?? '').trim(),
      departmentId: (emp.departmentId as string) ?? null,
      workingDays,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      halfDays: 0,
      holidayDays,
      absentDays,
      overtimeHours,
      totalPayableDays,
      // Structure snapshot for the CSV/PDF breakdown columns.
      basicSalary,
      hra,
      da,
      conveyance,
      medical,
      specialAllowance,
      grossSalary,
      earnedGross: grossSalary,
      overtimePay,
      leaveEncashment: 0,
      pf,
      professionalTax,
      otherDeductions: round2(unpaidDeduction + absentDeduction),
      unpaidDeduction,
      absentDeduction,
      totalEarnings,
      totalDeductions,
      netSalary,
    });
  }

  return { items, workingDays, holidayDays: holidayKeys.size };
}

export const payrollRoutes: Route[] = [
  // ------------------------------------------------------------- calculate
  {
    method: 'POST',
    path: '/api/payroll/calculate',
    handler: async (req) => {
      const caller = must(req);
      assertPermission(caller, 'payroll.calculate');
      const { companyId, monthIndex, year, departmentId, selectedEmployeeIds, preview } = req.body as {
        companyId: string; monthIndex: number; year: number; departmentId?: string;
        selectedEmployeeIds?: string[]; preview?: boolean;
      };
      assertCompanyScope(caller, companyId);

      const { items, workingDays } = await calculateRun(companyId, monthIndex, year, departmentId, selectedEmployeeIds);
      const totalNet = round2(items.reduce((s, i) => s + i.netSalary, 0));

      // Preview = the mandatory review step: calculate and return the rows,
      // write NOTHING (no run, no audit entry). Previously every preview
      // silently persisted a duplicate payrollRun — that is how the two
      // duplicate Nov-2026 runs were created.
      if (preview) {
        return { preview: true, items, employeeCount: items.length, workingDays, totalNet };
      }

      const companyDocs = await queryEntities<Record<string, unknown>>({ entity: 'company', companyId, filters: { id: companyId }, limit: 1 }).catch(() => []);
      // Payroll ref reads best from the short code (SOF-NOV-2026), falling
      // back to the full company ID / legacy code.
      const companyCode = String(companyDocs[0]?.shortCode ?? companyDocs[0]?.code ?? 'CO');

      const id = newId();
      const payrollRef = `${companyCode}-${MONTHS[monthIndex]}-${year}`;
      const run: PayrollRunDoc = {
        id, companyId,
        month: MONTHS[monthIndex], year, monthIndex,
        status: 'Calculated',
        payrollRef,
        workingDays,
        totalEmployees: items.length,
        totalNet,
        items,
        departmentId: departmentId ?? null,
        createdAt: isoNow(), updatedAt: isoNow(),
        createdBy: caller.uid,
      };
      await putEntity<PayrollRunDoc>(run, { entity: 'payrollRun' });

      // Spec §2/3: the moment payroll is generated, one salary-slip record
      // exists per item with status 'Pending' — dispatch later flips it to
      // 'Emailed'. Upsert by (userId + month + year) so a regenerate refreshes
      // figures instead of duplicating rows.
      const existingSlips = await queryEntities<Record<string, unknown>>({
        entity: 'salarySlip', companyId, filters: { year },
      });
      const empRows = await queryEntities<Record<string, unknown>>({ entity: 'employee', companyId });
      const joinByUser = new Map(empRows.map((e: Record<string, unknown>) => [String(e.userId ?? ''), e.joinDate]));
      for (const item of items) {
        const prev = existingSlips.find(
          (s) => String(s.userId ?? '') === item.userId && String(s.month ?? '') === MONTHS[monthIndex],
        );
        await putEntity(
          {
            ...(prev ?? {}),
            id: prev ? String(prev.id) : newId(),
            companyId,
            userId: item.userId,
            employeeName: item.employeeName,
            employeeEmail: item.employeeEmail,
            employeeId: item.employeeId,
            designation: item.designation,
            department: item.department,
            // Real DOJ — printed on the slip (PDF download + email attach).
            dateOfJoining: prev?.dateOfJoining ?? joinByUser.get(item.userId) ?? null,
            payrollRef: `${payrollRef}-${item.employeeId}`,
            month: MONTHS[monthIndex],
            year,
            monthIndex,
            netSalary: item.netSalary,
            grossSalary: item.grossSalary,
            breakdown: { basic: item.grossSalary, overtimePay: item.overtimePay, pf: item.pf, tax: item.professionalTax, absentDeduction: item.absentDeduction },
            payroll: { workingDays: item.workingDays, presentDays: item.presentDays, paidLeaveDays: item.paidLeaveDays, unpaidLeaveDays: item.unpaidLeaveDays, holidayDays: item.holidayDays, absentDays: item.absentDays, overtimeHours: item.overtimeHours, totalPayableDays: item.totalPayableDays },
            // Never downgrade an already-emailed slip back to Pending.
            status: prev ? String(prev.status ?? 'Pending') : 'Pending',
            version: prev ? Number(prev.version ?? 0) : 0,
            payrollRunId: id,
            createdAt: prev?.createdAt ?? isoNow(),
            updatedAt: isoNow(),
          },
          { entity: 'salarySlip', userIdField: 'userId', tsField: 'createdAt' },
        );
      }

      await putEntity(
        { id: newId(), companyId, runId: id, action: 'calculate', performedBy: caller.uid, performerName: caller.name, month: MONTHS[monthIndex], year, employeeCount: items.length, totalNet, timestamp: isoNow() },
        { entity: 'payrollAudit', tsField: 'timestamp' },
      );
      // Clients (web + mobile) read runId/items/employeeCount from the body.
      return { runId: id, run, items, employeeCount: items.length, workingDays, totalNet };
    },
  },

  // ------------------------------------------------------------ submit run
  {
    method: 'POST',
    path: '/api/payroll/runs/:id/submit',
    handler: async (req) => {
      const caller = must(req);
      assertPermission(caller, 'payroll.approve');
      const companyId = String(req.body.companyId ?? caller.companyId);
      const runs = await queryEntities<PayrollRunDoc>({ entity: 'payrollRun', companyId, filters: { id: req.params.id }, limit: 1 });
      const run = runs[0];
      if (!run) throw new ApiError('not-found', 'Payroll run not found');

      const updated = await patchEntity<PayrollRunDoc>('payrollRun', companyId, run.id, {
        status: 'Submitted',
        submittedBy: caller.uid, submittedByName: caller.name, submittedAt: isoNow(),
      }, { entity: 'payrollRun' });

      const admins = await queryEntities<Record<string, unknown>>({ entity: 'user', companyId, filters: { role: 'company-admin' } });
      await fanOutNotifications(admins.map((a) => String(a.id)), {
        companyId, type: 'payroll_submitted',
        title: `Payroll ${run.month} ${run.year} submitted`,
        message: `${caller.name} submitted payroll for review (${run.totalEmployees} employees, ₹${run.totalNet.toLocaleString('en-IN')} net).`,
        link: '/payroll', priority: 'high',
      });
      return { run: updated };
    },
  },

  // ------------------------------------------------------------ list runs
  {
    method: 'GET',
    path: '/api/payroll/runs',
    handler: async (req) => {
      const caller = must(req);
      assertPermission(caller, 'payroll.view');
      const companyId = req.query.companyId ?? caller.companyId;
      if (!isSuperAdmin(caller)) assertCompanyScope(caller, companyId);
      const runs = await queryEntities<PayrollRunDoc>({ entity: 'payrollRun', companyId, orderBy: { field: 'createdAt', desc: true } });
      return { runs };
    },
  },

  // -------------------------------------------- dispatch payslips via SES
  {
    method: 'POST',
    path: '/api/payroll/runs/:id/dispatch-payslips',
    handler: async (req) => {
      const caller = must(req);
      assertPermission(caller, 'payroll.manage');
      const companyId = String(req.body.companyId ?? caller.companyId);
      assertCompanyScope(caller, companyId);

      const runs = await queryEntities<PayrollRunDoc>({ entity: 'payrollRun', companyId, filters: { id: req.params.id }, limit: 1 });
      const run = runs[0];
      if (!run) throw new ApiError('not-found', 'Payroll run not found');

      // Spec §D: every payslip email carries the PDF attachment and CCs the
      // company admin (previously the template claimed "attached" with no
      // attachment, and admins only got a separate summary email).
      const adminEmails = (
        await queryEntities<Record<string, unknown>>({ entity: 'user', companyId, filters: { role: 'company-admin' }, limit: 50 })
      )
        .map((a) => String(a.email ?? '').trim().toLowerCase())
        .filter(Boolean);

      let sent = 0;
      let failed = 0;
      // Generate-time slips (status Pending, spec §2/3) are UPDATED in place —
      // never duplicated — and carry the real DOJ the browser download prints.
      const existingSlips = await queryEntities<Record<string, unknown>>({
        entity: 'salarySlip', companyId, filters: { year: run.year },
      });
      for (const item of run.items) {
        if (!item.employeeEmail) { failed++; continue; }
        const prev = existingSlips.find(
          (s) => String(s.userId ?? '') === item.userId && String(s.month ?? '') === run.month,
        );
        const t = templates.payslip(item.employeeName, run.month, run.year, item.netSalary);
        let attachment: { filename: string; content: Buffer; contentType: string } | undefined;
        try {
          attachment = {
            filename: `Payslip-${run.month}-${run.year}-${item.employeeId || item.userId}.pdf`,
            content: generatePayslipPdf({
              employeeName: item.employeeName,
              employeeId: item.employeeId,
              designation: item.designation,
              employeeEmail: item.employeeEmail,
              month: run.month,
              year: run.year,
              netSalary: item.netSalary,
              grossSalary: item.grossSalary,
              // Same values the browser download reads off the slip → identical PDF.
              basicSalary: Number(prev?.basicSalary ?? 0),
              allowances: Number(prev?.allowances ?? 0),
              deductions: Number(prev?.deductions ?? 0),
              dateOfJoining: (prev?.dateOfJoining as string | null | undefined) ?? null,
              payDate: (prev?.paidOn as string | null | undefined) ?? new Date(),
              breakdown: { basic: item.grossSalary, overtimePay: item.overtimePay, pf: item.pf, tax: item.professionalTax, absentDeduction: item.absentDeduction },
              payroll: { workingDays: item.workingDays, presentDays: item.presentDays, paidLeaveDays: item.paidLeaveDays, unpaidLeaveDays: item.unpaidLeaveDays, holidayDays: item.holidayDays, absentDays: Math.max(0, item.workingDays - item.totalPayableDays), overtimeHours: item.overtimeHours, totalPayableDays: item.totalPayableDays },
            }),
            contentType: 'application/pdf',
          };
        } catch {
          // A PDF failure must not block the dispatch — the email still goes
          // out and the slip is marked by the send result, not the attachment.
          attachment = undefined;
        }
        const ownEmail = String(item.employeeEmail).trim().toLowerCase();
        const res = await sendEmailCentral({
          companyId, to: item.employeeEmail,
          cc: adminEmails.filter((e) => e !== ownEmail),
          subject: t.subject, html: t.html,
          ...(attachment ? { attachments: [attachment] } : {}),
          type: 'payroll', dedupKey: `payslip-${item.userId}-${run.month}-${run.year}`,
          triggeredBy: caller.uid,
        });
        if (res.success) sent++; else failed++;

        // Save/update slip record — Pending → Emailed on success (spec §3).
        await putEntity(
          {
            ...(prev ?? {}),
            id: prev ? String(prev.id) : newId(),
            companyId, userId: item.userId,
            employeeName: item.employeeName, employeeEmail: item.employeeEmail,
            employeeId: item.employeeId, designation: item.designation,
            dateOfJoining: prev?.dateOfJoining ?? null,
            payrollRef: `${run.payrollRef}-${item.employeeId}`,
            month: run.month, year: run.year, monthIndex: run.monthIndex,
            netSalary: item.netSalary, grossSalary: item.grossSalary,
            breakdown: { basic: item.grossSalary, overtimePay: item.overtimePay, pf: item.pf, tax: item.professionalTax, absentDeduction: item.absentDeduction },
            payroll: { workingDays: item.workingDays, presentDays: item.presentDays, paidLeaveDays: item.paidLeaveDays, unpaidLeaveDays: item.unpaidLeaveDays, holidayDays: item.holidayDays, absentDays: Math.max(0, item.workingDays - item.totalPayableDays), overtimeHours: item.overtimeHours, totalPayableDays: item.totalPayableDays },
            status: res.success ? 'Emailed' : String(prev?.status ?? 'Pending'),
            emailStatus: res.success ? 'sent' : String(prev?.emailStatus ?? 'failed'),
            emailSentAt: res.success ? isoNow() : prev?.emailSentAt,
            payrollRunId: run.id,
            version: prev ? Number(prev.version ?? 0) : 1,
            createdAt: prev?.createdAt ?? isoNow(),
            updatedAt: isoNow(),
          },
          { entity: 'salarySlip', userIdField: 'userId', tsField: 'createdAt' },
        );

        // Email Center record — the Sent tab reads the `email` collection, so
        // a delivered payslip must leave a row there (transport logs alone
        // live in a different entity and never show up in the UI).
        if (res.success) {
          const nowIso = isoNow();
          await putEntity(
            {
              id: newId(),
              companyId,
              from: process.env.EMAIL_FROM_NAME || 'HR MAX',
              fromEmail: process.env.EMAIL_FROM || 'info@hrmax.in',
              to: item.employeeName,
              toEmail: ownEmail,
              subject: t.subject,
              body: t.html,
              date: nowIso.slice(0, 10),
              type: 'Employee',
              status: 'Sent',
              read: false,
              starred: false,
              recipientGroup: 'Individual Employee',
              payrollMonth: run.monthIndex,
              payrollYear: run.year,
              sentAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
            { entity: 'email', tsField: 'createdAt' },
          );
        }
      }

      const updated = await patchEntity<PayrollRunDoc>('payrollRun', companyId, run.id, {
        status: 'Emailed',
        payslipEmailsDispatched: true, payslipEmailCount: sent, payslipEmailFailed: failed, payslipEmailsAt: isoNow(),
      }, { entity: 'payrollRun' });

      // Summary to company admins
      const admins = await queryEntities<Record<string, unknown>>({ entity: 'user', companyId, filters: { role: 'company-admin' } });
      if (admins.length) {
        const rows = run.items.map((i) => `<tr><td style="padding:6px 10px;border:1px solid #eee">${i.employeeName}</td><td style="padding:6px 10px;border:1px solid #eee">₹${i.netSalary.toLocaleString('en-IN')}</td></tr>`).join('');
        await sendEmailCentral({
          companyId,
          to: admins.map((a) => String(a.email ?? '')).filter(Boolean),
          subject: `Payslip dispatch summary — ${run.month} ${run.year}`,
          html: `<p>${sent} payslips sent, ${failed} failed.</p><table>${rows}</table>`,
          type: 'payroll',
          dedupKey: `payroll-summary-${companyId}-${run.month}-${run.year}`,
        });
      }
      return { run: updated, sent, failed };
    },
  },
];
