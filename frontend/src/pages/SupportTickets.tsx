import { useState, useEffect, useMemo } from 'react'
import {
  MessageSquare, CheckCircle, Clock, AlertCircle, Headphones, Search, Plus, Eye,
  ChevronDown, Filter, Loader2, ChevronLeft, ChevronRight, Send, X, Activity, Building2, User as UserIcon, Users
} from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useRoleBasedStats, useRoleBasedTitle } from '../hooks/useRoleBasedData'
import {
  getAllTickets, getTicketsByCompany, getTicketsByCompanies, getTicketsByUser, getTicketsByExecutive, getTicketsByTeamLeader,
  createTicket, updateTicket, deleteTicket, updateTicketStatus, addTicketMessage, getTicketStats
} from '../services/ticketService'
import { logAudit } from '../services/auditLogService'
import { isDate } from '../utils/dateUtils'
import type { SupportTicket, TicketMessage } from '../types/user'
import './SupportTickets.css'

const PRIORITY_OPTIONS = ['High', 'Medium', 'Low', 'Urgent']
const STATUS_OPTIONS = ['Open', 'In Progress', 'Resolved', 'Closed']
const CATEGORY_OPTIONS = ['IT Support', 'HR', 'Finance', 'General', 'Technical', 'Access Request']

const INITIAL_FORM: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt'> = {
  title: '', description: '', status: 'Open', priority: 'Medium',
  createdBy: '', createdById: '', assignedTo: '', category: 'General', companyId: '',
}

export function SupportTickets() {
  const { user, hasPermission } = useAuth()
  const { canAccessAllCompanies, availableCompanies, effectiveCompanyId, selectedCompanyName } = usePermissionScope('support')
  const pageTitle = useRoleBasedTitle('Support Tickets')
  const { canViewAllStats } = useRoleBasedStats()
  const isTeamLeader = user?.role === 'team-leader'
  const canManageAll = canViewAllStats || isTeamLeader

  // Data
  const [allTickets, setAllTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 })

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [companyFilter, setCompanyFilter] = useState('All')
  const [executiveFilter, setExecutiveFilter] = useState('All')
  const [tlFilter, setTlFilter] = useState('All')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [commentText, setCommentText] = useState('')

  // ============ Data Fetching ============
  const fetchTickets = async () => {
    try {
      setLoading(true)
      let data: SupportTicket[]
      if (user?.role === 'executive') {
        // Executive: fetch tickets from all assigned companies
        const companyIds = availableCompanies.map(c => c.id)
        if (companyIds.length > 0) {
          data = await getTicketsByCompanies(companyIds)
        } else {
          data = await getTicketsByUser(user?.id || '')
        }
      } else if (effectiveCompanyId && user?.role !== 'master-admin') {
        data = await getTicketsByCompany(effectiveCompanyId)
      } else {
        data = await getAllTickets()
      }
      setAllTickets(data)
      setError(null)
    } catch (err) {
      console.error('Error fetching tickets:', err)
      setError('Failed to load tickets.')
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const s = await getTicketStats(effectiveCompanyId || undefined)
      setStats(s)
    } catch {}
  }

  useEffect(() => { fetchTickets(); fetchStats() }, [effectiveCompanyId, user?.id])

  // ============ Derived filter options (chained) ============
  const filterOptions = useMemo(() => {
    // Start with all tickets, then narrow based on active filters (excluding current filter category)
    let pool = allTickets

    // When computing company options, respect exec & TL filters
    let companyPool = pool
    if (executiveFilter !== 'All') companyPool = companyPool.filter(t => t.executiveId === executiveFilter)
    if (tlFilter !== 'All') companyPool = companyPool.filter(t => t.tlId === tlFilter)
    const companies = [...new Map(companyPool.filter(t => t.companyId).map(t => [t.companyId, { id: t.companyId, name: t.companyName || t.companyId }])).values()]

    // When computing exec options, respect company & TL filters
    let execPool = pool
    if (companyFilter !== 'All') execPool = execPool.filter(t => t.companyId === companyFilter)
    if (tlFilter !== 'All') execPool = execPool.filter(t => t.tlId === tlFilter)
    const executives = [...new Map(execPool.filter(t => t.executiveId).map(t => [t.executiveId, { id: t.executiveId, name: t.executiveName || t.executiveId }])).values()]

    // When computing TL options, respect company & exec filters
    let tlPool = pool
    if (companyFilter !== 'All') tlPool = tlPool.filter(t => t.companyId === companyFilter)
    if (executiveFilter !== 'All') tlPool = tlPool.filter(t => t.executiveId === executiveFilter)
    const teamLeaders = [...new Map(tlPool.filter(t => t.tlId).map(t => [t.tlId, { id: t.tlId, name: t.tlName || t.tlId }])).values()]

    return { companies, executives, teamLeaders }
  }, [allTickets, companyFilter, executiveFilter, tlFilter])

  // ============ Filtered & Paginated Tickets ============
  const filteredTickets = useMemo(() => {
    return allTickets.filter(t => {
      if (searchTerm) {
        const s = searchTerm.toLowerCase()
        if (!t.title.toLowerCase().includes(s) && !t.description.toLowerCase().includes(s)) return false
      }
      if (statusFilter !== 'All' && t.status !== statusFilter) return false
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false
      if (companyFilter !== 'All' && t.companyId !== companyFilter) return false
      if (executiveFilter !== 'All' && t.executiveId !== executiveFilter) return false
      if (tlFilter !== 'All' && t.tlId !== tlFilter) return false
      return true
    })
  }, [allTickets, searchTerm, statusFilter, priorityFilter, companyFilter, executiveFilter, tlFilter])

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize))
  const paginatedTickets = filteredTickets.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // ============ CRUD Handlers ============
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await createTicket({ ...formData, createdBy: user?.name || '', createdById: user?.id || '', companyId: effectiveCompanyId || '' })
      logAudit({ userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'master-admin', action: 'Created support ticket', actionType: 'create', module: 'Support Tickets', targetEntity: formData.title, status: 'success' })
      await fetchTickets(); await fetchStats()
      setIsAddOpen(false); setFormData(INITIAL_FORM)
    } catch (err) { console.error(err) } finally { setIsSubmitting(false) }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTicket) return
    setIsSubmitting(true)
    try {
      await updateTicket(selectedTicket.id, formData)
      logAudit({ userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'master-admin', action: 'Updated support ticket', actionType: 'update', module: 'Support Tickets', targetEntity: formData.title, status: 'success', details: `Status: ${formData.status}, Priority: ${formData.priority}` })
      await fetchTickets(); await fetchStats()
      setIsDetailOpen(false); setSelectedTicket(null)
    } catch (err) { console.error(err) } finally { setIsSubmitting(false) }
  }

  const handleStatusChange = async (id: string, status: SupportTicket['status']) => {
    try {
      await updateTicketStatus(id, status)
      logAudit({ userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'master-admin', action: `Changed ticket status to ${status}`, actionType: 'update', module: 'Support Tickets', targetEntity: id, status: 'success' })
      await fetchTickets(); await fetchStats()
      if (selectedTicket?.id === id) {
        setSelectedTicket(prev => prev ? { ...prev, status } : null)
      }
    } catch (err) { console.error(err) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this ticket permanently?')) return
    try {
      await deleteTicket(id)
      logAudit({ userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'master-admin', action: 'Deleted support ticket', actionType: 'delete', module: 'Support Tickets', targetEntity: id, status: 'success' })
      await fetchTickets(); await fetchStats()
    } catch (err) { console.error(err) }
  }

  const handleAddComment = async () => {
    if (!selectedTicket || !commentText.trim()) return
    try {
      await addTicketMessage(selectedTicket.id, { userId: user?.id || '', userName: user?.name || '', message: commentText.trim() })
      logAudit({ userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'master-admin', action: 'Added comment to ticket', actionType: 'update', module: 'Support Tickets', targetEntity: selectedTicket.id, status: 'success' })
      const updated = await (await import('../services/ticketService')).getTicketById(selectedTicket.id)
      if (updated) setSelectedTicket(updated)
      setCommentText('')
    } catch (err) { console.error(err) }
  }

  const openDetail = (ticket: SupportTicket) => {
    setSelectedTicket(ticket)
    setFormData({
      title: ticket.title, description: ticket.description, status: ticket.status,
      priority: ticket.priority, createdBy: ticket.createdBy, createdById: ticket.createdById,
      assignedTo: ticket.assignedTo || '', category: ticket.category, companyId: ticket.companyId,
    })
    setIsDetailOpen(true)
  }

  // ============ Helpers ============
  const statusColor = (s: string) => {
    switch (s) {
      case 'Open': return { bg: '#eff6ff', text: '#2563eb' }
      case 'In Progress': return { bg: '#fef3c7', text: '#d97706' }
      case 'Resolved': return { bg: '#dcfce7', text: '#16a34a' }
      case 'Closed': return { bg: '#f3f4f6', text: '#6b7280' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }
  const priorityColor = (p: string) => {
    switch (p) {
      case 'Urgent': return { bg: '#fef2f2', text: '#dc2626' }
      case 'High': return { bg: '#fee2e2', text: '#ef4444' }
      case 'Medium': return { bg: '#fef3c7', text: '#f59e0b' }
      case 'Low': return { bg: '#ffedd5', text: '#f97316' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }

  const statsCards = [
    { icon: MessageSquare, label: 'Total', value: stats.total, color: '#f97316', bg: '#fff7ed' },
    { icon: AlertCircle, label: 'Open', value: stats.open, color: '#2563eb', bg: '#eff6ff' },
    { icon: Clock, label: 'In Progress', value: stats.inProgress, color: '#d97706', bg: '#fef3c7' },
    { icon: CheckCircle, label: 'Resolved', value: stats.resolved, color: '#16a34a', bg: '#dcfce7' },
  ]

  if (loading && allTickets.length === 0) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading tickets...</p></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />

      <div className="page-content">
        {error && (
          <div className="st-error">
            <AlertCircle size={18} /> <span>{error}</span>
            <button onClick={fetchTickets} className="btn-primary" style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 12 }}>Retry</button>
          </div>
        )}

        {/* Stats */}
        <div className="st-stats">
          {statsCards.map((s, i) => (
            <div key={i} className="st-stat-card" style={{ '--stat-color': s.color, '--stat-bg': s.bg } as any}>
              <div className="st-stat-icon" style={{ background: s.bg, color: s.color }}><s.icon size={22} /></div>
              <div className="st-stat-info">
                <span className="st-stat-label">{s.label}</span>
                <span className="st-stat-value">{s.value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Filter Toolbar */}
        <div className="st-toolbar">
          <div className="st-filters-row">
            <div className="st-search">
              <Search size={16} />
              <input type="text" placeholder="Search subjects or descriptions..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
            </div>

            <select className="st-filter-select" value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setCurrentPage(1) }}>
              {canAccessAllCompanies && <option value="All">All Companies</option>}
              {(canAccessAllCompanies ? filterOptions.companies : availableCompanies).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select className="st-filter-select" value={executiveFilter} onChange={e => { setExecutiveFilter(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Executives</option>
              {filterOptions.executives.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>

            <select className="st-filter-select" value={tlFilter} onChange={e => { setTlFilter(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Team Leaders</option>
              {filterOptions.teamLeaders.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <select className="st-filter-select st-filter-short" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select className="st-filter-select st-filter-short" value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Priority</option>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {hasPermission('support.create') && (
              <button className="btn-primary st-add-btn" onClick={() => setIsAddOpen(true)}><Plus size={16} />New Ticket</button>
            )}
          </div>

          {(companyFilter !== 'All' || executiveFilter !== 'All' || tlFilter !== 'All' || statusFilter !== 'All' || priorityFilter !== 'All') && (
            <div className="st-active-filters">
              <Filter size={14} />
              <span>Active filters: </span>
              {companyFilter !== 'All' && <span className="st-filter-chip">Company: {filterOptions.companies.find(c => c.id === companyFilter)?.name || companyFilter}<button onClick={() => setCompanyFilter('All')}><X size={12} /></button></span>}
              {executiveFilter !== 'All' && <span className="st-filter-chip">Exec: {filterOptions.executives.find(e => e.id === executiveFilter)?.name || executiveFilter}<button onClick={() => setExecutiveFilter('All')}><X size={12} /></button></span>}
              {tlFilter !== 'All' && <span className="st-filter-chip">TL: {filterOptions.teamLeaders.find(t => t.id === tlFilter)?.name || tlFilter}<button onClick={() => setTlFilter('All')}><X size={12} /></button></span>}
              {statusFilter !== 'All' && <span className="st-filter-chip">Status: {statusFilter}<button onClick={() => setStatusFilter('All')}><X size={12} /></button></span>}
              {priorityFilter !== 'All' && <span className="st-filter-chip">Priority: {priorityFilter}<button onClick={() => setPriorityFilter('All')}><X size={12} /></button></span>}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Raised By</th>
                <th>Assigned Entity</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTickets.length === 0 ? (
                <tr><td colSpan={7} className="st-empty">No tickets found matching your filters{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}.</td></tr>
              ) : (
                paginatedTickets.map(ticket => {
                  const sc = statusColor(ticket.status)
                  const pc = priorityColor(ticket.priority)
                  const entityParts = [
                    ticket.companyName && `🏢 ${ticket.companyName}`,
                    ticket.executiveName && `👤 ${ticket.executiveName}`,
                    ticket.tlName && `👥 ${ticket.tlName}`,
                  ].filter(Boolean)
                  return (
                    <tr key={ticket.id} className="st-row" onClick={() => openDetail(ticket)}>
                      <td><span className="st-id">{ticket.id.slice(-6).toUpperCase()}</span></td>
                      <td>
                        <div className="st-raised-by">
                          <span className="st-raised-name">{ticket.createdBy}</span>
                          <span className="st-raised-role">{ticket.createdById?.slice(0, 8) || ''}</span>
                        </div>
                      </td>
                      <td>
                        <div className="st-entity-cell">
                          {entityParts.length > 0 ? entityParts.map((p, i) => <span key={i} className="st-entity-tag">{p}</span>) : <span className="st-na">—</span>}
                        </div>
                      </td>
                      <td><span className="st-subject">{ticket.title}</span></td>
                      <td><span className="st-pill" style={{ background: sc.bg, color: sc.text }}>{ticket.status}</span></td>
                      <td><span className="st-pill" style={{ background: pc.bg, color: pc.text }}>{ticket.priority}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="st-actions">
                          <button className="st-action-btn" onClick={() => openDetail(ticket)} title="View Details"><Eye size={15} /></button>
                          {ticket.status === 'Open' && <button className="st-action-btn st-action-accept" onClick={() => handleStatusChange(ticket.id, 'In Progress')} title="Accept">→</button>}
                          {ticket.status === 'In Progress' && <button className="st-action-btn st-action-resolve" onClick={() => handleStatusChange(ticket.id, 'Resolved')} title="Resolve">✓</button>}
                          {(canManageAll || hasPermission('support.delete')) && <button className="st-action-btn st-action-delete" onClick={() => handleDelete(ticket.id)} title="Delete">✕</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="st-pagination">
          <span className="st-pagination-info">{filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}</span>
          <div className="st-pagination-controls">
            <button className="st-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}><ChevronLeft size={14} /><ChevronLeft size={14} /></button>
            <button className="st-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1).map((p, idx, arr) => (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="st-page-ellipsis">...</span>}
                <button className={`st-page-btn ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
              </span>
            ))}
            <button className="st-page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={14} /></button>
            <button className="st-page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}><ChevronRight size={14} /><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Create Ticket Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Create Support Ticket" size="large">
        <form onSubmit={handleCreate} className="st-modal-form">
          <div className="form-group"><label>Subject *</label><input type="text" value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} required placeholder="Brief summary" /></div>
          <div className="form-group"><label>Description *</label><textarea value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} required rows={4} placeholder="Describe the issue..." /></div>
          <div className="st-form-row">
            <div className="form-group"><label>Category</label><select value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.target.value }))}>{CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="form-group"><label>Priority</label><select value={formData.priority} onChange={e => setFormData(p => ({ ...p, priority: e.target.value as any }))}>{PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Create Ticket'}</button>
          </div>
        </form>
      </Modal>

      {/* Detail / Drill-Down Modal */}
      <Modal isOpen={isDetailOpen} onClose={() => { setIsDetailOpen(false); setSelectedTicket(null); setCommentText('') }} title={selectedTicket ? `Ticket #${selectedTicket.id.slice(-6).toUpperCase()}` : ''} size="large">
        {selectedTicket && (
          <div className="st-detail">
            {/* Main info */}
            <div className="st-detail-header">
              <div className="st-detail-title-row">
                <h4>{selectedTicket.title}</h4>
                <span className="st-pill" style={{ background: statusColor(selectedTicket.status).bg, color: statusColor(selectedTicket.status).text }}>{selectedTicket.status}</span>
                <span className="st-pill" style={{ background: priorityColor(selectedTicket.priority).bg, color: priorityColor(selectedTicket.priority).text }}>{selectedTicket.priority}</span>
              </div>
              <div className="st-detail-meta">
                <span>Raised by <strong>{selectedTicket.createdBy}</strong> · {selectedTicket.createdAt && isDate(selectedTicket.createdAt) ? selectedTicket.createdAt.toLocaleString() : ''}</span>
                {selectedTicket.companyName && <span> · Company: {selectedTicket.companyName}</span>}
                {selectedTicket.executiveName && <span> · Exec: {selectedTicket.executiveName}</span>}
                {selectedTicket.tlName && <span> · TL: {selectedTicket.tlName}</span>}
              </div>
            </div>

            {/* Status actions */}
            <div className="st-detail-actions">
              {selectedTicket.status === 'Open' && <button className="btn-primary" onClick={() => handleStatusChange(selectedTicket.id, 'In Progress')}><Activity size={14} /> Accept & Start</button>}
              {selectedTicket.status === 'In Progress' && <button className="btn-primary" style={{ background: '#16a34a' }} onClick={() => handleStatusChange(selectedTicket.id, 'Resolved')}><CheckCircle size={14} /> Mark Resolved</button>}
              {selectedTicket.status !== 'Closed' && <button className="btn-secondary" onClick={() => handleStatusChange(selectedTicket.id, 'Closed')}>Close Ticket</button>}
              {(canManageAll || hasPermission('support.delete')) && <button className="btn-secondary" style={{ color: '#dc2626' }} onClick={() => handleDelete(selectedTicket.id)}>Delete</button>}
            </div>

            {/* Description */}
            <div className="st-detail-desc">
              <h5>Description</h5>
              <p>{selectedTicket.description}</p>
              <span className="st-detail-category">Category: {selectedTicket.category}</span>
            </div>

            {/* Conversation history */}
            <div className="st-detail-conversation">
              <h5>Conversation ({selectedTicket.conversation?.length || 0})</h5>
              <div className="st-conversation-list">
                {(selectedTicket.conversation || []).map((msg, idx) => (
                  <div key={msg.id || idx} className={`st-msg ${msg.userId === user?.id ? 'st-msg-self' : ''}`}>
                    <div className="st-msg-header">
                      <strong>{msg.userName}</strong>
                      <span className="st-msg-time">{msg.timestamp && isDate(msg.timestamp) ? msg.timestamp.toLocaleString() : ''}</span>
                    </div>
                    <p>{msg.message}</p>
                  </div>
                ))}
                {(!selectedTicket.conversation || selectedTicket.conversation.length === 0) && (
                  <p className="st-no-msgs">No comments yet. Add the first update below.</p>
                )}
              </div>

              {/* Add comment */}
              <div className="st-comment-box">
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Type your comment..."
                  rows={2}
                />
                <button className="btn-primary" onClick={handleAddComment} disabled={!commentText.trim()}>
                  <Send size={14} /> Send
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
