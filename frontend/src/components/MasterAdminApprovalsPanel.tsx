import { useEffect, useState } from 'react'
import { Loader2, Check, X, ShieldAlert, Eye, AlertCircle } from 'lucide-react'
import { collection, query, where, onSnapshot } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { errText } from '../aws/errors'
import { getEffectiveTiers, TIER_LABELS, reviewMasterAdminLeaveRequest } from '../services/leaveService'
import { reviewMasterAdminMissedPunch, getEffectiveMissedPunchTiers, getRecordEffectiveMissedPunchTiers, MISSED_PUNCH_TIER_LABELS } from '../services/attendanceService'
import { logAudit } from '../services/auditLogService'
import { Modal } from './Modal'
import './LeaveApprovalsPanel.css'

type MaxItem =
  | { kind: 'leave'; id: string; name: string; detail: string; sub: string; payload: any; requestedAt: Date }
  | { kind: 'missedPunch'; id: string; name: string; detail: string; sub: string; payload: any; requestedAt: Date }

const toDate = (v: any): Date => {
  if (!v) return new Date(0)
  if (v?.toDate) return v.toDate()
  if (v instanceof Date) return v
  return new Date(0)
}

const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtTime = (v: any) => {
  const d = v?.toDate ? v.toDate() : v instanceof Date ? v : null
  if (!d) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const mpEffectiveTiers = (role: string | undefined) =>
  // Delegates to the shared role-aware helper: Executive self-apps surface to
  // the Master Admin only after the assigned Team Leader reviews Tier 1
  // (3-tier: Executive → TL → Master Admin); Team Leader self-apps route
  // directly (single-step); Reporting Managers keep Admin → Exec → TL (3).
  getEffectiveMissedPunchTiers(role)

interface MasterAdminApprovalsPanelProps {
  scopedCompanyIds?: string[]
  userId: string
  userName: string
}

/**
 * Master Admin final-gate queue (realtime). Surfaces Executive / Team Leader
 * leave requests and missed-punch rectifications that have cleared every
 * required approval tier and are now awaiting the Master Admin's final
 * verification. Approve / Reject write through reviewMasterAdminLeaveRequest and
 * reviewMasterAdminMissedPunch (mandatory remark).
 */
export function MasterAdminApprovalsPanel({ scopedCompanyIds, userId, userName }: MasterAdminApprovalsPanelProps) {
  const [items, setItems] = useState<MaxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewItem, setReviewItem] = useState<MaxItem | null>(null)
  const [viewItem, setViewItem] = useState<MaxItem | null>(null)
  const [reviewAction, setReviewAction] = useState<'Approved' | 'Rejected'>('Approved')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  const scopeKey = (scopedCompanyIds || []).filter(Boolean).join(',')

  useEffect(() => {
    setItems([])
    setLoading(true)
    const scoped = (scopedCompanyIds || []).filter(Boolean)

    const inScope = (companyId?: string) => scoped.length === 0 || !companyId || scoped.includes(companyId)

    const leaves: MaxItem[] = []
    const punches: MaxItem[] = []
    let leaveDone = false
    let punchDone = false

    const emit = () => {
      if (!leaveDone || !punchDone) return
      setItems([...leaves, ...punches].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()))
      setLoading(false)
    }

    const unsubLeaves = onSnapshot(
      query(collection(db, 'leaveRequests'), where('masterAdminRequired', '==', true)),
      (snap) => {
        leaves.length = 0
        snap.docs.forEach(d => {
          const data = d.data()
          const maStatus = data.masterAdminApproveStatus
          // Treat an absent masterAdminApproveStatus as Pending (older clients /
          // pre-deploy legacy docs) so previously-invisible requests surface.
          const pending = !maStatus || maStatus === 'Pending'
          if (!pending) return
          if (data.status === 'Approved' || data.status === 'Rejected' || data.status === 'Cancelled') return
          if (!inScope(data.companyId)) return
          const approvalStatus = data.approvalStatus || {}
          const tiers = getEffectiveTiers(data.applicantRole)
          if (tiers.length > 0 && !tiers.every(t => approvalStatus[t] === 'Approved')) return
          leaves.push({
            kind: 'leave',
            id: d.id,
            name: data.employeeName || data.userName || 'Unknown',
            detail: `${data.leaveType || 'Leave'} · ${fmtDate(toDate(data.startDate))} → ${fmtDate(toDate(data.endDate))} (${data.totalDays || 0}d)`,
            sub: `${tiers.length === 0 ? 'All tiers auto-completed' : `${tiers.map(t => TIER_LABELS[t]).join(' + ')} approved`} — awaiting Master Admin`,
            payload: data,
            requestedAt: toDate(data.appliedOn),
          })
        })
        leaveDone = true
        emit()
      },
      () => { leaveDone = true; emit() },
    )

    const unsubPunches = onSnapshot(
      query(collection(db, 'attendance'), where('missedPunchRectification.masterAdminRequired', '==', true)),
      (snap) => {
        punches.length = 0
        snap.docs.forEach(d => {
          const data = d.data()
          const mp = data.missedPunchRectification || {}
          if (!mp.masterAdminRequired) return
          const maStatus = mp.masterAdminApproveStatus
          const pending = !maStatus || maStatus === 'Pending'
          if (!pending) return
          if (!inScope(data.companyId)) return
          const approvalStatus = mp.approvalStatus || {}
          const tiers = mpEffectiveTiers(mp.applicantRole)
          if (tiers.length > 0 && !tiers.every(t => approvalStatus[t] === 'Approved')) return
          punches.push({
            kind: 'missedPunch',
            id: d.id,
            name: data.name || data.userName || 'Unknown',
            detail: `Missed Punch · ${fmtDate(toDate(data.date))}`,
            sub: `${mp.correctedCheckOut ? `Corrected check-out ${fmtTime(mp.correctedCheckOut)}` : ''}${tiers.length === 0 ? ' · All tiers auto-completed' : ` · ${tiers.map(t => TIER_LABELS[t]).join(' + ')} approved`} — awaiting Master Admin`,
            payload: mp,
            requestedAt: toDate(mp.requestedAt),
          })
        })
        punchDone = true
        emit()
      },
      () => { punchDone = true; emit() },
    )

    return () => { try { unsubLeaves() } catch {} try { unsubPunches() } catch {} }
  }, [scopeKey])

  const openReview = (item: MaxItem, action: 'Approved' | 'Rejected') => {
    setReviewItem(item)
    setReviewAction(action)
    setNote('')
  }

  const closeReview = () => {
    setReviewItem(null)
    setReviewAction('Approved')
    setNote('')
  }

  const confirmReview = async () => {
    if (!reviewItem) return
    if (!note.trim()) { setActionError('A mandatory remark is required for Master Admin review.'); return }
    setActionError(null)
    setSubmitting(true)
    try {
      if (reviewItem.kind === 'leave') {
        await reviewMasterAdminLeaveRequest(reviewItem.id, reviewAction, userId, userName, note.trim())
      } else {
        await reviewMasterAdminMissedPunch(reviewItem.id, reviewAction, userId, userName, note.trim())
      }
      await logAudit({
        userId, userName: userName || 'User',
        userRole: 'master-admin',
        action: `${reviewAction} ${reviewItem.kind === 'leave' ? 'leave' : 'missed punch'} as Master Admin (${reviewItem.name})`,
        actionType: 'update',
        module: reviewItem.kind === 'leave' ? 'Leave' : 'Attendance',
        targetEntity: reviewItem.name,
        status: 'success',
        details: note.trim(),
      }).catch(() => {})
      closeReview()
    } catch (err) {
      console.error('Master Admin review failed:', err)
      setActionError(errText(err, 'Failed to update request. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="accordion-card" style={{ marginBottom: 12 }}>
      <div className="accordion-header">
        <h3><ShieldAlert size={16} /> Master Admin Final-Verification Queue</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!closed && items.length > 0 && (
            <span className="lap-count">
              {items.length} request{items.length !== 1 ? 's' : ''} awaiting your final verification
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
            <div className="lap-loading-inline" style={{ padding: 20 }}><Loader2 className="animate-spin" size={20} /> Loading final-verification queue...</div>
          ) : items.length === 0 ? (
            <div className="lap-empty">No requests awaiting your final verification.</div>
          ) : (
            <div className="lap-table-wrap">
              <table className="lap-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Request</th>
                    <th>Details</th>
                    <th>Final Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={`${item.kind}-${item.id}`}>
                      <td>
                        <div className="lap-entity">{item.name}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{item.kind === 'leave' ? 'Leave Request' : 'Missed Punch'}</div>
                      </td>
                      <td>
                        <span className="lap-pill" style={{ background: item.kind === 'leave' ? '#eff6ff' : '#f5f3ff', color: item.kind === 'leave' ? '#2563eb' : '#7c3aed' }}>
                          {item.detail}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>{item.sub}</td>
                      <td>
                        <div className="lap-row-actions">
                          <button className="lap-row-btn" title="View details & approval progress" onClick={() => setViewItem(item)}>
                            <Eye size={14} /> View
                          </button>
                          <button className="lap-row-btn lap-approve" title="Approve as Master Admin" onClick={() => openReview(item, 'Approved')}>
                            <Check size={14} /> Approve
                          </button>
                          <button className="lap-row-btn lap-reject" title="Reject as Master Admin" onClick={() => openReview(item, 'Rejected')}>
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

      <Modal
        isOpen={!!reviewItem}
        onClose={closeReview}
        title={reviewItem ? `${reviewAction === 'Approved' ? 'Approve' : 'Reject'} as Master Admin` : ''}
        size="small"
      >
        {reviewItem && (
          <div className="modal-form">
            <div style={{ marginBottom: '12px' }}>
              <p><strong>{reviewItem.name}</strong></p>
              <p style={{ fontSize: '14px', color: '#374151' }}>{reviewItem.detail}</p>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: 4 }}>{reviewItem.sub}</p>
              {reviewItem.kind === 'leave' && (
                <p style={{ fontSize: '14px', marginTop: '6px' }}>Reason: {reviewItem.payload.reason || '—'}</p>
              )}
              {reviewItem.kind === 'missedPunch' && (
                <p style={{ fontSize: '14px', marginTop: '6px' }}>Remark: {reviewItem.payload.remark || '—'}</p>
              )}
            </div>

            <div className="form-group">
              <label>Remark / Reason *</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Write a mandatory remark for your final decision..." />
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={closeReview}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: reviewAction === 'Approved' ? '#16a34a' : '#ef4444' }}
                onClick={confirmReview}
                disabled={submitting || !note.trim()}
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                {submitting ? 'Saving...' : `${reviewAction === 'Approved' ? 'Approve' : 'Reject'} as Master Admin`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!viewItem} onClose={() => setViewItem(null)} title={viewItem ? `${viewItem.kind === 'leave' ? 'Leave' : 'Missed Punch'} — Approval Details` : ''} size="small">
        {viewItem && (() => {
          const p = viewItem.payload
          const isLeave = viewItem.kind === 'leave'
          const effective = isLeave ? getEffectiveTiers(p.applicantRole) : getRecordEffectiveMissedPunchTiers(p)
          const labels = isLeave ? TIER_LABELS : MISSED_PUNCH_TIER_LABELS
          const approvalStatus = p.approvalStatus || {}
          const approvalLog = (p.approvalLog || []) as Array<{ tier: string; status: string; approvedBy: string; approvedByName: string; note?: string }>
          const maStatus = p.masterAdminApproveStatus
          const done = effective.filter(t => approvalStatus[t] === 'Approved' || approvalStatus[t] === 'Rejected').length
          const total = effective.length + (p.masterAdminRequired ? 1 : 0)
          const stChip = (status: string) => {
            if (status === 'Approved') return { bg: '#dcfce7', text: '#16a34a' }
            if (status === 'Rejected') return { bg: '#fee2e2', text: '#ef4444' }
            return { bg: '#fef3c7', text: '#b45309' }
          }
          return (
            <div className="modal-form">
              <div style={{ marginBottom: '12px' }}>
                <p><strong>{viewItem.name}</strong></p>
                <p style={{ fontSize: '14px', color: '#374151' }}>{viewItem.detail}</p>
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: 4 }}>{viewItem.sub}</p>
                {isLeave && <p style={{ fontSize: '14px', marginTop: '6px' }}>Reason: {p.reason || '—'}</p>}
                {!isLeave && p.correctedCheckOut && (
                  <p style={{ fontSize: '14px', marginTop: '6px' }}>Corrected check-out: {fmtTime(p.correctedCheckOut)}</p>
                )}
              </div>

              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                Approval Progress: <strong>{Math.min(done, total)}</strong>/{total} step{total > 1 ? 's' : ''} resolved
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {effective.map(t => {
                  const st = approvalStatus[t] || 'Pending'
                  const c = stChip(st)
                  return (
                    <span key={t} style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: c.bg, color: c.text }}>
                      {labels[t as keyof typeof labels]}: {st}
                    </span>
                  )
                })}
                {p.masterAdminRequired && (
                  <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: maStatus === 'Approved' ? '#dcfce7' : maStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', color: maStatus === 'Approved' ? '#16a34a' : maStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                    Master Admin: {maStatus || 'Pending'}
                  </span>
                )}
              </div>

              {approvalLog.length > 0 && (
                <div style={{ marginTop: '10px', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Audit Log</p>
                  {approvalLog.map((entry, idx) => (
                    <div key={idx} style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, background: entry.status === 'Approved' ? '#dcfce7' : '#fee2e2', color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }}>
                        {entry.status === 'Approved' ? '✓' : '✗'}
                      </span>
                      <span><strong>{labels[entry.tier as keyof typeof labels] || entry.tier}</strong> by {entry.approvedByName}</span>
                      {entry.note && <span style={{ fontStyle: 'italic' }}>({entry.note})</span>}
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-primary" onClick={() => setViewItem(null)}>Close</button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}