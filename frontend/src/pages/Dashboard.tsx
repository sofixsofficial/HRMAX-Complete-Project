import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Building2, Users, UserCheck, Briefcase, Calendar, CheckSquare, 
  Wallet, PartyPopper, BarChart3, Clock, UserPlus, Shield,
  ArrowUpRight, Loader2, TrendingUp, Network, Bell, ChevronDown,
  Crown, UserX, AlertCircle, Cake, Package,
  CheckCircle, XCircle, Ban, Activity, Search
} from 'lucide-react'
import { Header } from '../components/Header'
import { DashboardHero } from '../components/DashboardHero'
import { MissedPunchAlertCard } from '../components/MissedPunchAlertCard'
import { MasterAdminApprovalsPanel } from '../components/MasterAdminApprovalsPanel'
import { useAuth } from '../context/AuthContext'
import { useRealtimeDashboard } from '../hooks/useRealtimeDashboard'
import { getAllUsers } from '../services/authService'
import { getAllCompanies } from '../services/companyService'
import { subscribeToAdminAlerts, markAdminAlertAsRead, markAllAdminAlertsAsRead } from '../services/notificationService'
import type { AdminAlert } from '../services/notificationService'
import type { User, Company } from '../types/user'

import './Dashboard.css'

interface DashboardCard {
  icon: typeof Building2;
  label: string;
  count: string | number;
  trend?: string;
  path: string;
  show: boolean;
}

export function Dashboard() {
  const navigate = useNavigate()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const companyId = user?.role === 'master-admin' ? null : user?.companyId
  const data = useRealtimeDashboard(companyId)
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([])
  const [hFilterCompany, setHFilterCompany] = useState('')
  const [hFilterExecutive, setHFilterExecutive] = useState('')
  const [hFilterTL, setHFilterTL] = useState('')
  const [loadingTimeout, setLoadingTimeout] = useState(false)
  const [adminAlerts, setAdminAlerts] = useState<AdminAlert[]>([])

  useEffect(() => {
    if (user?.role !== 'master-admin') return
    const unsub = subscribeToAdminAlerts(alerts => setAdminAlerts(alerts.slice(0, 8)))
    return unsub
  }, [user?.role])

  const handleAlertClick = async (a: AdminAlert) => {
    if (!a.read) await markAdminAlertAsRead(a.id)
    if (a.link) navigate(a.link)
  }

  useEffect(() => {
    if (!data.loading) { setLoadingTimeout(false); return }
    const timer = setTimeout(() => setLoadingTimeout(true), 15000)
    return () => clearTimeout(timer)
  }, [data.loading])

  useEffect(() => {
    if (user?.role !== 'master-admin') return
    Promise.all([
      getAllUsers(),
      getAllCompanies().catch(() => [] as Company[]),
    ]).then(([users, comps]) => {
      setAllUsers(users)
      setAllCompanies(comps)
    }).catch(() => {})
  }, [user?.role])

  const toggleSection = (section: string) => {
    setOpenSection(prev => prev === section ? null : section)
  }

  const handleCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate(path)
    }
  }

  const topCards: DashboardCard[] = [
    { icon: Building2, label: 'Total Companies', count: data.totalCompanies, trend: 'Active', path: '/companies', show: user?.role === 'master-admin' },
    { icon: Users, label: 'Total Employees', count: data.totalEmployees, trend: `${data.activeEmployees} Active`, path: '/employees', show: true },
    { icon: UserCheck, label: 'Active Employees', count: data.activeEmployees, trend: 'Active', path: '/employees?status=Active', show: user?.role === 'master-admin' || user?.role === 'company-admin' },
    { icon: Users, label: 'Inactive Employees', count: data.inactiveEmployees, trend: 'Inactive', path: '/employees?status=Inactive', show: user?.role === 'master-admin' || user?.role === 'company-admin' },
    { icon: Crown, label: 'Total Executives', count: data.totalExecutives, trend: 'Management', path: '/executives', show: user?.role === 'master-admin' },
    { icon: UserPlus, label: 'Team Leaders', count: data.totalTeamLeaders, trend: 'Team Leads', path: '/team-leaders', show: user?.role === 'master-admin' },
    { icon: Clock, label: 'Present Today', count: data.presentToday, trend: 'Checked In', path: '/attendance?status=Present', show: true },
    { icon: UserX, label: 'Absent Today', count: data.absentToday, trend: 'Marked Absent', path: '/attendance?status=Absent', show: true },
    { icon: Clock, label: 'Late Today', count: data.lateToday, trend: 'Late', path: '/attendance?status=Late', show: true },
    { icon: Clock, label: 'Miss Punch', count: data.missPunchToday, trend: 'Missed Punch', path: '/attendance?status=Miss Punch', show: true },
    { icon: Calendar, label: 'On Leave', count: data.onLeaveToday, trend: 'On Leave Today', path: '/employees?status=leave', show: true },
    { icon: Calendar, label: 'Pending Leaves', count: data.pendingLeaves, trend: data.pendingLeaves > 0 ? 'Awaiting Review' : 'None', path: '/leaves?status=Pending', show: true },
    { icon: Wallet, label: 'Payroll Processed', count: data.salaryGenerated, trend: 'Total Records', path: '/salary-slips', show: true },
    { icon: CheckSquare, label: 'Pending Tasks', count: data.pendingTasks, trend: data.pendingTasks > 0 ? 'Pending' : 'All Done', path: '/tasks?status=Pending', show: true },
    { icon: CheckSquare, label: 'Completed Tasks', count: data.completedTasks, trend: 'Done', path: '/tasks?status=Completed', show: true },
    { icon: PartyPopper, label: 'Upcoming Holidays', count: data.upcomingHolidays, trend: 'Coming Up', path: '/holidays', show: true },
    { icon: Cake, label: 'Today Birthdays', count: data.todayBirthdays, trend: data.todayBirthdays > 0 ? 'Celebrate!' : 'None Today', path: '/birthdays', show: true },
    { icon: Network, label: 'Departments', count: data.totalDepartments, trend: 'Active', path: '/departments', show: true },

    { icon: Shield, label: 'Total Roles', count: data.totalRoles, trend: `${data.activeRoles} Active`, path: '/roles', show: user?.role === 'master-admin' },
    { icon: Users, label: 'Company Admins', count: data.totalCompanyAdmins, trend: `${data.pendingCompanyAdmins} Pending`, path: '/company-admin-approvals', show: user?.role === 'master-admin' },
    { icon: Clock, label: 'Pending Approvals', count: data.pendingCompanyAdmins, trend: 'Awaiting Review', path: '/company-admin-approvals?status=Pending', show: user?.role === 'master-admin' },
    { icon: CheckCircle, label: 'Approved Admins', count: data.approvedCompanyAdmins, trend: 'Active', path: '/company-admin-approvals?status=Approved', show: user?.role === 'master-admin' && data.approvedCompanyAdmins > 0 },
    { icon: XCircle, label: 'Rejected Admins', count: data.rejectedCompanyAdmins, trend: 'Rejected', path: '/company-admin-approvals?status=Rejected', show: user?.role === 'master-admin' && data.rejectedCompanyAdmins > 0 },
    { icon: Ban, label: 'Suspended Admins', count: data.suspendedCompanyAdmins, trend: 'Suspended', path: '/company-admin-approvals?status=Suspended', show: user?.role === 'master-admin' && data.suspendedCompanyAdmins > 0 },
  ]

  const actionCards = [
    { icon: Building2, label: 'Add Company', path: '/companies', color: '#f97316' },
    { icon: UserPlus, label: 'Add Employee', path: '/employees', color: '#10b981' },
    { icon: Crown, label: 'Add Executive', path: '/executives', color: '#8b5cf6' },
    { icon: UserPlus, label: 'Add Team Leader', path: '/team-leaders', color: '#f59e0b' },
    { icon: CheckSquare, label: 'Assign Task', path: '/tasks', color: '#ec4899' },
    { icon: Wallet, label: 'Generate Payroll', path: '/payroll', color: '#ef4444' },
    { icon: Shield, label: 'Roles & Access', path: '/roles', color: '#8b5cf6' },

    { icon: PartyPopper, label: 'Holidays', path: '/holidays', color: '#f97316' },
    { icon: Cake, label: 'Birthdays', path: '/birthdays', color: '#ec4899' },
    { icon: Network, label: 'Departments', path: '/departments', color: '#10b981' },
    { icon: Package, label: 'Manage Assets', path: '/assets', color: '#8b5cf6' },
    { icon: Clock, label: 'Attendance', path: '/attendance', color: '#f59e0b' },
    { icon: Calendar, label: 'Leave Requests', path: '/leaves?status=Pending', color: '#ef4444' },
  ]

  if (!isAuthenticated && !authLoading) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content">
          <div className="loading-container">
            <AlertCircle size={32} color="#ef4444" />
            <p>Session expired. Please sign in again.</p>
            <button className="btn-primary" onClick={() => navigate('/login')} style={{ marginTop: 12 }}>
              Go to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (data.loading && !loadingTimeout) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content">
          <div className="loading-container">
            <Loader2 className="animate-spin" size={32} />
            <p>Loading dashboard data...</p>
          </div>
        </div>
      </div>
    )
  }

  if (loadingTimeout) {
    return (
      <div className="page-container">
        <Header title="Dashboard" />
        <div className="page-content">
          <div className="loading-container">
            <AlertCircle size={32} />
            <p>Dashboard is taking longer than expected. Check your connection and try again.</p>
            <button className="btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>
              Reload Page
            </button>
          </div>
        </div>
      </div>
    )
  }

  const visibleCards = topCards.filter(c => c.show)

  return (
    <div className="page-container">
      <Header title="Dashboard" />
      
      <div className="page-content">
        {/* Welcome Hero — time-based scene, live clock + team stats.
            Master Admin does not punch in/out from the dashboard (no personal
            attendance slice) — they get the static "Not Checked In" pill. */}
        <DashboardHero
          showAttendance={false}
          stats={[
            { label: 'Present', value: data.presentToday, color: '#10b981' },
            { label: 'Absent', value: data.absentToday, color: '#ef4444' },
            { label: 'On Leave', value: data.onLeaveToday, color: '#3b82f6' },
            { label: 'Pending Tasks', value: data.pendingTasks, color: '#ec4899' },
          ]}
        />

        {/* Missed Punch Alert */}
        <MissedPunchAlertCard count={data.missPunchToday} badge={data.missPunchToday} />

        {/* Master Admin final-verification queue (Executive / TL leave + missed punch) */}
        {user?.role === 'master-admin' && (
          <MasterAdminApprovalsPanel userId={user?.id || ''} userName={user?.name || ''} />
        )}

        {/* Top Stats Cards Row */}
        <div className="stats-grid">
          {visibleCards.map((card, idx) => {
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
          </div>
        </div>

        {/* Admin Alerts */}
        {user?.role === 'master-admin' && adminAlerts.length > 0 && (
          <div className="accordion-card" style={{ marginBottom: 12 }}>
            <div className="accordion-header">
              <h3><Bell size={16} /> Admin Alerts</h3>
              <div className="accordion-right">
                <button
                  onClick={() => markAllAdminAlertsAsRead()}
                  style={{ fontSize: 12, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                >
                  Mark all read
                </button>
              </div>
            </div>
            <div style={{ padding: '0 20px 16px' }}>
              {adminAlerts.map(a => (
                <div key={a.id} onClick={() => handleAlertClick(a)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                    background: a.read ? '#f9fafb' : '#fff7ed', marginBottom: 6,
                    border: a.priority === 'high' ? '1px solid #fee2e2' : '1px solid transparent'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: a.read ? 400 : 600, color: '#0f172a' }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.body}</div>
                  </div>
                  <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Accordion Sections */}
        <div className="accordion-sections">
          <div className={`accordion-card ${openSection === 'activity' ? 'open' : ''}`}>
            <div className="accordion-header" onClick={() => toggleSection('activity')}>
              <h3><Bell size={16} /> Recent Activity</h3>
              <div className="accordion-right">
                <span className="view-all" onClick={(e) => { e.stopPropagation(); navigate('/audit-logs'); }}>View All</span>
                <ChevronDown size={16} className={`accordion-chevron ${openSection === 'activity' ? 'rotated' : ''}`} />
              </div>
            </div>
            <div className="accordion-body">
              <div className="activity-list">
                <div className="activity-empty">
                  <Bell size={20} />
                  <span>Activity tracking available in Audit Logs</span>
                </div>
              </div>
            </div>
          </div>

          <div className={`accordion-card ${openSection === 'stats' ? 'open' : ''}`}>
            <div className="accordion-header" onClick={() => toggleSection('stats')}>
              <h3><TrendingUp size={16} /> Statistics Overview</h3>
              <ChevronDown size={16} className={`accordion-chevron ${openSection === 'stats' ? 'rotated' : ''}`} />
            </div>
            <div className="accordion-body">
              <div className="stats-list">
                {[
                  { label: 'Employee Growth', value: `${data.activeEmployees} Active` },
                  { label: 'Attendance Rate', value: data.totalAttendance > 0 ? `${Math.round((data.presentToday / data.totalAttendance) * 100)}%` : 'N/A' },
                  { label: 'Departments Active', value: `${data.totalDepartments} Depts` },
                  { label: 'Payroll Records', value: `${data.salaryGenerated} Total` },
                  { label: 'Tasks Completed', value: `${data.completedTasks} / ${data.pendingTasks + data.completedTasks + data.inProgressTasks}` },
                ].map((s, idx) => (
                  <div key={idx} className="stats-item">
                    <div className="stats-item-header">
                      <span className="stats-label">{s.label}</span>
                    </div>
                    <div className="stats-value">{s.value}</div>
                    <div className="stats-bar">
                      <div className="stats-bar-fill" style={{ width: `${Math.min(100, idx === 0 ? (data.activeEmployees / Math.max(1, data.totalEmployees)) * 100 : 75)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`accordion-card ${openSection === 'roles' ? 'open' : ''}`}>
            <div className="accordion-header" onClick={() => toggleSection('roles')}>
              <h3><Shield size={16} /> User Roles Overview</h3>
              <div className="accordion-right">
                <span className="view-all" onClick={(e) => { e.stopPropagation(); navigate('/roles'); }}>Manage</span>
                <ChevronDown size={16} className={`accordion-chevron ${openSection === 'roles' ? 'rotated' : ''}`} />
              </div>
            </div>
            <div className="accordion-body">
              <div className="role-list">
                <div className="role-item">
                  <div className="role-info">
                    <div className="role-dot admin" />
                    <span>Master Admin</span>
                  </div>
                  <span className="role-count">{user?.role === 'master-admin' ? '1' : '-'}</span>
                </div>
                <div className="role-item">
                  <div className="role-info">
                    <div className="role-dot hr" />
                    <span>Executives</span>
                  </div>
                  <span className="role-count">{data.totalExecutives}</span>
                </div>
                <div className="role-item">
                  <div className="role-info">
                    <div className="role-dot manager" />
                    <span>Team Leaders</span>
                  </div>
                  <span className="role-count">{data.totalTeamLeaders}</span>
                </div>
                <div className="role-item">
                  <div className="role-info">
                    <div className="role-dot employee" />
                    <span>Employees</span>
                  </div>
                  <span className="role-count">{data.totalEmployees}</span>
                </div>
              </div>
            </div>
          </div>

          {user?.role === 'master-admin' && (
            <div className={`accordion-card ${openSection === 'hierarchy' ? 'open' : ''}`}>
              <div className="accordion-header" onClick={() => toggleSection('hierarchy')}>
                <h3><Network size={16} /> Hierarchy Matrix</h3>
                <ChevronDown size={16} className={`accordion-chevron ${openSection === 'hierarchy' ? 'rotated' : ''}`} />
              </div>
              <div className="accordion-body">
                {(() => {
                  const executives = allUsers.filter(u => u.role === 'executive' && u.isActive)
                  const teamLeaders = allUsers.filter(u => u.role === 'team-leader' && u.isActive)
                  const companies = allCompanies

                  const hierarchy = companies.map(comp => {
                    const execs = executives.filter(e => {
                      const assignedIds = (e as any).assignedCompanyIds || []
                      return assignedIds.includes(comp.id)
                    })
                    return {
                      company: comp,
                      executives: execs.map(exec => ({
                        executive: exec,
                        teamLeaders: teamLeaders.filter(tl => {
                          const linkedIds = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : [])
                          return linkedIds.includes(exec.id)
                        }),
                      })),
                    }
                  }).filter(h => h.executives.length > 0)

                  const filtered = hierarchy.filter(h => {
                    if (hFilterCompany && h.company.id !== hFilterCompany) return false
                    if (hFilterExecutive && !h.executives.some(e => e.executive.id === hFilterExecutive)) return false
                    if (hFilterTL && !h.executives.some(e => e.teamLeaders.some(tl => tl.id === hFilterTL))) return false
                    return true
                  })

                  const allTLs = teamLeaders
                  const allExecs = executives

                  return (
                    <div style={{ padding: '4px 0' }}>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <select value={hFilterCompany} onChange={e => { setHFilterCompany(e.target.value); setHFilterExecutive(''); setHFilterTL('') }}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151', outline: 'none', background: '#fff' }}>
                            <option value="">All Companies</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <select value={hFilterExecutive} onChange={e => { setHFilterExecutive(e.target.value); setHFilterTL('') }}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151', outline: 'none', background: '#fff' }}>
                            <option value="">All Executives</option>
                            {allExecs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <select value={hFilterTL} onChange={e => setHFilterTL(e.target.value)}
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151', outline: 'none', background: '#fff' }}>
                            <option value="">All Team Leaders</option>
                            {allTLs.map(tl => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
                          </select>
                        </div>
                      </div>

                      {filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '28px 16px', color: '#9ca3af', fontSize: 13 }}>
                          <Network size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
                          <div>No hierarchy relationships found for the selected filters.</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {filtered.map(h => (
                            <div key={h.company.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                              <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                                <Building2 size={16} style={{ color: '#f97316', flexShrink: 0 }} />
                                {h.company.name}
                                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginLeft: 'auto' }}>{h.executives.length} executive{h.executives.length !== 1 ? 's' : ''}</span>
                              </div>
                              {h.executives.map(({ executive: exec, teamLeaders: tls }) => (
                                <div key={exec.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <div style={{ padding: '8px 14px 8px 28px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', background: '#fafafa' }}>
                                    <Crown size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                                    <span style={{ fontWeight: 500 }}>{exec.name}</span>
                                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{(exec as any).executiveTitle || 'Executive'}</span>
                                    <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{tls.length} TL{tls.length !== 1 ? 's' : ''}</span>
                                  </div>
                                  {tls.length > 0 ? tls.map(tl => {
                                    const hasContingency = !!(tl as any).contingencyAccess
                                    return (
                                      <div key={tl.id} style={{ padding: '6px 14px 6px 48px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280' }}>
                                        <UserPlus size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                        <span>{tl.name}</span>
                                        {hasContingency && (
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 100, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', fontSize: 10, fontWeight: 500 }}>
                                            <Activity size={10} /> Contingency
                                          </span>
                                        )}
                                      </div>
                                    )
                                  }) : (
                                    <div style={{ padding: '6px 14px 6px 48px', fontSize: 12, color: '#d1d5db', fontStyle: 'italic' }}>No team leaders assigned</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
