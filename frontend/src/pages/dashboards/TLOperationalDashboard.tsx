import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock, CheckSquare, Calendar,
  Filter, Plus, Loader2, Search,
  AlertCircle, X, ArrowUpRight, Building2, Users, UserCheck, PartyPopper, Cake, Wallet, Eye,
} from 'lucide-react'
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { Header } from '../../components/Header'
import { DashboardHero } from '../../components/DashboardHero'
import { Modal } from '../../components/Modal'
import { TLFilterBar } from '../../components/TLFilterBar'
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard'
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel'
import { LeaveReviewModal } from '../../components/LeaveReviewModal'
import type { LeaveReviewDraft } from '../../components/LeaveReviewModal'
import { LeaveApplyModal } from '../../components/LeaveApplyModal'
import { SelfAttendanceCard } from '../../components/SelfAttendanceCard'
import { useAuth } from '../../context/AuthContext'
import { useTLFilter } from '../../context/TLFilterContext'
import { useCompany } from '../../context/CompanyContext'
import { useTeamDashboardStats } from '../../hooks/useTeamDashboardStats'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { createTask } from '../../services/taskService'
import { logAudit } from '../../services/auditLogService'
import { getNextPendingTier, TIER_LABELS, reviewTierLeaveRequest } from '../../services/leaveService'
import type { Task, LeaveRequest } from '../../types/user'
import './TLOperationalDashboard.css'
import './../Dashboard.css'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'In Progress': { bg: '#eff6ff', text: '#2563eb' },
  Completed: { bg: '#dcfce7', text: '#16a34a' },
  Approved: { bg: '#dcfce7', text: '#16a34a' },
  Open: { bg: '#eff6ff', text: '#2563eb' },
  Resolved: { bg: '#dcfce7', text: '#16a34a' },
  Present: { bg: '#dcfce7', text: '#16a34a' },
  Absent: { bg: '#fee2e2', text: '#dc2626' },
  Late: { bg: '#fef3c7', text: '#d97706' },
  'On Leave': { bg: '#f3f4f6', text: '#6b7280' },
  Pending: { bg: '#fef3c7', text: '#f59e0b' },
  Rejected: { bg: '#fee2e2', text: '#ef4444' },
}

export function TLOperationalDashboard() {
  const navigate = useNavigate()
  const { user: authUser, hasPermission } = useAuth()
  const canCreateTasks = hasPermission('tasks.create')
  const canApproveLeaves = hasPermission('leave.approve')
  const {
    executives, selectedExecutiveId, selectedCompanyId,
    isLoading, isReady,
    currentExecutive, currentCompany,
  } = useTLFilter()
  const { availableCompanies } = useCompany()

  // Overview + team stats follow the active scope:
  // nothing selected → all authorized companies · executive selected → their companies · company selected → just it
  const scopedCompanyIds = useMemo(() => {
    if (selectedCompanyId) return [selectedCompanyId]
    if (currentExecutive) return currentExecutive.assignedCompanyIds || []
    return [...new Set(executives.flatMap(e => e.assignedCompanyIds || []))]
  }, [selectedCompanyId, currentExecutive, executives])
  const teamStats = useTeamDashboardStats(scopedCompanyIds, authUser?.departmentId)
  const overviewStats = useDashboardStats(scopedCompanyIds)

  const [activities, setActivities] = useState<any[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Modals
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'Medium' as Task['priority'], assignedTo: '' })
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ type: 'error' | 'warning'; message: string } | null>(null)
  const [reviewDraft, setReviewDraft] = useState<LeaveReviewDraft | null>(null)
  const [showLeaveApply, setShowLeaveApply] = useState(false)
  const [viewActivity, setViewActivity] = useState<any | null>(null)

  const showToast = (type: 'error' | 'warning', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  const requireSelection = (): boolean => {
    if (!selectedExecutiveId) {
      showToast('warning', 'Please select an Executive first.')
      return false
    }
    if (!selectedCompanyId) {
      showToast('warning', 'Please select a Company first.')
      return false
    }
    return true
  }

  // Recent activity follows the active scope: the selected company, or every
  // authorized company when nothing is picked ("All Companies" mode).
  // Live onSnapshot feeds so new leaves / tasks / attendance appear instantly
  // in the "Pending Approvals" table without a manual refresh.
  const scopeKey = scopedCompanyIds.join(',')
  useEffect(() => {
    const ids = scopeKey ? scopeKey.split(',') : []
    if (ids.length === 0) {
      setActivities([])
      setActivitiesLoading(false)
      return
    }

    setActivitiesLoading(true)
    const companyNameOf = (cid: string) => availableCompanies.find(c => c.id === cid)?.name || cid
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Merged real-time feed, keyed by `${type}-${docId}` so a document removed
    // from any query (deleted / scope change) drops out automatically.
    const bucket: Record<string, any> = {}
    const unsubs: (() => void)[] = []
    const totalWatchKeys = ids.length * 3

    // Initial-load marker: the table shows as loading until every feed has
    // fired once (or errored); live recomputes keep flowing afterwards.
    const pendingMarkers = new Set<string>()
    const markFired = (watchKey: string) => {
      if (pendingMarkers.has(watchKey)) return
      pendingMarkers.add(watchKey)
      if (pendingMarkers.size >= totalWatchKeys) setActivitiesLoading(false)
    }

    const recompute = () => {
      const results = Object.values(bucket)
      results.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
      setActivities(results.slice(0, 30))
    }

    const mapTask = (d: any, cid: string) => {
      const d2 = d.data()
      return {
        id: `task-${d.id}`, type: 'task', title: d2.title || 'Untitled task',
        status: d2.status || 'Pending',
        companyId: d2.companyId || cid,
        companyName: companyNameOf(d2.companyId || cid),
        executiveId: currentExecutive?.id || '',
        executiveName: currentExecutive?.name || '',
        assignedTo: d2.assignedTo,
        dueDate: d2.dueDate,
        origin: 'Task', createdAt: d2.createdAt?.toDate?.() || new Date(),
      }
    }

    const mapLeave = (d: any, cid: string) => {
      const d2 = d.data()
      return {
        id: `leave-${d.id}`, type: 'leave', title: `${d2.employeeName || d2.userName || 'Unknown'} - ${d2.leaveType || 'Leave'}`,
        status: d2.status || 'Pending',
        companyId: d2.companyId || cid,
        companyName: companyNameOf(d2.companyId || cid),
        executiveId: currentExecutive?.id || '',
        executiveName: currentExecutive?.name || '',
        userName: d2.employeeName || d2.userName,
        userId: d2.userId,
        leaveType: d2.leaveType,
        fromDate: d2.startDate || d2.fromDate,
        toDate: d2.endDate || d2.toDate,
        totalDays: d2.totalDays || 0,
        reason: d2.reason || '',
        approvalStatus: d2.approvalStatus || {},
        approvalLog: d2.approvalLog || [],
        approverIds: d2.approverIds || {},
        origin: 'Leave', createdAt: d2.appliedOn?.toDate?.() || d2.createdAt?.toDate?.() || new Date(),
      }
    }

    const mapAttendance = (d: any, cid: string) => {
      const d2 = d.data()
      return {
        id: `att-${d.id}`, type: 'attendance', title: `${d2.name || 'Unknown'} attendance`,
        status: d2.status || 'Miss Punch',
        companyId: d2.companyId || cid,
        companyName: companyNameOf(d2.companyId || cid),
        executiveId: currentExecutive?.id || '',
        executiveName: currentExecutive?.name || '',
        userName: d2.name, date: d2.date,
        checkOut: d2.checkOut,
        origin: 'Attendance', createdAt: d2.date?.toDate?.() || new Date(),
      }
    }

    const watch = (keyPrefix: string, cid: string, ref: ReturnType<typeof query>, mapper: (d: any, cid: string) => any) => {
      const watchKey = `${cid}-${keyPrefix}`
      const unsub = onSnapshot(ref, (snap) => {
        // Rebuild this query's slice (handles adds/removes/modifies).
        for (const k of Object.keys(bucket)) if (k.startsWith(`${keyPrefix}-`)) delete bucket[k]
        snap.docs.forEach(d => { bucket[`${keyPrefix}-${d.id}`] = mapper(d, cid) })
        markFired(watchKey)
        recompute()
      }, (err) => {
        console.error(`[TL activities] ${keyPrefix} listener error:`, err?.message || err)
        markFired(watchKey)
        recompute()
      })
      unsubs.push(unsub)
    }

    ids.forEach(cid => {
      watch('task', cid,
        query(collection(db, 'tasks'), where('companyId', '==', cid), orderBy('createdAt', 'desc'), limit(15)),
        mapTask)
      watch('leave', cid,
        query(collection(db, 'leaveRequests'), where('companyId', '==', cid), orderBy('appliedOn', 'desc'), limit(15)),
        mapLeave)
      watch('att', cid,
        query(collection(db, 'attendance'), where('companyId', '==', cid), where('date', '>=', today), limit(10)),
        mapAttendance)
    })

    return () => {
      unsubs.forEach(u => { try { u() } catch {} })
    }
  }, [scopeKey, currentExecutive?.id, availableCompanies])

  const displayedActivities = useMemo(() => {
    let items = activities
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      items = items.filter(a =>
        a.title.toLowerCase().includes(s) ||
        a.companyName?.toLowerCase().includes(s) ||
        a.userName?.toLowerCase().includes(s) ||
        a.assignedTo?.toLowerCase().includes(s)
      )
    }
    return items
  }, [activities, searchTerm])

  const auditLog = (action: string, entity: string, details?: string) => {
    logAudit({
      userId: authUser?.id || '', userName: authUser?.name || '', userRole: 'team-leader',
      action, actionType: 'update', module: 'TL Operations',
      targetEntity: entity, status: 'success',
      details: details || `Exec: ${currentExecutive?.name}, Company: ${currentCompany?.name}`,
    })
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requireSelection()) return
    setSubmitting(true)
    try {
      await createTask({
        title: taskForm.title, description: taskForm.description, priority: taskForm.priority,
        assignedTo: taskForm.assignedTo, assignedToId: '',
        companyId: selectedCompanyId!,
        status: 'Pending', progress: 0, createdBy: authUser?.name || '',
      })
      auditLog('Created task', taskForm.title)
      setShowTaskModal(false)
      setTaskForm({ title: '', description: '', priority: 'Medium', assignedTo: '' })
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmLeaveReview = async (draft: LeaveReviewDraft, note: string) => {
    if (!requireSelection()) return
    setSubmitting(true)
    try {
      await reviewTierLeaveRequest(draft.leave.id, draft.tier, draft.action, authUser?.id || '', authUser?.name || '', note)
      auditLog(`${draft.action} leave as ${TIER_LABELS[draft.tier]}`, draft.leave.id, note || undefined)

      setActivities(prev => prev.map(a =>
        a.id === `leave-${draft.leave.id}`
          ? { ...a, status: draft.action === 'Approved' ? 'Approved' : 'Rejected' }
          : a,
      ))
      setReviewDraft(null)
    } catch (err) {
      console.error(err)
      showToast('error', err instanceof Error ? err.message : 'Failed to review leave')
    } finally {
      setSubmitting(false)
    }
  }

  // Whether the signed-in TL is the assigned approver at the next pending tier.
  const isMyLeaveAction = (a: any): boolean => {
    const nextTier = getNextPendingTier(a.approvalStatus || {})
    return !!nextTier && !!authUser?.id && a.approverIds?.[nextTier] === authUser.id
  }

  const openLeaveReview = (a: any, approve: boolean) => {
    if (!requireSelection()) return
    const approvalStatus = a.approvalStatus || {}
    const approverIds = a.approverIds || {}
    const nextTier = getNextPendingTier(approvalStatus)
    if (!nextTier) { showToast('warning', 'All approval tiers already completed'); return }
    if (authUser?.id !== approverIds[nextTier]) {
      showToast('warning', 'You do not have permission to act on this tier')
      return
    }
    const leave: LeaveRequest = {
      id: a.id.replace(/^leave-/, ''),
      userId: a.userId || '',
      employeeName: a.userName || a.title || 'Unknown',
      employeeId: '', employeeEmail: '', avatar: '', department: '', departmentId: '',
      companyId: a.companyId || '',
      leaveType: a.leaveType || 'Casual',
      startDate: a.fromDate?.toDate?.() || new Date(a.fromDate || Date.now()),
      endDate: a.toDate?.toDate?.() || new Date(a.toDate || Date.now()),
      totalDays: a.totalDays || 0,
      reason: a.reason || '',
      status: a.status || 'Pending',
      isPaid: false,
      appliedOn: a.createdAt || new Date(),
      approvalStatus,
      approvalLog: a.approvalLog || [],
      approverIds,
      applicantRole: a.applicantRole,
      masterAdminRequired: !!a.masterAdminRequired,
      masterAdminApproveStatus: a.masterAdminApproveStatus,
    }
    setReviewDraft({ leave, tier: nextTier, action: approve ? 'Approved' : 'Rejected' })
  }

  const statusPill = (status: string) => {
    const sc = STATUS_COLORS[status] || { bg: '#f3f4f6', text: '#6b7280' }
    return <span className="tl-ops-pill" style={{ background: sc.bg, color: sc.text }}>{status}</span>
  }

  const breadcrumbs = useMemo(() => {
    const parts = ['Dashboard', 'Operations']
    if (currentExecutive) parts.push(currentExecutive.name)
    if (currentCompany) parts.push(currentCompany.name)
    return parts
  }, [currentExecutive, currentCompany])

  const headerTitle = useMemo(() => {
    if (currentCompany) return `${currentCompany.name} — Operations`
    if (currentExecutive) return `${currentExecutive.name} — Operations`
    return 'Operations Dashboard'
  }, [currentExecutive, currentCompany])

  const handleCardKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  // Assignment overview follows the active scope (see scopedCompanyIds above)
  const totalExecutives = currentExecutive ? 1 : executives.length
  const totalCompanies = scopedCompanyIds.length
  const scopeLabel = selectedCompanyId
    ? (currentCompany?.name || 'Selected company')
    : currentExecutive
      ? currentExecutive.name
      : 'All companies'


  // Loading state
  if (isLoading) {
    return (
      <div className="page-container">
        <Header title="Operations Dashboard" breadcrumbs={['Dashboard', 'Operations']} />
        <div className="page-content">
          <div className="tl-ops-loading">
            <Loader2 className="animate-spin" size={32} />
            <p>Loading hierarchy...</p>
          </div>
        </div>
      </div>
    )
  }

  // No executives mapped — show cards with 0 and the initialization prompt
  const noExecutives = executives.length === 0

  return (
    <div className="page-container">
      <Header title={headerTitle} breadcrumbs={breadcrumbs} />

      {/* Toast */}
      {toast && (
        <div className={`tl-ops-toast tl-ops-toast-${toast.type}`}>
          <AlertCircle size={16} />
          <span>{toast.message}</span>
          <button className="tl-ops-toast-close" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <div className="page-content">
        {/* ===== Welcome Hero (top of content, mirrors other role dashboards) ===== */}
        <DashboardHero
          stats={[
            { label: 'Present', value: teamStats.presentToday, color: '#10b981' },
            { label: 'Pending Tasks', value: teamStats.pendingTasks, color: '#ec4899' },
            { label: 'Leaves', value: teamStats.pendingLeaves, color: '#3b82f6' },
            { label: 'Approved', value: teamStats.approvedLeaves, color: '#10b981' },
          ]}
        />

        {/* ===== Missed Punch + Leave Approvals (immediate reviewer attention) ===== */}
        {scopedCompanyIds.length > 0 && (
          <>
            <MissedPunchAlertCard count={overviewStats.missPunchApprovals} badge={overviewStats.missPunchApprovals} />

            {/* Multi-tier leave verification — requests routed to this TL within
                their assigned-company scope, approve/reject with remark. */}
            <LeaveApprovalsPanel
              companyIds={scopedCompanyIds}
              userId={authUser?.id || ''}
              userName={authUser?.name || ''}
              role="team-leader"
              title="Leave Approvals"
            />
          </>
        )}

        {/* ===== Cascading Filter Bar ===== */}
        <TLFilterBar onScopeChange={() => setSearchTerm('')} />

        {/* ===== Self Attendance ===== */}
        <SelfAttendanceCard role="team-leader" />

        {/* ===== Personal Leave & Attendance Portal ===== */}
        <div className="accordion-card" style={{ marginBottom: 12 }}>
          <div className="accordion-header">
            <h3><Calendar size={16} /> My Leaves & Attendance</h3>
            <button
              className="dash-action"
              style={{ background: '#8b5cf6', border: 'none', color: '#fff', fontSize: 12, padding: '4px 12px' }}
              onClick={() => navigate('/my-leaves-attendance')}
            >
              Open Personal Portal
            </button>
          </div>
          <div style={{ padding: '0 20px 16px', fontSize: 13, color: '#6b7280' }}>
            Track your own leave requests and approval progress (Master Admin), attendance history,
            remaining balances, and submit missed-punch corrections for yourself.
          </div>
        </div>

        {/* ===== Stat Cards — shown after live counts load (avoid provisional zeros) ===== */}
        {overviewStats.loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: '#6b7280', fontSize: 13 }}>
            <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <span>Loading real-time counts…</span>
          </div>
        ) : (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          {[
            { icon: Users, label: 'Total Executives', count: totalExecutives, trend: currentExecutive ? currentExecutive.name : 'Assigned', path: '/executives' },
            { icon: Building2, label: 'Total Companies', count: totalCompanies, trend: scopeLabel, path: '/companies' },
            { icon: Users, label: 'Total Employees', count: overviewStats.totalEmployees, trend: `${overviewStats.activeEmployees} Active`, path: '/employees' },
            { icon: UserCheck, label: 'Active Employees', count: overviewStats.activeEmployees, trend: 'Active', path: '/employees?status=Active' },
            { icon: Users, label: 'Inactive Employees', count: overviewStats.inactiveEmployees, trend: 'Inactive', path: '/employees?status=Inactive' },
            { icon: Clock, label: 'Present Today', count: overviewStats.presentToday, trend: 'Checked In', path: '/attendance?status=Present&period=today' },
            { icon: Clock, label: 'Absent Today', count: overviewStats.absentToday, trend: 'Marked Absent', path: '/attendance?status=Absent&period=today' },
            { icon: Clock, label: 'Late Today', count: overviewStats.lateToday, trend: 'Late', path: '/attendance?status=Late&period=today' },
            { icon: Clock, label: 'Miss Punch', count: overviewStats.missPunchApprovals, trend: 'Missed Punch', path: '/attendance?status=Miss Punch' },
            { icon: CheckSquare, label: 'Approved Attendance', count: overviewStats.approvedAttendanceToday, trend: 'Approved', path: '/attendance?status=Approved&period=today' },
            { icon: Calendar, label: 'On Leave', count: overviewStats.onLeaveToday, trend: 'On Leave Today', path: '/employees?status=leave' },
            { icon: Calendar, label: 'Pending Leaves', count: overviewStats.pendingLeaveApprovals, trend: overviewStats.pendingLeaveApprovals > 0 ? 'Awaiting Review' : 'None', path: '/leaves?status=Pending' },
            { icon: Calendar, label: 'Approved Leaves', count: overviewStats.approvedLeaves, trend: 'Approved', path: '/leaves?status=Approved' },
            { icon: Calendar, label: 'Rejected Leaves', count: overviewStats.rejectedLeaves, trend: 'Rejected', path: '/leaves?status=Rejected' },
            { icon: CheckSquare, label: 'Pending Tasks', count: overviewStats.pendingTasks, trend: overviewStats.pendingTasks > 0 ? 'Pending' : 'All Done', path: '/tasks?status=Pending' },
            { icon: CheckSquare, label: 'Completed Tasks', count: overviewStats.completedTasks, trend: 'Done', path: '/tasks?status=Completed' },
            { icon: CheckSquare, label: 'In Progress Tasks', count: overviewStats.inProgressTasks, trend: 'In Progress', path: '/tasks?status=In Progress' },
            { icon: Building2, label: 'Departments', count: overviewStats.activeDepartments, trend: 'All', path: '/departments' },
            { icon: Wallet, label: 'Salary Slips', count: overviewStats.salaryGenerated, trend: 'Total Records', path: '/salary-slips' },
            { icon: PartyPopper, label: 'Upcoming Holidays', count: overviewStats.upcomingHolidays, trend: 'Coming Up', path: '/holidays' },
            { icon: Cake, label: 'Today Birthdays', count: overviewStats.todayBirthdays, trend: overviewStats.todayBirthdays > 0 ? 'Celebrate!' : 'None Today', path: '/birthdays' },
          ].map((card, idx) => {
            const Icon = card.icon
            return (
              <div
                key={idx}
                className="stat-card"
                onClick={() => navigate(card.path)}
                tabIndex={0}
                onKeyDown={(e) => handleCardKeyDown(e, () => navigate(card.path))}
                style={{ cursor: 'pointer' }}
              >
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
        )}

        {/* ===== Initialization Prompt (no executives mapped) ===== */}
        {noExecutives && (
          <div className="tl-ops-init-prompt">
            <Filter size={32} style={{ color: '#6366f1' }} />
            <h3>No Executives Mapped</h3>
            <p>Contact your administrator to assign executives to your oversight.</p>
          </div>
        )}

        {/* ===== Active View ===== */}
        {/* The operational view renders whenever the TL has a scope. With no
            executive filter the whole portfolio is aggregated ("All Companies");
            selecting an executive narrows to their companies; picking a company
            narrows to just it. Mutation actions additionally require an
            executive + specific company (see requireSelection). */}
        {!noExecutives && (
          <>
            {/* Metric Cards */}
            {teamStats.loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: '#6b7280', fontSize: 13 }}>
                <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
                <span>Loading real-time counts…</span>
              </div>
            ) : (
            <div className="stats-grid">
              {[
                { icon: Clock, label: 'Present Today', count: teamStats.presentToday, trend: 'Checked in', path: '/attendance' },
                { icon: CheckSquare, label: 'Pending Tasks', count: teamStats.pendingTasks, trend: `${teamStats.inProgressTasks} in progress`, path: '/tasks' },
                { icon: Calendar, label: 'Leave Requests', count: teamStats.pendingLeaves, trend: `${teamStats.approvedLeaves} approved`, path: '/leaves' },
              ].map((card, idx) => {
                const Icon = card.icon
                return (
                  <div key={idx} className="stat-card" onClick={() => navigate(card.path)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, () => navigate(card.path))}>
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
            )}

            {/* Quick Actions */}
            <div className="quick-actions-section">
              <h3>Quick Actions</h3>
              <div className="quick-actions-grid">
                {canCreateTasks && (
                  <div className="quick-action-card" onClick={() => { if (requireSelection()) setShowTaskModal(true) }} tabIndex={0}>
                    <div className="qa-icon" style={{ background: 'rgba(236, 72, 153, 0.09)', color: '#ec4899' }}>
                      <Plus size={22} />
                    </div>
                    <span>New Task</span>
                  </div>
                )}
                <div className="quick-action-card" onClick={() => setShowLeaveApply(true)} tabIndex={0}>
                  <div className="qa-icon" style={{ background: 'rgba(139, 92, 246, 0.09)', color: '#8b5cf6' }}>
                    <Calendar size={22} />
                  </div>
                  <span>Apply My Leave</span>
                </div>
                {canApproveLeaves && (
                  <div className="quick-action-card" onClick={() => { if (requireSelection()) navigate('/leaves') }} tabIndex={0}>
                    <div className="qa-icon" style={{ background: 'rgba(139, 92, 246, 0.09)', color: '#8b5cf6' }}>
                      <Calendar size={22} />
                    </div>
                    <span>Review Leaves</span>
                  </div>
                )}
                <div className="quick-action-card" onClick={() => navigate('/attendance')} tabIndex={0}>
                  <div className="qa-icon" style={{ background: 'rgba(245, 158, 11, 0.09)', color: '#f59e0b' }}>
                    <Clock size={22} />
                  </div>
                  <span>Attendance</span>
                </div>
                <div className="quick-action-card" onClick={() => navigate('/leaves')} tabIndex={0}>
                  <div className="qa-icon" style={{ background: 'rgba(139, 92, 246, 0.09)', color: '#8b5cf6' }}>
                    <Calendar size={22} />
                  </div>
                  <span>Apply Leave</span>
                </div>
                <div className="quick-action-card" onClick={() => navigate('/tasks')} tabIndex={0}>
                  <div className="qa-icon" style={{ background: 'rgba(16, 185, 129, 0.09)', color: '#10b981' }}>
                    <CheckSquare size={22} />
                  </div>
                  <span>All Tasks</span>
                </div>
              </div>
            </div>

            {/* Activities Panel */}
            <div className="accordion-card">
              <div className="accordion-header">
                <h3>Active Tasks & Pending Approvals</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="tl-ops-table-search">
                    <Search size={15} />
                    <input type="text" placeholder="Search activities..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  </div>
                  <span className="tl-ops-table-count">{displayedActivities.length} item{displayedActivities.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div style={{ padding: 0 }}>
                {activitiesLoading ? (
                  <div className="tl-ops-loading-inline"><Loader2 className="animate-spin" size={20} /> Loading activities...</div>
                ) : (
                  <div className="tl-ops-table-wrap">
                    <table className="tl-ops-table">
                      <thead>
                        <tr>
                          <th>Origin</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Entity</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedActivities.length === 0 ? (
                          <tr><td colSpan={6} className="tl-ops-empty-row">No activities found for {currentCompany?.name}.</td></tr>
                        ) : (
                          displayedActivities.map(a => (
                            <tr key={a.id}>
                              <td>
                                <div className="tl-ops-origin-tags">
                                  {a.executiveName && <span className="tl-ops-origin-tag tl-ops-origin-exec">{a.executiveName}</span>}
                                  {a.companyName && <span className="tl-ops-origin-tag tl-ops-origin-company">{a.companyName}</span>}
                                </div>
                              </td>
                              <td>
                                <span className={`tl-ops-type-badge tl-ops-type-${a.type}`}>
                                  {a.type === 'task' ? '📋' : a.type === 'leave' ? '🏖' : '⏰'} {a.origin}
                                </span>
                              </td>
                              <td>
                                <div className="tl-ops-desc-cell">
                                  <span className="tl-ops-desc-title">{a.title}</span>
                                  {a.type === 'leave' && a.fromDate && (
                                    <span className="tl-ops-desc-sub">{a.leaveType} · {a.fromDate?.toDate?.()?.toLocaleDateString?.() || a.fromDate} → {a.toDate?.toDate?.()?.toLocaleDateString?.() || a.toDate}</span>
                                  )}
                                  {a.type === 'task' && a.assignedTo && (
                                    <span className="tl-ops-desc-sub">Assigned to: {a.assignedTo}</span>
                                  )}
                                  {a.type === 'attendance' && a.userName && (
                                    <span className="tl-ops-desc-sub">{a.userName} · {a.date?.toDate?.()?.toLocaleDateString?.() || a.date}</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <div className="tl-ops-entity-cell">
                                  <span className="tl-ops-entity-name">{a.userName || a.assignedTo || '—'}</span>
                                </div>
                              </td>
                              <td>{statusPill(a.status)}</td>
                              <td>
                                <div className="tl-ops-row-actions">
                                  {a.type === 'leave' && (
                                    <button className="tl-ops-row-btn" onClick={() => setViewActivity(a)} title="View details"><Eye size={14} /></button>
                                  )}
                                  {a.type === 'task' && (
                                    <button className="tl-ops-row-btn" onClick={() => navigate('/tasks')} title="View Task"><ArrowUpRight size={14} /></button>
                                  )}
                                  {a.type === 'leave' && a.status === 'Pending' && isMyLeaveAction(a) && (
                                    <>
                                      <button className="tl-ops-row-btn tl-ops-row-approve" onClick={() => openLeaveReview(a, true)} title="Approve">✓</button>
                                      <button className="tl-ops-row-btn tl-ops-row-reject" onClick={() => openLeaveReview(a, false)} title="Reject">✕</button>
                                    </>
                                  )}
                                  {a.type === 'attendance' && !a.checkOut && (
                                    <button className="tl-ops-row-btn tl-ops-row-approve" onClick={() => navigate('/attendance')} title="Review">Review</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== Create Task Modal ===== */}
      <Modal isOpen={showTaskModal} onClose={() => setShowTaskModal(false)} title="Create Task" size="medium">
        <form onSubmit={handleCreateTask} className="tl-ops-modal-form">
          <div className="form-group">
            <label>Title *</label>
            <input type="text" value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} required placeholder="Task summary" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} rows={3} placeholder="Details..." />
          </div>
          <div className="tl-ops-form-row">
            <div className="form-group">
              <label>Priority</label>
              <select value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as Task['priority'] }))}>
                <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
              </select>
            </div>
            <div className="form-group">
              <label>Assigned To</label>
              <input type="text" value={taskForm.assignedTo} onChange={e => setTaskForm(p => ({ ...p, assignedTo: e.target.value }))} placeholder="Employee name" />
            </div>
          </div>
          {isReady && (
            <div className="tl-ops-modal-context">
              <Building2 size={14} /> Auto-tagged to: {currentCompany?.name} · Executive: {currentExecutive?.name}
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setShowTaskModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create Task
            </button>
          </div>
        </form>
      </Modal>

      {/* Multi-tier leave verification — remarks on approve/reject */}
      <LeaveReviewModal draft={reviewDraft} submitting={submitting} onClose={() => setReviewDraft(null)} onConfirm={handleConfirmLeaveReview} />

      {/* Self leave application (standard employee flow) */}
      <LeaveApplyModal
        isOpen={showLeaveApply}
        onClose={() => setShowLeaveApply(false)}
        companyId={selectedCompanyId || (scopedCompanyIds.length > 0 ? scopedCompanyIds[0] : undefined)}
      />

      <Modal isOpen={!!viewActivity} onClose={() => setViewActivity(null)} title={viewActivity ? `${viewActivity.type === 'leave' ? 'Leave' : viewActivity.type === 'task' ? 'Task' : 'Attendance'} Details` : ''} size="small">
        {viewActivity && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{viewActivity.title}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {viewActivity.userName || '—'}{viewActivity.companyName ? ` · ${viewActivity.companyName}` : ''}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Type</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{viewActivity.origin || viewActivity.type}</div>
              </div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Status</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{statusPill(viewActivity.status)}</div>
              </div>
            </div>
            {viewActivity.type === 'leave' && (
              <>
                {viewActivity.leaveType && <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Leave type: <strong>{viewActivity.leaveType}</strong></div>}
                {(viewActivity.fromDate || viewActivity.toDate) && (
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
                    Dates: {viewActivity.fromDate?.toDate?.()?.toLocaleDateString?.() || viewActivity.fromDate} → {viewActivity.toDate?.toDate?.()?.toLocaleDateString?.() || viewActivity.toDate}
                  </div>
                )}
                {viewActivity.reason && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Reason: {viewActivity.reason}</div>}
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 14, marginBottom: 8 }}>Approval Chain</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {(viewActivity.approvalStatus ? Object.entries(viewActivity.approvalStatus) : []).map(([tier, st]) => {
                    const c = st === 'Approved' ? { bg: '#dcfce7', tc: '#16a34a' } : st === 'Rejected' ? { bg: '#fee2e2', tc: '#ef4444' } : { bg: '#fef3c7', tc: '#b45309' }
                    return (
                      <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', minWidth: 120 }}>{tier}</span>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.tc }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: c.tc }}>{st as string}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {viewActivity.type === 'attendance' && (
              <>
                {viewActivity.date && <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Date: <strong>{viewActivity.date?.toDate?.()?.toLocaleDateString?.() || viewActivity.date}</strong></div>}
                {viewActivity.reason && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Reason: {viewActivity.reason}</div>}
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setViewActivity(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
