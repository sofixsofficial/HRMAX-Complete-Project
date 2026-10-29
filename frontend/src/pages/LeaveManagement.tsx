import { useState, useEffect } from 'react'
import { errText } from '../aws/errors';
import { ActionErrorBanner } from '../components/ActionErrorBanner';
import { useSearchParams } from 'react-router-dom'
import { Plane, Clock, CheckCircle, XCircle, Plus, Search, Check, X, Ban, Loader2, Crown, Eye, AlertCircle } from 'lucide-react'

import { auth, db } from '../aws/clients'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { Pagination } from '../components/Pagination'
import {
  getAllLeaveRequests,
  getLeaveRequestsByCompany,
  getLeaveRequestsByDepartment,
  getLeaveRequestsByUser,
  createLeaveRequest,
  reviewLeaveRequest,
  reviewTierLeaveRequest,
  reviewMasterAdminLeaveRequest,
  cancelLeaveRequest,
  calcLeaveDays,
  isLeaveTypePaid,
  TIER_LABELS,
  TIER_ORDER,
  getNextPendingTier,
  isAwaitingMasterAdmin,
  getEffectiveTiers,
  getLiveTiers,
} from '../services/leaveService'
import { getEmployeesByCompany, getEmployeeByUserId } from '../services/employeeService'
import { scopedCompanyIds } from '../utils/companyScope'
import { hasPersonalPage } from '../utils/personalRoles'
import { getAllUsers } from '../services/authService'
import { getCompanyById, getAllCompanies } from '../services/companyService'
import { logAudit } from '../services/auditLogService'
import type { LeaveRequest, LeaveType, Employee, User, Company, ApprovalTier } from '../types/user'
import './Companies.css'

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity']

const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })

const statusColor = (status: string) => {
  switch (status) {
    case 'Approved': return { bg: '#dcfce7', text: '#16a34a' }
    case 'Pending': return { bg: '#fef3c7', text: '#f59e0b' }
    case 'Rejected': return { bg: '#fee2e2', text: '#ef4444' }
    case 'Cancelled': return { bg: '#f3f4f6', text: '#6b7280' }
    default: return { bg: '#f3f4f6', text: '#6b7280' }
  }
}

// What the leave-table lookup map actually reads from a company record —
// both full Company docs and scoped AssignedCompany summaries satisfy it.
type CompanyLookup = { name: string; domain?: string; assignedExecutiveId?: string }

const MA_TIER_LABEL = 'Master Admin'

const isMasterAdminPending = (l: LeaveRequest) =>
  !!l.masterAdminRequired
  && (l.masterAdminApproveStatus == null || l.masterAdminApproveStatus === 'Pending')
  && getEffectiveTiers((l as any).applicantRole).every(t => l.approvalStatus[t] === 'Approved')

// Progress display that respects the applicant's effective tiers plus the
// Master Admin final gate — and only counts tiers that actually have to
// decide (Skipped tiers have no approver, so counting them left the counter
// stuck at e.g. 2/4 forever even after the request reached Approved).
// An Executive self-app counts the managing Team Leader and the Master Admin
// (2 steps); a Team Leader self-app counts only the Master Admin (1 step).
const approvalProgressOf = (l: LeaveRequest) => {
  const tiers = getLiveTiers(l as any)
  if (l.masterAdminRequired) {
    const total = tiers.length + 1
    const done =
      tiers.filter(t => l.approvalStatus[t] === 'Approved').length +
      (l.masterAdminApproveStatus === 'Approved' || l.masterAdminApproveStatus === 'Rejected' ? 1 : 0)
    return { label: `${done}/${total}`, width: total ? (done / total) * 100 : 100 }
  }
  const resolved = tiers.filter(t => l.approvalStatus[t] === 'Approved').length
  if (tiers.length === 0) {
    // No live approver at all → every tier was skipped and the server
    // auto-approved the request: the chain is resolved.
    return { label: '1/1', width: 100 }
  }
  return { label: `${resolved}/${tiers.length}`, width: (resolved / tiers.length) * 100 }
}

interface ApplyState {
  employeeId: string  // employee doc id (for admin applying on behalf)
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason: string
}

const todayStr = new Date().toISOString().split('T')[0]

const INITIAL_APPLY: ApplyState = {
  employeeId: '',
  leaveType: 'Casual',
  startDate: todayStr,
  endDate: todayStr,
  reason: ''
}

export function LeaveManagement() {
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, canAccessAllCompanies, availableCompanies, selectedCompanyName, isLoading: companyLoading } = usePermissionScope('leave')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const [searchParams] = useSearchParams()
  const isApprover = ['master-admin', 'team-leader', 'reporting-manager'].includes(user?.role || '')
  const isReportingManager = user?.role === 'reporting-manager'

  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesById, setCompaniesById] = useState<Record<string, CompanyLookup>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Filters/search change the result set — restart from page 1
  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilter, employeeFilter, companyFilter])

  useEffect(() => {
    const status = searchParams.get('status')
    if (status === 'Pending' || status === 'Approved' || status === 'Rejected') setStatusFilter(status)
  }, [])

  const [isApplyOpen, setIsApplyOpen] = useState(false)
  const [applyData, setApplyData] = useState<ApplyState>(INITIAL_APPLY)
  const [applyMode, setApplyMode] = useState<'self' | 'behalf'>('self')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const selectedCompanyId = effectiveCompanyId

  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null)
  const [reviewTier, setReviewTier] = useState<ApprovalTier>('reportingManager')
  const [reviewAction, setReviewAction] = useState<'Approved' | 'Rejected'>('Approved')
  const [reviewNote, setReviewNote] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [reviewIsMasterAdmin, setReviewIsMasterAdmin] = useState(false)

  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<LeaveRequest | null>(null)
  const openDetails = (leave: LeaveRequest) => {
    setDetailsTarget(leave)
    setIsDetailsOpen(true)
  }

  useEffect(() => {
    if (companyLoading) return
    fetchData()
  }, [user?.id, effectiveCompanyId, availableCompanies, user?.role, companyLoading])

  const fetchData = async () => {
    try {
      setLoading(true)
      let data: LeaveRequest[]
      switch (user?.role) {
        case 'master-admin':
          data = await getAllLeaveRequests()
          break
        case 'reporting-manager':
          if (effectiveCompanyId) {
            // Same-company portfolio scope: fetch every leave in the active
            // company instead of filtering by approverIds.reportingManager.
            // That strict filter leaves the list empty whenever the manager
            // mapping is unbound or stored as an employee-doc-id.
            data = await getLeaveRequestsByCompany(effectiveCompanyId)
          } else {
            data = await getLeaveRequestsByUser(user.id)
          }
          break
        case 'employee':
          if (effectiveCompanyId) {
            // Check if this employee is a Reporting Manager (legacy path)
            const emp = await getEmployeeByUserId(user.id).catch(() => null)
            if ((emp as any)?.isReportingManager) {
              data = await getLeaveRequestsByCompany(effectiveCompanyId)
            } else {
              data = await getLeaveRequestsByUser(user.id)
            }
          } else if (user?.id) {
            data = await getLeaveRequestsByUser(user.id)
          } else {
            data = []
          }
          break
        case 'company-admin':
        case 'team-leader':
        case 'executive':
        case 'hr':
          if (effectiveCompanyId) {
            data = await getLeaveRequestsByCompany(effectiveCompanyId)
          } else {
            // All Companies mode — requests across authorized companies
            const ids = scopedCompanyIds(null, availableCompanies)
            const results = await Promise.all(ids.map(id => getLeaveRequestsByCompany(id).catch(() => [] as LeaveRequest[])))
            data = results.flat()
          }
          break
        default:
          data = []
      }
      data.sort((a, b) => new Date(b.appliedOn).getTime() - new Date(a.appliedOn).getTime())
      setLeaves(data)

      if (effectiveCompanyId) {
        const emps = await getEmployeesByCompany(effectiveCompanyId)
        setEmployees(emps)
      } else if (user?.role === 'executive' || user?.role === 'team-leader') {
        const ids = scopedCompanyIds(null, availableCompanies)
        const results = await Promise.all(ids.map(id => getEmployeesByCompany(id).catch(() => [] as Employee[])))
        setEmployees(results.flat())
      }

      const [users, comps] = await Promise.all([
        getAllUsers().catch(() => [] as User[]),
        getAllCompanies().catch(() => [] as Company[])
      ])
      setAllUsers(users)
      setCompanies(comps)

      setError(null)
    } catch (err) {
      console.error('Error fetching leave requests:', err)
      setError('Failed to load leave requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isApplyOpen) {
      setApplyData(prev => ({ ...prev, employeeId: '' }))
    }
  }, [isApplyOpen])

  // Resolve company names via permissioned single-doc reads. Listing ALL
  // companies is denied by rules for scoped roles (free list -> empty), which
  // made the Company column fall back to raw ids like "ml1ENKx7B6Yza7uv69h6".
  // getCompanyById is allowed for members/scoped roles, so every visible leave
  // resolves to its readable name (plus the already-loaded scope companies).
  useEffect(() => {
    const ids = [...new Set(leaves.map(l => l.companyId).filter(Boolean))]
    const scopeMap: Record<string, CompanyLookup> = {}
    availableCompanies.forEach(c => { scopeMap[c.id] = c })
    setCompaniesById(scopeMap)
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(ids.map(async id => {
        if (scopeMap[id]) return null
        try {
          const c = await getCompanyById(id)
          return c ? ([id, c] as const) : null
        } catch {
          return null
        }
      }))
      if (cancelled) return
      const next = { ...scopeMap }
      entries.forEach(e => { if (e) next[e[0]] = e[1] })
      setCompaniesById(next)
    })()
    return () => { cancelled = true }
  }, [leaves, availableCompanies])

  // ── lookup helpers ──────────────────────────────────────────
  // Fallback order: loaded company docs → server-stamped `companyName`
  // (leave rows from a company this viewer is no longer scoped to) → raw id.
  const getCompanyName = (cid: string) => companiesById[cid]?.name || leaves.find(l => l.companyId === cid)?.companyName || cid
  const getAssignedExecutiveId = (cid: string) => companiesById[cid]?.assignedExecutiveId || ''
  const getAssignedExecutive = (cid: string) => {
    const execId = getAssignedExecutiveId(cid)
    if (!execId) return ''
    const exec = allUsers.find(u => u.id === execId)
    return exec?.name || ''
  }
  const getTLsForCompany = (cid: string) => {
    const execId = getAssignedExecutiveId(cid)
    if (!execId) return []
    const exec = allUsers.find(u => u.id === execId)
    const tlIds: string[] = (exec as any)?.assignedTeamLeaderIds || []
    return tlIds.map((tid: string) => {
      const tl = allUsers.find(u => u.id === tid)
      return tl?.name || ''
    }).filter(Boolean)
  }

  // Determine which tier the current user can act on for a given leave request
  const getActionableTier = (l: LeaveRequest): ApprovalTier | null => {
    if (!user) return null
    const nextTier = getNextPendingTier(l.approvalStatus)
    if (!nextTier) return null
    if (user.role === 'master-admin') return nextTier
    if (user.role === 'team-leader' && nextTier === 'reportingManager') {
      const tlUser = allUsers.find(u => u.id === user.id)
      const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
      const c = companies.find(c => c.id === l.companyId)
      const execId = (c as any)?.assignedExecutiveId || ''
      const exec = allUsers.find(u => u.id === execId)
      const execIsInactive = exec && exec.isActive === false
      const hasContingency = !!(tlUser as any)?.contingencyAccess
      if (linkedIds.includes(execId) && (hasContingency || execIsInactive)) {
        return 'reportingManager'
      }
    }
    if (user.id === l.approverIds[nextTier]) return nextTier
    // Legacy fallback: requests created before approverIds were resolved may
    // carry an empty map. Grant the natural role holder of the pending tier a
    // working Approve/Reject control instead of hiding the actions entirely.
    if (!l.approverIds[nextTier]) {
      if (user.role === 'reporting-manager' && nextTier === 'reportingManager') return nextTier
      if (user.role === 'hr' && nextTier === 'hr') {
        if (!effectiveCompanyId || l.companyId === effectiveCompanyId) return nextTier
      }
      if (user.role === 'company-admin' && nextTier === 'companyAdmin') {
        if (!effectiveCompanyId || l.companyId === effectiveCompanyId) return nextTier
      }
      if (user.role === 'executive' && nextTier === 'executive') {
        const execUser = allUsers.find(u => u.id === user.id)
        const cids: string[] = (execUser as any)?.assignedCompanyIds || []
        if (cids.includes(l.companyId)) return nextTier
      }
      if (user.role === 'team-leader' && nextTier === 'teamLeader') {
        const tlUser = allUsers.find(u => u.id === user.id)
        const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
        const execId = getAssignedExecutiveId(l.companyId)
        if (linkedIds.includes(execId)) return nextTier
      }
    }
    return null
  }

  // ── role-based visibility ───────────────────────────────────
  const hideOwnRows = hasPersonalPage(user?.role)
  const visibleLeaves = leaves.filter(l => {
    // Management roles with a personal page keep their OWN requests out of the
    // management table — they live on My Leaves & Attendance. (Employees are
    // exempt: their /leaves page is the personal view of their own requests.)
    if (hideOwnRows && l.userId === user?.id) return false
    if (user?.role === 'master-admin' || user?.role === 'company-admin' || user?.role === 'hr') return true
    if (user?.role === 'executive') {
      // Executives manage ALL companies (CompanyContext model): the management
      // table mirrors the dashboard card scope (active top-nav companies)
      // instead of the legacy assignedCompanyIds, so card counts == row counts.
      const scopeIds = [...new Set((availableCompanies || []).map(c => c.id).filter(Boolean))]
      return scopeIds.length === 0 || scopeIds.includes(l.companyId)
    }
    if (user?.role === 'team-leader') {
      const tlUser = allUsers.find(u => u.id === user.id)
      const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
      const allCompanyIds: string[] = allUsers
        .filter(u => linkedIds.includes(u.id))
        .flatMap((ex: any) => ex.assignedCompanyIds || [])
      return allCompanyIds.includes(l.companyId)
    }
    return true
  })

  const filteredData = visibleLeaves.filter(l => {
    if (statusFilter !== 'All' && l.status !== statusFilter) return false
    if (employeeFilter !== 'all' && l.userId !== employeeFilter && l.employeeId !== employeeFilter) return false
    if (companyFilter !== 'all' && l.companyId !== companyFilter) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      if (!l.employeeName.toLowerCase().includes(s) &&
          !l.leaveType.toLowerCase().includes(s) &&
          !l.reason.toLowerCase().includes(s)) return false
    }
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filteredData.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pagedRows = filteredData.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Pending badge = rows the CURRENT user can actually act on (exec / TL / RM)
  // within their visible scope, so it matches the dashboard approval cards.
  // Other roles keep the plain status count for their visible set.
  const isQueueRole = !!user && ['executive', 'team-leader', 'reporting-manager'].includes(user.role)
  const stats = {
    pending: visibleLeaves.filter(l => l.status === 'Pending' && (!isQueueRole || getActionableTier(l))).length,
    approved: visibleLeaves.filter(l => l.status === 'Approved').length,
    rejected: visibleLeaves.filter(l => l.status === 'Rejected').length
  }

  const handleCardFilter = (status: string) => {
    setStatusFilter(prev => prev === status ? 'All' : status)
  }

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault()
    setApplyError(null)
    if (isApprover && applyMode === 'behalf' && !applyData.employeeId) {
      setApplyError('Select an employee to apply on their behalf')
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(true)
    try {
      const start = new Date(applyData.startDate)
      const end = new Date(applyData.endDate)
      const totalDays = calcLeaveDays(start, end)
      if (totalDays <= 0) {
        setApplyError('End date must be on or after start date')
        setIsSubmitting(false)
        return
      }

      const currentUid = auth.currentUser?.uid
      if (!currentUid) throw new Error('Not authenticated')

      // Determine employee info.
      // Self mode always targets the signed-in user's OWN employee record so a
      // manager's personal application never bypasses or re-couples to their
      // management approval queue — createLeaveRequest creates a brand new doc.
      let emp: Employee | undefined
      if (!isApprover || applyMode === 'self') {
        emp = employees.find(e => e.userId === currentUid)
        if (!emp) emp = await getEmployeeByUserId(currentUid).catch(() => undefined) || undefined
      } else {
        emp = employees.find(e => e.id === applyData.employeeId)
      }

      const leavePayload: Omit<LeaveRequest, 'id' | 'appliedOn' | 'status' | 'approvalStatus' | 'approvalLog' | 'approverIds'> = {
        userId: (!isApprover || applyMode === 'self') ? currentUid : (emp?.userId || currentUid),
        employeeName: emp?.name || user?.name || 'Unknown',
        employeeId: emp?.employeeId || '',
        employeeEmail: emp?.email || user?.email || '',
        avatar: emp?.avatar || user?.avatar || '',
        department: emp?.department || '',
        departmentId: emp?.departmentId || user?.departmentId || '',
        companyId: emp?.companyId || user?.companyId || effectiveCompanyId || '',
        leaveType: applyData.leaveType,
        startDate: start,
        endDate: end,
        totalDays,
        reason: applyData.reason,
        isPaid: isLeaveTypePaid(applyData.leaveType)
      }

      await createLeaveRequest(leavePayload)
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `Applied for ${applyData.leaveType} leave (${totalDays} day${totalDays > 1 ? 's' : ''})`,
          actionType: 'create', module: 'Leave Management',
          targetEntity: leavePayload.employeeName, status: 'success',
          details: `${applyData.leaveType} - ${totalDays} day(s)`,
        })
      }
      await fetchData()
      setIsApplyOpen(false)
      setApplyData(INITIAL_APPLY)
    } catch (err) {
      console.error('Error applying for leave:', err)
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: 'Failed to apply for leave', actionType: 'create',
          module: 'Leave Management', targetEntity: user.name, status: 'failure',
        })
      }
      setApplyError(errText(err, 'Failed to submit leave request. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const openReview = (leave: LeaveRequest, tier: ApprovalTier, action: 'Approved' | 'Rejected') => {
    setReviewTarget(leave)
    setReviewTier(tier)
    setReviewAction(action)
    setReviewNote('')
    setReviewError(null)
    setReviewIsMasterAdmin(false)
    setIsReviewOpen(true)
  }

  const openMasterAdminReview = (leave: LeaveRequest, action: 'Approved' | 'Rejected') => {
    setReviewTarget(leave)
    setReviewAction(action)
    setReviewNote('')
    setReviewError(null)
    setReviewIsMasterAdmin(true)
    setIsReviewOpen(true)
  }

  const handleReview = async () => {
    if (!reviewTarget || !user) return
    if (!reviewNote.trim()) {
      setReviewError('A remark is required to complete this approval step')
      return
    }
    setReviewError(null)
    setIsSubmitting(true)
    try {
      if (reviewIsMasterAdmin) {
        // Signature: (id, action, reviewedBy, reviewedByName, note) — the old call
        // passed (id, uid, name, action, note), writing the reviewer's UID into
        // `masterAdminApproveStatus` and corrupting the gate on this path.
        await reviewMasterAdminLeaveRequest(reviewTarget.id, reviewAction, user.id, user.name, reviewNote)
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `${reviewAction} ${MA_TIER_LABEL} for ${reviewTarget.employeeName}`,
          actionType: reviewAction === 'Approved' ? 'approve' : 'reject',
          module: 'Leave Management',
          targetEntity: reviewTarget.employeeName, status: 'success',
          details: reviewNote || undefined,
        })
      } else {
        await reviewTierLeaveRequest(reviewTarget.id, reviewTier, reviewAction, user.id, user.name, reviewNote)
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `${reviewAction} tier ${TIER_LABELS[reviewTier]} for ${reviewTarget.employeeName}`,
          actionType: reviewAction === 'Approved' ? 'approve' : 'reject',
          module: 'Leave Management',
          targetEntity: reviewTarget.employeeName, status: 'success',
          details: reviewNote || undefined,
        })
      }
      await fetchData()
      setIsReviewOpen(false)
      setReviewTarget(null)
    } catch (err) {
      console.error('Error reviewing leave:', err)
      setReviewError(errText(err, 'Failed to update leave request. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this leave request?')) return
    setCancelError(null)
    try {
      await cancelLeaveRequest(id)
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: 'Cancelled leave request', actionType: 'delete',
          module: 'Leave Management', targetEntity: 'Leave Request',
          targetId: id, status: 'success',
        })
      }
      await fetchData()
    } catch (err) {
      console.error('Error cancelling leave:', err)
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: 'Failed to cancel leave request', actionType: 'delete',
          module: 'Leave Management', targetEntity: 'Leave Request', status: 'failure',
        })
      }
      setCancelError(errText(err, 'Failed to cancel leave request. Please try again.'))
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Leave Management" breadcrumbs={['Dashboard', 'Leave Management']} />
        <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading...</p></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Leave Management" breadcrumbs={['Dashboard', 'Leave Management']} />
        <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn-primary">Retry</button></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Leave Management" breadcrumbs={['Dashboard', 'Leave Management']} />

      <div className="page-content">
        <ScopeIndicator />
        <ActionErrorBanner message={cancelError} onDismiss={() => setCancelError(null)} />
        <div className="stats-row">
          <div className="stat-card-companies" onClick={() => handleCardFilter('Pending')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'Pending' ? '2px solid #f59e0b' : '2px solid transparent', boxShadow: statusFilter === 'Pending' ? '0 0 0 3px rgba(245,158,11,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#fffbeb', color: '#f59e0b' }}><Clock size={24} /></div>
              <div className="stat-details"><span className="stat-label">Pending</span><span className="stat-value">{stats.pending}</span></div>
            </div>
          </div>
          <div className="stat-card-companies" onClick={() => handleCardFilter('Approved')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'Approved' ? '2px solid #10b981' : '2px solid transparent', boxShadow: statusFilter === 'Approved' ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#ecfdf5', color: '#10b981' }}><CheckCircle size={24} /></div>
              <div className="stat-details"><span className="stat-label">Approved</span><span className="stat-value">{stats.approved}</span></div>
            </div>
          </div>
          <div className="stat-card-companies" onClick={() => handleCardFilter('Rejected')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'Rejected' ? '2px solid #ef4444' : '2px solid transparent', boxShadow: statusFilter === 'Rejected' ? '0 0 0 3px rgba(239,68,68,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#fef2f2', color: '#ef4444' }}><XCircle size={24} /></div>
              <div className="stat-details"><span className="stat-label">Rejected</span><span className="stat-value">{stats.rejected}</span></div>
            </div>
          </div>
        </div>

        <div className="companies-section">
          <div className="section-header-companies">
            <h3>Leave Requests</h3>
            <div className="section-actions">
              {!hideOwnRows && user?.role !== 'company-admin' && user?.role !== 'master-admin' && canPerform('create', 'leave') && (
                <button className="btn-primary" onClick={() => { setApplyData(INITIAL_APPLY); setApplyMode('self'); setApplyError(null); setIsApplyOpen(true) }}>
                  <Plus size={16} />Apply for Leave
                </button>
              )}
            </div>
          </div>

          <div className="filters-row">
            <div className="search-filter">
              <Search size={16} />
              <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <select className="filter-select" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.userId || emp.id}>{emp.name} ({emp.employeeId})</option>
              ))}
            </select>
            <select className="filter-select" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
              {canAccessAllCompanies && <option value="all">All Companies</option>}
              {(canAccessAllCompanies ? companies : availableCompanies).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Company</th>
                  <th>Assigned Executive</th>
                  <th>Reporting TL</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(l => {
                  const sc = statusColor(l.status)
                  const companyName = getCompanyName(l.companyId)
                  const execName = getAssignedExecutive(l.companyId)
                  const tlNames = getTLsForCompany(l.companyId)
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="admin-cell">
                          <span className="admin-name">{l.employeeName}</span>
                          <span className="admin-email">{l.employeeId}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-cell">
                          <span className="admin-name">{companyName}</span>
                          <span className="admin-email">{companiesById[l.companyId]?.domain || ''}</span>
                        </div>
                      </td>
                      <td>{execName ? <span className="company-code">{execName}</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td>{tlNames.length > 0 ? tlNames.map((tn: string, i: number) => <span key={i} className="company-code" style={{ marginRight: 4 }}>{tn}</span>) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td><span className="company-code">{l.leaveType}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.startDate)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.endDate)}</td>
                      <td><span className="employees-count">{l.totalDays}</span></td>
                      <td style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{l.appliedOn ? fmtDate(l.appliedOn) : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="status-badge-table" style={{ background: sc.bg, color: sc.text }}>{l.status}</span>
                          {isAwaitingMasterAdmin(l.approvalStatus, l.masterAdminRequired, l.masterAdminApproveStatus) && (
                            <span className="company-code" style={{ fontSize: 11, background: '#fff7ed', color: '#9a3412' }}>Awaiting {MA_TIER_LABEL}</span>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                            <div style={{ flex: 1, height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden', minWidth: '50px' }}>
                              <div style={{ width: `${approvalProgressOf(l).width}%`, height: '100%', background: l.status === 'Rejected' ? '#ef4444' : '#3b82f6', borderRadius: '3px' }} />
                            </div>
                            <span style={{ color: '#6b7280' }}>{approvalProgressOf(l).label}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button className="action-btn edit" title="View approval status" onClick={() => openDetails(l)}><Eye size={16} /></button>
                          {(() => {
                            const tier = getActionableTier(l)
                            if (tier && user) {
                              return (
                                <>
                                  <button className="action-btn edit" title={`Approve as ${TIER_LABELS[tier]}`} onClick={() => openReview(l, tier, 'Approved')}><Check size={16} /></button>
                                  <button className="action-btn delete" title={`Reject as ${TIER_LABELS[tier]}`} onClick={() => openReview(l, tier, 'Rejected')}><X size={16} /></button>
                                </>
                              )
                            }
                            return null
                          })()}
                          {user?.role === 'master-admin' && isMasterAdminPending(l) && (() => {
                            return (
                              <>
                                <button className="action-btn edit" title="Approve as Master Admin (final)" onClick={() => openMasterAdminReview(l, 'Approved')}><Check size={16} /></button>
                                <button className="action-btn delete" title="Reject as Master Admin (final)" onClick={() => openMasterAdminReview(l, 'Rejected')}><X size={16} /></button>
                              </>
                            )
                          })()}
                          {user?.role === 'team-leader' && l.status === 'Pending' && (() => {
                            const tlUser = allUsers.find(u => u.id === user?.id)
                            const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
                            const execId = getAssignedExecutiveId(l.companyId)
                            const exec = allUsers.find(u => u.id === execId)
                            const execIsInactive = exec && exec.isActive === false
                            const hasContingency = !!(tlUser as any)?.contingencyAccess
                            const isContingencyActive = linkedIds.includes(execId) && (hasContingency || execIsInactive)
                            return isContingencyActive ? (
                              <span className="company-code" style={{ fontSize: 11, marginRight: 4, background: '#fef3c7', color: '#92400e' }}>
                                <Crown size={12} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                                Acting Manager
                              </span>
                            ) : null
                          })()}
                          {l.status !== 'Approved' && l.status !== 'Rejected' && (l.userId === user?.id) && (
                            <button className="action-btn" title="Cancel" onClick={() => handleCancel(l.id)}><Ban size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filteredData.length === 0 && (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>No leave requests found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={filteredData.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
          />
        </div>
      </div>

      {/* Apply Modal */}
      <Modal isOpen={isApplyOpen} onClose={() => setIsApplyOpen(false)} title="Apply for Leave" size="medium">
        <form onSubmit={handleApply} className="modal-form">
          {isApprover && (
            <div className="form-group">
              <label>Application For *</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={applyMode === 'self' ? 'btn-primary' : 'btn-secondary'}
                  style={{ flex: 1 }}
                  onClick={() => setApplyMode('self')}
                >
                  For Myself
                </button>
                <button
                  type="button"
                  className={applyMode === 'behalf' ? 'btn-primary' : 'btn-secondary'}
                  style={{ flex: 1 }}
                  onClick={() => setApplyMode('behalf')}
                >
                  For an Employee
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                {applyMode === 'self'
                  ? 'Submitting your OWN personal leave through the standard employee flow. Your management approval queue is untouched.'
                  : 'Applying on behalf of a selected employee. This does not affect your own leave balance or requests.'}
              </p>
            </div>
          )}

          {isApprover && applyMode === 'behalf' && (
            <div className="form-group">
              <label>Employee *</label>
              <select
                value={applyData.employeeId}
                onChange={(e) => setApplyData(prev => ({ ...prev, employeeId: e.target.value }))}
                required
              >
                <option value="">-- Select Employee --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeId})</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Leave Type *</label>
            <select
              value={applyData.leaveType}
              onChange={(e) => setApplyData(prev => ({ ...prev, leaveType: e.target.value as LeaveType }))}
              required
            >
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}{isLeaveTypePaid(t) ? ' (Paid)' : ' (Unpaid)'}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Start Date *</label>
              <input type="date" value={applyData.startDate} onChange={(e) => setApplyData(prev => ({ ...prev, startDate: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>End Date *</label>
              <input type="date" value={applyData.endDate} onChange={(e) => setApplyData(prev => ({ ...prev, endDate: e.target.value }))} required />
            </div>
          </div>

          <div style={{ background: '#f9fafb', padding: '10px 14px', borderRadius: '8px', fontSize: '14px', marginBottom: '8px' }}>
            Total Days: <strong>{calcLeaveDays(new Date(applyData.startDate), new Date(applyData.endDate))}</strong>
          </div>

          <div className="form-group">
            <label>Reason *</label>
            <textarea value={applyData.reason} onChange={(e) => setApplyData(prev => ({ ...prev, reason: e.target.value }))} rows={3} placeholder="Reason for leave..." required />
          </div>

          <ActionErrorBanner message={applyError} onDismiss={() => setApplyError(null)} marginBottom={8} />

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsApplyOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit Request'}</button>
          </div>
        </form>
      </Modal>

      {/* Review Modal */}
      <Modal isOpen={isReviewOpen} onClose={() => setIsReviewOpen(false)} title={`${reviewAction === 'Approved' ? 'Approve' : 'Reject'} as ${reviewIsMasterAdmin ? MA_TIER_LABEL : TIER_LABELS[reviewTier]}`} size="small">
        {reviewTarget && (
          <div className="modal-form">
            <div style={{ marginBottom: '12px' }}>
              <p><strong>{reviewTarget.employeeName}</strong> — {reviewTarget.leaveType}</p>
              <p style={{ color: '#6b7280', fontSize: '14px' }}>{fmtDate(reviewTarget.startDate)} → {fmtDate(reviewTarget.endDate)} ({reviewTarget.totalDays} days)</p>
              <p style={{ fontSize: '14px', marginTop: '6px' }}>{reviewTarget.reason}</p>
              <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {getEffectiveTiers((reviewTarget as any).applicantRole).map(t => {
                  const st = reviewTarget.approvalStatus[t]
                  const isCurrent = t === reviewTier
                  return (
                    <span key={t} style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                      background: st === 'Approved' ? '#dcfce7' : st === 'Rejected' ? '#fee2e2' : isCurrent ? '#dbeafe' : '#f3f4f6',
                      color: st === 'Approved' ? '#16a34a' : st === 'Rejected' ? '#ef4444' : isCurrent ? '#2563eb' : '#6b7280',
                      border: isCurrent ? '1px solid #2563eb' : '1px solid transparent',
                    }}>
                      {TIER_LABELS[t]}: {st}
                    </span>
                  )
                })}
                {(getEffectiveTiers((reviewTarget as any).applicantRole).length === 0) && !reviewTarget.masterAdminRequired && (
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                    background: '#f3f4f6', color: '#6b7280', border: '1px solid transparent',
                  }}>
                    All tiers auto-completed
                  </span>
                )}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                {(() => {
                  const tiers = getEffectiveTiers((reviewTarget as any).applicantRole)
                  const revTotal = tiers.length + (reviewTarget.masterAdminRequired ? 1 : 0)
                  const revDone =
                    tiers.filter(t => reviewTarget.approvalStatus[t] !== 'Pending').length +
                    (reviewTarget.masterAdminApproveStatus === 'Approved' || reviewTarget.masterAdminApproveStatus === 'Rejected' ? 1 : 0)
                  return `Approval Progress: ${revDone}/${revTotal} tier${revTotal > 1 ? 's' : ''} resolved`
                })()}
              </div>
              {reviewTarget.masterAdminRequired && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                    background: reviewTarget.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : reviewTarget.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed',
                    color: reviewTarget.masterAdminApproveStatus === 'Approved' ? '#16a34a' : reviewTarget.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412',
                    border: '1px solid transparent',
                  }}>
                    {MA_TIER_LABEL}: {reviewTarget.masterAdminApproveStatus || 'Pending'}
                  </span>
                </div>
              )}
              {reviewTarget.approvalLog && reviewTarget.approvalLog.length > 0 && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Approval Log</p>
                  {reviewTarget.approvalLog.map((entry: any, idx: number) => (
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
            </div>
            <div className="form-group">
              <label>Remark / Reason *</label>
              <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} placeholder="Write a mandatory remark for this approval decision..." />
            </div>
            {reviewError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, color: '#b91c1c', fontSize: 13 }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{reviewError}</span>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsReviewOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: reviewAction === 'Approved' ? '#16a34a' : '#ef4444' }}
                onClick={handleReview}
                disabled={isSubmitting || reviewNote.trim() === ''}
              >
                {isSubmitting ? 'Saving...' : `${reviewAction === 'Approved' ? 'Approve' : 'Reject'} as ${reviewIsMasterAdmin ? MA_TIER_LABEL : TIER_LABELS[reviewTier]}`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Approval Status / Details Modal (visible to applicant & approvers) */}
      <Modal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Leave Approval Status" size="small">
        {detailsTarget && (() => {
          const detailTiers = getEffectiveTiers((detailsTarget as any).applicantRole)
          const detailTotal = detailTiers.length + (detailsTarget.masterAdminRequired ? 1 : 0)
          const detailDone =
            detailTiers.filter(t => detailsTarget.approvalStatus[t] !== 'Pending').length +
            (detailsTarget.masterAdminApproveStatus === 'Approved' || detailsTarget.masterAdminApproveStatus === 'Rejected' ? 1 : 0)
          return (
          <div className="modal-form">
            <div style={{ marginBottom: '12px' }}>
              <p><strong>{detailsTarget.employeeName}</strong> — {detailsTarget.leaveType}</p>
              <p style={{ color: '#6b7280', fontSize: '14px' }}>{fmtDate(detailsTarget.startDate)} → {fmtDate(detailsTarget.endDate)} ({detailsTarget.totalDays} days)</p>
              <p style={{ fontSize: '14px', marginTop: '6px' }}>{detailsTarget.reason}</p>
              <div style={{ marginTop: '8px' }}>
                <span className="status-badge-table" style={{ background: statusColor(detailsTarget.status).bg, color: statusColor(detailsTarget.status).text }}>{detailsTarget.status}</span>
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Approval Progress</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {detailTiers.map(t => {
                  const st = detailsTarget.approvalStatus[t]
                  const done = st === 'Approved'
                  const rejected = st === 'Rejected'
                  return (
                    <span key={t} style={{
                      padding: '3px 8px', borderRadius: '4px', fontSize: '11px',
                      background: done ? '#dcfce7' : rejected ? '#fee2e2' : '#f3f4f6',
                      color: done ? '#16a34a' : rejected ? '#ef4444' : '#6b7280',
                      border: '1px solid transparent',
                    }}>
                      {TIER_LABELS[t]}: {st}
                    </span>
                  )
                })}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                <strong>{detailDone}</strong>/{detailTotal} approval tier{detailTotal > 1 ? 's' : ''} resolved
              </div>
              {detailsTarget.masterAdminRequired && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                    background: detailsTarget.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : detailsTarget.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed',
                    color: detailsTarget.masterAdminApproveStatus === 'Approved' ? '#16a34a' : detailsTarget.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412',
                    border: '1px solid transparent',
                  }}>
                    {MA_TIER_LABEL}: {detailsTarget.masterAdminApproveStatus || 'Pending'}
                  </span>
                </div>
              )}
            </div>

            {detailsTarget.approvalLog && detailsTarget.approvalLog.length > 0 && (
              <div style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Approval Log</p>
                {detailsTarget.approvalLog.map((entry: any, idx: number) => (
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

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsDetailsOpen(false)}>Close</button>
            </div>
          </div>
          )
        })()}
      </Modal>
    </div>
  )
}
