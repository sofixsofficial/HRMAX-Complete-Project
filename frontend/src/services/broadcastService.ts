import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';

export type BroadcastMode = 'all-active' | 'department' | 'selected';
export type BroadcastMessageType = 'payroll' | 'attendance' | 'leave' | 'general';

export interface CompanyBroadcastParams {
  companyId: string;
  recipientMode: BroadcastMode;
  departmentId?: string | null;
  employeeIds?: string[];
  subject: string;
  message: string;
  messageType?: BroadcastMessageType;
  notifyInApp?: boolean;
}

export interface CompanyBroadcastResult {
  success: boolean;
  jobId?: string;
  total?: number;
  dispatched?: number;
  failed?: number;
  skipped?: number;
  companyId?: string;
  message?: string;
  error?: string;
}

export interface BroadcastJob {
  id: string;
  companyId: string;
  subject: string;
  messageType: string;
  recipientMode: string;
  total: number;
  dispatched: number;
  failed: number;
  skipped?: number;
  status: string;
  triggeredByName?: string;
  createdAt?: Date;
}

/**
 * Send a secure, individually-addressed email broadcast to employees inside a
 * single company scope (all active / a department / selected employees). Each
 * recipient receives their OWN email (no group visibility), gets an in-app
 * notification, and the Company Admin receives a confirmation alert. The
 * per-recipient result is persisted for the audit trail.
 */
export const companyAdminBroadcast = async (params: CompanyBroadcastParams): Promise<CompanyBroadcastResult> => {
  try {
    const fn = httpsCallable(functions, 'companyAdminBroadcast');
    const result = await fn(params);
    const data = result.data as any;
    return {
      success: true,
      jobId: data.jobId,
      total: data.total,
      dispatched: data.dispatched,
      failed: data.failed,
      skipped: data.skipped,
      companyId: data.companyId,
      message: data.message,
    };
  } catch (err: any) {
    console.error('companyAdminBroadcast failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Broadcast is currently unavailable.',
    };
  }
};

/** List recent broadcast confirmation logs for a company (newest first). */
export const listBroadcastJobs = async (companyId: string): Promise<BroadcastJob[]> => {
  try {
    const fn = httpsCallable(functions, 'listBroadcastJobs');
    const result = await fn({ companyId });
    const data = result.data as any;
    const jobs: BroadcastJob[] = (data?.jobs || []).map((j: any) => ({
      id: j.id,
      companyId: j.companyId,
      subject: j.subject,
      messageType: j.messageType,
      recipientMode: j.recipientMode,
      total: j.total || 0,
      dispatched: j.dispatched || 0,
      failed: j.failed || 0,
      skipped: j.skipped || 0,
      status: j.status,
      triggeredByName: j.triggeredByName,
      createdAt: j.createdAt?.toDate ? j.createdAt.toDate() : new Date(j.createdAt || Date.now()),
    }));
    return jobs;
  } catch (err: any) {
    console.error('listBroadcastJobs failed:', err?.message || err);
    return [];
  }
};