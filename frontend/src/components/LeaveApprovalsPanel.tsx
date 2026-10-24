import { useEffect, useState } from 'react'
import { Loader2, Check, X, Eye, AlertCircle } from 'lucide-react'
import { collection, query, where, onSnapshot } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { errText } from '../aws/errors'
import { TIER_LABELS, getEffectiveTiers, reviewTierLeaveRequest, getActionableLeaveTier } from '../services/leaveService'
import { logAudit } from '../services/auditLogService'
import { LeaveReviewModal } from './LeaveReviewModal'
import type { LeaveReviewDraft } from './LeaveReviewModal'
import type { LeaveRequest, ApprovalTier } from '../types/user'
import './LeaveApprovalsPanel.css'

const toDate = (v: any): Date => {
  if (!v) return new Date(0)
  if (v?.toDate) return v.toDate()
  if (v instanceof Date) return v
  return new Date(0)
}

const mapLeave = (d: any): LeaveRequest => {
  const data = d.data()
  return {
    id: d.id,
    userId: data.userId,
    employeeName: data.employeeName || data.userName || 'Unknown',
    employeeId: data.employeeId || '',
    employeeEmail: data.employeeEmail || '',
    avatar: data.avatar || '',
    department: data.department || '',
    departmentId: data.departmentId || '',
    companyId: data.companyId,
    leaveType: data.leaveType,
    startDate: toDate(data.startDate),
    endDate: toDate(data.endDate),
    totalDays: data.totalDays || 0,
    reason: data.reason || '',
    status: data.status || 'Pending',
    isPaid: !!data.isPaid,
    appliedOn: toDate(data.appliedOn),
    approvalStatus: data.approvalStatus || {},
    approvalLog: data.approvalLog || [],
    approverIds: data.approverIds || {},
    applicantRole: data.applicantRole,
    masterAdminRequired: !!data.masterAdminRequired,
    masterAdminApproveStatus: data.masterAdminApproveStatus,
  }
}

const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })

interface LeaveApprovalsPanelProps {
  companyIds: string[]
  userId: string
  userName: string
  role?: string
  title?: string
}

/**
 * Realtime "view + verify + take action" leave approvals panel for a dashboard.
 * Shows leave requests, scoped to the given companies, currently routed to the
 * signed-in user at the next pending tier. Approve / Reject open a shared
 * review modal with remarks and write through the standard 4-tier flow.
 */
export function LeaveApprovalsPanel({ companyIds, userId, userName, role, title = 'Leave Approvals' }: LeaveApprovalsPanelProps) {
  const [all, setAll] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<LeaveReviewDraft | null>(null)
  const [viewLeave, setViewLeave] = useState<LeaveRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  const companyKey = companyIds.filter(Boolean).join(',')

  useEffect(() => {
    const ids = companyKey ? companyKey.split(',') : []
    setClosed(false)
    if (ids.length === 0) { setAll([]); setLoading(false); return }
    setLoading(true)
    const slices: Record<string, LeaveRequest[]> = {}
    const unsubs = ids.map(cid => {
      return onSnapshot(
        query(collection(db, 'leaveRequests'), where('companyId', '==', cid), where('status', '==', 'Pending')),
        (snap) => {
          slices[cid] = snap.docs.map(mapLeave)
          setAll(Object.values(slices).flat())
          setLoading(false)
        },
        () => {
          slices[cid] = []
          setAll(Object.values(slices).flat())
          setLoading(false)
        },
      )
    })
    return () => { unsubs.forEach(u => { try { u() } catch {} }) }
  }, [companyKey])

  const actionable = all
    .filter(l => getActionableLeaveTier(l, userId, role, companyIds))
    .sort((a, b) => b.appliedOn.getTime() - a.appliedOn.getTime())

  const handleConfirmReview = async (d: LeaveReviewDraft, note: string) => {
    setActionError(null)
    setSubmitting(true)
    try {
      await reviewTierLeaveRequest(d.leave.id, d.tier, d.action, userId, userName || 'User', note)
      await logAudit({
        userId, userName: userName || 'User',
        userRole: 'dashboard',
        action: `${d.action} leave at ${TIER_LABELS[d.tier]} tier`,
        actionType: d.action === 'Approved' ? 'approve' : 'reject',
        module: 'Dashboard',
        targetEntity: d.leave.employeeName,
        status: 'success',
        details: note || undefined,
      }).catch(() => {})
      setDraft(null)
    } catch (err) {
      console.error('Leave review failed:', err)
      setActionError(errText(err, 'Failed to update leave request. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="accordion-card" style={{ marginBottom: 12 }}>
      <div className="accordion-header">
        <h3>{title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!closed && actionable.length > 0 && (
            <span className="lap-count">
              {actionable.length} request{actionable.length !== 1 ? 's' : ''} awaiting your verification
            </span>
          )}
          <button
            onClick={() => setClosed(c => !c)}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
          >
            {closed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!closed && (
        <div style={{ padding: 0 }}>
          {actionError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{actionError}</span>
              <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={15} /></button>
            </div>
          )}
          {loading ? (
            <div className="lap-loading-inline" style={{ padding: 20 }}><Loader2 className="animate-spin" size={20} /> Loading leave requests...</div>
          ) : actionable.length === 0 ? (
            <div style={{ padding: '18px 20px', color: '#9ca3af', fontSize: 13 }}>
              No leave requests awaiting your verification.
            </div>
          ) : (
            <div className="lap-table-wrap">
              <table className="lap-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Leave Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Next Tier</th>
                    <th>Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {actionable.map(l => (
                    <tr key={l.id}>
                      <td>
                        <div className="lap-entity">
                          <span className="tl-ops-entity-name">{l.employeeName}</span>
                          {l.department && <div style={{ fontSize: 11, color: '#9ca3af' }}>{l.department}</div>}
                        </div>
                      </td>
                      <td><span className="lap-pill" style={{ background: '#eff6ff', color: '#2563eb' }}>{l.leaveType}</span></td>
                      <td style={{ fontSize: 12, color: '#374151' }}>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                      <td><span className="lap-count">{l.totalDays}</span></td>
                      <td>
                        <span className="lap-pill" style={{ background: '#fef3c7', color: '#92400e' }}>
                          {TIER_LABELS[getActionableLeaveTier(l, userId, role, companyIds) as ApprovalTier]}
                        </span>
                      </td>
                      <td>
                        <div className="lap-row-actions">
                          <button
                            className="lap-row-btn"
                            title="View details & approval progress"
                            onClick={() => setViewLeave(l)}
                          >
                            <Eye size={14} /> View
                          </button>
                          <button
                            className="lap-row-btn lap-approve"
                            title="Approve"
                            onClick={() => setDraft({ leave: l, tier: getActionableLeaveTier(l, userId, role, companyIds) as ApprovalTier, action: 'Approved' })}
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            className="lap-row-btn lap-reject"
                            title="Reject"
                            onClick={() => setDraft({ leave: l, tier: getActionableLeaveTier(l, userId, role, companyIds) as ApprovalTier, action: 'Rejected' })}
                          >
                            <X size={14} /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <LeaveReviewModal draft={draft} submitting={submitting} onClose={() => setDraft(null)} onConfirm={handleConfirmReview} />
      <LeaveReviewModal
        draft={viewLeave ? {
          leave: viewLeave,
          tier: (getActionableLeaveTier(viewLeave, userId, role, companyIds) || getEffectiveTiers(viewLeave.applicantRole)[0] || ('reportingManager' as ApprovalTier)),
          action: 'Approved',
        } : null}
        submitting={false}
        onClose={() => setViewLeave(null)}
        onConfirm={() => {}}
        readOnly
      />
    </div>
  )
}