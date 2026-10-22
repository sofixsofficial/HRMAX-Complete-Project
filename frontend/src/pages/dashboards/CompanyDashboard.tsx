import { useState, useEffect } from 'react'
import { errText } from '../../aws/errors';
import { useNavigate } from 'react-router-dom'
import {
  Users, Clock, Calendar, Wallet, CheckSquare, Megaphone,
  Loader2, Building2, BarChart3, Package, ArrowUpRight,
  UserX, UserCheck, Mail, Send, Bell, CheckCircle2, XCircle,
} from 'lucide-react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { Header } from '../../components/Header'
import { DashboardHero } from '../../components/DashboardHero'
import { Modal } from '../../components/Modal'
import { Toast } from '../../components/Toast'
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard'
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel'
import { useAuth } from '../../context/AuthContext'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { subscribeToAdminAlerts, markAdminAlertAsRead, type AdminAlert } from '../../services/notificationService'
import { getEmployeesByCompany } from '../../services/employeeService'
import { getDepartmentsByCompany } from '../../services/departmentService'
import { companyAdminBroadcast, listBroadcastJobs, type BroadcastJob, type BroadcastMode, type BroadcastMessageType } from '../../services/broadcastService'
import type { Employee, Department } from '../../types/user'
import './../Dashboard.css'

interface DashboardCard {
  icon: typeof Building2
  label: string
  count: string | number
  trend?: string
  path: string
  show: boolean
}

export function CompanyDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const stats = useDashboardStats(user?.companyId)
  const [announcements, setAnnouncements] = useState(0)

  const companyId = user?.companyId || ''
  const isCompanyAdmin = user?.role === 'company-admin'

  // Admin Alerts — real-time, scoped to this company
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [jobs, setJobs] = useState<BroadcastJob[]>([])

  // Broadcast modal state
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false)
  const [broadcastMode, setBroadcastMode] = useState<BroadcastMode>('all-active')
  const [departmentId, setDepartmentId] = useState('')
  const [messageType, setMessageType] = useState<BroadcastMessageType>('general')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    const ref = user?.companyId
      ? query(collection(db, 'announcements'), where('companyId', '==', user.companyId))
      : collection(db, 'announcements')
    const unsub = onSnapshot(ref, (snap) => {
      setAnnouncements(snap.size)
    }, () => setAnnouncements(0))
    return () => unsub()
  }, [user?.companyId])

  // Real-time admin alerts + broadcast confirmation logs (company scope only)
  useEffect(() => {
    const unsub = subscribeToAdminAlerts((all) => {
      if (!companyId) { setAlerts([]); return }
      setAlerts(all.filter(a => a.companyId === companyId).slice(0, 20))
    })
    return () => unsub()
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    listBroadcastJobs(companyId).then(setJobs).catch(() => setJobs([]))
  }, [companyId])

  const loadEmployees = async () => {
    if (!companyId) return
    setLoadingEmployees(true)
    try {
      const all = await getEmployeesByCompany(companyId)
      setEmployees(all.filter(e => e.status === 'Active'))
      const deps = await getDepartmentsByCompany(companyId)
      setDepartments(deps)
    } catch {
      setEmployees([])
      setDepartments([])
    } finally {
      setLoadingEmployees(false)
    }
  }

  const openBroadcast = () => {
    setIsBroadcastOpen(true)
    setBroadcastMode('all-active')
    setDepartmentId('')
    setMessageType('general')
    setSubject('')
    setMessage('')
    setSelectedEmployeeIds(new Set())
    loadEmployees()
  }

  const toggleEmployee = (id: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllSelected = () => {
    if (selectedEmployeeIds.size === employees.length && employees.length > 0) setSelectedEmployeeIds(new Set())
    else setSelectedEmployeeIds(new Set(employees.map(e => e.userId || e.id).filter(Boolean)))
  }

  const effectiveTargets = broadcastMode === 'department' && departmentId
    ? employees.filter(e => e.departmentId === departmentId)
    : broadcastMode === 'selected'
      ? employees.filter(e => selectedEmployeeIds.has(e.userId || e.id))
      : employees

  const handleSendBroadcast = async () => {
    if (!companyId) { setToast({ message: 'No company scope selected.', type: 'error' }); return }
    const targetCount = broadcastMode === 'selected' ? selectedEmployeeIds.size : effectiveTargets.length
    if ((broadcastMode === 'department' && !departmentId) || (broadcastMode === 'selected' && targetCount === 0)) {
      setToast({ message: 'Please select recipients for the broadcast.', type: 'error' })
      return
    }
    if (!subject.trim() || !message.replace(/<[^>]*>/g, '').trim()) {
      setToast({ message: 'Subject and message are required.', type: 'error' })
      return
    }
    if (!confirm(`Send this broadcast to ${targetCount} employee(s) in your company? Each employee receives a personal email (no group visibility) plus an in-app notification, and you get a confirmation log.`)) return

    setSending(true)
    try {
      const res = await companyAdminBroadcast({
        companyId,
        recipientMode: broadcastMode,
        departmentId: broadcastMode === 'department' ? departmentId : null,
        employeeIds: broadcastMode === 'selected' ? Array.from(selectedEmployeeIds) : [],
        subject: subject.trim(),
        message,
        messageType,
        notifyInApp: true,
      })
      if (!res.success) {
        setToast({ message: res.error || 'Broadcast failed.', type: 'error' })
        return
      }
      setToast({
        message: res.total === 0
          ? 'No active employees matched that scope.'
          : `Broadcast sent! ${res.dispatched ?? 0} delivered${res.failed ? `, ${res.failed} failed` : ''}.`,
        type: 'success',
      })
      setIsBroadcastOpen(false)
      listBroadcastJobs(companyId).then(setJobs).catch(() => {})
    } catch (err: any) {
      setToast({ message: errText(err, 'Broadcast failed.'), type: 'error' })
    } finally {
      setSending(false)
    }
  }

  const handleCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate(path)
    }
  }

  if (stats.loading) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading dashboard...</p></div>
        </div>
      </div>
    )
  }

  const topCards: DashboardCard[] = [
    { icon: Users, label: 'Total Employees', count: stats.totalEmployees, trend: `${stats.activeEmployees} Active`, path: '/employees', show: true },
    { icon: UserCheck, label: 'Active Employees', count: stats.activeEmployees, trend: 'Active', path: '/employees?status=Active', show: true },
    { icon: UserX, label: 'Inactive Employees', count: stats.inactiveEmployees, trend: 'Inactive', path: '/employees?status=Inactive', show: true },
    { icon: Clock, label: 'Present Today', count: stats.presentToday, trend: 'Checked In', path: '/attendance?status=Present&period=today', show: true },
    { icon: UserX, label: 'Absent Today', count: stats.absentToday, trend: 'Absent', path: '/attendance?status=Absent&period=today', show: true },
    { icon: Clock, label: 'Late Today', count: stats.lateToday, trend: 'Late', path: '/attendance?status=Late&period=today', show: true },
    { icon: Clock, label: 'Miss Punch', count: stats.missPunchToday, trend: stats.missPunchToday > 0 ? 'Needs attention' : 'All clear', path: '/attendance?status=Miss Punch&period=today', show: true },
    { icon: Calendar, label: 'On Leave', count: stats.onLeaveToday, trend: 'On Leave', path: '/employees?status=leave', show: true },
    { icon: Calendar, label: 'Pending Leaves', count: stats.pendingLeaves, trend: stats.pendingLeaves > 0 ? 'Awaiting Review' : 'None', path: '/leaves?status=Pending', show: true },
    { icon: CheckSquare, label: 'Pending Tasks', count: stats.pendingTasks, trend: stats.pendingTasks > 0 ? 'Pending' : 'All Done', path: '/tasks?status=Pending', show: true },
    { icon: Wallet, label: 'Payroll Records', count: stats.salaryGenerated, trend: 'Total Records', path: '/salary-slips', show: true },
    { icon: Building2, label: 'Departments', count: stats.activeDepartments, trend: 'All', path: '/departments', show: true },
    { icon: Megaphone, label: 'Announcements', count: announcements, trend: 'Latest', path: '/announcements', show: true },
    { icon: Package, label: 'Assets', count: stats.totalAssets, trend: 'Manage', path: '/assets', show: true },
  ]

  const actionCards = [
    { icon: Users, label: 'Manage Employees', path: '/employees', color: '#10b981' },
    { icon: Building2, label: 'Departments', path: '/departments', color: '#f97316' },
    { icon: Clock, label: 'View Attendance', path: '/attendance', color: '#f59e0b' },
    { icon: Wallet, label: 'Process Payroll', path: '/payroll', color: '#ef4444' },
    { icon: Calendar, label: 'Review Leaves', path: '/leaves', color: '#8b5cf6' },
    { icon: BarChart3, label: 'Company Reports', path: '/reports', color: '#3b82f6' },
  ]

  const unreadAlerts = alerts.filter(a => !a.read)

  return (
    <div className="page-container">
      <Header title="Dashboard" />
      <div className="page-content">
        {/* Welcome Hero — time-based scene, live clock. Company Admin does not
            check in/out from the dashboard, so no attendance slice here. */}
        <DashboardHero
          showAttendance={false}
          stats={[
            { label: 'Present', value: stats.presentToday, color: '#10b981' },
            { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
            { label: 'On Leave', value: stats.onLeaveToday, color: '#3b82f6' },
            { label: 'Pending Tasks', value: stats.pendingTasks, color: '#ec4899' },
          ]}
        />

        {/* Missed Punch Alert */}
        <MissedPunchAlertCard count={stats.missPunchToday} badge={stats.missPunchToday} />

        {/* Multi-tier leave verification — requests routed to the company admin */}
        {user?.companyId && (
          <LeaveApprovalsPanel
            companyIds={[user.companyId]}
            userId={user.id}
            userName={user.name || ''}
            role={user.role}
          />
        )}

        {/* Top Stats Cards Row */}
        <div className="stats-grid">
          {topCards.map((card, idx) => {
            const Icon = card.icon
            return (
              <div key={idx} className="stat-card" onClick={() => navigate(card.path)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, card.path)}>
                <div className="stat-icon">
                  <Icon size={24} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">{card.label}</span>
                  <div className="stat-value">{card.count}</div>
                  {card.trend && <span className="stat-trend">{card.trend}</span>}
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
            {actionCards.map((item, idx) => {
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
            {isCompanyAdmin && companyId && (
              <div className="quick-action-card" onClick={openBroadcast} tabIndex={0} style={{ cursor: 'pointer' }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBroadcast() } }}>
                <div className="qa-icon" style={{ background: '#f9731615', color: '#f97316' }}>
                  <Mail size={22} />
                </div>
                <span>Email Broadcast</span>
              </div>
            )}
          </div>
        </div>

        {/* Company Admin Notification Center — real-time alerts + broadcast logs */}
        {isCompanyAdmin && companyId && (
          <div className="companies-section" style={{ marginTop: 24 }}>
            <div className="section-header-companies">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={18} /> Admin Notifications
                {unreadAlerts.length > 0 && (
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: 12, fontSize: 11, padding: '2px 8px' }}>{unreadAlerts.length}</span>
                )}
              </h3>
              {alerts.length > 0 && (
                <button className="btn-sm btn-secondary" onClick={() => navigate('/email-center')}>Email Center</button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <div className="table-container">
                <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Live Alerts</div>
                {alerts.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No recent notifications for your company.</div>
                ) : (
                  alerts.slice(0, 8).map(alert => (
                    <div
                      key={alert.id}
                      onClick={() => { if (!alert.read) markAdminAlertAsRead(alert.id).catch(() => {}) }}
                      style={{
                        padding: '10px 16px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                        background: alert.read ? '#fff' : '#fff7ed', display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: alert.read ? '#d1d5db' : '#f97316' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{alert.title}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{alert.body}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : ''}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="table-container">
                <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Send size={14} /> Broadcast Confirmation Logs
                  <button className="btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={openBroadcast}>
                    <Mail size={12} /> New Broadcast
                  </button>
                </div>
                {jobs.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No email broadcasts yet. Compose one to notify employees about payroll, attendance, or leave updates.</div>
                ) : (
                  jobs.map(job => (
                    <div key={job.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {job.failed > 0 ? <XCircle size={16} style={{ color: '#ef4444', marginTop: 2, flexShrink: 0 }} /> : <CheckCircle2 size={16} style={{ color: '#10b981', marginTop: 2, flexShrink: 0 }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{job.subject}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {job.dispatched} of {job.total} delivered
                          {job.failed ? ` · ${job.failed} failed` : ''} · mode: {job.recipientMode}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {job.createdAt ? new Date(job.createdAt).toLocaleString() : ''} · {job.triggeredByName || 'Admin'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Email Broadcast Modal */}
      <Modal isOpen={isBroadcastOpen} onClose={() => setIsBroadcastOpen(false)} title="Company Email Broadcast" size="large">
        <div className="modal-form">
          <div className="form-row">
            <div className="form-group">
              <label>Message Type *</label>
              <select value={messageType} onChange={e => setMessageType(e.target.value as BroadcastMessageType)}>
                <option value="general">General</option>
                <option value="payroll">Payroll / Salary</option>
                <option value="attendance">Attendance</option>
                <option value="leave">Leave</option>
              </select>
            </div>
            <div className="form-group">
              <label>Recipients (within {user?.name ? 'your' : 'selected'} company) *</label>
              <select value={broadcastMode} onChange={e => setBroadcastMode(e.target.value as BroadcastMode)}>
                <option value="all-active">All Active Employees</option>
                <option value="department">Specific Department</option>
                <option value="selected">Selected Employees</option>
              </select>
            </div>
          </div>

          {broadcastMode === 'department' && (
            <div className="form-group">
              <label>Department *</label>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">Select department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          {broadcastMode === 'selected' && (
            <div className="form-group">
              <label>Select Employees * ({selectedEmployeeIds.size} of {employees.length})</label>
              {loadingEmployees ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}><Loader2 className="animate-spin" size={16} style={{ marginRight: 6 }} />Loading employees...</div>
              ) : employees.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No active employees found in this company.</div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    <input type="checkbox" checked={selectedEmployeeIds.size === employees.length && employees.length > 0} onChange={toggleAllSelected} />
                    Select All ({employees.length})
                  </label>
                  {employees.map(emp => (
                    <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={selectedEmployeeIds.has(emp.userId || emp.id)} onChange={() => toggleEmployee(emp.userId || emp.id)} />
                      <span style={{ fontWeight: 500 }}>{emp.name}</span>
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>&lt;{emp.email}&gt;</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label>Subject *</label>
            <input type="text" placeholder="e.g. September payroll has been disbursed" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Message *</label>
            <textarea
              rows={6}
              placeholder="Write your broadcast message. Each employee receives a personalised, individual email (no group visibility) plus an in-app notification."
              value={message}
              onChange={e => setMessage(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
            />
          </div>

          <div style={{ fontSize: 12, color: '#6b7280', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
            Recipient count: <strong>{broadcastMode === 'selected' ? selectedEmployeeIds.size : effectiveTargets.length}</strong> active employee(s).
            Each recipient gets an individual email, an in-app notification, and the Company Admin receives a confirmation log with per-recipient delivery status.
          </div>

          <div className="modal-footer" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={() => setIsBroadcastOpen(false)} disabled={sending}>Cancel</button>
            <button className="btn-primary" onClick={handleSendBroadcast} disabled={sending}>
              {sending ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : <><Send size={16} /> Send Broadcast</>}
            </button>
          </div>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}