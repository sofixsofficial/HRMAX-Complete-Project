import { collection, query, where, getDocs, doc, getDoc } from '../aws/firestore-compat';
import { httpsCallable } from '../aws/functions-compat';
import { db, functions } from '../aws/clients';
import { SalarySlip } from '../types/user';

const COLLECTION_NAME = 'salarySlips';
const ref = collection(db, COLLECTION_NAME);

const mapSlip = (d: any): SalarySlip => {
  const data = d.data();
  return {
    id: d.id,
    userId: data.userId || '',
    employeeName: data.employeeName || '',
    employeeEmail: data.employeeEmail || '',
    avatar: data.avatar || '',
    employeeId: data.employeeId || '',
    department: data.department || '',
    departmentColor: data.departmentColor || '',
    month: data.month || '',
    year: data.year || 0,
    basicSalary: data.basicSalary || 0,
    allowances: data.allowances || 0,
    deductions: data.deductions || 0,
    netSalary: data.netSalary || 0,
    status: data.status || 'Pending',
    paidOn: data.paidOn?.toDate?.() || data.paidOn || null,
    companyId: data.companyId || '',
    breakdown: data.breakdown,
    createdAt: data.createdAt?.toDate?.() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
    payrollRef: data.payrollRef || '',
    payrollRunId: data.payrollRunId || '',
    version: data.version,
    superseded: data.superseded,
    supersededAt: data.supersededAt?.toDate?.() || data.supersededAt,
    emailStatus: data.emailStatus,
    emailError: data.emailError,
    emailSentAt: data.emailSentAt?.toDate?.() || data.emailSentAt,
    payslipEmailStatus: data.payslipEmailStatus,
    correction: data.correction,
  };
};

export const getSalarySlipsByCompany = async (companyId: string): Promise<SalarySlip[]> => {
  const snap = await getDocs(query(ref, where('companyId', '==', companyId)));
  return snap.docs.map(mapSlip);
};

export const getSalarySlipsByUser = async (userId: string): Promise<SalarySlip[]> => {
  const snap = await getDocs(query(ref, where('userId', '==', userId)));
  return snap.docs.map(mapSlip);
};

export const getAllSalarySlips = async (): Promise<SalarySlip[]> => {
  const snap = await getDocs(ref);
  return snap.docs.map(mapSlip);
};

export const markAsPaid = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileMarkSalarySlipPaid');
  await callableFn({ slipId: id });
};

export const deleteSalarySlip = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteSalarySlip');
  await callableFn({ slipId: id });
};

export const getSalaryStats = async (companyId?: string) => {
  if (!companyId) return { total: 0, paid: 0, pending: 0, processing: 0, emailed: 0, totalAmount: 0 };
  const slips = await getSalarySlipsByCompany(companyId);
  return salaryStatsFromSlips(slips);
};

/**
 * Stats computed from slips already in hand. The platform sentinels
 * ('global' / 'master-admin') are not tenants, so `getSalaryStats` cannot be
 * scoped to them - it would report zeros while the list below shows rows.
 */
export const salaryStatsFromSlips = (slips: SalarySlip[]) => {
  const totalAmount = slips.reduce((sum, s) => sum + (s.netSalary || 0), 0);
  return {
    total: slips.length,
    paid: slips.filter(s => s.status === 'Paid').length,
    pending: slips.filter(s => s.status === 'Pending').length,
    processing: slips.filter(s => s.status === 'Processing').length,
    emailed: slips.filter(s => s.status === 'Emailed').length,
    totalAmount,
  };
};

export const getCompanyPayslipOptions = async (companyId?: string): Promise<Record<string, any>> => {
  if (!companyId) return {};
  try {
    const snap = await getDoc(doc(db, 'companies', companyId));
    if (!snap.exists()) return {};
    const company = snap.data();
    return {
      companyName: company.name || '',
      companyAddress: company.address || '',
      companyCity: company.city || '',
      companyState: company.state || '',
      companyCountry: company.country || '',
      companyLogo: company.logoUrl || '',
      companyCurrency: company.currency || 'INR',
    };
  } catch (err) {
    console.error('Failed to fetch company for payslip:', err);
    return {};
  }
};

export interface DispatchPayslipsResult {
  success: boolean;
  dispatched?: number;
  failed?: number;
  total?: number;
  adminNotified?: boolean;
  summarySent?: number;
  message?: string;
  error?: string;
}

/**
 * Invoke the dispatchPayslips Cloud Function: generates a PDF for each salary
 * slip and emails ONE PDF to that employee only. Company Admin(s) get a summary.
 */
export const dispatchPayslips = async (params: {
  companyId: string;
  runId?: string;
  monthIndex?: number;
  year?: number;
  slipIds?: string[];
  employeeIds?: string[];
  payStatus?: 'Paid' | 'Pending' | 'all';
}): Promise<DispatchPayslipsResult> => {
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

/**
 * Retry email dispatch for slips whose last send failed.
 */
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
      message: data.message,
    };
  } catch (err: any) {
    console.error('retryFailedPayslips failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to retry salary-slip emails.',
    };
  }
};
