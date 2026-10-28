import { useEffect, useState } from 'react'
import { errText } from '../aws/errors';
import { Loader2 } from 'lucide-react'
import { Modal } from './Modal'
import { useAuth } from '../context/AuthContext'
import { auth, db } from '../aws/clients'
import { doc, getDoc } from '../aws/firestore-compat'
import { getEmployeeByUserId } from '../services/employeeService'
import { createLeaveRequest, calcLeaveDays, isLeaveTypePaid, getEffectiveTiers, TIER_LABELS, requiresMasterAdminGate } from '../services/leaveService'
import type { ApprovalChainConfig } from '../utils/approvalChains'
import { logAudit } from '../services/auditLogService'
import type { Employee, LeaveType } from '../types/user'

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity']
const todayStr = new Date().toISOString().split('T')[0]

interface LeaveApplyModalProps {
  isOpen: boolean
  onClose: () => void
  companyId?: string
  /** Pre-fill for re-submitting a rejected leave within its 2-working-day window. */
  resubmitting?: { leaveType: LeaveType; startDate: string; endDate: string } | null
}

/**
 * Standard leave application modal for a user's OWN leave. Uses the exact same
 * `createLeaveRequest` service (and therefore the same 4-tier routing and
 * approval rules) as regular employees — no management bypass.
 */
export function LeaveApplyModal({ isOpen, onClose, companyId, resubmitting }: LeaveApplyModalProps) {
  const { user } = useAuth()
  const [form, setForm] = useState({ leaveType: 'Casual' as LeaveType, startDate: todayStr, endDate: todayStr, reason: '' })
  const [own, setOwn] = useState<Employee | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // The company's configurable approval chains — the preview must show the
  // SAME routing the server will apply (falls back to defaults when absent).
  const [chains, setChains] = useState<ApprovalChainConfig | null>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(resubmitting
        ? { leaveType: resubmitting.leaveType, startDate: resubmitting.startDate, endDate: resubmitting.endDate, reason: '' }
        : { leaveType: 'Casual', startDate: todayStr, endDate: todayStr, reason: '' })
      setError('')
      const uid = auth.currentUser?.uid
      if (uid) getEmployeeByUserId(uid).then(e => setOwn(e || null)).catch(() => setOwn(null))
    }
  }, [isOpen, resubmitting])

  useEffect(() => {
    const cid = companyId || user?.companyId
    if (!isOpen || !cid) { setChains(null); return }
    let dead = false
    getDoc(doc(db, 'companies', cid))
      .then((snap) => {
        if (dead) return
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null
        setChains((data?.approvalChains as ApprovalChainConfig) ?? null)
      })
      .catch(() => { if (!dead) setChains(null) })
    return () => { dead = true }
  }, [isOpen, companyId, user?.companyId])

  const company = companyId || user?.companyId || own?.companyId || ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const uid = auth.currentUser?.uid
    if (!uid) return
    const start = new Date(form.startDate)
    const end = new Date(form.endDate)
    const totalDays = calcLeaveDays(start, end)
    if (totalDays <= 0) { setError('End date must be on or after start date'); return }
    if (!company) { setError('No company context yet. Select a company from your dashboard first.'); return }

    setSubmitting(true)
    try {
      await createLeaveRequest({
        userId: uid,
        employeeName: own?.name || user?.name || 'Unknown',
        employeeId: own?.employeeId || '',
        employeeEmail: own?.email || user?.email || '',
        avatar: own?.avatar || user?.avatar || '',
        department: own?.department || '',
        departmentId: own?.departmentId || user?.departmentId || '',
        companyId: company,
        leaveType: form.leaveType,
        startDate: start,
        endDate: end,
        totalDays,
        reason: form.reason,
        isPaid: isLeaveTypePaid(form.leaveType),
      })
      await logAudit({
        userId: uid, userName: own?.name || user?.name || 'Unknown', userRole: user?.role || '',
        action: `Applied for own ${form.leaveType} leave (${totalDays} day${totalDays > 1 ? 's' : ''})`,
        actionType: 'create', module: 'Leave Management',
        targetEntity: own?.name || user?.name || 'Unknown', status: 'success',
        details: `${form.leaveType} - ${totalDays} day(s)`,
      }).catch(() => {})
      onClose()
    } catch (err) {
      console.error('Self leave application failed:', err)
      setError(errText(err, 'Failed to submit leave request'))
    } finally {
      setSubmitting(false)
    }
  }

  const total = calcLeaveDays(new Date(form.startDate), new Date(form.endDate))

  // Tiers Verification preview — the exact role-aware chain createLeaveRequest
  // routes to on submit (Employee 4-tier, RM/HR 3-tier, Exec 2-tier, TL 1-tier,
  // Master Admin gate where applicable).
  const tierSteps: { key: string; label: string }[] = getEffectiveTiers(user?.role, chains).map((t) => ({
    key: t as string,
    label: TIER_LABELS[t],
  }))
  if (requiresMasterAdminGate(user?.role)) tierSteps.push({ key: 'masterAdmin', label: 'Master Admin' })

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={resubmitting ? 'Re-submit Rejected Leave' : 'Apply for Leave'} size="medium">
      <form onSubmit={handleSubmit} className="modal-form">
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          {resubmitting
            ? `Re-submitting your rejected ${form.leaveType} leave through the standard workflow (allowed within the 2-working-day window).`
            : `Applying for your own ${form.leaveType} leave through the standard workflow.`}
        </p>

        <div className="form-group">
          <label>Leave Type *</label>
          <select value={form.leaveType} onChange={e => setForm(p => ({ ...p, leaveType: e.target.value as LeaveType }))} required>
            {LEAVE_TYPES.map(t => (
              <option key={t} value={t}>{t}{isLeaveTypePaid(t) ? ' (Paid)' : ' (Unpaid)'}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Start Date *</label>
            <input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>End Date *</label>
            <input type="date" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} required />
          </div>
        </div>

        <div style={{ background: '#f9fafb', padding: '10px 14px', borderRadius: '8px', fontSize: '14px', marginBottom: '8px' }}>
          Total Days: <strong>{total}</strong>
        </div>

        <div className="form-group">
          <label>Reason *</label>
          <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} rows={3} placeholder="Reason for leave..." required />
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>
        )}

        {/* ── Tiers Verification (same chain as approvals) ── */}
        <div style={{ background: '#f9fafb', border: '1px solid #f0f2f5', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Approval Workflow</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Verification <strong style={{ color: '#111827' }}>0</strong>/{tierSteps.length}</span>
          </div>
          {tierSteps.map((t) => (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flex: 1 }}>{t.label}</span>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: '#f59e0b' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309' }}>Pending</span>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={submitting || total <= 0}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </form>
    </Modal>
  )
}