import { useState } from 'react'
import { Clock, Edit3, AlertCircle, Loader2, Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useEmployeePersonalStats } from '../hooks/useEmployeePersonalStats'
import { useAuth } from '../context/AuthContext'
import { requestPunchRectification } from '../services/attendanceService'
import { notifyAttendanceCascade } from '../services/attendanceNotifier'
import { logAudit } from '../services/auditLogService'
import { Modal } from './Modal'
import { AttendancePunchBanner } from './AttendancePunchBanner'
import { isActiveMissedPunchRecord } from '../utils/attendanceStatus'
import type { AttendanceRecord, UserRole } from '../types/user'

const toDate = (v: any): Date | null => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  if (v instanceof Date) return v
  return null
}

const formatTime = (v: any) => {
  const d = toDate(v)
  if (!d) return '--'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

const formatDate = (v: any) => {
  const d = toDate(v)
  if (!d) return ''
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

interface SelfAttendanceCardProps {
  role: UserRole
}

const ROLE_LABELS: Record<string, string> = {
  'reporting-manager': 'Reporting Manager',
  'team-leader': 'Team Leader',
  'executive': 'Executive',
  'employee': 'Employee',
}

const MA_ROLES = new Set(['team-leader', 'executive'])

export function SelfAttendanceCard({ role }: SelfAttendanceCardProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const personal = useEmployeePersonalStats()
  const [rectifyModal, setRectifyModal] = useState<AttendanceRecord | null>(null)
  const [rectifyTime, setRectifyTime] = useState('')
  const [rectifyRemark, setRectifyRemark] = useState('')
  const [submittingRectify, setSubmittingRectify] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return
    setSubmittingRectify(true)
    try {
      const [h, m] = rectifyTime.split(':').map(Number)
      const corrected = new Date(rectifyModal.date)
      corrected.setHours(h, m, 0, 0)
      await requestPunchRectification(rectifyModal.id, corrected, rectifyRemark || undefined)
      await notifyAttendanceCascade({
        companyId: rectifyModal.companyId,
        employeeUserId: user.id,
        employeeName: user.name,
        kind: 'rectification-requested',
        dateLabel: new Date(rectifyModal.date).toLocaleDateString(),
        actorName: user.name,
      })
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Requested missed punch rectification for ${new Date(rectifyModal.date).toLocaleDateString()}`,
        actionType: 'update', module: 'Attendance', targetEntity: rectifyModal.name, status: 'success',
      })
      const routingNote = MA_ROLES.has(role)
        ? 'Rectification routed to Master Admin for review.'
        : 'Rectification submitted for manager review.'
      setActionMsg({ type: 'success', text: routingNote })
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to submit rectification' })
    } finally {
      setSubmittingRectify(false)
    }
  }

  if (personal.loading) return null

  const todayRecord = personal.todayRecord
  const unresolvedMissPunch = personal.monthRecords.filter(
    r => isActiveMissedPunchRecord(r)
  )

  return (
    <div className="accordion-card" style={{ marginBottom: 12 }}>
      <div className="accordion-header">
        <h3><Clock size={16} /> My Attendance</h3>
        <button className="dash-action" style={{ background: '#f97316', border: 'none', color: '#fff', fontSize: 12, padding: '4px 12px' }} onClick={() => navigate('/attendance')}>
          Full View
        </button>
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        {actionMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 12,
            background: actionMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444',
            fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${actionMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {actionMsg.type === 'success' ? <Clock size={15} /> : <AlertCircle size={15} />}
            {actionMsg.text}
            <button onClick={() => setActionMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>&times;</button>
          </div>
        )}

        {/* Mandatory orange check-in / check-out banner (dynamic Check In → Check Out) */}
        <AttendancePunchBanner />

        {/* Missed punch rectification prompt */}
        {todayRecord && isActiveMissedPunchRecord(todayRecord) && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#f3e8ff', border: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} style={{ color: '#9333ea', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#7e22ce', flex: 1 }}>Missed checkout detected</span>
            <button
              onClick={() => setRectifyModal(todayRecord)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#9333ea', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              <Edit3 size={12} /> Rectify Now
            </button>
          </div>
        )}

        {/* Monthly summary */}
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          {[
            { label: 'Present', value: personal.monthStats.present, color: '#16a34a' },
            { label: 'Late', value: personal.monthStats.late, color: '#f59e0b' },
            { label: 'Absent', value: personal.monthStats.absent, color: '#ef4444' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 8, background: `${s.color}0d`, border: `1px solid ${s.color}22` }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{s.label}</div>
            </div>
          ))}
          {unresolvedMissPunch.length > 0 && (
            <div
              onClick={() => navigate('/attendance?status=Miss Punch')}
              style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 8, background: '#f3e8ff', border: '1px solid #e9d5ff', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: '#9333ea' }}>{unresolvedMissPunch.length}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Unresolved</div>
            </div>
          )}
        </div>

        {/* Role routing info for TL/Exec */}
        {MA_ROLES.has(role) && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1e40af' }}>
            <Info size={14} style={{ flexShrink: 0 }} />
            Missed punch and leave requests are routed directly to the Master Admin for final review.
          </div>
        )}
        {role === 'reporting-manager' && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1e40af' }}>
            <Info size={14} style={{ flexShrink: 0 }} />
            Missed punch requests are routed through: Company Admin → Executive → Team Leader.
          </div>
        )}
      </div>

      {/* Missed Punch Rectification Modal */}
      <Modal isOpen={!!rectifyModal} onClose={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark('') }} title="Rectify Missed Punch" size="small">
        {rectifyModal && (
          <div style={{ padding: '8px 0' }}>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
              You missed your checkout on <strong>{formatDate(rectifyModal.date)}</strong>.
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Checked in at {formatTime(rectifyModal.checkIn)}. Please enter your actual checkout time.
            </p>
            {MA_ROLES.has(role) && (
              <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={13} />
                This rectification will be routed directly to the Master Admin for review.
              </div>
            )}
            {role === 'reporting-manager' && (
              <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={13} />
                This rectification will be routed: Company Admin → Executive → Team Leader.
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Correct Check-Out Time
              </label>
              <input
                type="time"
                value={rectifyTime}
                onChange={e => setRectifyTime(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                  fontSize: 14, outline: 'none'
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Remark (Optional)
              </label>
              <textarea
                value={rectifyRemark}
                onChange={e => setRectifyRemark(e.target.value)}
                rows={2}
                placeholder="Add a note for the approver..."
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                  fontSize: 13, outline: 'none', resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark('') }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
              <button onClick={handleRectifyRequest} disabled={!rectifyTime || submittingRectify}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: !rectifyTime ? '#d1d5db' : '#9333ea',
                  color: '#fff', cursor: !rectifyTime ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6
                }}>
                {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : null}
                Submit for Review
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
