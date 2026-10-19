import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { PayrollRun, PayrollItem, Employee, AttendanceRecord, LeaveRequest, Holiday, SalaryStructure } from '../types/user';
import { toDateSafe } from '../utils/dateUtils';
import { getApprovedLeaveDaysForMonth, computeLeaveEncashmentDays } from './leaveService';

const ref = collection(db, 'payrollRuns');

const mapRun = (d: any): PayrollRun => ({
  id: d.id,
  companyId: d.data().companyId || '',
  month: d.data().month || '',
  year: d.data().year || 0,
  monthIndex: d.data().monthIndex ?? 0,
  status: d.data().status || 'Draft',
  workingDays: d.data().workingDays || 0,
  totalEmployees: d.data().totalEmployees || 0,
  totalNet: d.data().totalNet || 0,
  items: d.data().items || [],
  createdBy: d.data().createdBy || '',
  createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt,
  updatedAt: d.data().updatedAt?.toDate?.() || d.data().updatedAt,
  disbursedOn: d.data().disbursedOn?.toDate?.() || d.data().disbursedOn,
});

export const getPayrollRunsByCompany = async (companyId: string): Promise<PayrollRun[]> => {
  const snap = await getDocs(query(ref, where('companyId', '==', companyId)));
  return snap.docs.map(mapRun);
};

export const getAllPayrollRuns = async (): Promise<PayrollRun[]> => {
  const snap = await getDocs(ref);
  return snap.docs.map(mapRun);
};

export const savePayrollRun = async (run: Omit<PayrollRun, 'id'>): Promise<string> => {
  const callableFn = httpsCallable(functions, 'mobileSavePayrollRun');
  const result = await callableFn({ ...run });
  return result.data as string;
};

export const updatePayrollRun = async (id: string, updates: Partial<PayrollRun>): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileUpdatePayrollRun');
  await callableFn({ runId: id, ...updates });
};

export const deletePayrollRun = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeletePayrollRun');
  await callableFn({ runId: id });
};

export const disbursePayrollRun = async (run: PayrollRun): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDisbursePayroll');
  await callableFn({
    runId: run.id,
    companyId: run.companyId,
    month: run.month,
    year: run.year,
    items: run.items,
  });
};

export const getWorkingDaysInMonth = (monthIndex: number, year: number, holidays: Holiday[], weekendDays?: number[]): number => {
  const wd = weekendDays && weekendDays.length > 0 ? weekendDays : [0, 6];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, monthIndex, day);
    if (wd.includes(d.getDay())) continue;
    const isHoliday = holidays.some((h) => {
      const hd = toDateSafe(h.date);
      return !!hd && hd.getDate() === day && hd.getMonth() === monthIndex && hd.getFullYear() === year;
    });
    if (isHoliday) continue;
    count++;
  }
  return count;
};

export const getHolidayDaysInMonth = (monthIndex: number, year: number, holidays: Holiday[]): number => {
  return holidays.filter((h) => {
    const d = toDateSafe(h.date);
    return !!d && d.getMonth() === monthIndex && d.getFullYear() === year && d.getDay() !== 0 && d.getDay() !== 6;
  }).length;
};

export const getPresentDays = (attendance: AttendanceRecord[], userId: string, monthIndex: number, year: number) => {
  const records = attendance.filter((a) => {
    const d = toDateSafe(a.date);
    return !!d && a.userId === userId && d.getMonth() === monthIndex && d.getFullYear() === year;
  });
  let presentDays = 0;
  let overtimeHours = 0;
  let unresolvedMissPunchDays = 0;
  for (const r of records) {
    if (r.status === 'Present' || r.status === 'Late' || r.status === 'Approved') {
      presentDays++;
      overtimeHours += r.overtimeHours || 0;
    }
    if (r.status === 'Miss Punch' && r.missedPunchRectification && !r.missedPunchRectification.resolved) {
      unresolvedMissPunchDays++;
    }
  }
  return { presentDays, overtimeHours, unresolvedMissPunchDays };
};

export const resolveStructure = (employee: Employee, structures: SalaryStructure[]) => {
  // Employee's per-hour OT rate takes precedence over the structure rate (matches web)
  const overtimeRate = 'overtimeRatePerHour' in employee && employee.overtimeRatePerHour != null
    ? employee.overtimeRatePerHour
    : 0;
  const s = structures.find((st) => st.id === employee.salaryStructureId);
  if (s) {
    return {
      ...s,
      overtimeRate: overtimeRate || s.overtimeRate,
    };
  }
  const flat = employee.salary || 0;
  return {
    basicSalary: flat,
    hra: 0, da: 0, conveyance: 0, medical: 0, specialAllowance: 0,
    pf: 0, professionalTax: 0, overtimeRate: overtimeRate || 0,
    grossSalary: flat,
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const calculatePayrollItems = (params: {
  employees: Employee[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
  structures: SalaryStructure[];
  monthIndex: number;
  year: number;
  leaveAllowances?: Record<string, number>;
  payrollDays?: number;
}): { items: PayrollItem[]; workingDays: number } => {
  const { employees, attendance, leaves, holidays, structures, monthIndex, year, leaveAllowances, payrollDays } = params;
  const activeEmployees = employees.filter((e) => e.status === 'Active' || e.status === 'On Leave');
  const holidayDays = getHolidayDaysInMonth(monthIndex, year, holidays);
  const isDecember = monthIndex === 11;
  // Daily rate divisor — company payroll days (default 26)
  const divisor = payrollDays && payrollDays > 0 ? payrollDays : 26;

  const items: PayrollItem[] = activeEmployees.map((emp) => {
    const empWeekendDays: number[] = (emp as any).weekendDays?.length > 0 ? (emp as any).weekendDays : [0, 6];
    const workingDays = getWorkingDaysInMonth(monthIndex, year, holidays, empWeekendDays);
    const structure = resolveStructure(emp, structures);
    const { presentDays, overtimeHours, unresolvedMissPunchDays } = getPresentDays(attendance, emp.userId, monthIndex, year);
    const { paidDays, unpaidDays, halfDays } = getApprovedLeaveDaysForMonth(leaves, emp.userId, monthIndex, year);

    // Daily rate = Monthly Salary ÷ Payroll Days (used for deductions only)
    const dailyRate = divisor > 0 ? structure.grossSalary / divisor : 0;

    // Working-days attended (present + paid leave + holidays), absence = rest
    const paidDaysTotal = presentDays + paidDays + holidayDays;
    const absentDays = Math.max(0, workingDays - paidDaysTotal - unpaidDays);

    // Gross earnings — full monthly salary (HR MAX deduction model, no proration)
    const earnedGross = round2(structure.grossSalary);
    const overtimePay = round2(overtimeHours * structure.overtimeRate);

    // Deductions — PF/PT are fixed monthly; unpaid leave & absence at daily rate
    const unpaidDeduction = round2(dailyRate * unpaidDays);
    const absentDeduction = round2(dailyRate * absentDays);
    const pf = round2(structure.pf);
    const professionalTax = round2(structure.professionalTax);

    // Year-end encashment — Dec payroll only: unused encashable days × daily rate
    let leaveEncashment = 0;
    let encashDays = 0;
    if (isDecember) {
      encashDays = computeLeaveEncashmentDays(leaveAllowances, leaves, emp.userId, year, (emp as any).joinDate);
      leaveEncashment = encashDays > 0 ? round2(dailyRate * encashDays) : 0;
    }

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
      basicSalary: structure.basicSalary,
      hra: structure.hra,
      da: structure.da,
      conveyance: structure.conveyance,
      medical: structure.medical,
      specialAllowance: structure.specialAllowance,
      grossSalary: structure.grossSalary,
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
      netSalary,
    } as PayrollItem;
  });
  const maxWorkingDays = items.length > 0 ? Math.max(...items.map((i) => i.workingDays)) : 0;
  return { items, workingDays: maxWorkingDays };
};

// ============================================================
// BULK PAYROLL — Preview (no writes) & Generate (writes slips)
// ============================================================

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * previewBulkPayroll — mandatory review step. Runs calculation but writes NOTHING.
 * Tries the Cloud Function first; falls back to client-side calculation.
 */
export const previewBulkPayroll = async (params: {
  companyId: string;
  monthIndex: number;
  year: number;
  departmentId?: string | null;
  selectedEmployeeIds?: string[];
}): Promise<{ success: boolean; items?: PayrollItem[]; employeeCount?: number; workingDays?: number; totalNet?: number; error?: string }> => {
  // Try Cloud Function first
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

  // Fallback: client-side calculation (no writes)
  try {
    const employeeService = await import('./employeeService');
    const leaveService = await import('./leaveService');
    const holidayService = await import('./holidayService');
    const salaryStructureService = await import('./salaryStructureService');

    const employees = params.departmentId
      ? (await employeeService.getEmployeesByCompany(params.companyId)).filter((e: any) => e.departmentId === params.departmentId)
      : await employeeService.getEmployeesByCompany(params.companyId);

    const [attendanceSnap, leaves, holidays, structures] = await Promise.all([
      getDocs(query(collection(db, 'attendance'), where('companyId', '==', params.companyId))),
      leaveService.getLeaveRequestsByCompany(params.companyId),
      holidayService.getHolidaysByCompany(params.companyId),
      salaryStructureService.getSalaryStructuresByCompany(params.companyId),
    ]);
    const attendance = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));

    const filteredEmployees = params.selectedEmployeeIds?.length
      ? employees.filter(e => params.selectedEmployeeIds!.includes(String(e.id || e.userId || '')))
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
      employees: filteredEmployees as any as Employee[],
      attendance: attendance as any as AttendanceRecord[],
      leaves: leaves as any as LeaveRequest[],
      holidays: holidays as any as Holiday[],
      structures: structures as any as SalaryStructure[],
      monthIndex: params.monthIndex,
      year: params.year,
      leaveAllowances,
      payrollDays,
    });

    if (items.length === 0) return { success: false, error: 'No active employees found matching the criteria.' };
    const totalNet = items.reduce((s, i) => s + i.netSalary, 0);
    return { success: true, items, employeeCount: items.length, workingDays, totalNet };
  } catch (fallbackErr: any) {
    console.error('previewBulkPayroll fallback failed:', fallbackErr);
    return { success: false, error: fallbackErr?.message || 'Failed to preview payroll' };
  }
};

/**
 * generateBulkPayroll — after mandatory preview, writes salary slips + payroll run.
 * Tries Cloud Function first; falls back to client-side batched writes.
 */
export const generateBulkPayroll = async (params: {
  companyId: string;
  monthIndex: number;
  year: number;
  departmentId?: string | null;
  selectedEmployeeIds?: string[];
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
    const employeeService = await import('./employeeService');
    const leaveService = await import('./leaveService');
    const holidayService = await import('./holidayService');
    const salaryStructureService = await import('./salaryStructureService');

    const employees = params.departmentId
      ? (await employeeService.getEmployeesByCompany(params.companyId)).filter((e: any) => e.departmentId === params.departmentId)
      : await employeeService.getEmployeesByCompany(params.companyId);

    const [attendanceSnap, leaves, holidays, structures] = await Promise.all([
      getDocs(query(collection(db, 'attendance'), where('companyId', '==', params.companyId))),
      leaveService.getLeaveRequestsByCompany(params.companyId),
      holidayService.getHolidaysByCompany(params.companyId),
      salaryStructureService.getSalaryStructuresByCompany(params.companyId),
    ]);
    const attendance = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));

    const filteredEmployees = params.selectedEmployeeIds?.length
      ? employees.filter(e => params.selectedEmployeeIds!.includes(String(e.id || e.userId || '')))
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
      employees: filteredEmployees as any as Employee[],
      attendance: attendance as any as AttendanceRecord[],
      leaves: leaves as any as LeaveRequest[],
      holidays: holidays as any as Holiday[],
      structures: structures as any as SalaryStructure[],
      monthIndex: params.monthIndex,
      year: params.year,
      leaveAllowances,
      payrollDays,
    });

    if (items.length === 0) return { success: false, error: 'No active employees found matching the criteria.' };

    const totalNet = items.reduce((s, i) => s + i.netSalary, 0);
    const monthName = MONTHS[params.monthIndex];

    // Client-side writes are blocked by Firestore rules — the generateBulkPayroll
    // Cloud Function is required for persistence.
    throw new Error(
      'Client-side payroll generation is disabled. The generateBulkPayroll Cloud Function is required.'
    );
  } catch (fallbackErr: any) {
    console.error('generateBulkPayroll fallback failed:', fallbackErr);
    return { success: false, error: fallbackErr?.message || 'Failed to generate bulk payroll' };
  }
};
