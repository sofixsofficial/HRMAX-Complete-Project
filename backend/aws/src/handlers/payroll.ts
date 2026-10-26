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
import { createNotification, fanOutNotifications } from '../lib/notify.js';
import { ApiError, newId, isoNow } from '../lib/types.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PAID_LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'];
const DEFAULT_DIVISOR = 26;

interface PayrollItem {
  userId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  designation?: string;
  departmentId?: string | null;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayDays: number;
  overtimeHours: number;
  totalPayableDays: number;
  grossSalary: number;
  earnedGross: number;
  overtimePay: number;
  pf: number;
  professionalTax: number;
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
    const grossSalary = Number(structure.grossSalary ?? emp.salary ?? 0);
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
      employeeId: String(emp.id),
      employeeName: String(emp.name ?? ''),
      employeeEmail: String(emp.email ?? ''),
      designation: emp.designation as string | undefined,
      departmentId: (emp.departmentId as string) ?? null,
      workingDays,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      holidayDays,
      overtimeHours,
      totalPayableDays,
      grossSalary,
      earnedGross: grossSalary,
      overtimePay,
      pf,
      professionalTax,
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
      const { companyId, monthIndex, year, departmentId } = req.body as { companyId: string; monthIndex: number; year: number; departmentId?: string };
      assertCompanyScope(caller, companyId);

      const { items, workingDays } = await calculateRun(companyId, monthIndex, year, departmentId);
      const totalNet = round2(items.reduce((s, i) => s + i.netSalary, 0));
      const companyDocs = await queryEntities<Record<string, unknown>>({ entity: 'company', companyId, filters: { id: companyId }, limit: 1 }).catch(() => []);
      const companyCode = String(companyDocs[0]?.code ?? 'CO');

      const id = newId();
      const run: PayrollRunDoc = {
        id, companyId,
        month: MONTHS[monthIndex], year, monthIndex,
        status: 'Calculated',
        payrollRef: `${companyCode}-${MONTHS[monthIndex]}-${year}`,
        workingDays,
        totalEmployees: items.length,
        totalNet,
        items,
        departmentId: departmentId ?? null,
        createdAt: isoNow(), updatedAt: isoNow(),
        createdBy: caller.uid,
      };
      await putEntity<PayrollRunDoc>(run, { entity: 'payrollRun' });

      await putEntity(
        { id: newId(), companyId, runId: id, action: 'calculate', performedBy: caller.uid, performerName: caller.name, month: MONTHS[monthIndex], year, employeeCount: items.length, totalNet, timestamp: isoNow() },
        { entity: 'payrollAudit', tsField: 'timestamp' },
      );
      return { run };
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

      let sent = 0;
      let failed = 0;
      for (const item of run.items) {
        if (!item.employeeEmail) { failed++; continue; }
        const t = templates.payslip(item.employeeName, run.month, run.year, item.netSalary);
        const res = await sendEmailCentral({
          companyId, to: item.employeeEmail, subject: t.subject, html: t.html,
          type: 'payroll', dedupKey: `payslip-${item.userId}-${run.month}-${run.year}`,
          triggeredBy: caller.uid,
        });
        if (res.success) sent++; else failed++;

        // Save slip record
        await putEntity(
          {
            id: newId(), companyId, userId: item.userId,
            employeeName: item.employeeName, employeeEmail: item.employeeEmail,
            employeeId: item.employeeId, designation: item.designation,
            payrollRef: `${run.payrollRef}-${item.employeeId}`,
            month: run.month, year: run.year, monthIndex: run.monthIndex,
            netSalary: item.netSalary, grossSalary: item.grossSalary,
            breakdown: { basic: item.grossSalary, overtimePay: item.overtimePay, pf: item.pf, tax: item.professionalTax, absentDeduction: item.absentDeduction },
            payroll: { workingDays: item.workingDays, presentDays: item.presentDays, paidLeaveDays: item.paidLeaveDays, unpaidLeaveDays: item.unpaidLeaveDays, holidayDays: item.holidayDays, absentDays: Math.max(0, item.workingDays - item.totalPayableDays), overtimeHours: item.overtimeHours, totalPayableDays: item.totalPayableDays },
            status: res.success ? 'Emailed' : 'Pending',
            emailStatus: res.success ? 'sent' : 'failed',
            emailSentAt: res.success ? isoNow() : undefined,
            payrollRunId: run.id, version: 1,
            createdAt: isoNow(), updatedAt: isoNow(),
          },
          { entity: 'salarySlip', userIdField: 'userId' },
        );
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
