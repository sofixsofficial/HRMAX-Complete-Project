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
import type { SalarySlip } from '../types/user';

const COLLECTION_NAME = 'salarySlips';
const salaryRef = collection(db, COLLECTION_NAME);

const mapSlip = (doc: { id: string; data: () => any }): SalarySlip => {
  const data = doc.data();
  // Backend-generated slips carry grossSalary + a breakdown, never the legacy
  // basicSalary/allowances/deductions trio - reading those straight put
  // "Basic: 0 / Deductions: 0" next to a non-zero net on the invoice.
  const bd = data.breakdown || {};
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const gross = num(data.grossSalary) || num(bd.basic) || 0;
  const basic = data.basicSalary != null ? num(data.basicSalary) : (num(bd.basic) || gross);
  const leaveEncash = num(bd.leaveEncashment);
  const overtime = num(bd.overtimePay);
  // Recurring allowances only: encashment and overtime are printed as their
  // own earnings lines, so folding them in here would count them twice.
  const allowances =
    data.allowances != null
      ? num(data.allowances)
      : Math.max(0, gross - basic - leaveEncash - overtime);
  // `otherDeductions` may already contain the absent cut, which is also stored
  // as `absentDeduction` - only take what is left of it.
  const absent = num(bd.absentDeduction);
  const deductionsTotal =
    num(bd.pf) + num(bd.tax) + absent + Math.max(0, num(bd.otherDeductions) - absent);
  return {
    id: doc.id,
    userId: data.userId,
    employeeName: data.employeeName,
    employeeEmail: data.employeeEmail,
    avatar: data.avatar,
    employeeId: data.employeeId,
    department: data.department,
    departmentColor: data.departmentColor,
    designation: data.designation,
    month: data.month,
    year: data.year,
    basicSalary: basic,
    allowances,
    deductions: data.deductions != null ? num(data.deductions) : deductionsTotal,
    grossSalary: gross || undefined,
    netSalary: data.netSalary,
    status: data.status,
    paidOn: data.paidOn?.toDate ? data.paidOn.toDate() : data.paidOn || null,
    companyId: data.companyId,
    breakdown: data.breakdown,
    payroll: data.payroll,
    payrollRef: data.payrollRef,
    payrollRunId: data.payrollRunId,
    version: data.version,
    supersedesId: data.supersedesId,
    supersededBy: data.supersededBy,
    superseded: data.superseded,
    supersededAt: data.supersededAt?.toDate ? data.supersededAt.toDate() : data.supersededAt,
    emailStatus: data.emailStatus,
    emailError: data.emailError,
    emailSentAt: data.emailSentAt?.toDate ? data.emailSentAt.toDate() : data.emailSentAt,
    payslipEmailStatus: data.payslipEmailStatus,
    payslipEmailAt: data.payslipEmailAt?.toDate ? data.payslipEmailAt.toDate() : data.payslipEmailAt,
    regeneratedAt: data.regeneratedAt?.toDate ? data.regeneratedAt.toDate() : data.regeneratedAt,
    regeneratedBy: data.regeneratedBy,
    correction: data.correction,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt || new Date()),
    raw: data,
  } as SalarySlip;
};

// Get all salary slips
export const getAllSalarySlips = async (): Promise<SalarySlip[]> => {
  const snapshot = await getDocs(salaryRef);
  return snapshot.docs.map(mapSlip);
};

// Get salary slips by company
export const getSalarySlipsByCompany = async (companyId: string): Promise<SalarySlip[]> => {
  const q = query(salaryRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapSlip);
};

// Get salary slips by user
export const getSalarySlipsByUser = async (userId: string): Promise<SalarySlip[]> => {
  const q = query(salaryRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapSlip);
};

// Create salary slip
export const createSalarySlip = async (slip: Omit<SalarySlip, 'id'>): Promise<SalarySlip> => {
  const docRef = await addDoc(salaryRef, {
    ...slip,
    createdAt: serverTimestamp()
  });

  return {
    ...slip,
    id: docRef.id
  } as SalarySlip;
};

// Update salary slip
export const updateSalarySlip = async (id: string, updates: Partial<SalarySlip>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, updates);
};

// Mark as paid
export const markAsPaid = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    status: 'Paid',
    paidOn: serverTimestamp()
  });
};

// Delete salary slip
export const deleteSalarySlip = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Get a single salary slip
export const getSalarySlip = async (id: string): Promise<SalarySlip | null> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return mapSlip(snap);
};

// Get salary stats
export const getSalaryStats = async (companyId?: string) => {
  if (!companyId) return { total: 0, paid: 0, pending: 0, processing: 0, emailed: 0, totalAmount: 0 };
  let slips = await getSalarySlipsByCompany(companyId);

  return salaryStatsFromSlips(slips);
};

/**
 * Stats computed from slips already in hand. 'global' / 'master-admin' are
 * platform sentinels rather than tenants, so a companyId-scoped stats query
 * reports zeros while the list on screen shows rows.
 */
export const salaryStatsFromSlips = (slips: SalarySlip[]) => {
  const totalAmount = slips.reduce((sum, s) => sum + (s.netSalary || 0), 0);

  return {
    total: slips.length,
    paid: slips.filter(s => s.status === 'Paid').length,
    pending: slips.filter(s => s.status === 'Pending').length,
    processing: slips.filter(s => s.status === 'Processing').length,
    emailed: slips.filter(s => s.status === 'Emailed').length,
    totalAmount
  };
};

// ============================================
// PAYSLIP EMAIL DISPATCH (server-side)
// ============================================

export interface DispatchPayslipsResult {
  success: boolean;
  dispatched?: number;
  failed?: number;
  total?: number;
  adminNotified?: boolean;
  /** Number of recipients (company admin(s) + company) who got the full payroll summary email. */
  summarySent?: number;
  message?: string;
  error?: string;
}

export interface DispatchPayslipsParams {
  companyId: string;
  runId?: string;
  monthIndex?: number;
  year?: number;
  slipIds?: string[];
  /** Restrict dispatch to these employees (by user id) — the email filter. */
  employeeIds?: string[];
  /** Sender keeps a record copy (BCC) — isolated per employee. */
  bcc?: string[];
  /** Which slip statuses to dispatch — 'all' allows right-after-generation emails. */
  payStatus?: 'Paid' | 'Pending' | 'all';
}

/**
 * Invoke the dispatchPayslips Cloud Function: generates a PDF for each salary
 * slip and emails ONE PDF to that employee only. The Company Admin(s) and the
 * Company also receive a full payroll summary (total employee count). Gracefully
 * returns a failure result if the function isn't deployed.
 */
export const dispatchPayslips = async (params: DispatchPayslipsParams): Promise<DispatchPayslipsResult> => {
  try {
    const fn = httpsCallable(functions, 'dispatchPayslips');
    const result = await fn(params);
    const data = result.data as any;
    return {
      success: true,
      dispatched: data.dispatched,
      failed: data.failed,
      total: data.total,
      adminNotified: data.adminCc,
      summarySent: data.summarySent,
      message: data.message,
    };
  } catch (err: any) {
    console.error('dispatchPayslips failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Salary slip email dispatch is unavailable.',
    };
  }
};

export interface RegeneratePayslipResult {
  success: boolean;
  slipId?: string;
  supersedesId?: string;
  version?: number;
  emailed?: boolean;
  emailStatus?: string;
  error?: string;
}

export interface RegeneratePayslipParams {
  slipId: string;
  /** Edited values when correcting within the window. */
  correction?: {
    reason: string;
    basicSalary: number;
    allowances: number;
    deductions: number;
    breakdown?: SalarySlip['breakdown'];
  };
  /** Mandatory reason when a Master Admin overrides an expired/locked run. */
  overrideReason?: string;
}

/** Regenerate + email a corrected salary slip within the 5-working-day window. */
export const regeneratePayslip = async (params: RegeneratePayslipParams): Promise<RegeneratePayslipResult> => {
  try {
    const fn = httpsCallable(functions, 'regeneratePayslip');
    const result = await fn({ slipId: params.slipId, correction: params.correction, overrideReason: params.overrideReason });
    const data = result.data as any;
    return {
      success: true,
      slipId: data.slipId,
      supersedesId: data.supersedesId,
      version: data.version,
      emailed: data.emailed,
      emailStatus: data.emailStatus,
    };
  } catch (err: any) {
    console.error('regeneratePayslip failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to regenerate the salary slip.',
    };
  }
};

/** Retry email dispatch for slips whose last send failed. */
export const retryFailedPayslips = async (params: {
  companyId: string;
  monthIndex?: number;
  year?: number;
  slipIds?: string[];
}): Promise<DispatchPayslipsResult> => {
  try {
    const fn = httpsCallable(functions, 'retryFailedPayslipEmails');
    const result = await fn(params);
    const data = result.data as any;
    return {
      success: true,
      dispatched: data.dispatched,
      failed: data.failed,
      total: data.total,
      message: data.dispatched ? `${data.dispatched} salary slips emailed.` : 'No failed salary-slip emails found.',
    };
  } catch (err: any) {
    console.error('retryFailedPayslips failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to retry salary-slip emails.',
    };
  }
};