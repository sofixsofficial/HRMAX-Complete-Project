import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendEmailCentral } from './emailService';

const db = admin.firestore();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const round2 = (n: number) => Math.round(n * 100) / 100;

interface PayrollItem {
  userId: string; employeeId: string; employeeName: string; employeeEmail: string; avatar: string;
  department: string; departmentColor: string; departmentId: string;
  designation?: string;
  dateOfJoining?: string;
  workingDays: number; presentDays: number; paidLeaveDays: number; unpaidLeaveDays: number; halfDays?: number;
  holidayDays: number; overtimeHours: number; totalPayableDays: number; unresolvedMissPunchDays: number;
  basicSalary: number; hra: number; da: number; conveyance: number; medical: number;
  specialAllowance: number; grossSalary: number;
  earnedGross: number; overtimePay: number; pf: number; professionalTax: number;
  otherDeductions: number; totalEarnings: number; totalDeductions: number; netSalary: number;
  leaveEncashment?: number; leaveEncashmentDays?: number; absentDays?: number; absentDeduction?: number;
}

const MONTH_REF = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Payroll is final (no re-run allowed) once it moves past these statuses. A new
// run for the same company+month+year is rejected with a clear message.
const FINAL_PAYROLL_STATUSES = ['Reviewed', 'Submitted', 'Approved', 'Generated', 'Emailed', 'Corrected', 'Disbursed', 'Locked'];

/** Reject a duplicate payroll run for the same company+period. */
const assertNoFinalRun = async (companyId: string, monthIndex: number, year: number): Promise<void> => {
  const snap = await db.collection('payrollRuns').where('companyId', '==', companyId).get();
  const existing = snap.docs
    .map((d) => d.data())
    .find((r: any) => r.monthIndex === monthIndex && r.year === year && FINAL_PAYROLL_STATUSES.includes(r.status));
  if (existing) {
    throw new functions.https.HttpsError(
      'already-exists',
      `Payroll for ${MONTHS[monthIndex]} ${year} already exists (status: ${existing.status}). Use the salary-slip correction/regeneration flow instead of re-running payroll.`
    );
  }
};

const PAID_LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity'];

const DEFAULT_LEAVE_ALLOWANCES: Record<string, number> = {
  Casual: 12, Sick: 12, Earned: 15, Unpaid: 0, Maternity: 180, Paternity: 5,
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v === 'string') return new Date(v);
  return null;
};

/**
 * Prorate an annual leave allowance by joining date (join month ⇒ months
 * remaining ÷ 12). Joined before the balance year ⇒ full allowance.
 */
const prorateAllowance = (annual: number, joinDate: any, year: number): number => {
  if (!annual || annual <= 0) return 0;
  const join = toDate(joinDate);
  if (!join || isNaN(join.getTime())) return annual;
  if (join.getFullYear() < year) return annual;
  if (join.getFullYear() > year) return 0;
  const monthsRemaining = 12 - join.getMonth();
  return Math.round((annual * monthsRemaining) / 12 * 100) / 100;
};

/**
 * Year-end encashable days = unused balance for the policy's encashable types
 * (default Earned) for the calendar year (approved leave only, allowance
 * prorated by join date), floored so payroll never pays fractional days.
 */
const getEncashmentDays = (
  employee: any,
  leaves: any[],
  leaveAllowances: Record<string, number> | undefined,
  year: number,
  encashableTypes: string[] = ['Earned'],
): number => {
  const config = { ...DEFAULT_LEAVE_ALLOWANCES, ...(leaveAllowances || {}) };
  const total = (encashableTypes.length ? encashableTypes : ['Earned']).reduce((sum, type) => {
    const allowance = prorateAllowance(config[type] || 0, employee.joinDate, year);
    let used = 0;
    for (const l of leaves) {
      if (l.userId !== (employee.userId || employee.id) || l.leaveType !== type || l.status !== 'Approved') continue;
      const start = toDate(l.startDate);
      if (!start || isNaN(start.getTime()) || start.getFullYear() !== year) continue;
      used += l.totalDays || 0;
    }
    return sum + Math.max(0, allowance - used);
  }, 0);
  return Math.floor(total);
};

/**
 * Resolve an employee's effective leave balance source:
 *   1. Employee-specific monthly entitlements (Employee Create → Leave
 *      Entitlements; Yearly = Monthly × 12) — the current source of truth.
 *   2. Employee-assigned policy → company default → company legacy allowances.
 * Returns per-type allowances and the encashable leave types (Earned only when
 * the employee holds an Earned entitlement; else fallback defaults).
 */
const resolveLeavePolicy = (
  employee: any,
  policies: any[],
  legacyAllowances: Record<string, number> | undefined,
): { allowances: Record<string, number> | undefined; encashable: string[] } => {
  const monthly = employee?.monthlyLeaveEntitlements;
  if (monthly && typeof monthly === 'object' && Object.keys(monthly).some((t) => Number(monthly[t]) > 0)) {
    const allowances: Record<string, number> = {};
    for (const [type, m] of Object.entries<any>(monthly)) {
      if (Number(m) > 0) allowances[type] = Math.round(Number(m) * 12 * 100) / 100;
    }
    const encashable: string[] = Number(monthly.Earned) > 0 ? ['Earned'] : [];
    return { allowances, encashable };
  }
  const fallback = policies.find((p: any) => p.isDefault) || policies[0];
  const pol = policies.find((p: any) => p.id === employee.leavePolicyId) || fallback;
  if (pol?.types && typeof pol.types === 'object') {
    const allowances: Record<string, number> = {};
    const encashable: string[] = [];
    for (const [type, cfg] of Object.entries<any>(pol.types)) {
      if (cfg?.days) allowances[type] = cfg.days;
      if (cfg?.encashable && cfg?.paid) encashable.push(type);
    }
    if (encashable.length === 0) encashable.push('Earned');
    return { allowances, encashable };
  }
  return { allowances: legacyAllowances, encashable: legacyAllowances && Object.keys(legacyAllowances).length ? ['Earned'] : [] };
};

const getWorkingDaysInMonth = (monthIndex: number, year: number, holidays: any[]): number => {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const holidayDates = new Set(
    holidays.flatMap((h: any) => {
      const d = toDate(h.date);
      if (!d) return [];
      if (d.getMonth() !== monthIndex || d.getFullYear() !== year) return [];
      return [d.getDate()];
    })
  );
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex, day);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6 && !holidayDates.has(day)) workingDays++;
  }
  return workingDays;
};

const getHolidayDaysInMonth = (monthIndex: number, year: number, holidays: any[]): number => {
  return holidays.filter((h: any) => {
    const d = toDate(h.date);
    if (!d) return false;
    const dow = d.getDay();
    return d.getMonth() === monthIndex && d.getFullYear() === year && dow !== 0 && dow !== 6;
  }).length;
};

const getPresentDays = (attendance: any[], userId: string, monthIndex: number, year: number) => {
  let presentDays = 0, overtimeHours = 0, unresolvedMissPunchDays = 0;
  attendance
    .filter((a: any) => a.userId === userId)
    .forEach((a: any) => {
      const d = toDate(a.date);
      if (d && d.getMonth() === monthIndex && d.getFullYear() === year) {
        if (a.status === 'Present' || a.status === 'Late' || a.status === 'Approved') {
          presentDays++;
          overtimeHours += a.overtimeHours || 0;
        }
        if (a.status === 'Miss Punch' && (!a.missedPunchRectification || !a.missedPunchRectification.resolved)) {
          unresolvedMissPunchDays++;
        }
      }
    });
  return { presentDays, overtimeHours, unresolvedMissPunchDays };
};

const getApprovedLeaveDaysForMonth = (leaves: any[], userId: string, monthIndex: number, year: number) => {
  let paidDays = 0, unpaidDays = 0, halfDays = 0;
  leaves
    .filter((l: any) => l.userId === userId && l.status === 'Approved')
    .forEach((l: any) => {
      const start = toDate(l.startDate);
      const end = toDate(l.endDate);
      if (!start || !end) return;
      const total = Number(l.totalDays) || 0;
      // Half-day leave (e.g. totalDays = 0.5 over a single date) is attributed
      // as 0.5 days to the month containing the start date, not a full day.
      if (total % 1 !== 0) {
        if (start.getMonth() === monthIndex && start.getFullYear() === year) {
          const isPaid = (l.isPaid === true) || PAID_LEAVE_TYPES.includes(l.leaveType);
          if (isPaid) paidDays += 0.5;
          else unpaidDays += 0.5;
          halfDays += 0.5;
        }
        return;
      }
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getMonth() === monthIndex && d.getFullYear() === year) {
          if (l.isPaid || PAID_LEAVE_TYPES.includes(l.leaveType)) paidDays++;
          else unpaidDays++;
        }
      }
    });
  return { paidDays, unpaidDays, halfDays };
};

const resolveStructure = (employee: any, structures: any[]) => {
  const s = structures.find((st: any) => st.id === employee.salaryStructureId);
  if (s) {
    return {
      basicSalary: s.basicSalary || 0, hra: s.hra || 0, da: s.da || 0,
      conveyance: s.conveyance || 0, medical: s.medical || 0, specialAllowance: s.specialAllowance || 0,
      grossSalary: s.grossSalary || 0, pf: s.pf || 0, professionalTax: s.professionalTax || 0, overtimeRate: s.overtimeRate || 0,
    };
  }
  const flat = employee.salary || 0;
  return {
    basicSalary: flat, hra: 0, da: 0, conveyance: 0, medical: 0, specialAllowance: 0,
    grossSalary: flat, pf: 0, professionalTax: 0, overtimeRate: 0,
  };
};

export const generateBulkPayroll = functions.runWith({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { companyId, monthIndex, year, departmentId, selectedEmployeeIds } = data;

  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
  }
  if (monthIndex === undefined || monthIndex === null || monthIndex < 0 || monthIndex > 11) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid monthIndex (0-11) is required');
  }
  if (!year) {
    throw new functions.https.HttpsError('invalid-argument', 'year is required');
  }

  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found');
  }
  const caller = callerDoc.data()!;
  const isMasterAdmin = caller.role === 'master-admin';
  const isExecForCompany = caller.role === 'executive' && caller.assignedCompanyIds?.includes(companyId);
  const isCompanyUser = caller.companyId === companyId;

  if (!isMasterAdmin && !isExecForCompany && !isCompanyUser) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this company');
  }

await assertNoFinalRun(companyId, monthIndex, year);

  try {
    const { items, workingDays, totalNet, companyCode } = await buildBulkPayrollData({
      companyId,
      monthIndex,
      year,
      departmentId: departmentId || null,
      selectedEmployeeIds,
    });

    // Create payroll run doc (generate ID first for cross-ref)
    const runRef = db.collection('payrollRuns').doc();

    // Batch writes: salary slips + run doc + audit (split into batches of 498 to stay under 500 limit)
    const BATCH_LIMIT = 498;
    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch: admin.firestore.WriteBatch = db.batch();
    let opCount = 0;

    for (const item of items) {
      if (opCount >= BATCH_LIMIT) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        opCount = 0;
      }
      const slipRef = db.collection('salarySlips').doc();
      currentBatch.set(slipRef, {
        userId: item.userId,
        employeeName: item.employeeName,
        employeeEmail: item.employeeEmail,
        avatar: item.avatar,
        employeeId: item.employeeId,
        department: item.department,
        departmentColor: item.departmentColor,
        designation: item.designation || '',
        dateOfJoining: item.dateOfJoining || '',
        payrollRef: `${companyCode}-${String(item.employeeId || item.userId).toUpperCase()}-${year}-${MONTH_REF[monthIndex]}`,
        payroll: {
          workingDays: item.workingDays,
          presentDays: item.presentDays,
          paidLeaveDays: item.paidLeaveDays,
          unpaidLeaveDays: item.unpaidLeaveDays,
          halfDays: item.halfDays || 0,
          holidayDays: item.holidayDays,
          absentDays: item.absentDays || 0,
          overtimeHours: item.overtimeHours,
          totalPayableDays: item.totalPayableDays,
          unresolvedMissPunchDays: item.unresolvedMissPunchDays,
          grossSalary: item.grossSalary,
          overtimePay: item.overtimePay,
          leaveEncashment: item.leaveEncashment || 0,
          leaveEncashmentDays: item.leaveEncashmentDays || 0,
          absentDeduction: item.absentDeduction || 0,
        },
        month: MONTHS[monthIndex],
        year,
        basicSalary: item.basicSalary,
        allowances: item.overtimePay + item.hra + item.da + item.conveyance + item.medical + item.specialAllowance,
        deductions: item.totalDeductions,
        netSalary: item.netSalary,
        status: 'Pending',
        paidOn: null,
        companyId,
        payrollRunId: runRef.id,
        breakdown: { hra: item.hra, da: item.da, pf: item.pf, tax: item.professionalTax, otherDeductions: item.otherDeductions, ...(item.absentDeduction ? { absentDeduction: item.absentDeduction } : {}), ...(item.leaveEncashment ? { leaveEncashment: item.leaveEncashment } : {}) },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      opCount++;
    }

    // Set the payroll run document
    currentBatch.set(runRef, {
      companyId,
      month: MONTHS[monthIndex],
      year,
      monthIndex,
      status: 'Calculated',
      payrollRef: `${companyCode}-${MONTHS[monthIndex]}-${year}`,
      workingDays,
      totalEmployees: items.length,
      totalNet,
      items,
      createdBy: context.auth.uid,
      departmentId: departmentId || null,
      isBulk: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;

    // Add audit log entry to current batch (or new batch if full)
    if (opCount >= BATCH_LIMIT) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      opCount = 0;
    }
    const auditRef = db.collection('payrollAudit').doc();
    currentBatch.set(auditRef, {
      companyId,
      runId: runRef.id,
      action: 'calculate_bulk',
      performedBy: context.auth.uid,
      performerName: caller.name || '',
      performerRole: caller.role || '',
      month: MONTHS[monthIndex],
      year,
      departmentId: departmentId || null,
      employeeCount: items.length,
      totalNet,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount++;

    batches.push(currentBatch);

    // Commit all batches sequentially
    for (const batch of batches) {
      await batch.commit();
    }

    return {
      success: true,
      runId: runRef.id,
      items,
      workingDays,
      totalNet,
      employeeCount: items.length,
    };
  } catch (error: any) {
    console.error('Error generating bulk payroll:', error);
    throw new functions.https.HttpsError('internal', `Failed to generate bulk payroll: ${error.message}`);
  }
});

/**
 * Shared bulk-payroll calculation used by BOTH generateBulkPayroll and the
 * mandatory previewBulkPayroll, so the preview is always identical to what
 * actually gets written. Loads company employees/attendance/leaves/holidays/
 * structures and computes the line items WITHOUT writing anything.
 */
async function buildBulkPayrollData(params: {
  companyId: string;
  monthIndex: number;
  year: number;
  departmentId?: string | null;
  selectedEmployeeIds?: string[];
}): Promise<{ items: PayrollItem[]; workingDays: number; totalNet: number; companyCode: string }> {
  const { companyId, monthIndex, year, departmentId, selectedEmployeeIds } = params;

  // Build employee query scoped to company + optional department
  let empQuery: FirebaseFirestore.Query = db.collection('employees').where('companyId', '==', companyId);
  if (departmentId) {
    empQuery = empQuery.where('departmentId', '==', departmentId);
  }
  const empSnap = await empQuery.get();
  let employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filter to only selected employees if provided
  if (selectedEmployeeIds && Array.isArray(selectedEmployeeIds) && selectedEmployeeIds.length > 0) {
    employees = employees.filter((e: any) => selectedEmployeeIds.includes(e.userId || e.id));
  }

  if (employees.length === 0) {
    throw new functions.https.HttpsError('not-found', 'No employees found matching the criteria');
  }

  // Fetch attendance, leaves, holidays, structures for the company
  const [attSnap, leaveSnap, holSnap, structSnap] = await Promise.all([
    db.collection('attendance').where('companyId', '==', companyId).get(),
    db.collection('leaveRequests').where('companyId', '==', companyId).get(),
    db.collection('holidays').where('companyId', '==', companyId).get(),
    db.collection('salaryStructures').where('companyId', '==', companyId).get(),
  ]);

  const attendance = attSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const leaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const holidays = holSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const structures = structSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Company leave policy (yearly allowance per type) + payroll days (daily-rate
  // divisor) — feed the Dec encashment and the unified HR MAX daily rate
  let companyLeaveAllowances: Record<string, number> | undefined;
  let payrollDays: number | undefined;
  let companyCode = companyId.slice(0, 6).toUpperCase();
  let leavePolicies: any[] = [];
  try {
    const [companySnap, policySnap] = await Promise.all([
      db.collection('companies').doc(companyId).get(),
      db.collection('leavePolicies').where('companyId', '==', companyId).get(),
    ]);
    if (companySnap.exists) {
      const cdata = companySnap.data();
      companyLeaveAllowances = cdata?.leaveAllowances || undefined;
      payrollDays = cdata?.payrollSettings?.workingDaysPerMonth || undefined;
      companyCode = (cdata?.code && String(cdata.code).trim()) ? String(cdata.code).trim().toUpperCase() : companyId.slice(0, 6).toUpperCase();
    }
    leavePolicies = policySnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { /* fall back to defaults */ }

  const workingDays = getWorkingDaysInMonth(monthIndex, year, holidays);
  const holidayDays = getHolidayDaysInMonth(monthIndex, year, holidays);
  // HR MAX: one core rate for the whole company — Monthly Salary ÷ Payroll Days
  const divisor = payrollDays && payrollDays > 0 ? payrollDays : 26;

  // Calculate payroll for each employee
  const items: PayrollItem[] = employees
    .filter((e: any) => e.status === 'Active' || e.status === 'On Leave')
    .map((emp: any) => {
      const struct = resolveStructure(emp, structures);
      const { presentDays, overtimeHours, unresolvedMissPunchDays } = getPresentDays(attendance, emp.userId || emp.id, monthIndex, year);
      const { paidDays, unpaidDays, halfDays } = getApprovedLeaveDaysForMonth(leaves, emp.userId || emp.id, monthIndex, year);

      // Daily rate = Monthly Salary ÷ Payroll Days (single source for absent,
      // unpaid leave, encashment, and payroll)
      const dailyRate = divisor > 0 ? struct.grossSalary / divisor : 0;

      // Working-days attended (present + paid leave + holidays) — absence is the rest
      const paidDaysTotal = presentDays + paidDays + holidayDays;
      const absentDays = Math.max(0, workingDays - paidDaysTotal - unpaidDays);

      // Gross earnings — full monthly salary (HR MAX deduction model, no proration)
      const earnedGross = round2(struct.grossSalary);
      const overtimePay = round2(overtimeHours * struct.overtimeRate);

      // Deductions — PF/PT fixed monthly; unpaid leave & absence at daily rate
      const unpaidDeduction = round2(dailyRate * unpaidDays);
      const absentDeduction = round2(dailyRate * absentDays);
      const pf = round2(struct.pf);
      const professionalTax = round2(struct.professionalTax);

      // Year-end encashment — Dec payroll only: unused encashable days × daily rate
      const { allowances: empLeaveAllowances, encashable: encashableTypes } =
        resolveLeavePolicy(emp, leavePolicies, companyLeaveAllowances);
      const encashDays = monthIndex === 11 ? getEncashmentDays(emp, leaves, empLeaveAllowances, year, encashableTypes) : 0;
      const leaveEncashment = encashDays > 0 ? round2(dailyRate * encashDays) : 0;

      const totalEarnings = round2(earnedGross + overtimePay + leaveEncashment);
      const totalDeductions = round2(pf + professionalTax + unpaidDeduction + absentDeduction);
      const netSalary = round2(Math.max(0, totalEarnings - totalDeductions));

      return {
        userId: emp.userId || emp.id,
        employeeId: emp.employeeId || '',
        employeeName: emp.name || '',
        employeeEmail: emp.email || '',
        avatar: emp.avatar || '',
        department: emp.department || '',
        departmentColor: emp.departmentColor || '',
        departmentId: emp.departmentId || '',
        designation: emp.designation || '',
        dateOfJoining: emp.joinDate || emp.joiningDate || '',
        workingDays, presentDays, paidLeaveDays: paidDays, unpaidLeaveDays: unpaidDays, halfDays,
        holidayDays, absentDays, overtimeHours, totalPayableDays: paidDaysTotal, unresolvedMissPunchDays,
        basicSalary: struct.basicSalary, hra: struct.hra, da: struct.da,
        conveyance: struct.conveyance, medical: struct.medical, specialAllowance: struct.specialAllowance,
        grossSalary: struct.grossSalary, earnedGross, overtimePay, leaveEncashment, leaveEncashmentDays: encashDays,
        absentDeduction,
        pf, professionalTax,
        otherDeductions: round2(unpaidDeduction + absentDeduction), totalEarnings, totalDeductions, netSalary,
      };
    });

  const totalNet = items.reduce((sum, i) => sum + i.netSalary, 0);
  return { items, workingDays, totalNet, companyCode };
}

/**
 * previewBulkPayroll — MANDATORY preview step before salary slips are written.
 * Runs the exact same calculation as generateBulkPayroll but writes nothing, so
 * the user can review the payroll (and totals) before confirming generation.
 */
export const previewBulkPayroll = functions.runWith({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { companyId, monthIndex, year, departmentId, selectedEmployeeIds } = data;

  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
  }
  if (monthIndex === undefined || monthIndex === null || monthIndex < 0 || monthIndex > 11) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid monthIndex (0-11) is required');
  }
  if (!year) {
    throw new functions.https.HttpsError('invalid-argument', 'year is required');
  }

  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found');
  }
  const caller = callerDoc.data()!;
  const isMasterAdmin = caller.role === 'master-admin';
  const isExecForCompany = caller.role === 'executive' && caller.assignedCompanyIds?.includes(companyId);
  const isCompanyUser = caller.companyId === companyId;

  if (!isMasterAdmin && !isExecForCompany && !isCompanyUser) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this company');
  }

  try {
    const { items, workingDays, totalNet } = await buildBulkPayrollData({
      companyId,
      monthIndex,
      year,
      departmentId: departmentId || null,
      selectedEmployeeIds,
    });

    return { success: true, items, workingDays, totalNet, employeeCount: items.length };
  } catch (error: any) {
    console.error('Error previewing bulk payroll:', error);
    throw new functions.https.HttpsError('internal', `Failed to preview bulk payroll: ${error.message}`);
  }
});

/**
 * Submit payroll for approval — notifies company admin(s) via email
 */
export const submitPayrollForApproval = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { companyId, runId, monthIndex, year, selectedEmployeeIds, note } = data;

  if (!companyId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'companyId and runId are required');
  }

  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found');
  }
  const caller = callerDoc.data()!;
  const isMasterAdmin = caller.role === 'master-admin';
  const isExecForCompany = caller.role === 'executive' && caller.assignedCompanyIds?.includes(companyId);
  const isTLForCompany = caller.role === 'team-leader' && caller.companyId === companyId;

  if (!isMasterAdmin && !isExecForCompany && !isTLForCompany) {
    throw new functions.https.HttpsError('permission-denied', 'Only executives, team leaders, and master admins can submit payroll for approval');
  }

  try {
    // Verify the payroll run exists and belongs to this company
    const runDoc = await db.collection('payrollRuns').doc(runId).get();
    if (!runDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Payroll run not found');
    }
    const runData = runDoc.data()!;
    if (runData.companyId !== companyId) {
      throw new functions.https.HttpsError('permission-denied', 'Payroll run does not belong to this company');
    }
    if (runData.status !== 'Calculated' && runData.status !== 'Draft') {
      throw new functions.https.HttpsError('failed-precondition', `Payroll run is already ${runData.status}. Only Calculated or Draft runs can be submitted.`);
    }

    // Update status to 'Submitted'
    await db.collection('payrollRuns').doc(runId).update({
      status: 'Submitted',
      submittedBy: context.auth.uid,
      submittedByName: caller.name || '',
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      submissionNote: note || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Look up company info and admin emails
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const companyData = companyDoc.data();
    const companyName = companyData?.name || 'Company';
    const companyEmail = companyData?.email || '';

    // Find company admin users
    const adminSnap = await db.collection('users')
      .where('companyId', '==', companyId)
      .where('role', '==', 'company-admin')
      .get();
    const adminEmails: string[] = [];
    adminSnap.forEach(d => {
      const u = d.data();
      if (u.email) adminEmails.push(u.email);
    });

    // Create audit entry
    await db.collection('payrollAudit').add({
      companyId,
      runId,
      action: 'submit_for_approval',
      performedBy: context.auth.uid,
      performerName: caller.name || '',
      performerRole: caller.role || '',
      month: MONTHS[monthIndex || runData.monthIndex],
      year: year || runData.year,
      employeeCount: selectedEmployeeIds?.length || runData.totalEmployees || 0,
      totalNet: runData.totalNet || 0,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send email notification to company admins
    let emailSent = false;
    const recipients = [...adminEmails];
    if (companyEmail && !recipients.includes(companyEmail)) {
      recipients.push(companyEmail);
    }

    if (recipients.length > 0) {
      try {
        const monthLabel = MONTHS[monthIndex || runData.monthIndex];
        const submitterName = caller.name || 'A team member';

        const result = await sendEmailCentral({
          to: recipients,
          subject: `[Payroll] ${monthLabel} ${year || runData.year} Payroll Submitted for Approval by ${submitterName}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#2563eb;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
                <h2 style="margin:0;">Payroll Submission</h2>
              </div>
              <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
                <p><strong>${submitterName}</strong> has submitted the <strong>${monthLabel} ${year || runData.year}</strong> payroll for approval.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Company</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${companyName}</td></tr>
                  <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Period</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${monthLabel} ${year || runData.year}</td></tr>
                  <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Total Employees</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${selectedEmployeeIds?.length || runData.totalEmployees || 'N/A'}</td></tr>
                  <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Total Amount</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">₹${(runData.totalNet || 0).toLocaleString('en-IN')}</td></tr>
                  ${note ? `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Note</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${note}</td></tr>` : ''}
                </table>
                <p>Please review and approve the payroll at your earliest convenience.</p>
                <div style="text-align:center;margin-top:24px;">
                  <a href="${functions.config().app?.url || 'https://hrm-sofisx.web.app'}/payroll" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Review Payroll</a>
                </div>
              </div>
            </div>
          `,
          type: 'payroll',
          companyId,
          triggeredBy: context.auth.uid,
          dedupKey: `payroll-submit-${runId}`,
        });
        emailSent = result.delivered;
        if (!result.delivered) {
          console.warn(`Payroll email not delivered for company ${companyId}:`, result.error || result.skipped);
        }
      } catch (emailErr: any) {
        console.error('Failed to send payroll approval email:', emailErr);
        // Don't fail the whole operation if email fails
      } finally {
        // Always create an in-app notification for admins
        await db.collection('notifications').add({
          companyId,
          type: 'payroll_submitted',
          title: 'Payroll Submitted for Approval',
          message: `${caller.name || 'A team member'} submitted ${MONTHS[monthIndex || runData.monthIndex]} ${year || runData.year} payroll for approval.`,
          recipients: adminEmails,
          readBy: [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return {
      success: true,
      runId,
      emailSent,
      recipients: adminEmails,
    };
  } catch (error: any) {
    console.error('Error submitting payroll for approval:', error);
    throw new functions.https.HttpsError('internal', `Failed to submit payroll: ${error.message}`);
  }
});

export const calculatePayroll = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { companyId, monthIndex, year } = data;

  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
  }
  if (monthIndex === undefined || monthIndex === null || monthIndex < 0 || monthIndex > 11) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid monthIndex (0-11) is required');
  }
  if (!year) {
    throw new functions.https.HttpsError('invalid-argument', 'year is required');
  }

  // Verify the caller belongs to or manages this company
  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found');
  }
  const caller = callerDoc.data()!;
  const isMasterAdmin = caller.role === 'master-admin';
  const isExecForCompany = caller.role === 'executive' && caller.assignedCompanyIds?.includes(companyId);
  const isCompanyUser = caller.companyId === companyId;

  if (!isMasterAdmin && !isExecForCompany && !isCompanyUser) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this company');
  }

  await assertNoFinalRun(companyId, monthIndex, year);

  try {
    // Fetch all required data in parallel
    const [empSnap, attSnap, leaveSnap, holSnap, structSnap] = await Promise.all([
      db.collection('employees').where('companyId', '==', companyId).get(),
      db.collection('attendance').where('companyId', '==', companyId).get(),
      db.collection('leaveRequests').where('companyId', '==', companyId).get(),
      db.collection('holidays').where('companyId', '==', companyId).get(),
      db.collection('salaryStructures').where('companyId', '==', companyId).get(),
    ]);

    const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const attendance = attSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const leaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const holidays = holSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const structures = structSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Company leave policy (yearly allowance per type) + payroll days (daily-rate
    // divisor) — feed the Dec encashment and the unified HR MAX daily rate
    let companyLeaveAllowances: Record<string, number> | undefined;
    let payrollDays: number | undefined;
    let companyCode = companyId.slice(0, 6).toUpperCase();
    let leavePolicies: any[] = [];
    try {
      const [companySnap, policySnap] = await Promise.all([
        db.collection('companies').doc(companyId).get(),
        db.collection('leavePolicies').where('companyId', '==', companyId).get(),
      ]);
      if (companySnap.exists) {
        const cdata = companySnap.data();
        companyLeaveAllowances = cdata?.leaveAllowances || undefined;
        payrollDays = cdata?.payrollSettings?.workingDaysPerMonth || undefined;
        companyCode = (cdata?.code && String(cdata.code).trim()) ? String(cdata.code).trim().toUpperCase() : companyId.slice(0, 6).toUpperCase();
      }
      leavePolicies = policySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { /* fall back to defaults */ }

    const workingDays = getWorkingDaysInMonth(monthIndex, year, holidays);
    const holidayDays = getHolidayDaysInMonth(monthIndex, year, holidays);
    // HR MAX: one core rate for the whole company — Monthly Salary ÷ Payroll Days
    const divisor = payrollDays && payrollDays > 0 ? payrollDays : 26;

    const items: PayrollItem[] = employees
      .filter((e: any) => e.status === 'Active' || e.status === 'On Leave')
      .map((emp: any) => {
        const struct = resolveStructure(emp, structures);
        const { presentDays, overtimeHours, unresolvedMissPunchDays } = getPresentDays(attendance, emp.userId || emp.id, monthIndex, year);
        const { paidDays, unpaidDays, halfDays } = getApprovedLeaveDaysForMonth(leaves, emp.userId || emp.id, monthIndex, year);

        // Daily rate = Monthly Salary ÷ Payroll Days (single source for absent,
        // unpaid leave, encashment, and payroll)
        const dailyRate = divisor > 0 ? struct.grossSalary / divisor : 0;

        // Working-days attended (present + paid leave + holidays) — absence is the rest
        const paidDaysTotal = presentDays + paidDays + holidayDays;
        const absentDays = Math.max(0, workingDays - paidDaysTotal - unpaidDays);

        // Gross earnings — full monthly salary (HR MAX deduction model, no proration)
        const earnedGross = round2(struct.grossSalary);
        const overtimePay = round2(overtimeHours * struct.overtimeRate);

        // Deductions — PF/PT fixed monthly; unpaid leave & absence at daily rate
        const unpaidDeduction = round2(dailyRate * unpaidDays);
        const absentDeduction = round2(dailyRate * absentDays);
        const pf = round2(struct.pf);
        const professionalTax = round2(struct.professionalTax);

        // Year-end encashment — Dec payroll only: unused encashable days × daily rate
        const { allowances: empLeaveAllowances, encashable: encashableTypes } =
          resolveLeavePolicy(emp, leavePolicies, companyLeaveAllowances);
        const encashDays = monthIndex === 11 ? getEncashmentDays(emp, leaves, empLeaveAllowances, year, encashableTypes) : 0;
        const leaveEncashment = encashDays > 0 ? round2(dailyRate * encashDays) : 0;

        const totalEarnings = round2(earnedGross + overtimePay + leaveEncashment);
        const totalDeductions = round2(pf + professionalTax + unpaidDeduction + absentDeduction);
        const netSalary = round2(Math.max(0, totalEarnings - totalDeductions));

        return {
          userId: emp.userId || emp.id,
          employeeId: emp.employeeId || '',
          employeeName: emp.name || '',
          employeeEmail: emp.email || '',
          avatar: emp.avatar || '',
          department: emp.department || '',
          departmentColor: emp.departmentColor || '',
          departmentId: emp.departmentId || '',
          designation: emp.designation || '',
          dateOfJoining: emp.joinDate || emp.joiningDate || '',
          workingDays, presentDays, paidLeaveDays: paidDays, unpaidLeaveDays: unpaidDays, halfDays,
          holidayDays, absentDays, overtimeHours, totalPayableDays: paidDaysTotal, unresolvedMissPunchDays,
          basicSalary: struct.basicSalary, hra: struct.hra, da: struct.da,
          conveyance: struct.conveyance, medical: struct.medical, specialAllowance: struct.specialAllowance,
          grossSalary: struct.grossSalary, earnedGross, overtimePay, leaveEncashment, leaveEncashmentDays: encashDays,
          absentDeduction,
          pf, professionalTax,
          otherDeductions: round2(unpaidDeduction + absentDeduction), totalEarnings, totalDeductions, netSalary,
        };
      });

    const totalNet = items.reduce((sum, i) => sum + i.netSalary, 0);

    // Save the payroll run + salary slips in a single batch (generate run id
    // up-front so slips can reference it, mirroring generateBulkPayroll).
    const runRef = db.collection('payrollRuns').doc();
    const batch = db.batch();

    for (const item of items) {
      const slipRef = db.collection('salarySlips').doc();
      batch.set(slipRef, {
        userId: item.userId,
        employeeName: item.employeeName,
        employeeEmail: item.employeeEmail,
        avatar: item.avatar,
        employeeId: item.employeeId,
        department: item.department,
        departmentColor: item.departmentColor,
        designation: item.designation || '',
        dateOfJoining: item.dateOfJoining || '',
        payrollRef: `${companyCode}-${String(item.employeeId || item.userId).toUpperCase()}-${year}-${MONTH_REF[monthIndex]}`,
        payroll: {
          workingDays: item.workingDays,
          presentDays: item.presentDays,
          paidLeaveDays: item.paidLeaveDays,
          unpaidLeaveDays: item.unpaidLeaveDays,
          halfDays: item.halfDays || 0,
          holidayDays: item.holidayDays,
          absentDays: item.absentDays || 0,
          overtimeHours: item.overtimeHours,
          totalPayableDays: item.totalPayableDays,
          unresolvedMissPunchDays: item.unresolvedMissPunchDays,
          grossSalary: item.grossSalary,
          overtimePay: item.overtimePay,
          leaveEncashment: item.leaveEncashment || 0,
          leaveEncashmentDays: item.leaveEncashmentDays || 0,
          absentDeduction: item.absentDeduction || 0,
        },
        month: MONTHS[monthIndex],
        year,
        basicSalary: item.basicSalary,
        allowances: item.overtimePay + item.hra + item.da + item.conveyance + item.medical + item.specialAllowance,
        deductions: item.totalDeductions,
        netSalary: item.netSalary,
        status: 'Pending',
        paidOn: null,
        companyId,
        payrollRunId: runRef.id,
        breakdown: { hra: item.hra, da: item.da, pf: item.pf, tax: item.professionalTax, otherDeductions: item.otherDeductions, ...(item.absentDeduction ? { absentDeduction: item.absentDeduction } : {}), ...(item.leaveEncashment ? { leaveEncashment: item.leaveEncashment } : {}) },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    batch.set(runRef, {
      companyId,
      month: MONTHS[monthIndex],
      year,
      payrollRef: `${companyCode}-${MONTHS[monthIndex]}-${year}`,
      monthIndex,
      status: 'Calculated',
      workingDays,
      totalEmployees: items.length,
      totalNet,
      items,
      createdBy: context.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Log audit
    const auditRef = db.collection('payrollAudit').doc();
    batch.set(auditRef, {
      companyId,
      runId: runRef.id,
      action: 'calculate',
      performedBy: context.auth.uid,
      performerName: caller.name || '',
      performerRole: caller.role || '',
      month: MONTHS[monthIndex],
      year,
      employeeCount: items.length,
      totalNet,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      success: true,
      runId: runRef.id,
      items,
      workingDays,
      totalNet,
    };
  } catch (error: any) {
    console.error('Error calculating payroll:', error);
    throw new functions.https.HttpsError('internal', `Failed to calculate payroll: ${error.message}`);
  }
});
