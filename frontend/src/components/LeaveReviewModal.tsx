import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from './Modal'
import { getEffectiveTiers, TIER_LABELS } from '../services/leaveService'
import type { LeaveRequest, ApprovalTier } from '../types/user'

export interface LeaveReviewDraft {
  leave: LeaveRequest
  tier: ApprovalTier
  action: 'Approved' | 'Rejected'
}

interface LeaveReviewModalProps {
  draft: LeaveReviewDraft | null
  submitting?: boolean
  onClose: () => void
  onConfirm: (draft: LeaveReviewDraft, note: string) => void
  readOnly?: boolean
}

const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })

const MA_TIER_LABEL = 'Master Admin'

const statusStyle = (status: string) => {
  if (status === 'Approved') return { bg: '#dcfce7', text: '#16a34a' }
  if (status === 'Rejected') return { bg: '#fee2e2', text: '#ef4444' }
  return { bg: '#fef3c7', text: '#f59e0b' }
}

/**
 * Multi-tier leave verification modal. Renders the request details, the
 * per-tier approval progress and log, plus a remarks field, then confirms the
 * Approve / Reject action at the caller-provided tier (the next pending tier
 * the current user is the assigned approver for).
 */
export function LeaveReviewModal({ draft, submitting, onClose, onConfirm, readOnly }: LeaveReviewModalProps) {
  const [note, setNote] = useState('')

  const reset = () => {
    setNote('')
    onClose()
  }

  return (
    <Modal
      isOpen={!!draft}
      onClose={reset}
      title={draft ? (readOnly ? 'Leave Request Details' : `${draft.action === 'Approved' ? 'Approve' : 'Reject'} as ${TIER_LABELS[draft.tier]}`) : ''}
      size="small"
    >
      {draft && (() => {
        const effective = getEffectiveTiers(draft.leave.applicantRole)
        const total = effective.length + (draft.leave.masterAdminRequired ? 1 : 0)
        const done =
          effective.filter(t => {
            const st = draft.leave.approvalStatus[t]
            return st === 'Approved' || st === 'Rejected'
          }).length +
          (draft.leave.masterAdminApproveStatus === 'Approved' || draft.leave.masterAdminApproveStatus === 'Rejected' ? 1 : 0)
        return (
        <div className="modal-form">
          <div style={{ marginBottom: '12px' }}>
            <p><strong>{draft.leave.employeeName}</strong> — {draft.leave.leaveType}</p>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              {fmtDate(draft.leave.startDate)} → {fmtDate(draft.leave.endDate)} ({draft.leave.totalDays} day{draft.leave.totalDays !== 1 ? 's' : ''})
            </p>
            <p style={{ fontSize: '14px', marginTop: '6px' }}>{draft.leave.reason}</p>

            <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {effective.map(t => {
                const st = draft.leave.approvalStatus[t]
                const done2 = st === 'Approved'
                const rejected = st === 'Rejected'
                const isCurrent = t === draft.tier
                return (
                  <span key={t} style={{
                    padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                    background: done2 ? '#dcfce7' : rejected ? '#fee2e2' : isCurrent ? '#dbeafe' : '#f3f4f6',
                    color: done2 ? '#16a34a' : rejected ? '#ef4444' : isCurrent ? '#2563eb' : '#6b7280',
                    border: isCurrent ? '1px solid #2563eb' : '1px solid transparent',
                  }}>
                    {TIER_LABELS[t]}: {st}
                  </span>
                )
              })}
              {(effective.length === 0) && !draft.leave.masterAdminRequired && (
                <span style={{
                  padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                  background: '#f3f4f6', color: '#6b7280', border: '1px solid transparent',
                }}>
                  All tiers auto-completed
                </span>
              )}
              {draft.leave.masterAdminRequired && (
                <span style={{
                  padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                  background: draft.leave.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : draft.leave.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed',
                  color: draft.leave.masterAdminApproveStatus === 'Approved' ? '#16a34a' : draft.leave.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412',
                  border: '1px solid transparent',
                }}>
                  {MA_TIER_LABEL}: {draft.leave.masterAdminApproveStatus || 'Pending'}
                </span>
              )}
            </div>

            <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
              Approval Progress: <strong>{done}</strong>/{total} tier{total > 1 ? 's' : ''} resolved
            </div>
          </div>

          {draft.leave.approvalLog && draft.leave.approvalLog.length > 0 && (
            <div style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Approval Log</p>
              {draft.leave.approvalLog.map((entry: any, idx: number) => (
                <div key={idx} style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                    background: entry.status === 'Approved' ? '#dcfce7' : '#fee2e2',
                    color: entry.status === 'Approved' ? '#16a34a' : '#ef4444',
                  }}>
                    {entry.status === 'Approved' ? '✓' : '✗'}
                  </span>
                  <span><strong>{TIER_LABELS[entry.tier as ApprovalTier] || entry.tier}</strong> by {entry.approvedByName}</span>
                  {entry.note && <span style={{ fontStyle: 'italic' }}>({entry.note})</span>}
                </div>
              ))}
            </div>
          )}

          {!readOnly ? (
          <>
          <div className="form-group">
            <label>Remark / Reason *</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Write a mandatory remark for this approval decision..." />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: draft.action === 'Approved' ? '#16a34a' : '#ef4444' }}
              onClick={() => onConfirm(draft, note)}
              disabled={submitting || !note.trim()}
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? 'Saving...' : `${draft.action === 'Approved' ? 'Approve' : 'Reject'} as ${TIER_LABELS[draft.tier]}`}
            </button>
          </div>
          </>
          ) : (
          <div className="modal-footer">
            <button type="button" className="btn-primary" onClick={reset}>Close</button>
          </div>
          )}
        </div>
        )
      })()}
    </Modal>
  )
}

export type { ApprovalTier }
export { statusStyle }