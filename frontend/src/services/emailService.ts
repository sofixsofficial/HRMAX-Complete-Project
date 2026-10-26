import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from '../aws/firestore-compat'
import { getFunctions, httpsCallable } from '../aws/functions-compat'
import { db } from '../aws/clients'
import { getAllEmployees, getEmployeesByCompany, getEmployeesByCompanies } from './employeeService'
import type { Email, DeliveryStatus } from '../types/email'
import type { Employee } from '../types/user'

const COLLECTION = 'emails'
const ref = collection(db, COLLECTION)

export const fetchEmails = async (companyId?: string, role?: string): Promise<Email[]> => {
  try {
    let constraints: any[] = []
    if (companyId && role !== 'master-admin') {
      constraints.push(where('companyId', '==', companyId))
    }
    constraints.push(orderBy('date', 'asc'))
    const q = query(ref, ...constraints)
    const snapshot = await getDocs(q)
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Email)).reverse()
  } catch (err) {
    if ((err as any)?.code === 'failed-precondition') {
      const q = companyId && role !== 'master-admin'
        ? query(ref, where('companyId', '==', companyId))
        : query(ref)
      const snapshot = await getDocs(q)
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Email)).reverse()
    }
    throw err
  }
}

const stripUndefined = (obj: Record<string, any>) => {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined))
}

export const saveEmail = async (emailData: Omit<Email, 'id'>): Promise<string> => {
  const docRef = doc(ref)
  await setDoc(docRef, {
    ...stripUndefined(emailData as any),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

export const updateEmail = async (id: string, updates: Partial<Email>): Promise<void> => {
  await updateDoc(doc(db, COLLECTION, id), {
    ...stripUndefined(updates as any),
    updatedAt: serverTimestamp(),
  })
}

export const updateEmailStatus = async (id: string, status: DeliveryStatus): Promise<void> => {
  const updates: any = { status, updatedAt: serverTimestamp() }
  const now = new Date().toISOString()
  if (status === 'Sent') updates.sentAt = now
  if (status === 'Delivered') updates.deliveredAt = now
  if (status === 'Opened') updates.openedAt = now
  if (status === 'Clicked') updates.clickedAt = now
  await updateDoc(doc(db, COLLECTION, id), updates)
}

export const deleteEmail = async (id: string): Promise<void> => {
  await updateEmailStatus(id, 'Deleted')
}

export const archiveEmail = async (id: string): Promise<void> => {
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'Archived',
    updatedAt: serverTimestamp(),
  })
}

export const toggleStar = async (id: string, starred: boolean): Promise<void> => {
  await updateDoc(doc(db, COLLECTION, id), {
    starred: !starred,
    updatedAt: serverTimestamp(),
  })
}

export const markAsRead = async (id: string): Promise<void> => {
  await updateDoc(doc(db, COLLECTION, id), {
    read: true,
    updatedAt: serverTimestamp(),
  })
}

export const bulkAction = async (ids: string[], action: 'delete' | 'archive' | 'markRead'): Promise<void> => {
  const batch = writeBatch(db)
  ids.forEach(id => {
    const d = doc(db, COLLECTION, id)
    if (action === 'delete') {
      batch.update(d, { status: 'Deleted', updatedAt: serverTimestamp() })
    } else if (action === 'archive') {
      batch.update(d, { status: 'Archived', updatedAt: serverTimestamp() })
    } else {
      batch.update(d, { read: true, updatedAt: serverTimestamp() })
    }
  })
  await batch.commit()
}

export const sendEmailViaSMTP = async (params: {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  companyId?: string
  emailId?: string
  attachments?: Array<{ filename: string; content: string; contentType?: string }>
}): Promise<{ success: boolean; delivered: boolean }> => {
  const functions = getFunctions()
  const sendEmailFn = httpsCallable(functions, 'sendEmail')
  const result = await sendEmailFn(params)
  return result.data as { success: boolean; delivered: boolean }
}

export const resolveRecipientGroup = async (
  group: string,
  companyId?: string,
  companyIds?: string[]
): Promise<{ name: string; email: string }[]> => {
  let employees: Employee[] = []
  try {
    if (companyIds && companyIds.length > 0) {
      employees = await getEmployeesByCompanies(companyIds)
    } else if (companyId) {
      employees = await getEmployeesByCompany(companyId)
    } else {
      employees = await getAllEmployees()
    }
  } catch {
    return []
  }

  switch (group) {
    case 'Individual Employee':
    case 'Multiple Employees':
      return employees.map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Department':
      return employees.filter(e => e.departmentId).map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Team':
      return employees.filter(e => e.role === 'team-leader' || e.departmentId).map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Executive':
      return employees.filter(e => e.role === 'executive').map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Team Leader':
      return employees.filter(e => e.role === 'team-leader').map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Company':
    case 'All Employees':
      return employees.map(e => ({
        name: e.name || e.email,
        email: e.email,
      }))
    case 'Job Applicants':
      return []
    default:
      return []
  }
}

export const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export const parseEmails = (input: string): string[] => {
  return input
    .split(/[,;]/)
    .map(e => e.trim())
    .filter(e => e.length > 0 && validateEmail(e))
}

export const sendCorporateInquiry = async (params: {
  companyName: string
  fullName: string
  workEmail: string
  phoneNumber: string
  estimatedTeamSize: string
}): Promise<{ success: boolean; delivered: boolean }> => {
  const functions = getFunctions()
  const inquiryFn = httpsCallable(functions, 'corporateInquiry')
  // UI field names -> backend contract. legacy.ts#corporateInquiry reads
  // name/email/company/phone/message and REQUIRES `email`; the form collected
  // companyName/fullName/workEmail/..., so every submission died with
  // "email is required" before an email was ever sent.
  const result = await inquiryFn({
    name: params.fullName,
    email: params.workEmail,
    company: params.companyName,
    phone: params.phoneNumber,
    message: `Estimated team size: ${params.estimatedTeamSize}`,
  })
  return result.data as { success: boolean; delivered: boolean }
}

export const sendSupportTicket = async (params: {
  subject: string
  description: string
  category: string
  priority?: string
  userName?: string
  userEmail?: string
  phone?: string
  companyName?: string
  ticketId: string
}): Promise<{ success: boolean; delivered: boolean; ticketId?: string }> => {
  const functions = getFunctions()
  const ticketFn = httpsCallable(functions, 'sendSupportTicket')
  // UI field names -> backend contract. legacy.ts#sendSupportTicket reads
  // email/name/subject/message and REQUIRES `email`; both callers passed
  // userEmail/userName/description, so every contact/support submission
  // failed with "email is required" and no mail ever went out.
  const meta = [
    params.category ? `Category: ${params.category}` : '',
    params.priority ? `Priority: ${params.priority}` : '',
    params.companyName ? `Company: ${params.companyName}` : '',
    params.phone ? `Phone: ${params.phone}` : '',
  ].filter(Boolean).join('\n')
  const body = params.description ?? ''
  const result = await ticketFn({
    email: params.userEmail,
    name: params.userName,
    subject: params.subject,
    message: meta ? `${meta}\n\n${body}` : body,
  })
  return result.data as { success: boolean; delivered: boolean; ticketId?: string }
}

// ============================================================
// CENTRAL EMAIL SYSTEM — Dashboard-managed SMTP + logs
// ============================================================

export interface SmtpSettings {
  enabled: boolean
  host: string
  port: number
  encryption: 'tls' | 'ssl' | 'none'
  user: string
  pass: string
  fromName: string
  fromEmail: string
  replyTo?: string
}

export interface EmailSystemConfigResponse {
  dashboard: (SmtpSettings & { hasPassword?: boolean }) | null
  envFallback: { host: string; port: number; user: string } | null
}

export interface EmailLogEntry {
  id: string
  type?: string
  companyId?: string | null
  to: string | string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  status: 'success' | 'failed' | 'disabled' | 'skipped-duplicate'
  error?: string | null
  messageId?: string | null
  attempts?: number
  triggeredBy?: string
  createdAt?: { seconds: number; nanoseconds: number } | string
  lastRetryAt?: { seconds: number; nanoseconds: number } | string
}

const getCallable = (name: string) => httpsCallable(getFunctions(), name)

export const getEmailSystemConfig = async (): Promise<EmailSystemConfigResponse> => {
  const result = await getCallable('getEmailSystemConfig')({})
  return result.data as EmailSystemConfigResponse
}

export const saveEmailSystemConfig = async (
  config: SmtpSettings,
  options?: { validate?: boolean; keepExistingPassword?: boolean }
): Promise<{ success: boolean; validated: boolean }> => {
  const result = await getCallable('saveEmailSystemConfig')({
    config,
    validate: options?.validate,
    keepExistingPassword: options?.keepExistingPassword,
  })
  return result.data as { success: boolean; validated: boolean }
}

export const testEmailSystemConnection = async (
  config?: Partial<SmtpSettings>,
  keepExistingPassword?: boolean
): Promise<{ success: boolean; message?: string; error?: string }> => {
  const result = await getCallable('testEmailSystemConnection')({
    config: config || null,
    keepExistingPassword: !!keepExistingPassword,
  })
  return result.data as { success: boolean; message?: string; error?: string }
}

export const sendEmailSystemTest = async (
  to: string
): Promise<{ success: boolean; delivered?: boolean; messageId?: string; logId?: string }> => {
  const result = await getCallable('sendEmailSystemTest')({ to })
  return result.data as { success: boolean; delivered?: boolean; messageId?: string; logId?: string }
}

export const listEmailLogs = async (
  status: 'all' | 'success' | 'failed' | 'disabled' | 'skipped-duplicate' = 'all',
  limit = 50
): Promise<EmailLogEntry[]> => {
  const result = await getCallable('listEmailLogs')({ status, limit })
  return ((result.data as any).logs || []) as EmailLogEntry[]
}

export const retryEmailLog = async (
  logId: string
): Promise<{ success: boolean; delivered: boolean; error?: string; skipped?: string }> => {
  const result = await getCallable('retryEmailLog')({ logId })
  return result.data as { success: boolean; delivered: boolean; error?: string; skipped?: string }
}
