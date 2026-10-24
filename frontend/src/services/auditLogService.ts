import { collection, doc, setDoc, serverTimestamp } from '../aws/firestore-compat'
import { db } from '../aws/clients'

export interface AuditLogEntry {
  id?: string
  timestamp: Date | null
  userId: string
  userName: string
  userRole: string
  action: string
  actionType: 'read' | 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'resolve' | 'assign' | 'transfer' | 'login' | 'logout' | 'export'
  module: string
  targetEntity: string
  targetId?: string
  companyId?: string
  companyName?: string
  details?: string
  status: 'success' | 'failure' | 'warning'
  ipAddress?: string
}

function generateLogId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `${ts}_${rand}`
}

export const logAudit = async (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
  try {
    const logId = generateLogId()
    const payload = { ...entry, id: logId, timestamp: serverTimestamp() } as Record<string, unknown>
    await setDoc(doc(db, 'audit_logs', logId), Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)))
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}

/** Legacy wrapper for backward compatibility with existing code */
export const logAction = async (
  userId: string,
  userName: string,
  userRole: string,
  action: string,
  module: string,
  targetEntity: string,
  details?: string,
  companyId?: string,
) => {
  await logAudit({
    userId,
    userName,
    userRole,
    action,
    actionType: 'export',
    module,
    targetEntity,
    companyId,
    details,
    status: 'success',
  })
}

export const ACTION_MODULES = [
  'All',
  'Employees',
  'Attendance',
  'Leave',
  'Payroll',
  'Roles & Permissions',
  'Companies',
  'Departments',
  'Tasks',
  'Documents',
  'Transfer Management',
  'Settings',
  'Announcements',
  'Emails',
  'Support Tickets',
  'Authentication',
] as const

export const ACTION_TYPES = [
  'All',
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'assign',
  'transfer',
  'login',
  'logout',
  'export',
] as const

export const STATUS_OPTIONS = ['All', 'success', 'failure', 'warning'] as const

export const actionLabel = (type: string) => {
  const labels: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    approve: 'Approved',
    reject: 'Rejected',
    assign: 'Assigned',
    transfer: 'Transferred',
    login: 'Logged In',
    logout: 'Logged Out',
    export: 'Exported',
  }
  return labels[type] || type
}

export const statusBadge = (status: string) => {
  const m: Record<string, { bg: string; text: string }> = {
    success: { bg: '#dcfce7', text: '#16a34a' },
    failure: { bg: '#fee2e2', text: '#ef4444' },
    warning: { bg: '#fef3c7', text: '#d97706' },
  }
  return m[status] || { bg: '#f3f4f6', text: '#6b7280' }
}
