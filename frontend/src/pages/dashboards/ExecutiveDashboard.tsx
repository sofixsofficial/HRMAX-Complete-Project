import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Clock, CheckSquare, FileText, BarChart3,
  Briefcase, Megaphone, Building2, ShieldAlert, Wallet, Calculator, Calendar,
  PartyPopper, Cake, Crown,
  ArrowUpRight,
} from 'lucide-react'
import { collection, query, where, onSnapshot } from '../../aws/firestore-compat'
import { db } from '../../aws/clients'
import { Header } from '../../components/Header'
import { DashboardHero } from '../../components/DashboardHero'
import { MissedPunchAlertCard } from '../../components/MissedPunchAlertCard'
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel'
import { LeaveApplyModal } from '../../components/LeaveApplyModal'
import { SelfAttendanceCard } from '../../components/SelfAttendanceCard'
import { useAuth } from '../../context/AuthContext'
import { useCompany } from '../../context/CompanyContext'
import { usePermissionScope } from '../../hooks/usePermissionScope'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { logAudit } from '../../services/auditLogService'
import './../Dashboard.css'

interface CardDef {
  key: string
  icon: any
  label: string
  path: string
  permission: string
  trend: string
}

const CARD_DEFS: CardDef[] = [
  { key: 'employees',    icon: Users,      label: 'Assigned Employees', path: '/employees',                     permission: 'employees.view',  trend: 'Total' },
  { key: 'executives',   icon: Crown,      label: 'Total Executives',   path: '/executives',                    permission: 'employees.view',  trend: 'Management' },
  { key: 'active-employees', icon: Users,  label: 'Active Employees',   path: '/employees?status=Active',       permission: 'employees.view',  trend: 'Active' },
  { key: 'inactive-employees', icon: Users, label: 'Inactive Employees', path: '/employees?status=Inactive',    permission: 'employees.view',  trend: 'Inactive' },
  { key: 'tasks-pending',icon: Briefcase,  label: 'Pending Work',      path: '/tasks',                         permission: 'tasks.view',    trend: 'Needs Attention' },
  { key: 'present',      icon: Clock,      label: 'Present Today',     path: '/attendance?status=Present&period=today',    permission: 'attendance.view',trend: 'Checked In' },
  { key: 'absent',       icon: Clock,      label: 'Absent Today',      path: '/attendance?status=Absent&period=today',     permission: 'attendance.view',trend: 'Absent' },
  { key: 'late',         icon: Clock,      label: 'Late Today',        path: '/attendance?status=Late&period=today',       permission: 'attendance.view',trend: 'Late' },
  { key: 'on-leave',     icon: Calendar,   label: 'On Leave Today',    path: '/employees?status=leave',       permission: 'attendance.view',trend: 'On Leave' },
  { key: 'miss-punch',   icon: Clock,      label: 'Missed Punch',      path: '/attendance?status=Miss Punch', permission: 'attendance.view',trend: 'Needs Review' },
  { key: 'approved-attendance', icon: CheckSquare, label: 'Approved Attendance', path: '/attendance?status=Approved&period=today', permission: 'attendance.view', trend: 'Approved' },
  { key: 'task-status',  icon: CheckSquare,label: 'Task Status',       path: '/tasks',                         permission: 'tasks.view',    trend: 'Completed' },
  { key: 'announcements',icon: Megaphone,  label: 'Announcements',     path: '/announcements',                 permission: '',              trend: 'Total' },
  { key: 'leaves',       icon: Calendar,   label: 'Pending Leave Requests', path: '/leaves?status=Pending',   permission: 'leave.view',    trend: '' },
  { key: 'leaves-total', icon: Calendar,   label: 'Total Leave Requests', path: '/leaves',                    permission: 'leave.view',    trend: 'All Time' },
  { key: 'leaves-approved', icon: Calendar, label: 'Approved Leaves',  path: '/leaves?status=Approved',        permission: 'leave.view',    trend: 'Approved' },
  { key: 'leaves-rejected', icon: Calendar, label: 'Rejected Leaves',  path: '/leaves?status=Rejected',        permission: 'leave.view',    trend: 'Rejected' },
  { key: 'total-companies', icon: Building2, label: 'Total Companies', path: '/companies',                   permission: 'companies.view', trend: 'Authorized' },
  { key: 'payroll',      icon: Wallet,     label: 'Payroll',           path: '/payroll',                       permission: 'payroll.view',  trend: 'Generated' },
  { key: 'salary',       icon: Calculator, label: 'Salary Slips',      path: '/salary-slips',                  permission: 'salary.view',   trend: 'Total' },
  { key: 'departments',  icon: Building2,  label: 'Departments',        path: '/departments',                   permission: 'departments.view', trend: 'All' },
  { key: 'holidays',     icon: PartyPopper, label: 'Upcoming Holidays', path: '/holidays',                     permission: '',              trend: 'Coming Up' },
  { key: 'birthdays',    icon: Cake,       label: 'Today Birthdays',    path: '/birthdays',                    permission: '',              trend: '' },
]

const QUICK_ACTIONS = [
  { icon: Users,      label: 'Add Employee',    path: '/employees',   permission: 'employees.create', color: '#10b981' },
  { icon: FileText,   label: 'Mark Attendance', path: '/attendance',  permission: 'attendance.manage', color: '#f59e0b' },
  { icon: Calendar,   label: 'Apply Leave',     path: '/leaves',      permission: 'leave.apply', color: '#8b5cf6' },
  { icon: Calendar,   label: 'Process Leaves',  path: '/leaves',      permission: 'leave.approve', color: '#7c3aed' },
  { icon: CheckSquare,label: 'Update Tasks',    path: '/tasks',       permission: 'tasks.manage', color: '#ec4899' },
  { icon: BarChart3,  label: 'View Reports',    path: '/reports',     permission: 'reports.view', color: '#3b82f6' },
  { icon: Wallet,     label: 'Run Payroll',     path: '/payroll',     permission: 'payroll.manage', color: '#ef4444' },
  { icon: Calculator, label: 'Salary Slips',    path: '/salary-slips',permission: 'salary.view', color: '#f97316' },
  { icon: Building2, label: 'Create Department', path: '/departments',permission: 'departments.create', color: '#10b981' },
]

function ZeroStateBanner() {
  return (
    <div className="zero-state-banner">
      <div className="zero-state-icon"><Building2 size={32} /></div>
      <h3>No Company Assigned</h3>
      <p>You don't have any companies assigned to your account. Contact your administrator to get access.</p>
    </div>
  )
}

export function ExecutiveDashboard() {
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const { selectedCompanyId, setSelectedCompanyId, availableCompanies, canAccessAllCompanies, isCompanyRestricted } = usePermissionScope('dashboard')
  const [announcements, setAnnouncements] = useState(0)
  const [unauthorizedCompany, setUnauthorizedCompany] = useState(false)
  const [executives, setExecutives] = useState(0)
  const [showLeaveApply, setShowLeaveApply] = useState(false)

  const hasCompanyContext = availableCompanies.length > 0

  // Active scope: the selected company, or the FULL set of assigned companies
  // in "All Companies" mode. Executives are always assignment-scoped — we
  // never fall back to the user's own profile company, which could leak
  // unassigned data. No truncation: useDashboardStats chunks beyond 10 ids.
  const scopeCompanyIds = useMemo(() => {
    if (selectedCompanyId) return [selectedCompanyId]
    return availableCompanies.map(c => c.id)
  }, [selectedCompanyId, availableCompanies])
  const stats = useDashboardStats(scopeCompanyIds)

  useEffect(() => {
    // Announcements in the active scope (assignment-scoped, no fallback leak).
    if (scopeCompanyIds.length === 0) { setAnnouncements(0); return }
    // Firestore caps `in` at 10 — listen per chunk and sum the counts.
    const base = collection(db, 'announcements')
    const unsubs: (() => void)[] = []
    const perChunk: number[] = []
    const chunkCount = Math.ceil(scopeCompanyIds.length / 10)
    for (let c = 0; c < chunkCount; c++) perChunk.push(0)
    const recompute = () => setAnnouncements(perChunk.reduce((a, b) => a + b, 0))
    for (let c = 0; c < chunkCount; c++) {
      const chunk = scopeCompanyIds.slice(c * 10, c * 10 + 10)
      const ref = chunk.length === 1
        ? query(base, where('companyId', '==', chunk[0]))
        : query(base, where('companyId', 'in', chunk))
      perChunk[c] = 0
      const unsub = onSnapshot(ref, (snap) => {
        perChunk[c] = snap.size
        recompute()
      }, () => { perChunk[c] = 0; recompute() })
      unsubs.push(unsub)
    }
    return () => { unsubs.forEach(u => { try { u() } catch {} }) }
  }, [scopeCompanyIds])

  // Total Executives in the active scope (mirrors the Executives page).
  // Role-constrained query: never reads non-executive accounts, and the
  // in-memory filter keeps only executives mapped to the active companies.
  useEffect(() => {
    if (scopeCompanyIds.length === 0) { setExecutives(0); return }
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'executive')),
      (snap) => {
        const count = snap.docs.filter((d: any) => {
          const data = d.data()
          const assigned: string[] = data.assignedCompanyIds || []
          return assigned.some(cid => scopeCompanyIds.includes(cid))
        }).length
        setExecutives(count)
      },
      () => setExecutives(0)
    )
    return () => unsub()
  }, [scopeCompanyIds])

  const visibleCards = useMemo(
    () => CARD_DEFS.filter(c => !c.permission || hasPermission(c.permission)),
    [hasPermission],
  )
  const visibleActions = useMemo(
    () => QUICK_ACTIONS.filter(a => hasPermission(a.permission)),
    [hasPermission],
  )

  const navigateWithAudit = (path: string, module: string) => {
    if (!hasCompanyContext) {
      setUnauthorizedCompany(true)
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name || 'Executive',
          userRole: user.role,
          action: `BLOCKED: No company context for ${module}`,
          actionType: 'export',
          module: 'Dashboard',
          targetEntity: module,
          details: `Blocked navigation — no valid company selected`,
          status: 'failure',
        })
      }
      return
    }

    // "" means "All Companies": the destination module is itself scoped to the
    // executive's authorized companies, so cards navigate directly without
    // forcing a single-company selection first.
    const companyId = selectedCompanyId || ''
    const companyName = companyId
      ? (availableCompanies.find(c => c.id === companyId)?.name || companyId)
      : 'All Companies'

    if (user) {
      logAudit({
        userId: user.id,
        userName: user.name || 'Executive',
        userRole: user.role,
        action: `Navigated to ${module} for ${companyName}`,
        actionType: 'export',
        module: 'Dashboard',
        targetEntity: module,
        companyId: companyId || undefined,
        details: `Company scope: ${companyName}`,
        status: 'success',
      })
    }
    setUnauthorizedCompany(false)
    setSelectedCompanyId(companyId)
    navigate(path)
  }

  const getCardValue = (key: string): string | number => {
    switch (key) {
      case 'employees':     return stats.totalEmployees
      case 'executives':    return executives
      case 'active-employees': return stats.activeEmployees
      case 'inactive-employees': return stats.inactiveEmployees
      case 'tasks-pending': return stats.pendingTasks
      case 'present':       return stats.presentToday
      case 'absent':        return stats.absentToday
      case 'late':          return stats.lateToday
      case 'on-leave':      return stats.onLeaveToday
      case 'miss-punch':    return stats.missPunchApprovals
      case 'approved-attendance': return stats.approvedAttendanceToday
      case 'task-status':   return `${stats.completedTasks}/${stats.pendingTasks + stats.completedTasks}`
      case 'announcements': return announcements
      case 'leaves':        return stats.pendingLeaveApprovals
      case 'leaves-total':  return stats.totalLeaveRequests
      case 'leaves-approved': return stats.approvedLeaves
      case 'leaves-rejected': return stats.rejectedLeaves
      case 'total-companies': return selectedCompanyId ? 1 : availableCompanies.length
      case 'payroll':       return stats.salaryGenerated
      case 'salary':        return stats.salaryGenerated
      case 'departments':   return stats.activeDepartments
      case 'holidays':      return stats.upcomingHolidays
      case 'birthdays':     return stats.todayBirthdays
      default:              return 0
    }
  }

  const getCardTrend = (key: string): string => {
    if (!hasCompanyContext) return ''
    if (key === 'leaves') return stats.pendingLeaveApprovals > 0 ? 'Pending' : 'None'
    return CARD_DEFS.find(c => c.key === key)?.trend || ''
  }

  const handleCardKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  return (
    <div className="page-container">
      <Header title="Executive Dashboard" />
      <div className="page-content">

        {hasCompanyContext && (
          <>
            {/* Welcome Hero — time-based scene, live clock, server-confirmed working mode */}
            <DashboardHero
              stats={[
                { label: 'Present', value: stats.presentToday, color: '#10b981' },
                { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
                { label: 'On Leave', value: stats.onLeaveToday, color: '#3b82f6' },
                { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
              ]}
            />

            {/* Missed Punch Alert */}
            <MissedPunchAlertCard count={stats.missPunchApprovals} badge={stats.missPunchApprovals} />

            {/* Multi-tier leave verification — requests routed to this executive.
                Positioned directly below the missed-punch banner for immediate review. */}
            {scopeCompanyIds.length > 0 && (
              <LeaveApprovalsPanel
                companyIds={scopeCompanyIds}
                userId={user?.id || ''}
                userName={user?.name || ''}
                role={user?.role}
              />
            )}

            {/* Personal Leave & Attendance Portal */}
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
                Track your own leave requests and approval progress (Team Leader → Master Admin), attendance
                history, remaining balances, and submit missed-punch corrections for yourself.
              </div>
            </div>

            {/* Self Attendance */}
            <SelfAttendanceCard role="executive" />

            {/* Company Filter Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: '#fff', border: '1px solid #f3f4f6', borderRadius: 8, width: 'fit-content', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <Building2 size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>Company:</span>
              {isCompanyRestricted && availableCompanies.length === 1 ? (
                <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', padding: '2px 4px' }}>{availableCompanies[0].name}</span>
              ) : (
                <select
                  value={selectedCompanyId || ''}
                  onChange={e => { setUnauthorizedCompany(false); setSelectedCompanyId(e.target.value || '') }}
                  style={{ border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500, color: '#374151', outline: 'none', cursor: 'pointer', padding: '2px 4px', minWidth: 160 }}
                >
                  {(canAccessAllCompanies || availableCompanies.length > 1) && <option value="">All Companies</option>}
                  {availableCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            {unauthorizedCompany && (
              <div className="exec-unauthorized-banner">
                <ShieldAlert size={18} />
                <span>Unauthorized: You do not have access to this company's data.</span>
                <button className="exec-unauthorized-dismiss" onClick={() => setUnauthorizedCompany(false)}>Dismiss</button>
              </div>
            )}
          </>
        )}

        {/* Stat Cards — shown after live counts load (avoid provisional zeros) */}
        {stats.loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: '#6b7280', fontSize: 13 }}>
            <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <span>Loading real-time counts…</span>
          </div>
        ) : (
        <div className="stats-grid">
          {visibleCards.map(card => {
            const Icon = card.icon
            return (
              <div
                key={card.key}
                className="stat-card"
                onClick={() => {
                  if (!hasCompanyContext) return
                  navigateWithAudit(card.path, card.label)
                }}
                tabIndex={0}
                onKeyDown={(e) =>
                  handleCardKeyDown(e, () => {
                    if (!hasCompanyContext) return
                    navigateWithAudit(card.path, card.label)
                  })
                }
              >
                <div className="stat-icon">
                  <Icon size={24} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">{card.label}</span>
                  <div className="stat-value">{getCardValue(card.key)}</div>
                  {getCardTrend(card.key) && <span className="stat-trend">{getCardTrend(card.key)}</span>}
                </div>
                <ArrowUpRight size={16} className="stat-arrow" />
              </div>
            )
          })}
        </div>
        )}

        {/* No companies assigned notice (cards still show 0 above) */}
        {!hasCompanyContext && (
          <ZeroStateBanner />
        )}

        {/* Quick Actions */}
        {hasCompanyContext && (
          <div className="quick-actions-section">
            <h3>Quick Actions</h3>
            <div className="quick-actions-grid">
              <div className="quick-action-card" onClick={() => setShowLeaveApply(true)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, () => setShowLeaveApply(true))}>
                <div className="qa-icon" style={{ background: 'rgba(139, 92, 246, 0.09)', color: '#8b5cf6' }}>
                  <Calendar size={22} />
                </div>
                <span>Apply My Leave</span>
              </div>
              {visibleActions.map((item, idx) => {
                const Icon = item.icon
                return (
                  <div key={idx} className="quick-action-card" onClick={() => hasCompanyContext && navigateWithAudit(item.path, item.label)} tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, () => hasCompanyContext && navigateWithAudit(item.path, item.label))}>
                    <div className="qa-icon" style={{ background: `${item.color}15`, color: item.color }}>
                      <Icon size={22} />
                    </div>
                    <span>{item.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Self leave application (standard employee flow) */}
      <LeaveApplyModal
        isOpen={showLeaveApply}
        onClose={() => setShowLeaveApply(false)}
        companyId={selectedCompanyId || (scopeCompanyIds.length > 0 ? scopeCompanyIds[0] : undefined)}
      />
    </div>
  )
}
