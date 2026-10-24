import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from '../aws/firestore-compat';
import { httpsCallable } from '../aws/functions-compat';
import { db, functions } from '../aws/clients';
import type {
  PayrollRun,
  PayrollItem,
  Employee,
  AttendanceRecord,
  Holiday,
  LeaveRequest,
  SalaryStructure
} from '../types/user';
import { getApprovedLeaveDaysForMonth, computeLeaveEncashmentDays } from './leaveService';
import type { LeaveBalanceConfig } from './leaveService';

const COLLECTION_NAME = 'payrollRuns';
const payrollRef = collection(db, COLLECTION_NAME);

// Firestore rejects `undefined` field values. Strip them (recursively) before
// any write so a zero/optional computed field can never break a batch.
const stripUndefined = (value: any): any => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
};

// ============================================
// CALCULATION HELPERS
// ============================================

// Count working days (excluding weekends) in a given month
export const getWorkingDaysInMonth = (
  monthIndex: number,
  year: number,
  holidays: Holiday[],
  weekendDays?: number[]
): number => {
  const wd = weekendDays && weekendDays.length > 0 ? weekendDays : [0, 6];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const holidayDates = new Set(
    holidays
      .filter(h => {
        const d = new Date(h.date);
        return d.getMonth() === monthIndex && d.getFullYear() === year;
      })
      .map(h => new Date(h.date).getDate())
  );

  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex, day);
    const dow = date.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = wd.includes(dow);
    const isHoliday = holidayDates.has(day);
    if (!isWeekend && !isHoliday) workingDays++;
  }
  return workingDays;
};

// Count holiday days within the month (weekday holidays only)
export const getHolidayDaysInMonth = (
  monthIndex: number,
  year: number,
  holidays: Holiday[]
): number => {
  return holidays.filter(h => {
    const d = new Date(h.date);
    const dow = d.getDay();
    return d.getMonth() === monthIndex && d.getFullYear() === year && dow !== 0 && dow !== 6;
  }).length;
};

// Count an employee's present days (from attendance) in a month
const getPresentDays = (
  attendance: AttendanceRecord[],
  userId: string,
  monthIndex: number,
  year: number
): { presentDays: number; overtimeHours: number; unresolvedMissPunchDays: number } => {
  let presentDays = 0;
  let overtimeHours = 0;
  let unresolvedMissPunchDays = 0;
  attendance
    .filter(a => a.userId === userId)
    .forEach(a => {
      const d = new Date(a.date);
      if (d.getMonth() === monthIndex && d.getFullYear() === year) {
        if (a.status === 'Present' || a.status === 'Late' || a.status === 'Approved') {
          presentDays++;
          overtimeHours += a.overtimeHours || 0;
        }
        if (a.status === 'Miss Punch' && !a.missedPunchRectification?.resolved) {
          unresolvedMissPunchDays++;
        }
      }
    });
  return { presentDays, overtimeHours, unresolvedMissPunchDays };
};

// Get the salary structure for an employee (resolved) or build a flat one from employee.salary
export const resolveStructure = (
  employee: Employee,
  structures: SalaryStructure[]
): {
  basicSalary: number;
  hra: number;
  da: number;
  conveyance: number;
  medical: number;
  specialAllowance: number;
  grossSalary: number;
  pf: number;
  professionalTax: number;
  overtimeRate: number;
} => {
  const overtimeRate = 'overtimeRatePerHour' in employee && employee.overtimeRatePerHour != null
    ? employee.overtimeRatePerHour
    : 0;
  const s = structures.find(st => st.id === employee.salaryStructureId);
  if (s) {
    return {
      basicSalary: s.basicSalary,
      hra: s.hra,
      da: s.da,
      conveyance: s.conveyance,
      medical: s.medical,
      specialAllowance: s.specialAllowance,
      grossSalary: s.grossSalary,
      pf: s.pf,
      professionalTax: s.professionalTax,
      overtimeRate: overtimeRate || s.overtimeRate,
    };
  }
  // Fallback: use the flat monthly salary as basic; no structured allowances/deductions
  const flat = employee.salary || 0;
  return {
    basicSalary: flat,
    hra: 0,
    da: 0,
    conveyance: 0,
    medical: 0,
    specialAllowance: 0,
    grossSalary: flat,
    pf: 0,
    professionalTax: 0,
    overtimeRate: overtimeRate || 0,
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================================
// CORE ENGINE
// ============================================

export interface CalcPayrollParams {
  employees: Employee[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
  structures: SalaryStructure[];
  monthIndex: number;
  year: number;
  /** Company leave policy (yearly allowance per type) — used for Dec encashment */
  leaveAllowances?: Record<string, number>;
  /** Company payroll days (payrollSettings.workingDaysPerMonth) — unified daily-rate divisor */
  payrollDays?: number;
  /** Per-employee resolved leave policy (by employee.id) — overrides leaveAllowances for Dec encashment */
  policyById?: Record<string, { allowances: Record<string, number>; config: LeaveBalanceConfig }>;
}

export const calculatePayrollItems = (params: CalcPayrollParams): { items: PayrollItem[]; workingDays: number } => {
  const { employees, attendance, leaves, holidays, structures, monthIndex, year, leaveAllowances, payrollDays, policyById } = params;
  const holidayDays = getHolidayDaysInMonth(monthIndex, year, holidays);
  const isDecember = monthIndex === 11;
  // HR MAX: one core rate for the whole company — Monthly Salary ÷ Payroll Days
  const divisor = payrollDays && payrollDays > 0 ? payrollDays : 26;

  const items: PayrollItem[] = employees
    .filter(e => e.status === 'Active' || e.status === 'On Leave')
    .map(emp => {
      const empWeekendDays: number[] = (emp as any).weekendDays?.length > 0 ? (emp as any).weekendDays : [0, 6];
      const workingDays = getWorkingDaysInMonth(monthIndex, year, holidays, empWeekendDays);
      const struct = resolveStructure(emp, structures);
      const { presentDays, overtimeHours, unresolvedMissPunchDays } = getPresentDays(attendance, emp.userId, monthIndex, year);
      const { paidDays, unpaidDays, halfDays } = getApprovedLeaveDaysForMonth(leaves, emp.userId, monthIndex, year);

      // Daily rate = Monthly Salary ÷ Payroll Days (single source for absent,
      // unpaid leave, encashment, and payroll)
      const dailyRate = divisor > 0 ? struct.grossSalary / divisor : 0;

      // Working-days attended (present + paid leave + holidays), absence = rest
      const paidDaysTotal = presentDays + paidDays + holidayDays;
      const absentDays = Math.max(0, workingDays - paidDaysTotal - unpaidDays);

      // Gross earnings — full monthly salary (HR MAX deduction model, no proration)
      const earnedGross = round2(struct.grossSalary);
      const overtimePay = round2(overtimeHours * struct.overtimeRate);

      // Deductions — PF/PT are fixed monthly; unpaid leave & absence at daily rate
      const unpaidDeduction = round2(dailyRate * unpaidDays);
      const absentDeduction = round2(dailyRate * absentDays);
      const pf = round2(struct.pf);
      const professionalTax = round2(struct.professionalTax);

      // Year-end encashment — Dec payroll only: unused encashable days × daily rate
      const empPolicy = policyById?.[emp.id] || (leaveAllowances ? { allowances: leaveAllowances, config: undefined } : undefined);
      const encashDays = isDecember
        ? computeLeaveEncashmentDays(empPolicy?.allowances, leaves, emp.userId, year, (emp as any).joinDate, empPolicy?.config)
        : 0;
      const leaveEncashment = encashDays > 0 ? round2(dailyRate * encashDays) : 0;

      const totalEarnings = round2(earnedGross + overtimePay + leaveEncashment);
      const totalDeductions = round2(pf + professionalTax + unpaidDeduction + absentDeduction);
      const netSalary = round2(Math.max(0, totalEarnings - totalDeductions));

      return {
        userId: emp.userId,
        employeeId: emp.employeeId,
        employeeName: emp.name,
        employeeEmail: emp.email,
        avatar: emp.avatar || '',
        department: emp.department || '',
        departmentColor: emp.departmentColor || '',
        departmentId: emp.departmentId || '',
        workingDays,
        presentDays,
        paidLeaveDays: paidDays,
        unpaidLeaveDays: unpaidDays,
        halfDays,
        holidayDays,
        absentDays,
        overtimeHours,
        totalPayableDays: paidDaysTotal,
        unresolvedMissPunchDays,
        basicSalary: struct.basicSalary,
        hra: struct.hra,
        da: struct.da,
        conveyance: struct.conveyance,
        medical: struct.medical,
        specialAllowance: struct.specialAllowance,
        grossSalary: struct.grossSalary,
        earnedGross,
        overtimePay,
        leaveEncashment,
        leaveEncashmentDays: encashDays,
        absentDeduction,
        pf,
        professionalTax,
        otherDeductions: round2(unpaidDeduction + absentDeduction),
        totalEarnings,
        totalDeductions,
        netSalary
      } as PayrollItem;
    });

  const maxWorkingDays = items.length > 0 ? Math.max(...items.map(i => i.workingDays)) : 0;
  return { items, workingDays: maxWorkingDays };
};

// ============================================
// FIRESTORE CRUD
// ============================================

const mapRun = (d: any): PayrollRun => {
  const data = d.data();
  return {
    id: d.id,
    companyId: data.companyId,
    month: data.month,
    year: data.year,
    monthIndex: data.monthIndex,
    status: data.status,
    workingDays: data.workingDays,
    totalEmployees: data.totalEmployees,
    totalNet: data.totalNet,
    items: data.items || [],
    createdBy: data.createdBy,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
    disbursedOn: data.disbursedOn?.toDate()
  };
};

export const getPayrollRunsByCompany = async (companyId: string): Promise<PayrollRun[]> => {
  const q = query(payrollRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapRun).sort((a, b) =>
    b.year - a.year || b.monthIndex - a.monthIndex
  );
};

export const getAllPayrollRuns = async (): Promise<PayrollRun[]> => {
  const snapshot = await getDocs(payrollRef);
  return snapshot.docs.map(mapRun);
};

export const getPayrollRun = async (id: string): Promise<PayrollRun | null> => {
  const snapshot = await getDoc(doc(db, COLLECTION_NAME, id));
  if (!snapshot.exists()) return null;
  return mapRun(snapshot);
};

export const savePayrollRun = async (
  run: Omit<PayrollRun, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PayrollRun> => {
  const docRef = await addDoc(payrollRef, {
    ...run,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { ...run, id: docRef.id, createdAt: new Date(), updatedAt: new Date() } as PayrollRun;
};

export const updatePayrollRun = async (id: string, updates: Partial<PayrollRun>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const { id: _i, createdAt: _c, ...clean } = updates as any;
  await updateDoc(docRef, { ...clean, updatedAt: serverTimestamp() });
};

export const deletePayrollRun = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};

// ============================================
// PAYROLL VALIDATION (Pre-disbursement check)
// ============================================

export interface PayrollValidationResult {
  valid: boolean
  totalUnresolvedMissPunch: number
  issues: string[]
}

/** Verify all payroll items have resolved Missed Punch rectifications before disbursement */
export const validatePayrollForDisbursement = (items: PayrollItem[]): PayrollValidationResult => {
  const issues: string[] = [];
  let totalUnresolvedMissPunch = 0;

  for (const item of items) {
    if (item.unresolvedMissPunchDays > 0) {
      totalUnresolvedMissPunch += item.unresolvedMissPunchDays;
      issues.push(
        `${item.employeeName} has ${item.unresolvedMissPunchDays} unresolved Missed Punch record(s) — manager approval required`
      );
    }
  }

  return {
    valid: totalUnresolvedMissPunch === 0,
    totalUnresolvedMissPunch,
    issues,
  };
};

/** Call the submitPayrollForApproval Cloud Function */
export const submitPayrollForApproval = async (params: {
  companyId: string
  runId: string
  monthIndex: number
  year: number
  selectedEmployeeIds?: string[]
  note?: string
}): Promise<{ success: boolean; runId?: string; emailSent?: boolean; error?: string }> => {
  try {
    const submitFn = httpsCallable(functions, 'submitPayrollForApproval');
    const result = await submitFn(params);
    const data = result.data as any;
    return {
      success: true,
      runId: data.runId,
      emailSent: data.emailSent,
    };
  } catch (err: any) {
    console.error('submitPayrollForApproval failed:', err?.message || err);
    return { success: false, error: err?.message || 'Failed to submit payroll for approval' };
  }
};

/**
 * previewBulkPayroll — mandatory review step. Runs the exact same calculation
 * as generateBulkPayroll (server-side when available, client-side fallback)
 * but writes NOTHING. The preview must be confirmed before slips are written.
 */
export const previewBulkPayroll = async (params: {
  companyId: string;
  monthIndex: number;
  year: number;
  departmentId?: string | null;
  selectedEmployeeIds?: string[];
}): Promise<{ success: boolean; items?: PayrollItem[]; employeeCount?: number; workingDays?: number; totalNet?: number; error?: string }> => {
  try {
    const previewFn = httpsCallable(functions, 'previewBulkPayroll');
    const result = await previewFn(params);
    const data = result.data as any;
    return {
      success: true,
      items: data.items,
      employeeCount: data.employeeCount,
      workingDays: data.workingDays,
      totalNet: data.totalNet,
    };
  } catch (cfErr: any) {
    console.warn('previewBulkPayroll Cloud Function failed, falling back to client-side:', cfErr?.message || cfErr);
  }

  // Fallback: client-side calculation (no writes) — same data the generate fallback uses.
  try {
    const [employeeService, attendanceService, leaveService, holidayService, salaryStructureService] = await Promise.all([
      import('./employeeService'),
      import('./attendanceService'),
      import('./leaveService'),
      import('./holidayService'),
      import('./salaryStructureService'),
    ]);
    const employees = params.departmentId
      ? await employeeService.getEmployeesByDepartment(params.departmentId!)
      : await employeeService.getEmployeesByCompany(params.companyId);
    const [attendance, leaves, holidays, structures] = await Promise.all([
      attendanceService.getAttendanceByCompany(params.companyId),
      leaveService.getLeaveRequestsByCompany(params.companyId),
      holidayService.getHolidaysByCompany(params.companyId),
      salaryStructureService.getSalaryStructuresByCompany(params.companyId),
    ]);

    const filteredEmployees = params.selectedEmployeeIds?.length
      ? employees.filter(e => params.selectedEmployeeIds!.includes(e.id || e.userId))
      : employees;

    let leaveAllowances: Record<string, number> | undefined;
    let payrollDays: number | undefined;
    try {
      const compSnap = await getDoc(doc(db, 'companies', params.companyId));
      if (compSnap.exists()) {
        const comp = compSnap.data();
        leaveAllowances = comp.leaveAllowances || undefined;
        payrollDays = comp.payrollSettings?.workingDaysPerMonth || undefined;
      }
    } catch { /* fall back to defaults */ }

    const { items, workingDays } = calculatePayrollItems({
      employees: filteredEmployees, attendance, leaves, holidays, structures,
      monthIndex: params.monthIndex, year: params.year, leaveAllowances, payrollDays,
    });

    if (items.length === 0) return { success: false, error: 'No active employees found matching the criteria.' };
    const totalNet = items.reduce((s, i) => s + i.netSalary, 0);
    return { success: true, items, employeeCount: items.length, workingDays, totalNet };
  } catch (fallbackErr: any) {
    console.error('previewBulkPayroll fallback failed:', fallbackErr);
    return { success: false, error: fallbackErr?.message || 'Failed to preview payroll' };
  }
};

/** Call the generateBulkPayroll Cloud Function with fallback to client-side batched writes */
export const generateBulkPayroll = async (params: {
  companyId: string
  monthIndex: number
  year: number
  departmentId?: string | null
  selectedEmployeeIds?: string[]
}): Promise<{ success: boolean; runId?: string; items?: PayrollItem[]; employeeCount?: number; error?: string }> => {
  // Try Cloud Function first
  try {
    const generateFn = httpsCallable(functions, 'generateBulkPayroll');
    const result = await generateFn(params);
    const data = result.data as any;
    return {
      success: true,
      runId: data.runId,
      items: data.items,
      employeeCount: data.employeeCount,
    };
  } catch (cfErr: any) {
    console.warn('generateBulkPayroll Cloud Function failed, falling back to client-side:', cfErr?.message || cfErr);
  }

  // Fallback: client-side calculation + batched Firestore writes
  try {
    const [employees, attendance, leaves, holidays, structures] = await import('./employeeService').then(m =>
      params.departmentId
        ? Promise.all([
            m.getEmployeesByDepartment(params.departmentId!),
            import('./attendanceService').then(x => x.getAttendanceByCompany(params.companyId)),
            import('./leaveService').then(x => x.getLeaveRequestsByCompany(params.companyId)),
            import('./holidayService').then(x => x.getHolidaysByCompany(params.companyId)),
            import('./salaryStructureService').then(x => x.getSalaryStructuresByCompany(params.companyId)),
          ])
        : Promise.all([
            m.getEmployeesByCompany(params.companyId),
            import('./attendanceService').then(x => x.getAttendanceByCompany(params.companyId)),
            import('./leaveService').then(x => x.getLeaveRequestsByCompany(params.companyId)),
            import('./holidayService').then(x => x.getHolidaysByCompany(params.companyId)),
            import('./salaryStructureService').then(x => x.getSalaryStructuresByCompany(params.companyId)),
          ])
    );

    // Filter to selected employees if provided
    const filteredEmployees = params.selectedEmployeeIds?.length
      ? employees.filter(e => params.selectedEmployeeIds!.includes(e.id || e.userId))
      : employees;

    // Company leave policy + payroll days — needed for Dec encashment & the daily rate
    let leaveAllowances: Record<string, number> | undefined;
    let payrollDays: number | undefined;
    try {
      const compSnap = await getDoc(doc(db, 'companies', params.companyId));
      if (compSnap.exists()) {
        const comp = compSnap.data();
        leaveAllowances = comp.leaveAllowances || undefined;
        payrollDays = comp.payrollSettings?.workingDaysPerMonth || undefined;
      }
    } catch { /* fall back to defaults */ }

    const { items, workingDays } = calculatePayrollItems({
      employees: filteredEmployees, attendance, leaves, holidays, structures,
      monthIndex: params.monthIndex, year: params.year, leaveAllowances, payrollDays,
    });

    if (items.length === 0) return { success: false, error: 'No active employees found matching the criteria.' };

    const totalNet = items.reduce((s, i) => s + i.netSalary, 0);
    const safeItems = stripUndefined(items) as PayrollItem[];

    // Save payroll run
    const runRef = await addDoc(collection(db, 'payrollRuns'), {
      companyId: params.companyId,
      month: ['January','February','March','April','May','June','July','August','September','October','November','December'][params.monthIndex],
      year: params.year,
      monthIndex: params.monthIndex,
      status: 'Calculated',
      workingDays,
      totalEmployees: safeItems.length,
      totalNet,
      items: safeItems,
      departmentId: params.departmentId || null,
      isBulk: true,
      createdBy: 'fallback',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Create salary slips
    for (const item of safeItems) {
      await addDoc(collection(db, 'salarySlips'), stripUndefined({
        userId: item.userId,
        employeeName: item.employeeName,
        employeeEmail: item.employeeEmail,
        avatar: item.avatar,
        employeeId: item.employeeId,
        department: item.department,
        departmentColor: item.departmentColor,
        month: ['January','February','March','April','May','June','July','August','September','October','November','December'][params.monthIndex],
        year: params.year,
        basicSalary: item.basicSalary,
        allowances: item.overtimePay + item.hra + item.da + item.conveyance + item.medical + item.specialAllowance,
        deductions: item.totalDeductions,
        netSalary: item.netSalary,
        status: 'Pending',
        paidOn: null,
        companyId: params.companyId,
        payrollRunId: runRef.id,
        breakdown: { hra: item.hra, da: item.da, pf: item.pf, tax: item.professionalTax, otherDeductions: item.otherDeductions, ...(item.absentDeduction ? { absentDeduction: item.absentDeduction } : {}), ...(item.leaveEncashment ? { leaveEncashment: item.leaveEncashment } : {}) },
        createdAt: serverTimestamp(),
      }));
    }

    // Log audit
    await addDoc(collection(db, 'payrollAudit'), {
      companyId: params.companyId,
      runId: runRef.id,
      action: 'calculate_bulk',
      performedBy: 'fallback',
      performerName: 'Client-side Fallback',
      performerRole: '',
      month: ['January','February','March','April','May','June','July','August','September','October','November','December'][params.monthIndex],
      year: params.year,
      departmentId: params.departmentId || null,
      employeeCount: items.length,
      totalNet,
      timestamp: serverTimestamp(),
    });

    return { success: true, runId: runRef.id, items, employeeCount: items.length };
  } catch (fallbackErr: any) {
    console.error('generateBulkPayroll fallback failed:', fallbackErr);
    return { success: false, error: fallbackErr?.message || 'Failed to generate bulk payroll' };
  }
};
