import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Search, Download, ChevronLeft, ChevronRight,
  Loader2, Filter, X, Calendar, User, Building2, AlertCircle,
  CheckCircle, Clock, Shield, Users, DollarSign,
  Settings, Mail, Megaphone, FolderOpen, ArrowRightLeft,
  HelpCircle, LogIn, LogOut, Trash2, Pencil, Plus, ThumbsUp,
  ThumbsDown, UserCheck
} from 'lucide-react'
import { collection, getDocs, query, orderBy, limit, where } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { logAudit, ACTION_MODULES, ACTION_TYPES, STATUS_OPTIONS, actionLabel, statusBadge } from '../services/auditLogService'
import './AuditLogs.css'

interface AuditLog {
  id: string
  timestamp: Date | null
  userId: string
  userName: string
  userRole: string
  action: string
  actionType: string
  module: string
  targetEntity: string
  targetId?: string
  companyId?: string
  companyName?: string
  details?: string
  status: string
}

const MODULE_ICONS: Record<string, typeof FileText> = {
  'Employees': Users,
  'Attendance': Clock,
  'Leave': Calendar,
  'Payroll': DollarSign,
  'Roles & Permissions': Shield,
  'Companies': Building2,
  'Departments': Building2,
  'Tasks': FileText,
  'Documents': FolderOpen,
  'Transfer Management': ArrowRightLeft,
  'Settings': Settings,
  'Announcements': Megaphone,
  'Emails': Mail,
  'Support Tickets': HelpCircle,
  'Authentication': LogIn,
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function AuditLogs() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, selectedCompanyName } = useCompany()
  const navigate = useNavigate()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; role: string }[]>([])

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [moduleFilter, setModuleFilter] = useState('All')
  const [actionTypeFilter, setActionTypeFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [companyFilter, setCompanyFilter] = useState('All')
  const [userFilter, setUserFilter] = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) } }, [toast])

  // Sync local company filter with global context
  useEffect(() => {
    setCompanyFilter(effectiveCompanyId || 'All')
  }, [effectiveCompanyId])

  useEffect(() => {
    if (user && user.role !== 'master-admin') {
      navigate('/unauthorized', { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const baseRef = collection(db, 'audit_logs')
        const constraints: any[] = effectiveCompanyId ? [orderBy('timestamp', 'asc')] : [orderBy('timestamp', 'desc')]
        if (effectiveCompanyId) {
          constraints.push(where('companyId', '==', effectiveCompanyId))
        }
        constraints.push(limit(5000))
        const q = query(baseRef, ...constraints)
        const snap = await getDocs(q)
        // Snapshot data is untyped DocumentData — the docs are audit logs at runtime.
        // Rows carry `timestamp` (client writer), `createdAt` (server writer), or
        // both — display must fall back so no row renders as N/A.
        //
        // Two writers, two shapes: the browser writer (`logAudit`) sends
        // userName/userRole/module/status, while SERVER rows (legacy
        // `logAuditEvent`, password/reset audits) only carry actorId/actorName/
        // action/details. Spreading a server row as-is left `userRole` and
        // `status` undefined, and one `.replace()` on undefined blanked the
        // whole table — normalize every field at read time instead.
        let allLogs: AuditLog[] = snap.docs.map(d => {
          const raw = d.data() as Record<string, unknown>
          // ISO strings carry a patched toDate() (see aws/firestore.ts); guard
          // against garbage so an invalid date can never render "Invalid Date".
          const rawTs = raw.timestamp ?? raw.createdAt
          let ts: Date | null = null
          try {
            // Wire formats seen in the wild: ISO string (both writers), epoch
            // milliseconds (one legacy row), or a Timestamp-like object.
            const parsed =
              typeof rawTs === 'number'
                ? new Date(rawTs)
                : ((rawTs as { toDate?: () => Date } | undefined)?.toDate?.() ?? null)
            if (parsed && !Number.isNaN(parsed.getTime())) ts = parsed
          } catch {
            ts = null
          }
          return {
            ...raw,
            id: d.id,
            timestamp: ts,
            // `||` (not `??`) on purpose: server rows and some client rows ship
            // EMPTY strings for these, which must fall through too.
            userId: String(raw.userId || raw.actorId || raw.createdById || ''),
            userName: String(raw.userName || raw.actorName || raw.createdByName || 'System'),
            userRole: String(raw.userRole || raw.role || 'system'),
            action: String(raw.action || 'Activity'),
            actionType: String(raw.actionType || 'update'),
            module: String(raw.module || 'Authentication'),
            targetEntity: String(raw.targetEntity || raw.targetId || '—'),
            status: String(raw.status || 'success'),
            details: raw.details == null || raw.details === '' ? undefined : String(raw.details),
            companyName: raw.companyName == null || raw.companyName === '' ? undefined : String(raw.companyName),
          } as unknown as AuditLog
        })
        if (effectiveCompanyId) allLogs.reverse()

        const compSnap = await getDocs(collection(db, 'companies'))
        const comps = compSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id }))
        setCompanies(comps)

        const userSnap = await getDocs(collection(db, 'users'))
        const users = userSnap.docs.map(d => ({
          id: d.id,
          name: (d.data() as any).name || d.id,
          role: (d.data() as any).role || 'unknown',
        }))
        setAllUsers(users)

        setLogs(allLogs)
      } catch (err) {
        console.error('Error fetching audit logs:', err)
        setToast({ type: 'error', message: 'Failed to load audit logs. Please try again.' })
      } finally {
        setLoading(false)
      }
    }

    if (user && user.role === 'master-admin') {
      fetchData()
    }
  }, [user, effectiveCompanyId])

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (searchTerm) {
        const q = searchTerm.toLowerCase()
        const matches = l.userName.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.targetEntity.toLowerCase().includes(q) ||
          l.module.toLowerCase().includes(q) ||
          (l.details || '').toLowerCase().includes(q)
        if (!matches) return false
      }
      if (moduleFilter !== 'All' && l.module !== moduleFilter) return false
      if (actionTypeFilter !== 'All' && l.actionType !== actionTypeFilter) return false
      if (statusFilter !== 'All' && l.status !== statusFilter) return false
      if (companyFilter !== 'All' && l.companyId !== companyFilter) return false
      if (userFilter !== 'All' && l.userId !== userFilter) return false
      if (dateFrom) {
        const from = new Date(dateFrom)
        from.setHours(0, 0, 0, 0)
        if (l.timestamp && l.timestamp < from) return false
      }
      if (dateTo) {
        const to = new Date(dateTo)
        to.setHours(23, 59, 59, 999)
        if (l.timestamp && l.timestamp > to) return false
      }
      return true
    })
  }, [logs, searchTerm, moduleFilter, actionTypeFilter, statusFilter, companyFilter, userFilter, dateFrom, dateTo])

  // Stats
  const stats = useMemo(() => ({
    total: filteredLogs.length,
    success: filteredLogs.filter(l => l.status === 'success').length,
    failure: filteredLogs.filter(l => l.status === 'failure').length,
    warning: filteredLogs.filter(l => l.status === 'warning').length,
    today: filteredLogs.filter(l => {
      if (!l.timestamp) return false
      const today = new Date()
      return l.timestamp.toDateString() === today.toDateString()
    }).length,
  }), [filteredLogs])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // Export
  const handleExport = () => {
    const headers = ['Timestamp', 'User', 'Role', 'Action', 'Module', 'Target', 'Company', 'Status', 'Details']
    const rows = filteredLogs.map(l => [
      l.timestamp ? l.timestamp.toLocaleString() : 'N/A',
      l.userName,
      l.userRole,
      l.action,
      l.module,
      l.targetEntity,
      l.companyName || 'N/A',
      l.status,
      l.details || '',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)

    // Log the export action
    if (user) {
      logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'Exported Audit Log',
        actionType: 'export',
        module: 'Audit Logs',
        targetEntity: 'Audit Log Report',
        companyId: effectiveCompanyId || user.companyId || undefined,
        status: 'success',
        details: `Exported ${filteredLogs.length} log entries`,
      })
    }

    setToast({ type: 'success', message: `Exported ${filteredLogs.length} log entries` })
  }

  const clearFilters = () => {
    setSearchTerm('')
    setModuleFilter('All')
    setActionTypeFilter('All')
    setStatusFilter('All')
    setCompanyFilter('All')
    setUserFilter('All')
    setDateFrom('')
    setDateTo('')
    setCurrentPage(1)
  }

  const hasActiveFilters = searchTerm || moduleFilter !== 'All' || actionTypeFilter !== 'All' ||
    statusFilter !== 'All' || companyFilter !== 'All' || userFilter !== 'All' || dateFrom || dateTo

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Audit Logs" breadcrumbs={['Dashboard', 'Audit Logs']} />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading audit logs...</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Audit Logs" breadcrumbs={['Dashboard', 'Audit Logs']} />

      <div className="page-content">
        {/* Toast */}
        {toast && (
          <div className={`audit-toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}><X size={14} /></button>
          </div>
        )}

        {/* Stats */}
        <div className="audit-stats">
          <div className="audit-stat-card">
            <div className="audit-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><FileText size={22} /></div>
            <div className="audit-stat-info">
              <span className="audit-stat-label">Total Logs</span>
              <span className="audit-stat-value">{stats.total}</span>
            </div>
          </div>
          <div className="audit-stat-card">
            <div className="audit-stat-icon" style={{ background: '#dcfce7', color: '#16a34a' }}><CheckCircle size={22} /></div>
            <div className="audit-stat-info">
              <span className="audit-stat-label">Successful</span>
              <span className="audit-stat-value">{stats.success}</span>
            </div>
          </div>
          <div className="audit-stat-card">
            <div className="audit-stat-icon" style={{ background: '#fee2e2', color: '#ef4444' }}><AlertCircle size={22} /></div>
            <div className="audit-stat-info">
              <span className="audit-stat-label">Failed</span>
              <span className="audit-stat-value">{stats.failure}</span>
            </div>
          </div>
          <div className="audit-stat-card">
            <div className="audit-stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Clock size={22} /></div>
            <div className="audit-stat-info">
              <span className="audit-stat-label">Warnings</span>
              <span className="audit-stat-value">{stats.warning}</span>
            </div>
          </div>
          <div className="audit-stat-card">
            <div className="audit-stat-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}><Calendar size={22} /></div>
            <div className="audit-stat-info">
              <span className="audit-stat-label">Today</span>
              <span className="audit-stat-value">{stats.today}</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="audit-filters-section">
          <div className="audit-filters-top">
            <div className="audit-search-wrapper">
              <Search size={18} className="audit-search-icon" />
              <input
                type="text"
                placeholder="Search by user, action, target, or details..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
            <button className="audit-btn-export" onClick={handleExport}>
              <Download size={16} /> Export CSV
            </button>
            <button className="audit-btn-export" onClick={() => window.print()}>
              <FileText size={16} /> Export PDF
            </button>
          </div>

          <div className="audit-filters-grid">
            <div className="audit-filter-group">
              <label>Module</label>
              <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setCurrentPage(1) }}>
                {ACTION_MODULES.map(m => <option key={m} value={m}>{m === 'All' ? 'All Modules' : m}</option>)}
              </select>
            </div>
            <div className="audit-filter-group">
              <label>Action Type</label>
              <select value={actionTypeFilter} onChange={e => { setActionTypeFilter(e.target.value); setCurrentPage(1) }}>
                {ACTION_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Actions' : actionLabel(t)}</option>)}
              </select>
            </div>
            <div className="audit-filter-group">
              <label>Status</label>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1) }}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="audit-filter-group">
              <label>Company</label>
              <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setCurrentPage(1) }}>
                <option value="All">All Companies</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="audit-filter-group">
              <label>User</label>
              <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setCurrentPage(1) }}>
                <option value="All">All Users</option>
                {allUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </div>
            <div className="audit-filter-group">
              <label>From Date</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setCurrentPage(1) }} />
            </div>
            <div className="audit-filter-group">
              <label>To Date</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setCurrentPage(1) }} />
            </div>
            {hasActiveFilters && (
              <button className="audit-clear-btn" onClick={clearFilters}>
                <X size={14} /> Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Results Count */}
        <div className="audit-results-count">
          Showing <strong>{filteredLogs.length}</strong> of <strong>{logs.length}</strong> log entries
        </div>

        {/* Table */}
        <div className="audit-table-wrapper">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Module</th>
                <th>Target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="audit-empty-cell">
                    <FileText size={48} color="#d1d5db" />
                    <p>No audit logs found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
                    <span>Try adjusting your search or filters</span>
                  </td>
                </tr>
              ) : paginatedLogs.map(log => {
                const ModuleIcon = MODULE_ICONS[log.module] || FileText
                const sc = statusBadge(String(log.status || 'success'))
                const roleColor: Record<string, string> = {
                  'master-admin': '#f97316',
                  'company-admin': '#3b82f6',
                  'executive': '#8b5cf6',
                  'team-leader': '#10b981',
                  'hr': '#0ea5e9',
                  'employee': '#6b7280',
                  'system': '#64748b',
                }
                // Defensive: a row from an unknown writer must degrade to a
                // label, never throw — one bad row used to blank the table.
                const roleKey = String(log.userRole || 'system')
                const roleLabel = roleKey
                  .replace('-', ' ')
                  .replace(/\b\w/g, (l: string) => l.toUpperCase())
                const statusKey = String(log.status || 'success')
                return (
                  <tr key={log.id}>
                    <td>
                      <div className="audit-timestamp">
                        <Calendar size={13} />
                        <span>{log.timestamp ? log.timestamp.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}</span>
                        <span className="audit-time">{log.timestamp ? log.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
                    </td>
                    <td>
                      <div className="audit-user">
                        <span className="audit-user-name">{log.userName}</span>
                        {log.companyName && <span className="audit-user-company">{log.companyName}</span>}
                      </div>
                    </td>
                    <td>
                      <span className="audit-role-badge" style={{ color: roleColor[roleKey] || '#6b7280' }}>
                        {roleLabel}
                      </span>
                    </td>
                    <td>
                      <div className="audit-action">
                        <span className="audit-action-text">{log.action}</span>
                        {log.details && <span className="audit-action-detail" title={log.details}>{log.details}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="audit-module">
                        <ModuleIcon size={13} />
                        <span>{log.module}</span>
                      </div>
                    </td>
                    <td>
                      <span className="audit-target">{log.targetEntity}</span>
                    </td>
                    <td>
                      <span className="audit-status-badge" style={{ background: sc.bg, color: sc.text }}>
                        {statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="audit-pagination">
          <div className="audit-pagination-info">
            <span>Showing {paginatedLogs.length} of {filteredLogs.length} entries</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}/page</option>)}
            </select>
          </div>
          <div className="audit-pagination-controls">
            <button className="audit-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}><ChevronLeft size={14} /></button>
            <button className="audit-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 7).map(p => (
              <button key={p} className={`audit-page-btn ${currentPage === p ? 'audit-page-btn-active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
            ))}
            {totalPages > 7 && <span className="audit-page-ellipsis">...</span>}
            <button className="audit-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></button>
            <button className="audit-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
