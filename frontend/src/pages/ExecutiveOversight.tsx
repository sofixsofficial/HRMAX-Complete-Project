import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Crown, Building2, Users, ChevronLeft, ChevronRight,
  Eye, ArrowRightLeft, Download, Loader2, ArrowLeft,
  Clock, CheckSquare,
  Shield, AlertCircle, X,
  CheckCircle, RefreshCw, Activity, UserCheck, ListChecks
} from 'lucide-react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { getAllUsers } from '../services/authService'
import { getAllCompanies } from '../services/companyService'
import type { User, Company } from '../types/user'
import './ExecutiveOversight.css'

interface ExtendedUser extends User {
  executiveTitle?: string
  assignedCompanyIds?: string[]
  assignedTeamLeaderIds?: string[]
}

const fmtDate = (d: any) => {
  if (!d) return '-'
  try {
    const date = d.toDate ? d.toDate() : new Date(d)
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '-' }
}

const fmtDateTime = (d: any) => {
  if (!d) return '-'
  try {
    const date = d.toDate ? d.toDate() : new Date(d)
    return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '-' }
}

export function ExecutiveOversight() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [executives, setExecutives] = useState<ExtendedUser[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([])
  const [allTeamLeaders, setAllTeamLeaders] = useState<ExtendedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedExecutive, setSelectedExecutive] = useState<ExtendedUser | null>(null)
  const [companyFilter, setCompanyFilter] = useState('')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Drill-down data
  const [permissions, setPermissions] = useState<string[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [monitorData, setMonitorData] = useState<{
    attendanceToday: number; activeTasks: number; completedTasks: number; tlCount: number
    recentAuditLogs: any[]; recentTasks: any[]
  }>({ attendanceToday: 0, activeTasks: 0, completedTasks: 0, tlCount: 0, recentAuditLogs: [], recentTasks: [] })
  const [monitorLoading, setMonitorLoading] = useState(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [all, companies] = await Promise.all([
        getAllUsers(),
        getAllCompanies(),
      ])
      setExecutives(all.filter(u => u.role === 'executive'))
      setAllTeamLeaders(all.filter(u => u.role === 'team-leader'))
      setAllCompanies(companies)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const getCompanyName = (id: string) => allCompanies.find(c => c.id === id)?.name || id
  const getTLName = (id: string) => allTeamLeaders.find(t => t.id === id)?.name || id

  const filtered = executives.filter(u => {
    const s = searchTerm.toLowerCase()
    const matchSearch = !s || u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s)
    const matchStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && u.isActive) ||
      (statusFilter === 'inactive' && !u.isActive)
    return matchSearch && matchStatus
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const fetchMonitorData = async (execId: string, companyId: string) => {
    setMonitorLoading(true)
    try {
      const cFilter = companyId ? [companyId] : []
      const attSnap = cFilter.length > 0
        ? await getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId), limit(50)))
        : await getDocs(query(collection(db, 'attendance'), orderBy('date', 'desc'), limit(50)))
      const today = new Date().toISOString().split('T')[0]
      const attendanceToday = attSnap.docs.filter(d => {
        const dd = d.data() as any
        const dStr = dd.date?.toDate ? dd.date.toDate().toISOString().split('T')[0] : dd.date?.split('T')[0] || ''
        return dStr === today
      }).length

      const taskQ = cFilter.length > 0
        ? query(collection(db, 'tasks'), where('companyId', '==', companyId))
        : collection(db, 'tasks')
      const taskSnap = await getDocs(taskQ)
      let activeTasks = 0
      let completedTasks = 0
      taskSnap.docs.forEach(d => {
        const dd = d.data() as any
        if (dd.status === 'Completed' || dd.status === 'Done') completedTasks++
        else activeTasks++
      })

      const auditQ = cFilter.length > 0
        ? query(collection(db, 'audit_logs'), where('companyId', '==', companyId), orderBy('timestamp', 'asc'), limit(10))
        : query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(10))
      const auditSnap = await getDocs(auditQ)
      const recentAuditLogs = auditSnap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()

      const recentTaskQ = cFilter.length > 0
        ? query(collection(db, 'tasks'), where('companyId', '==', companyId), orderBy('createdAt', 'asc'), limit(5))
        : query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(5))
      const recentTaskSnap = await getDocs(recentTaskQ)
      const recentTasks = recentTaskSnap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()

      const exec = executives.find(e => e.id === execId)
      const tlCount = (exec as any)?.assignedTeamLeaderIds?.length || 0

      setMonitorData({ attendanceToday, activeTasks, completedTasks, tlCount, recentAuditLogs, recentTasks })
    } catch { /* ignore */ }
    setMonitorLoading(false)
  }

  const openExecutive = async (exec: ExtendedUser) => {
    setSelectedExecutive(exec)
    setCompanyFilter('')
    setProfileLoading(true)
    // Fetch permissions
    let perms: string[] = []
    try {
      const userDoc = await getDoc(doc(db, 'users', exec.id))
      if (userDoc.exists()) {
        const data = userDoc.data()
        perms = data.permissions || []
      }
    } catch { /* ignore */ }
    setPermissions(perms)
    setProfileLoading(false)
    await fetchMonitorData(exec.id, '')
  }

  const closeExecutive = () => {
    setSelectedExecutive(null)
    setCompanyFilter('')
    setMonitorData({ attendanceToday: 0, activeTasks: 0, completedTasks: 0, tlCount: 0, recentAuditLogs: [], recentTasks: [] })
  }

  const handleCompanyFilterChange = (cId: string) => {
    setCompanyFilter(cId)
    if (selectedExecutive) {
      fetchMonitorData(selectedExecutive.id, cId)
    }
  }

  const handleExport = () => {
    const rows = [['Executive Name', 'Email', 'Title', 'Companies Count', 'Companies', 'Team Leaders', 'Status']]
    filtered.forEach(e => {
      const comps = (e.assignedCompanyIds || []).map(getCompanyName).join(', ')
      const tls = (e.assignedTeamLeaderIds || []).map(getTLName).join(', ')
      rows.push([e.name, e.email, e.executiveTitle || '-', String((e.assignedCompanyIds || []).length), comps, tls, e.isActive ? 'Active' : 'Inactive'])
    })
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `Executive_Oversight_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
    setToast({ message: 'Executive matrix exported as CSV', type: 'success' })
  }

  const moduleMonitoringLinks: { icon: typeof Eye; label: string; href: string }[] = [
    { icon: Clock, label: 'View Attendance', href: '/attendance' },
    { icon: CheckSquare, label: 'View Tasks', href: '/tasks' },
    { icon: Shield, label: 'View Audit Logs', href: '/audit-logs' },
    { icon: Users, label: 'View Employees', href: '/employees' },
    { icon: Building2, label: 'View Companies', href: '/companies' },
    { icon: ArrowRightLeft, label: 'View Transfers', href: '/transfer-management' },
  ]

  // ── MAIN TABLE VIEW ──
  if (!selectedExecutive) {
    return (
      <div className="page-container">
        <Header title="Executive Oversight Matrix" />
        <div className="page-content">
          {loading ? (
            <div className="eom-loading"><Loader2 className="animate-spin" size={32} /><span>Loading executive data...</span></div>
          ) : (
            <>
              <div className="eom-header-row">
                <div className="eom-header-left">
                  <h2>Executive Oversight Matrix</h2>
                  <p>Monitor all executives, their assigned companies, and reporting team leaders</p>
                </div>
                <div className="eom-header-actions">
                  <button className="btn-primary btn-sm" onClick={handleExport}><Download size={16} /> Export Matrix</button>
                </div>
              </div>

              <div className="eom-stats">
                <div className="eom-stat-card">
                  <div className="eom-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><Crown size={22} /></div>
                  <div className="eom-stat-info"><strong>{executives.length}</strong><span>Total Executives</span></div>
                </div>
                <div className="eom-stat-card">
                  <div className="eom-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}><Building2 size={22} /></div>
                  <div className="eom-stat-info"><strong>{allCompanies.filter(c => (c as any).assignedExecutiveId).length}</strong><span>Companies Assigned</span></div>
                </div>
                <div className="eom-stat-card">
                  <div className="eom-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}><Users size={22} /></div>
                  <div className="eom-stat-info"><strong>{allTeamLeaders.filter(t => (t as any).reportingExecutiveId).length}</strong><span>TLs Reporting</span></div>
                </div>
                <div className="eom-stat-card">
                  <div className="eom-stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}><AlertCircle size={22} /></div>
                  <div className="eom-stat-info"><strong>{executives.filter(e => !e.isActive).length}</strong><span>Inactive Executives</span></div>
                </div>
                <div className="eom-stat-card">
                  <div className="eom-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}><RefreshCw size={22} /></div>
                  <div className="eom-stat-info"><strong>{allCompanies.filter(c => c.operationalMode === 'Continuous').length}C</strong><span>· {allCompanies.filter(c => c.operationalMode === 'Discontinuous').length}D</span></div>
                </div>
              </div>

              <div className="eom-toolbar">
                <div className="eom-search-box">
                  <Search size={16} />
                  <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
                </div>
                <select className="eom-filter-select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setCurrentPage(1) }}>
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="eom-table-wrapper">
                <table className="eom-table">
                  <thead>
                    <tr>
                      <th>Executive Name</th>
                      <th>Companies Handled</th>
                      <th>Assigned Companies</th>
                      <th>Reporting Team Leaders</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 ? (
                      <tr><td colSpan={6}><div className="eom-empty">No executives match your filters</div></td></tr>
                    ) : paginated.map(e => {
                      const companyIds = e.assignedCompanyIds || []
                      const tlIds = e.assignedTeamLeaderIds || []
                      return (
                        <tr key={e.id}>
                          <td>
                            <div className="eom-name-cell">
                              <span className="eom-name-link" onClick={() => openExecutive(e)}>{e.name}</span>
                              <span className="eom-name-sub">{e.executiveTitle || 'Executive'} · {e.email}</span>
                            </div>
                          </td>
                          <td>
                            <span className="eom-count-num">{companyIds.length}</span>
                          </td>
                          <td>
                            <div className="eom-chips">
                              {companyIds.slice(0, 3).map(cId => {
                                const comp = allCompanies.find(c => c.id === cId)
                                const mode = comp?.operationalMode
                                return <span key={cId} className={`eom-chip ${mode === 'Continuous' ? 'chip-green' : mode === 'Discontinuous' ? 'chip-amber' : ''}`}>{getCompanyName(cId)}</span>
                              })}
                              {companyIds.length > 3 && <span className="eom-chip chip-more">+{companyIds.length - 3}</span>}
                              {companyIds.length === 0 && <span className="eom-none">None</span>}
                            </div>
                          </td>
                          <td>
                            <div className="eom-chips">
                              {tlIds.slice(0, 2).map(tlId => (
                                <span key={tlId} className="eom-chip chip-blue">{getTLName(tlId)}</span>
                              ))}
                              {tlIds.length > 2 && <span className="eom-chip chip-more">+{tlIds.length - 2}</span>}
                              {tlIds.length === 0 && <span className="eom-none">None</span>}
                            </div>
                          </td>
                          <td>
                            <span className={`eom-pill ${e.isActive ? 'pill-green' : 'pill-red'}`}>{e.isActive ? 'Active' : 'Inactive'}</span>
                          </td>
                          <td onClick={ev => ev.stopPropagation()}>
                            <div className="eom-actions">
                              <button className="eom-action-btn" onClick={() => openExecutive(e)} title="Monitor"><Eye size={15} /></button>
                              <button className="eom-action-btn" onClick={() => navigate('/executives')} title="Edit Assignment"><Crown size={15} /></button>
                              <button className="eom-action-btn" onClick={() => navigate('/transfer-management')} title="Transfer"><ArrowRightLeft size={15} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="eom-pagination">
                  <span className="eom-pagination-info">Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
                  <div className="eom-pagination-controls">
                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={15} /></button>
                    <span className="eom-pagination-page">{currentPage} / {totalPages || 1}</span>
                    <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={15} /></button>
                    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
                      <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        {toast && (
          <div className={`eom-toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
            {toast.message}
          </div>
        )}
      </div>
    )
  }

  // ── DRILL-DOWN MONITORING VIEW ──
  const companyIds = selectedExecutive.assignedCompanyIds || []
  const selectedCompany = allCompanies.find(c => c.id === companyFilter)

  return (
    <div className="page-container">
      <Header title={`Monitor: ${selectedExecutive.name}`} />
      <div className="page-content">
        <div className="eom-monitor">
          {/* Header */}
          <div className="eom-monitor-header">
            <button className="eom-back-btn" onClick={closeExecutive}><ArrowLeft size={16} /> Back to Matrix</button>
            <div className="eom-monitor-info">
              <h2>{selectedExecutive.name}</h2>
              <p>{selectedExecutive.executiveTitle || 'Executive'} · {selectedExecutive.email}</p>
            </div>
            <div className="eom-monitor-meta">
              <div className="eom-monitor-stat"><Building2 size={14} /> <strong>{companyIds.length}</strong> Companies</div>
              <div className="eom-monitor-stat"><Users size={14} /> <strong>{(selectedExecutive as any).assignedTeamLeaderIds?.length || 0}</strong> TLs</div>
              <span className={`eom-pill ${selectedExecutive.isActive ? 'pill-green' : 'pill-red'}`}>{selectedExecutive.isActive ? 'Active' : 'Inactive'}</span>
            </div>
          </div>

          {/* Company Filter */}
          <div className="eom-filter-row">
            <div className="eom-filter-group">
              <Building2 size={15} />
              <select value={companyFilter} onChange={e => handleCompanyFilterChange(e.target.value)}>
                <option value="">All Companies</option>
                {companyIds.map(cId => {
                  const comp = allCompanies.find(c => c.id === cId)
                  return <option key={cId} value={cId}>{comp?.name || cId}</option>
                })}
              </select>
            </div>
            <span className="eom-filter-hint">
              {companyFilter ? `Viewing data for ${selectedCompany?.name || companyFilter}` : 'Viewing data across all assigned companies'}
            </span>
            <span className="eom-badge-viewonly"><Eye size={12} /> View-Only Monitoring</span>
          </div>

          {/* Live Status Cards */}
          <div className="eom-live-cards">
            <div className="eom-live-card">
              <Clock size={20} />
              <div>
                <strong>{monitorData.attendanceToday}</strong>
                <span>Attendance Today</span>
              </div>
            </div>
            <div className="eom-live-card">
              <Activity size={20} />
              <div>
                <strong>{monitorData.activeTasks}</strong>
                <span>Active Tasks</span>
              </div>
            </div>
            <div className="eom-live-card">
              <CheckCircle size={20} />
              <div>
                <strong>{monitorData.completedTasks}</strong>
                <span>Completed Tasks</span>
              </div>
            </div>
            <div className="eom-live-card">
              <Users size={20} />
              <div>
                <strong>{monitorData.tlCount}</strong>
                <span>TLs Reporting</span>
              </div>
            </div>
          </div>

          <div className="eom-monitor-grid">
            {/* Permission Audit */}
            <div className="eom-monitor-section">
              <div className="eom-section-title"><Shield size={16} /> Permission Audit</div>
              {profileLoading ? (
                <div className="eom-monitor-loading"><Loader2 className="animate-spin" size={16} /> Loading permissions...</div>
              ) : permissions.length > 0 ? (
                <div className="eom-perm-list">
                  {permissions.map((p, i) => (
                    <div key={i} className="eom-perm-item">
                      <CheckCircle size={12} />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="eom-monitor-empty">No explicit permissions granted (uses role-based defaults)</div>
              )}
            </div>

            {/* Quick Monitoring Links */}
            <div className="eom-monitor-section">
              <div className="eom-section-title"><Eye size={16} /> Quick Monitoring Links</div>
              <div className="eom-monitor-links">
                {moduleMonitoringLinks.map(link => (
                  <a key={link.href} href={link.href} className="eom-monitor-link" onClick={ev => { ev.preventDefault(); navigate(link.href) }}>
                    <link.icon size={15} />
                    <span>{link.label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="eom-monitor-section" style={{ marginTop: 16 }}>
            <div className="eom-section-title"><RefreshCw size={16} /> Recent Activity</div>
            {monitorLoading ? (
              <div className="eom-monitor-loading"><Loader2 className="animate-spin" size={16} /> Loading activity...</div>
            ) : (
              <>
                <div className="eom-monitor-activity">
                  {monitorData.recentTasks.length > 0 && (
                    <div className="eom-activity-block">
                      <h4>Recent Tasks</h4>
                      <table className="eom-mini-table">
                        <thead><tr><th>Title</th><th>Status</th><th>Priority</th></tr></thead>
                        <tbody>
                          {monitorData.recentTasks.slice(0, 5).map((t: any) => (
                            <tr key={t.id}>
                              <td style={{ fontSize: 12 }}>{t.title || '-'}</td>
                              <td><span className={`eom-pill ${t.status === 'Completed' || t.status === 'Done' ? 'pill-green' : t.status === 'In Progress' ? 'pill-amber' : 'pill-gray'}`} style={{ fontSize: 11, padding: '2px 8px' }}>{t.status || '-'}</span></td>
                              <td><span className="eom-priority-tag" style={{ background: t.priority === 'High' ? '#fee2e2' : t.priority === 'Medium' ? '#fef3c7' : '#dbeafe', color: t.priority === 'High' ? '#ef4444' : t.priority === 'Medium' ? '#d97706' : '#2563eb', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{t.priority || '-'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {monitorData.recentAuditLogs.length > 0 && (
                    <div className="eom-activity-block">
                      <h4>Recent Audit Activity</h4>
                      <table className="eom-mini-table">
                        <thead><tr><th>Time</th><th>Action</th><th>Module</th></tr></thead>
                        <tbody>
                          {monitorData.recentAuditLogs.slice(0, 8).map((log: any) => (
                            <tr key={log.id}>
                              <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(log.timestamp)}</td>
                              <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.action || '-'}</td>
                              <td><span style={{ fontSize: 11, color: '#6b7280' }}>{log.module || '-'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {monitorData.recentTasks.length === 0 && monitorData.recentAuditLogs.length === 0 && (
                    <div className="eom-monitor-empty">No recent activity found{companyFilter ? ' for the selected company' : ''}.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div className={`eom-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  )
}
