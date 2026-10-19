import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock, Calendar, CalendarPlus, CheckSquare, Users, Search, Eye,
  ArrowUpRight, Loader2, X, Check, FileText
} from 'lucide-react'
import { Header } from '../../components/Header'
import { Modal } from '../../components/Modal'
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard'
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel'
import { LeaveApplyModal } from '../../components/LeaveApplyModal'
import { SelfAttendanceCard } from '../../components/SelfAttendanceCard'
import { useAuth } from '../../context/AuthContext'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { subscribeToTeamByManager } from '../../services/employeeService'
import { createLeaveRequest, calcLeaveDays, isLeaveTypePaid, getActionableLeaveTier } from '../../services/leaveService'
import { getActionableMissedPunchTier } from '../../services/attendanceService'
import { logAudit } from '../../services/auditLogService'
import type { Employee, LeaveType, ApprovalTier, ApprovalLevel } from '../../types/user'
import { roleDepartmentLabel } from '../../utils/roleLabels'
import { isActiveMissedPunchRecord, recentMissPunchSinceDate } from '../../utils/attendanceStatus'
import './../Dashboard.css'

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity']
const todayStr = new Date().toISOString().split('T')[0]

const statusColors: Record<string, { bg: string; text: string }> = {
  Active: { bg: '#dcfce7', text: '#16a34a' },
  Inactive: { bg: '#fee2e2', text: '#ef4444' },
  'On Leave': { bg: '#ffedd5', text: '#f97316' },
}

export function ReportingManagerDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [team, setTeam] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Leave modal state
  const [isLeaveOpen, setIsLeaveOpen] = useState(false)
  const [leaveTarget, setLeaveTarget] = useState<Employee | null>(null)
  const [leaveType, setLeaveType] = useState<LeaveType>('Casual')
  const [leaveStart, setLeaveStart] = useState(todayStr)
  const [leaveEnd, setLeaveEnd] = useState(todayStr)
  const [leaveReason, setLeaveReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [missPunchCount, setMissPunchCount] = useState(0)
  const [pendingLeaves, setPendingLeaves] = useState(0)
  const [showLeaveApply, setShowLeaveApply] = useState(false)

  const unsubRef = useRef<(() => void) | null>(null)
  const unsubAttRef = useRef<(() => void) | null>(null)
  const unsubLeaveRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    unsubRef.current = subscribeToTeamByManager(user.id, (emps) => {
      setTeam(emps)
      setLoading(false)
    }, {
      companyIds: user.companyId ? [user.companyId] : [],
      includeScope: false,
    })
    return () => {
      if (unsubRef.current) unsubRef.current()
    }
  }, [user?.id, user?.companyId])

  // Realtime count of ACTIVE missed punches currently awaiting THIS RM's
  // decision, scoped to their company (matches the Attendance page rows the RM
  // gets Approve/Reject controls on): pending rectifications whose next Pending
  // tier belongs to the RM, or legacy records with no stamped approver.
  const scopeCompanyId = user?.companyId
  useEffect(() => {
    if (!user?.id || !scopeCompanyId) { setMissPunchCount(0); return }
    const q = query(
      collection(db, 'attendance'),
      where('companyId', '==', scopeCompanyId),
      where('date', '>=', recentMissPunchSinceDate())
    )
    const unsub = onSnapshot(q, (snap) => {
      let count = 0
      snap.docs.forEach(d => {
        const a = d.data()
        if (
          isActiveMissedPunchRecord(a) &&
          getActionableMissedPunchTier(a, user.id, user.role, [scopeCompanyId])
        ) count++
      })
      setMissPunchCount(count)
    }, () => setMissPunchCount(0))
    return () => unsub()
  }, [user?.id, user?.role, scopeCompanyId])

  // Realtime count of leave requests that await this RM's decision, scoped to
  // their company. Matches the Leave Approvals Panel queue (and the leaves
  // management tables) rather than a broad "any Pending" status count.
  useEffect(() => {
    if (!user?.id || !user.companyId) { setPendingLeaves(0); return }
    const rmScope = user.companyId
    const q = query(
      collection(db, 'leaveRequests'),
      where('companyId', '==', user.companyId),
      where('status', '==', 'Pending')
    )
    unsubLeaveRef.current = onSnapshot(q, (snap) => {
      let count = 0
      snap.docs.forEach(d => {
        const a = d.data()
        if (getActionableLeaveTier(a, user.id, user.role, [rmScope])) count++
      })
      setPendingLeaves(count)
    }, () => setPendingLeaves(0))
    return () => {
      if (unsubLeaveRef.current) unsubLeaveRef.current()
    }
  }, [user?.id, user?.companyId, user?.role])

  const active = team.filter(e => e.status === 'Active').length
  const onLeave = team.filter(e => e.status === 'On Leave').length
  const inactive = team.filter(e => e.status === 'Inactive').length
  const filtered = team.filter(e => {
    const s = searchTerm.toLowerCase()
    return !s || e.name.toLowerCase().includes(s) || e.email.toLowerCase().includes(s) || e.department.toLowerCase().includes(s)
  })

  const openLeaveModal = (emp: Employee) => {
    setLeaveTarget(emp)
    setLeaveType('Casual')
    setLeaveStart(todayStr)
    setLeaveEnd(todayStr)
    setLeaveReason('')
    setIsLeaveOpen(true)
  }

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!leaveTarget || !user) return
    const start = new Date(leaveStart)
    const end = new Date(leaveEnd)
    const totalDays = calcLeaveDays(start, end)
    if (totalDays <= 0) { alert('End date must be on or after start date'); return }
    setIsSubmitting(true)
    try {
      const tierOverrides: Partial<Record<ApprovalTier, ApprovalLevel>> = {
        reportingManager: 'Approved'
      }
      await createLeaveRequest({
        userId: leaveTarget.userId,
        employeeName: leaveTarget.name,
        employeeId: leaveTarget.employeeId,
        employeeEmail: leaveTarget.email,
        avatar: leaveTarget.avatar || '',
        department: leaveTarget.department,
        departmentId: leaveTarget.departmentId,
        companyId: leaveTarget.companyId,
        leaveType,
        startDate: start,
        endDate: end,
        totalDays,
        reason: leaveReason,
        isPaid: isLeaveTypePaid(leaveType),
      }, tierOverrides)

      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: 'Manual leave submitted from dashboard for team member',
        actionType: 'create',
        module: 'Reporting Manager Dashboard',
        targetEntity: leaveTarget.name,
        companyId: leaveTarget.companyId,
        status: 'success',
        details: `${leaveType} - ${totalDays} day(s) (Tier 1 bypassed)`,
      })

      setIsLeaveOpen(false)
      setLeaveTarget(null)
    } catch (err) {
      console.error('Error submitting manual leave:', err)
      alert('Failed to submit leave request')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (path === '__self-apply__') setShowLeaveApply(true)
      else navigate(path)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading your team...</p></div></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Dashboard" />

      <div className="page-content">
        {/* Welcome Hero */}
        <div className="dash-hero">
          <div className="dash-hero-content">
            <span className="dash-hero-greeting">Welcome back,</span>
            <h2 className="dash-hero-name">{user?.name || 'User'}</h2>
            <span className="dash-hero-role">{roleDepartmentLabel(user)}</span>
          </div>
          <div className="dash-hero-stats">
            {[
              { label: 'Team', value: team.length, color: '#3b82f6' },
              { label: 'Active', value: active, color: '#10b981' },
              { label: 'On Leave', value: onLeave, color: '#f59e0b' },
              { label: 'Inactive', value: inactive, color: '#ef4444' },
            ].map((s) => (
              <div key={s.label} className="dash-hero-stat">
                <span className="dash-hero-stat-value" style={{ color: s.color }}>{s.value}</span>
                <span className="dash-hero-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Missed Punch + Leave Approvals — immediate reviewer attention */}
        <MissedPunchAlertCard count={missPunchCount} badge={missPunchCount} />
        {user?.companyId && (
          <LeaveApprovalsPanel
            companyIds={[user.companyId]}
            userId={user.id}
            userName={user.name || ''}
            role={user.role}
          />
        )}

        {/* Self Attendance */}
        <SelfAttendanceCard role="reporting-manager" />

        {/* Personal Leave & Attendance Portal */}
        <div className="accordion-card" style={{ marginBottom: 12 }}>
          <div className="accordion-header">
            <h3><Calendar size={16} /> My Leaves & Attendance</h3>
            <button
              className="dash-action"
              style={{ background: '#8b5cf6', border: 'none', color: '#fff', fontSize: 12, padding: '4px 12px' }}
              onClick={() => navigate('/reporting-manager/my-leaves-attendance')}
            >
              Open Personal Portal
            </button>
          </div>
          <div style={{ padding: '0 20px 16px', fontSize: 13, color: '#6b7280' }}>
            Track your own leave requests and approval progress (Company Admin → Executive → Team Leader), attendance
            history, remaining balances, and submit missed-punch corrections for yourself.
          </div>
        </div>

        {/* Metric Cards */}
        <div className="stats-grid">
          {[
            { icon: Users, label: 'Team Members', count: team.length, trend: 'Your reports', path: '/reporting-manager/my-team' },
            { icon: Clock, label: 'Active', count: active, trend: 'Available now', path: '/reporting-manager/attendance' },
            { icon: Calendar, label: 'On Leave', count: onLeave, trend: 'Away today', path: '/reporting-manager/leaves' },
            { icon: CheckSquare, label: 'Inactive', count: inactive, trend: 'Not active', path: '/reporting-manager/my-team' },
            { icon: CalendarPlus, label: 'Pending Leave Approvals', count: pendingLeaves, trend: pendingLeaves > 0 ? 'Requires your review' : 'All clear', path: '/reporting-manager/leaves?status=Pending' },
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
              { icon: Clock, label: 'Team Attendance', path: '/reporting-manager/attendance', color: '#f59e0b' },
              { icon: Users, label: 'My Team', path: '/reporting-manager/my-team', color: '#10b981' },
              { icon: CalendarPlus, label: 'Apply My Leave', path: '__self-apply__', color: '#8b5cf6' },
              { icon: CalendarPlus, label: 'Team Leave', path: '/reporting-manager/leaves', color: '#7c3aed' },
              { icon: Calendar, label: 'Leave Requests', path: '/reporting-manager/leaves?status=Pending', color: '#7c3aed' },
              { icon: CheckSquare, label: 'Tasks', path: '/reporting-manager/tasks', color: '#ec4899' },
            ].map((item, idx) => {
              const Icon = item.icon
              return (
                <div key={idx} className="quick-action-card" onClick={() => item.path === '__self-apply__' ? setShowLeaveApply(true) : navigate(item.path)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, item.path)}>
                  <div className="qa-icon" style={{ background: `${item.color}15`, color: item.color }}>
                    <Icon size={22} />
                  </div>
                  <span>{item.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* My Team Panel */}
        <div className="accordion-card">
          <div className="accordion-header">
            <h3><Users size={15} /> My Team</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  placeholder="Search team..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ padding: '6px 10px 6px 28px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, width: 200 }}
                />
              </div>
              <button className="dash-action" onClick={() => navigate('/reporting-manager/my-team')}>
                View All <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
          <div style={{ padding: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} className="empty-cell">No team members found</td></tr>
                  ) : filtered.map(emp => {
                    const sc = statusColors[emp.status] || { bg: '#f3f4f6', text: '#6b7280' }
                    return (
                      <tr key={emp.id}>
                        <td><span style={{ fontWeight: 500 }}>{emp.name}</span></td>
                        <td>{emp.department}</td>
                        <td>{emp.designation}</td>
                        <td><span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{emp.status}</span></td>
                        <td>
                          <div className="emp-actions">
                            <button className="emp-action-icon view" onClick={() => navigate(`/reporting-manager/employee-profile/${emp.slug || emp.id}`)} title="View Profile"><Eye size={15} /></button>
                            <button className="emp-action-icon" style={{ background: '#fce7f3', color: '#db2777' }} onClick={() => navigate(`/reporting-manager/tasks?assignee=${emp.userId || emp.id}`)} title="Assign Task"><CheckSquare size={15} /></button>
                            <button className="emp-action-icon" style={{ background: '#dbeafe', color: '#2563eb' }} onClick={() => openLeaveModal(emp)} title="Apply Leave"><CalendarPlus size={15} /></button>
                            <button className="emp-action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }} onClick={() => navigate(`/reporting-manager/attendance?employee=${emp.id}`)} title="Attendance"><Clock size={15} /></button>
                            <button className="emp-action-icon" style={{ background: '#fef3c7', color: '#d97706' }} onClick={() => navigate(`/reporting-manager/leaves?employee=${emp.id}`)} title="Leave History"><FileText size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Leave Modal */}
      <Modal isOpen={isLeaveOpen} onClose={() => setIsLeaveOpen(false)} title={`Manual Leave — ${leaveTarget?.name || ''}`} size="small">
        <form onSubmit={handleSubmitLeave} className="modal-form">
          <div style={{ marginBottom: '12px', padding: '8px 12px', background: '#eff6ff', borderRadius: '6px', fontSize: '13px', color: '#1e40af' }}>
            <strong>Bypass Notice:</strong> Tier 1 (Reporting Manager) will be auto-approved. This leave goes directly to Company Admin for approval.
          </div>

          <div className="form-group">
            <label>Leave Type *</label>
            <select value={leaveType} onChange={e => setLeaveType(e.target.value as LeaveType)} required>
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}{isLeaveTypePaid(t) ? ' (Paid)' : ' (Unpaid)'}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Start Date *</label>
              <input type="date" value={leaveStart} onChange={e => setLeaveStart(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>End Date *</label>
              <input type="date" value={leaveEnd} onChange={e => setLeaveEnd(e.target.value)} required />
            </div>
          </div>

          <div style={{ background: '#f9fafb', padding: '10px 14px', borderRadius: '8px', fontSize: '14px', marginBottom: '8px' }}>
            Total Days: <strong>{calcLeaveDays(new Date(leaveStart), new Date(leaveEnd))}</strong>
          </div>

          <div className="form-group">
            <label>Reason *</label>
            <textarea value={leaveReason} onChange={e => setLeaveReason(e.target.value)} rows={3} placeholder="Reason for leave..." required />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsLeaveOpen(false)}>
              <X size={14} /> Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : <><Check size={14} /> Submit Manual Leave</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* Self leave application (standard employee flow) */}
      <LeaveApplyModal isOpen={showLeaveApply} onClose={() => setShowLeaveApply(false)} companyId={user?.companyId || undefined} />
    </div>
  )
}
