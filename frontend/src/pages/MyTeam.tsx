import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserCog, Search, Eye, Loader2, ChevronLeft, ChevronRight, Mail, Phone, Calendar, CheckSquare, Clock, Plus, Check, X } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { ActionErrorBanner } from '../components/ActionErrorBanner'
import { errText } from '../aws/errors'
import { subscribeToTeamByManager } from '../services/employeeService'
import { createLeaveRequest, calcLeaveDays, isLeaveTypePaid } from '../services/leaveService'
import { logAudit } from '../services/auditLogService'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import type { Employee, LeaveType, ApprovalTier, ApprovalLevel } from '../types/user'
import { toDate } from '../utils/dateUtils'
import './Employees.css'

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity']

const statusColors: Record<string, { bg: string; text: string }> = {
  Active: { bg: '#dcfce7', text: '#16a34a' },
  Inactive: { bg: '#fee2e2', text: '#ef4444' },
  'On Leave': { bg: '#ffedd5', text: '#f97316' },
}

const todayStr = new Date().toISOString().split('T')[0]

export function MyTeam() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { availableCompanies, selectedCompanyName } = useCompany()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Employee | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)

  // Leave modal state
  const [isLeaveOpen, setIsLeaveOpen] = useState(false)
  const [leaveTarget, setLeaveTarget] = useState<Employee | null>(null)
  const [leaveType, setLeaveType] = useState<LeaveType>('Casual')
  const [leaveStart, setLeaveStart] = useState(todayStr)
  const [leaveEnd, setLeaveEnd] = useState(todayStr)
  const [leaveReason, setLeaveReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    unsubRef.current = subscribeToTeamByManager(user.id, (emps) => {
      setEmployees(emps)
      setLoading(false)
    }, {
      companyIds: availableCompanies.map(c => c.id),
      includeScope: ['team-leader', 'executive', 'company-admin', 'master-admin'].includes(user.role as string),
    })
    return () => {
      if (unsubRef.current) unsubRef.current()
    }
  }, [user?.id, availableCompanies])

  const filtered = employees.filter(e => {
    const s = searchTerm.toLowerCase()
    return !s || e.name.toLowerCase().includes(s) || e.email.toLowerCase().includes(s) || e.department.toLowerCase().includes(s)
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const active = employees.filter(e => e.status === 'Active').length

  const openLeaveModal = (emp: Employee) => {
    setLeaveTarget(emp)
    setLeaveType('Casual')
    setLeaveStart(todayStr)
    setLeaveEnd(todayStr)
    setLeaveReason('')
    setLeaveError(null)
    setIsLeaveOpen(true)
  }

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!leaveTarget || !user) return
    setLeaveError(null)
    const start = new Date(leaveStart)
    const end = new Date(leaveEnd)
    const totalDays = calcLeaveDays(start, end)
    if (totalDays <= 0) { setLeaveError('End date must be on or after start date'); return }
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
        action: 'Manual leave submitted for team member',
        actionType: 'create',
        module: 'My Team',
        targetEntity: leaveTarget.name,
        companyId: leaveTarget.companyId,
        status: 'success',
        details: `${leaveType} - ${totalDays} day(s) (bypassed Tier 1)`,
      })

      setIsLeaveOpen(false)
      setLeaveTarget(null)
    } catch (err) {
      console.error('Error submitting manual leave:', err)
      setLeaveError(errText(err, 'Failed to submit leave request. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="My Team" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading team...</p></div></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="My Team" />
      <div className="page-content">
        <div className="emp-stats-row">
          <div className="emp-mini-stat"><UserCog size={22} /><div><strong>{employees.length}</strong><span>Team Members</span></div></div>
          <div className="emp-mini-stat"><Clock size={22} /><div><strong>{active}</strong><span>Active</span></div></div>
          <div className="emp-mini-stat"><Calendar size={22} /><div><strong>{employees.filter(e => e.status === 'On Leave').length}</strong><span>On Leave</span></div></div>
          <div className="emp-mini-stat"><CheckSquare size={22} /><div><strong>{new Set(employees.map(e => e.department)).size}</strong><span>Departments</span></div></div>
        </div>

        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search team members by name, email, or department..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Employee ID</th><th>Email</th><th>Phone</th><th>Department</th><th>Designation</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={8} className="empty-cell">No team members found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</td></tr>
              ) : paginated.map(emp => {
                const sc = statusColors[emp.status] || { bg: '#f3f4f6', text: '#6b7280' }
                return (
                  <tr key={emp.id}>
                    <td><span style={{ fontWeight: 500 }}>{emp.name}</span></td>
                    <td>{emp.employeeId || '—'}</td>
                    <td><span className="emp-email-cell">{emp.email}</span></td>
                    <td>{emp.phone || '—'}</td>
                    <td>{emp.department}</td>
                    <td>{emp.designation}</td>
                    <td><span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{emp.status}</span></td>
                    <td>
                      <div className="emp-actions">
                        <button className="emp-action-icon view" onClick={() => { setSelected(emp); setIsViewOpen(true) }} title="View"><Eye size={15} /></button>
                        <button className="emp-action-icon edit" onClick={() => navigate('/tasks')} title="Assign Task"><CheckSquare size={15} /></button>
                        <button className="emp-action-icon" style={{ background: '#dbeafe', color: '#2563eb' }} onClick={() => openLeaveModal(emp)} title="Submit Manual Leave"><Plus size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="pagination-info">Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="pagination-controls">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
            <span className="pagination-page">{currentPage} / {totalPages || 1}</span>
            <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
          </div>
        </div>
      </div>

      {/* View Profile Modal */}
      <Modal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} title="Team Member Profile" size="medium">
        {selected && (
          <div className="emp-profile">
            <div className="emp-profile-header">
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.designation} &middot; {selected.department}</p>
                <span className="emp-status-badge" style={{ background: statusColors[selected.status]?.bg || '#f3f4f6', color: statusColors[selected.status]?.text || '#6b7280' }}>{selected.status}</span>
              </div>
            </div>
            <div className="emp-profile-grid">
              <div className="emp-profile-section">
                <h4><Mail size={16} /> Contact</h4>
                <div className="emp-profile-fields">
                  <div><label>Email</label><span>{selected.email}</span></div>
                  <div><label>Phone</label><span>{selected.phone || '-'}</span></div>
                </div>
              </div>
              <div className="emp-profile-section">
                <h4><Calendar size={16} /> Employment</h4>
                <div className="emp-profile-fields">
                  <div><label>Employee ID</label><span>{selected.employeeId}</span></div>
                  <div><label>Department</label><span>{selected.department}</span></div>
                  <div><label>Designation</label><span>{selected.designation}</span></div>
                  <div><label>Join Date</label><span>{toDate(selected.joinDate) ? toDate(selected.joinDate)!.toLocaleDateString() : '—'}</span></div>
                  <div><label>Type</label><span>{selected.employmentType}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

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

          <ActionErrorBanner message={leaveError} onDismiss={() => setLeaveError(null)} marginBottom={8} />

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
    </div>
  )
}
