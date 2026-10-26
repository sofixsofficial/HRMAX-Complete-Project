import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, DollarSign, Search, Download, Eye, ChevronLeft, ChevronRight, Loader2, Mail, AlertTriangle, X } from 'lucide-react'
import { errText, safeDisplayText } from '../aws/errors'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { useRoleBasedStats, useRoleBasedTitle } from '../hooks/useRoleBasedData'
import { getAllSalarySlips, getSalarySlipsByCompany, getSalaryStats, salaryStatsFromSlips, retryFailedPayslips } from '../services/salaryService'
import { generatePayslip } from '../utils/payslip'
import { scopedCompanyIds } from '../utils/companyScope'
import { downloadPayslipPdf } from '../utils/payslipPdf'
import { getCompanyPayslipOptions } from '../utils/payslipOptions'
import type { SalarySlip } from '../types/user'
import './SalarySlips.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SLIP_STATUS_COLORS: Record<string, string> = { Paid: '#10b981', Emailed: '#16a34a', Pending: '#f59e0b', Processing: '#3b82f6' }

export function SalarySlips() {
  const [searchParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState('')
  const [salarySlips, setSalarySlips] = useState<SalarySlip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ total: 0, paid: 0, pending: 0, processing: 0, emailed: 0, totalAmount: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Modal states
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedSlip, setSelectedSlip] = useState<SalarySlip | null>(null)
  const [retryingEmails, setRetryingEmails] = useState(false)
  const [retryMsg, setRetryMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Filters
  const [monthFilter, setMonthFilter] = useState('All')
  
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('payroll')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const { canViewAllStats, isManager } = useRoleBasedStats()
  const pageTitle = useRoleBasedTitle('Salary Slips')
  const companyId = effectiveCompanyId || searchParams.get('company') || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  useEffect(() => {
    fetchSalarySlips()
    fetchStats()
  }, [companyId, user?.id, availableCompanies])

  const fetchSalarySlips = async () => {
    try {
      setLoading(true)
      setError(null)
      let data: SalarySlip[]

      // 'global' / 'master-admin' are platform sentinels, not tenants: scoping
      // to them queried a companyId that no slip carries, so master-admin saw
      // an empty list while the API held the records.
      const isPlatformScope = !companyId || companyId === 'global' || companyId === 'master-admin'

      if (isPlatformScope && user?.role !== 'executive' && user?.role !== 'team-leader') {
        data = await getAllSalarySlips()
      } else if (companyId) {
        data = await getSalarySlipsByCompany(companyId)
      } else if (user?.role === 'executive' || user?.role === 'team-leader') {
        // All Companies mode — slips across authorized companies
        const ids = scopedCompanyIds(null, availableCompanies)
        const results = await Promise.all(ids.map(id => getSalarySlipsByCompany(id).catch(() => [] as SalarySlip[])))
        data = results.flat()
      } else {
        data = []
      }
      
      setSalarySlips(data)
      if (isPlatformScope) setStats(salaryStatsFromSlips(data))
      setError(null)
    } catch (err: any) {
      console.error('Error fetching salary slips:', err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError(`Access denied. You do not have permission to view salary slips${companyName ? ` for ${companyName}` : ''}.`)
      } else if (err?.code === 'unavailable' || err?.message?.includes('timeout')) {
        setError('Request timed out. Please check your connection and try again.')
      } else {
        setError('Failed to load salary slips.')
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      // Platform-scope stats come from the loaded list (see fetchSalarySlips):
      // a companyId query against the 'global' sentinel would report all zeros.
      const isPlatformScope = !companyId || companyId === 'global' || companyId === 'master-admin'
      if (isPlatformScope) return
      const statsData = await getSalaryStats(companyId || undefined)
      setStats(statsData)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }

  const filteredSlips = salarySlips.filter(slip => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const matchesSearch = 
        slip.employeeName.toLowerCase().includes(search) ||
        slip.employeeId.toLowerCase().includes(search) ||
        slip.department.toLowerCase().includes(search)
      if (!matchesSearch) return false
    }
    
    if (monthFilter !== 'All' && slip.month !== monthFilter) return false
    
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredSlips.length / pageSize))
  const paginatedSlips = filteredSlips.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const handleExport = () => {
    const csvContent = [
      ['Employee', 'Employee ID', 'Department', 'Month', 'Basic Salary', 'Allowances', 'Deductions', 'Net Salary'].join(','),
      ...filteredSlips.map(slip => [
        slip.employeeName,
        slip.employeeId,
        slip.department,
        `${slip.month} ${slip.year}`,
        slip.basicSalary,
        slip.allowances,
        slip.deductions,
        slip.netSalary
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'salary-slips.csv'
    a.click()
  }

  const handleRetryFailedEmails = async () => {
    if (!companyId) return
    setRetryMsg(null)
    setRetryingEmails(true)
    try {
      const res = await retryFailedPayslips({ companyId })
      if (res.success) {
        setRetryMsg({ type: 'success', text: res.message || 'Retry finished.' })
      } else {
        setRetryMsg({ type: 'error', text: safeDisplayText(res.error) || 'Failed to retry salary-slip emails. Please try again.' })
      }
      await fetchSalarySlips()
    } catch (err) {
      console.error('Error retrying salary-slip emails:', err)
      setRetryMsg({ type: 'error', text: errText(err, 'Failed to retry salary-slip emails. Please try again.') })
    } finally {
      setRetryingEmails(false)
    }
  }

  const openViewModal = (slip: SalarySlip) => {
    setSelectedSlip(slip)
    setIsViewModalOpen(true)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)
  }

  const emailLog = (slip: SalarySlip): string => {
    const st = (slip.emailStatus === 'sent' && slip.emailSentAt)
      ? 'Sent'
      : (slip.emailStatus === 'failed' || slip.payslipEmailStatus === 'failed')
        ? 'Failed'
        : slip.emailStatus === 'retrying' ? 'Retrying' : 'Not sent'
    const lines = [
      `Salary slip email log — ${slip.employeeName} (${slip.month} ${slip.year})${slip.payrollRef ? ` · ${slip.payrollRef}` : ''}`,
      `Status: ${st}`,
    ]
    if (slip.emailSentAt) lines.push(`Sent on: ${new Date(slip.emailSentAt).toLocaleString()}`)
    if (slip.emailError) lines.push(`Error: ${slip.emailError}`)
    if (slip.version && slip.version > 1) lines.push(`Version: v${slip.version}`)
    if (st === 'Failed') lines.push('Tip: use "Retry Failed Emails" above to re-send.')
    return lines.join('\n')
  }

  const emailedCount = salarySlips.filter(s => s.emailStatus === 'sent' || s.payslipEmailStatus === 'sent').length

  const getStatsCards = () => {
    if (user?.role === 'executive') {
      const mySlip = salarySlips[0]
      return [
        { icon: DollarSign, label: 'Net Salary', value: mySlip ? formatCurrency(mySlip.netSalary) : '₹0', subtext: 'This month', color: '#10b981', bgColor: '#ecfdf5' },
        { icon: FileText, label: 'Total Slips', value: String(salarySlips.length), subtext: 'Documents', color: '#f97316', bgColor: '#fff7ed' },
        { icon: Download, label: 'YTD Earnings', value: formatCurrency(salarySlips.reduce((sum, s) => sum + s.netSalary, 0)), subtext: 'Year to date', color: '#22c55e', bgColor: '#f0fdf4' },
      ]
    }
    
    return [
      { icon: FileText, label: 'Total Slips', value: String(stats.total), subtext: 'Documents', color: '#f97316', bgColor: '#fff7ed' },
      { icon: DollarSign, label: 'Total Amount', value: formatCurrency(stats.totalAmount), subtext: 'Net payroll', color: '#ef4444', bgColor: '#fef2f2' },
      { icon: Mail, label: 'Emails Sent', value: String(emailedCount), subtext: 'Slips delivered', color: '#10b981', bgColor: '#ecfdf5' },
    ]
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading salary slips...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="error-container">
          <p>{error}</p>
          <button onClick={fetchSalarySlips} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
      
      <div className="page-content">
        <ScopeIndicator />
        {retryMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, background: retryMsg.type === 'error' ? '#fef2f2' : '#ecfdf5', border: retryMsg.type === 'error' ? '1px solid #fecaca' : '1px solid #a7f3d0', color: retryMsg.type === 'error' ? '#b91c1c' : '#047857' }}>
            {retryMsg.type === 'error' ? <AlertTriangle size={16} style={{ flexShrink: 0 }} /> : <Mail size={16} style={{ flexShrink: 0 }} />}
            <span style={{ flex: 1 }}>{retryMsg.text}</span>
            <button onClick={() => setRetryMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={16} /></button>
          </div>
        )}
        {/* Stats Cards */}
        <div className="stats-row salary-stats">
          {getStatsCards().map((stat, idx) => (
            <div
              key={idx}
              className="stat-card-salary"
            >
              <div className="stat-card-content">
                <div className="stat-icon-wrapper" style={{ background: stat.bgColor, color: stat.color }}>
                  <stat.icon size={24} />
                </div>
                <div className="stat-details">
                  <span className="stat-label">{stat.label}</span>
                  <span className="stat-value">{stat.value}</span>
                  {stat.subtext && <span className="stat-subtext-single">{stat.subtext}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="salary-filters-section">
          <div className="search-add-row">
            <div className="search-filter salary-search">
              <Search size={18} />
              <input 
                type="text" 
                placeholder={user?.role === 'executive' ? "Search your slips..." : "Search by employee name, ID..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {hasPermission('salary.export') && (
              <button className="btn-outline" onClick={handleExport}><Download size={18} />Export</button>
            )}
            {canPerform('manage', 'salary') && companyId && (
              <button className="btn-outline" onClick={handleRetryFailedEmails} disabled={retryingEmails} title="Re-send salary-slip emails that failed">
                <Mail size={18} />{retryingEmails ? 'Retrying...' : 'Retry Failed Emails'}
              </button>
            )}
          </div>
          <div className="filters-row salary-filters">
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {canViewAllStats && (
              <select className="filter-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="All">All Months</option>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Salary Slips List Section */}
        <div className="salary-section">
          <div className="section-header-salary">
            <div className="section-title-group">
              <h3>{user?.role === 'executive' ? 'My Salary Slips' : 'Salary Slips List'}</h3>
              <p>{user?.role === 'executive' ? 'View your salary history and payslips.' : 'View, download and email salary slips for employees.'}</p>
            </div>
          </div>

          <div className="table-container">
            <table className="salary-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Month/Year</th>
                  <th>Net Salary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSlips.map((slip) => {
                  const emailSent = slip.emailStatus === 'sent' && slip.emailSentAt
                  const emailFailed = slip.emailStatus === 'failed' || slip.emailStatus === 'retrying' || slip.payslipEmailStatus === 'failed'
                  const emailState = emailSent ? 'sent' : (emailFailed ? 'failed' : (slip.emailStatus && slip.emailStatus !== 'not-sent' ? slip.emailStatus : ''))
                  return (
                    <tr key={slip.id}>
                      <td>
                        <div className="employee-details">
                          <span className="employee-name">{slip.employeeName}</span>
                          <span className="employee-email">{slip.employeeEmail}</span>
                        </div>
                      </td>
                      <td><span className="employee-id">{slip.employeeId}</span></td>
                      <td><span className="dept-badge" style={{ background: slip.departmentColor + '20', color: slip.departmentColor }}>{slip.department}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="month-text">{slip.month} {slip.year}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: SLIP_STATUS_COLORS[slip.status] || '#64748b', background: (SLIP_STATUS_COLORS[slip.status] || '#64748b') + '18', border: `1px solid ${(SLIP_STATUS_COLORS[slip.status] || '#64748b')}40`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                            {slip.status || 'Pending'}
                          </span>
                        </div>
                        {slip.payrollRef && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{slip.payrollRef}</div>}
                        {slip.superseded && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Superseded by newer version</div>}
                        {emailState && (
                          <div style={{ fontSize: 11, marginTop: 2, fontWeight: 600, color: emailState === 'failed' ? '#dc2626' : (emailState === 'sent' ? '#16a34a' : '#b45309') }}>
                            {emailState === 'failed' ? 'Email failed — retry' : emailState === 'sent' ? 'Email sent' : 'Email pending'}
                          </div>
                        )}
                      </td>
                      <td><span className="net-salary">{formatCurrency(slip.netSalary)}</span></td>
                      <td>
                        <div className="action-buttons">
                          <button className="action-btn view" title="View details" onClick={() => openViewModal(slip)}><Eye size={16} /></button>
                          <button className="action-btn view" title="Print Payslip" onClick={async () => { const opts = await getCompanyPayslipOptions(slip.companyId); generatePayslip(slip, opts) }}><Download size={16} /></button>
                          <button className="action-btn view" title="Download PDF" onClick={async () => { const opts = await getCompanyPayslipOptions(slip.companyId); downloadPayslipPdf(slip, opts) }}><FileText size={16} /></button>
                          <button className="action-btn view" title="Email log" onClick={() => alert(emailLog(slip))}><Mail size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {paginatedSlips.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>No salary slips found{companyName ? ` for ${companyName}` : ''}.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bottom">
            <div className="pagination-info">
              <span className="showing-text">Showing {paginatedSlips.length} of {salarySlips.length} entries</span>
              <select className="page-size-select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
                <option value={5}>5/page</option>
                <option value={10}>10/page</option>
                <option value={20}>20/page</option>
                <option value={50}>50/page</option>
              </select>
            </div>
            <div className="pagination-controls">
              <button className="page-btn" disabled={currentPage === 1} onClick={() => handlePageChange(1)}><ChevronLeft size={14} /></button>
              <button className="page-btn" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}><ChevronLeft size={14} /></button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="page-ellipsis">...</span>}
                    <button className={`page-btn ${currentPage === p ? 'page-btn-active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
                  </span>
                ))}
              <button className="page-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}><ChevronRight size={14} /></button>
              <button className="page-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(totalPages)}><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* View Slip Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Salary Slip Details" size="medium">
        {selectedSlip && (
          <div className="company-details-view">
            <div className="detail-row"><span className="detail-label">Employee:</span><span className="detail-value">{selectedSlip.employeeName}</span></div>
            <div className="detail-row"><span className="detail-label">Employee ID:</span><span className="detail-value">{selectedSlip.employeeId}</span></div>
            <div className="detail-row"><span className="detail-label">Department:</span><span className="detail-value">{selectedSlip.department}</span></div>
            <div className="detail-row"><span className="detail-label">Month/Year:</span><span className="detail-value">{selectedSlip.month} {selectedSlip.year}</span></div>
            <div className="detail-row"><span className="detail-label">Basic Salary:</span><span className="detail-value">{formatCurrency(selectedSlip.basicSalary)}</span></div>
            <div className="detail-row"><span className="detail-label">HRA:</span><span className="detail-value">{formatCurrency(selectedSlip.breakdown?.hra || 0)}</span></div>
            <div className="detail-row"><span className="detail-label">DA:</span><span className="detail-value">{formatCurrency(selectedSlip.breakdown?.da || 0)}</span></div>
            <div className="detail-row"><span className="detail-label">Allowances:</span><span className="detail-value">{formatCurrency(selectedSlip.allowances)}</span></div>
            <div className="detail-row"><span className="detail-label">Deductions:</span><span className="detail-value">{formatCurrency(selectedSlip.deductions)}</span></div>
            <div className="detail-row"><span className="detail-label">Provident Fund (PF):</span><span className="detail-value">{formatCurrency(selectedSlip.breakdown?.pf || 0)}</span></div>
            <div className="detail-row"><span className="detail-label">Professional Tax:</span><span className="detail-value">{formatCurrency(selectedSlip.breakdown?.tax || 0)}</span></div>
            <div className="detail-row"><span className="detail-label">Other Deductions:</span><span className="detail-value">{formatCurrency(selectedSlip.breakdown?.otherDeductions || 0)}</span></div>
            {(selectedSlip.breakdown?.leaveEncashment ?? 0) > 0 && (
              <div className="detail-row"><span className="detail-label" style={{ color: '#059669' }}>Leave Encashment (Earned):</span><span className="detail-value" style={{ color: '#059669' }}>+{formatCurrency(selectedSlip.breakdown?.leaveEncashment || 0)}</span></div>
            )}
            {(selectedSlip.breakdown?.absentDeduction ?? 0) > 0 && (
              <div className="detail-row"><span className="detail-label" style={{ color: '#dc2626' }}>Absent Deduction:</span><span className="detail-value" style={{ color: '#dc2626' }}>-{formatCurrency(selectedSlip.breakdown?.absentDeduction || 0)}</span></div>
            )}
            <div className="detail-row"><span className="detail-label">Net Salary:</span><span className="detail-value" style={{ fontWeight: 'bold', color: '#10b981' }}>{formatCurrency(selectedSlip.netSalary)}</span></div>
            {selectedSlip.version && <div className="detail-row"><span className="detail-label">Version:</span><span className="detail-value">v{selectedSlip.version}{selectedSlip.version > 1 ? ' (corrected)' : ''}</span></div>}
            {selectedSlip.payrollRef && <div className="detail-row"><span className="detail-label">Payroll Ref:</span><span className="detail-value">{selectedSlip.payrollRef}</span></div>}
            {selectedSlip.superseded && <div className="detail-row"><span className="detail-label">Superseded:</span><span className="detail-value">Yes — a corrected version exists ({selectedSlip.supersededAt ? new Date(selectedSlip.supersededAt).toLocaleDateString() : ''})</span></div>}
            {selectedSlip.emailStatus && selectedSlip.emailStatus !== 'not-sent' && (
              <div className="detail-row">
                <span className="detail-label">Email:</span>
                <span className="detail-value" style={{ color: selectedSlip.emailStatus === 'failed' ? '#dc2626' : '#16a34a' }}>
                  {selectedSlip.emailStatus}{selectedSlip.emailError ? ` — ${selectedSlip.emailError}` : ''}
                </span>
              </div>
            )}
            {selectedSlip.correction && (
              <>
                <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
                <div className="detail-row"><span className="detail-label" style={{ color: '#b45309' }}>Correction Reason:</span><span className="detail-value">{selectedSlip.correction.reason}</span></div>
                <div className="detail-row"><span className="detail-label">Corrected By:</span><span className="detail-value">{selectedSlip.correction.correctedByName} ({selectedSlip.correction.correctedAt ? new Date(selectedSlip.correction.correctedAt).toLocaleString() : ''})</span></div>
                <div className="detail-row"><span className="detail-label">Previous Net:</span><span className="detail-value">{formatCurrency(selectedSlip.correction.previous.netSalary)}</span></div>
                <div className="detail-row"><span className="detail-label">Corrected Net:</span><span className="detail-value" style={{ fontWeight: 'bold', color: '#10b981' }}>{formatCurrency(selectedSlip.correction.current.netSalary)}</span></div>
                {selectedSlip.correction.overrideReason && <div className="detail-row"><span className="detail-label" style={{ color: '#b45309' }}>MA Override Reason:</span><span className="detail-value">{selectedSlip.correction.overrideReason}</span></div>}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
