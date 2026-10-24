import { useState, useEffect } from 'react'
import { errText } from '../../aws/errors';
import { useNavigate } from 'react-router-dom'
import {
  Clock, Calendar, Wallet, CheckSquare, Megaphone, Loader2, Edit3, AlertCircle,
  ArrowUpRight,
} from 'lucide-react'
import { collection, query, where, onSnapshot } from '../../aws/firestore-compat'
import { db } from '../../aws/clients'
import { Header } from '../../components/Header'
import { DashboardHero } from '../../components/DashboardHero'
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../context/AuthContext'
import { useCompany } from '../../context/CompanyContext'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { useEmployeePersonalStats } from '../../hooks/useEmployeePersonalStats'
import { requestPunchRectification } from '../../services/attendanceService'
import { notifyAttendanceCascade } from '../../services/attendanceNotifier'
import { logAudit } from '../../services/auditLogService'
import type { AttendanceRecord } from '../../types/user'
import { isActiveMissedPunchRecord } from '../../utils/attendanceStatus'
import './../Dashboard.css'

const statusColor = (s?: string) => {
  switch (s) {
    case 'Present': return '#16a34a'
    case 'Late': return '#f59e0b'
    case 'Absent': return '#ef4444'
    case 'On Leave': return '#3b82f6'
    case 'Miss Punch': return '#9333ea'
    default: return '#6b7280'
  }
}

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

export function EmployeeDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const companyId = effectiveCompanyId || user?.companyId
  const stats = useDashboardStats(companyId)
  const personal = useEmployeePersonalStats()
  const [announcements, setAnnouncements] = useState(0)
  const [rectifyModal, setRectifyModal] = useState<AttendanceRecord | null>(null)
  const [rectifyTime, setRectifyTime] = useState('')
  const [submittingRectify, setSubmittingRectify] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const ref = companyId
      ? query(collection(db, 'announcements'), where('companyId', '==', companyId))
      : collection(db, 'announcements')
    const unsub = onSnapshot(ref, (snap) => {
      setAnnouncements(snap.size)
    }, () => setAnnouncements(0))
    return () => unsub()
  }, [companyId])

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return
    setSubmittingRectify(true)
    try {
      const [h, m] = rectifyTime.split(':').map(Number)
      const corrected = new Date(rectifyModal.date)
      corrected.setHours(h, m, 0, 0)
      await requestPunchRectification(rectifyModal.id, corrected)
      // Cascade the rectification request to the employee + full same-company
      // management chain (RM, Company Admin, assigned Executive, linked TL,
      // Master Admin) server-side, avoiding any cross-company leak.
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
      setActionMsg({ type: 'success', text: 'Rectification request submitted for manager review.' })
      setRectifyModal(null)
      setRectifyTime('')
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to submit rectification') })
    } finally {
      setSubmittingRectify(false)
    }
  }

  const handleCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate(path)
    }
  }

  if (stats.loading || personal.loading) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading dashboard...</p></div>
        </div>
      </div>
    )
  }

  const todayCompleted = !!personal.todayRecord?.checkIn && !!personal.todayRecord?.checkOut
  const todayStatus = todayCompleted
    ? 'Completed'
    : personal.todayRecord?.status || (personal.todayRecord ? 'Checked In' : 'Not Checked In')

  const missPunchCount = personal.monthRecords.filter(r => isActiveMissedPunchRecord(r)).length
  const unresolvedMissPunch = personal.monthRecords.filter(r => isActiveMissedPunchRecord(r)).length

  return (
    <div className="page-container">
      <Header title="Dashboard" />
      <div className="page-content">
        {/* Welcome Hero — time-based scene, live clock, server-confirmed working mode */}
        <DashboardHero
          stats={[
            { label: 'Present', value: personal.monthStats.present, color: '#10b981' },
            { label: 'Absent', value: personal.monthStats.absent, color: '#ef4444' },
            { label: 'Tasks', value: personal.activeTasks, color: '#ec4899' },
            { label: 'Rate', value: `${personal.attendanceRate}%`, color: '#f97316' },
          ]}
        />

        {/* Missed Punch Alert */}
        <MissedPunchAlertCard count={unresolvedMissPunch} badge={unresolvedMissPunch} label="Missed Punch / Rectification" />

        {actionMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: actionMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444',
            fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${actionMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {actionMsg.type === 'success' ? <CheckSquare size={15} /> : <AlertCircle size={15} />}
            {actionMsg.text}
            <button onClick={() => setActionMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>&times;</button>
          </div>
        )}

        {/* Top Stats Cards */}
        <div className="stats-grid">
          {[
            { icon: Clock, label: 'My Attendance', count: personal.monthStats.total, trend: 'This month', path: '/attendance' },
            { icon: Calendar, label: 'Pending Leaves', count: personal.pendingLeaves, trend: personal.pendingLeaves > 0 ? 'Awaiting review' : 'None pending', path: '/leaves?status=Pending' },
            { icon: Wallet, label: 'Salary Slips', count: personal.salarySlips, trend: personal.salarySlips > 0 ? 'Generated for you' : 'No slips yet', path: '/salary-slips' },
            { icon: CheckSquare, label: 'Pending Tasks', count: personal.activeTasks, trend: personal.activeTasks > 0 ? 'Needs attention' : 'All done', path: '/tasks?status=Pending' },
            { icon: Megaphone, label: 'Announcements', count: announcements, trend: 'From company', path: '/announcements' },
          ].map((card, idx) => {
            const Icon = card.icon
            return (
              <div key={idx} className="stat-card" onClick={() => navigate(card.path)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, card.path)}>
                <div className="stat-icon">
                  <Icon size={24} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">{card.label}</span>
                  <div className="stat-value">{card.count}</div>
                  <span className="stat-trend">{card.trend}</span>
                </div>
                <ArrowUpRight size={16} className="stat-arrow" />
              </div>
            )
          })}
        </div>

        {/* Quick Actions */}
        <div className="quick-actions-section">
          <h3>Quick Actions</h3>
          <div className="quick-actions-grid">
            {[
              { icon: Clock, label: 'Mark Attendance', path: '/attendance', color: '#f59e0b' },
              { icon: Calendar, label: 'Apply Leave', path: '/leaves', color: '#8b5cf6' },
              { icon: Wallet, label: 'View Salary', path: '/salary-slips', color: '#ef4444' },
              { icon: CheckSquare, label: 'My Tasks', path: '/tasks', color: '#ec4899' },
              { icon: Megaphone, label: 'Announcements', path: '/announcements', color: '#3b82f6' },
            ].map((item, idx) => {
              const Icon = item.icon
              return (
                <div key={idx} className="quick-action-card" onClick={() => navigate(item.path)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, item.path)}>
                  <div className="qa-icon" style={{ background: `${item.color}15`, color: item.color }}>
                    <Icon size={22} />
                  </div>
                  <span>{item.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Today's Attendance Panel */}
        <div className="accordion-card" style={{ marginBottom: 12 }}>
          <div className="accordion-header">
            <h3><Clock size={16} /> Today's Attendance</h3>
          </div>
          <div style={{ padding: '0 20px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14, borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor(personal.todayRecord?.status), flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Today's Status</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: statusColor(personal.todayRecord?.status) }}>
                  {todayStatus}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                  In: {formatTime(personal.todayRecord?.checkIn)}
                  {personal.todayRecord?.checkIn ? '  |  ' : ''}Out: {formatTime(personal.todayRecord?.checkOut)}
                </div>
                {personal.todayRecord && isActiveMissedPunchRecord(personal.todayRecord) && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#9333ea', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={13} />
                    Missed checkout —
                    <button onClick={() => setRectifyModal(personal.todayRecord)}
                      style={{ background: 'none', border: 'none', color: '#9333ea', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                      Rectify now
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card" style={{ cursor: 'default' }}>
                  <div className="stat-icon" style={{ background: '#dcfce715', color: '#16a34a' }}><Clock size={24} /></div>
                  <div className="stat-info">
                    <span className="stat-label">Present</span>
                    <div className="stat-value" style={{ color: '#16a34a' }}>{personal.monthStats.present}</div>
                  </div>
                </div>
                <div className="stat-card" style={{ cursor: 'default' }}>
                  <div className="stat-icon" style={{ background: '#fef3c715', color: '#f59e0b' }}><Clock size={24} /></div>
                  <div className="stat-info">
                    <span className="stat-label">Late</span>
                    <div className="stat-value" style={{ color: '#f59e0b' }}>{personal.monthStats.late}</div>
                  </div>
                </div>
                <div className="stat-card" style={{ cursor: 'default' }}>
                  <div className="stat-icon" style={{ background: '#fee2e215', color: '#ef4444' }}><Clock size={24} /></div>
                  <div className="stat-info">
                    <span className="stat-label">Absent</span>
                    <div className="stat-value" style={{ color: '#ef4444' }}>{personal.monthStats.absent}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>This Month</div>
              {personal.monthRecords.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: '#9ca3af', fontSize: 13 }}>
                  <Clock size={16} /> No attendance records yet this month
                </div>
              ) : (
                <ul className="dash-list">
                  {personal.monthRecords.slice(0, 5).map(r => (
                    <li key={r.id} className="dash-list-item">
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: '#111827' }}>{formatDate(r.date)}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          In: {formatTime(r.checkIn)}  |  Out: {formatTime(r.checkOut)}
                          {r.workHours ? `  |  ${r.workHours}h` : ''}
                        </div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: `1px solid ${statusColor(r.status)}33`, background: `${statusColor(r.status)}0d`, color: statusColor(r.status) }}>
                        {r.status}
                      </span>
                      {isActiveMissedPunchRecord(r) && (
                        <button onClick={() => setRectifyModal(r)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: '1px solid #9333ea40', background: '#f3e8ff', color: '#9333ea', cursor: 'pointer' }}>
                          <Edit3 size={11} /> Rectify
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button className="dash-action" style={{ marginTop: 12, background: '#f97316', border: 'none', color: '#fff' }} onClick={() => navigate('/attendance')}>
              <Clock size={15} /> View Full History
            </button>
          </div>
        </div>
      </div>

      {/* Missed Punch Rectification Modal */}
      <Modal isOpen={!!rectifyModal} onClose={() => { setRectifyModal(null); setRectifyTime('') }} title="Rectify Missed Punch" size="small">
        {rectifyModal && (
          <div style={{ padding: '8px 0' }}>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
              You missed your checkout on <strong>{formatDate(rectifyModal.date)}</strong>.
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Checked in at {formatTime(rectifyModal.checkIn)}. Please enter your actual checkout time.
            </p>
            <div style={{ marginBottom: 16 }}>
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRectifyModal(null); setRectifyTime('') }}
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
