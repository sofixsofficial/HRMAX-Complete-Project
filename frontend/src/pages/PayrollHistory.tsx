import { useState, useEffect } from 'react'
import { History as HistoryIcon, Users, Loader2, Mail, Download } from 'lucide-react'
import { Header } from '../components/Header'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useAuth } from '../context/AuthContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { getPayrollRunsByCompany, getAllPayrollRuns } from '../services/payrollService'
import { dispatchPayslips } from '../services/salaryService'
import { Pagination } from '../components/Pagination'
import { scopedCompanyIds } from '../utils/companyScope'
import type { PayrollRun, PayrollItem } from '../types/user'
import './Companies.css'

const fmt = (n: number) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

const statusColor = (status: string) => {
  switch (status) {
    case 'Emailed': return { bg: '#ecfdf5', text: '#059669' }
    case 'Generated': return { bg: '#d1fae5', text: '#047857' }
    case 'Calculated': return { bg: '#fef3c7', text: '#f59e0b' }
    case 'Draft': return { bg: '#f3f4f6', text: '#6b7280' }
    default: return { bg: '#f3f4f6', text: '#6b7280' }
  }
}

const displayStatus = (status: string) => (status === 'Calculated' ? 'Generated' : status)

const exportRunCsv = (run: PayrollRun) => {
  const items = (run.items || []) as PayrollItem[]
  if (items.length === 0) {
    alert('No line-item data saved for this run. CSV export is available for runs generated from the Payroll page.')
    return
  }
  const headers = ['Employee ID', 'Employee Name', 'Department', 'Working Days', 'Present', 'Paid Lv', 'Unpaid Lv', 'Half', 'Holidays', 'Absent', 'OT (hrs)', 'Basic', 'HRA', 'DA', 'Conveyance', 'Medical', 'Special', 'Gross', 'OT Pay', 'Encashment', 'PF', 'PT', 'Other Deductions', 'Earnings', 'Deductions', 'Net']
  const rows = items.map(it => [
    it.employeeId, it.employeeName, it.department, it.workingDays, it.presentDays,
    it.paidLeaveDays, it.unpaidLeaveDays, it.halfDays ?? 0, it.holidayDays, it.absentDays ?? 0, it.overtimeHours,
    it.basicSalary, it.hra, it.da, it.conveyance, it.medical, it.specialAllowance, it.grossSalary,
    it.overtimePay, it.leaveEncashment ?? 0, it.pf, it.professionalTax, it.otherDeductions,
    it.totalEarnings, it.totalDeductions, it.netSalary,
  ].map(cell => (typeof cell === 'string' && /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
  const summary = `"Period","Status","Month","Year","Employees","Total Net","Total Gross"\r\n"${run.month} ${run.year}",${run.status},${run.month},${run.year},${run.totalEmployees},${run.totalNet},${items.reduce((s, i) => s + i.totalEarnings, 0)}\r\n\r\n`
  const content = '\ufeff' + summary + headers.join(',') + '\r\n' + rows.join('\r\n') + '\r\n'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `payroll-${run.companyId}-${run.month}-${run.year}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function PayrollHistoryContent() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId, isLoading: companyLoading } = usePermissionScope('payroll')
  const { canPerform } = useAccessControl()
  const companyId = effectiveCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emailingId, setEmailingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const isExecOrTL = user?.role === 'executive' || user?.role === 'team-leader'

  const fetchRuns = async () => {
    try {
      setLoading(true)
      setError(null)
      let data: PayrollRun[]
      if (user?.role === 'master-admin' && !companyId) {
        data = await getAllPayrollRuns()
      } else if (companyId) {
        data = await getPayrollRunsByCompany(companyId)
      } else if (isExecOrTL) {
        const ids = scopedCompanyIds(null, availableCompanies)
        const results = await Promise.all(ids.map(id => getPayrollRunsByCompany(id).catch(() => [] as PayrollRun[])))
        data = results.flat()
      } else {
        data = []
      }
      data.sort((a, b) => b.year - a.year || b.monthIndex - a.monthIndex)
      setRuns(data)
    } catch (err: any) {
      console.error('Error fetching payroll history:', err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError('Access denied. You do not have permission to view payroll data for this company.')
      } else {
        setError('Failed to load payroll history.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (companyLoading) return
    fetchRuns()
  }, [companyId, user?.role, companyLoading, availableCompanies])

  // Company scope change swaps the dataset — restart from page 1
  useEffect(() => {
    setPage(1)
  }, [companyId])

  const handleEmailRun = async (run: PayrollRun) => {
    setEmailingId(run.id)
    try {
      const res = await dispatchPayslips({ companyId: run.companyId, runId: run.id, monthIndex: run.monthIndex, year: run.year, payStatus: 'all' })
      if (!res.success) {
        alert(res.error || 'Failed to send salary-slip emails.')
        return
      }
      if ((res.dispatched ?? 0) === 0 && !res.failed) {
        alert('No salary slips were emailed. Check that slips exist for this payroll (configure SMTP if needed).')
        return
      }
      const parts = [`${res.dispatched ?? 0} individual salary slips sent to employees`]
      if (res.failed) parts.push(`${res.failed} failed`)
      if (res.summarySent) parts.push('company admin(s) + company received the summary with total employee count')
      alert(`${run.month} ${run.year}: ${parts.join(' — ')}.`)
      await fetchRuns()
    } catch (err: any) {
      console.error('Error emailing payroll:', err)
      alert(err?.message || 'Failed to send salary-slip emails.')
    } finally {
      setEmailingId(null)
    }
  }

  const pageCount = Math.max(1, Math.ceil(runs.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pagedRows = runs.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Payroll History" breadcrumbs={['Dashboard', 'Payroll History']} />
        <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading...</p></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Payroll History" breadcrumbs={['Dashboard', 'Payroll History']} />
        <div className="error-container"><p>{error}</p><button onClick={fetchRuns} className="btn-primary">Retry</button></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Payroll History" breadcrumbs={['Dashboard', 'Payroll History']} />

      <div className="page-content">
        <ScopeIndicator />

        <div className="companies-section">
          <div className="section-header-companies">
            <h3><Users size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />Monthly Generated Records</h3>
          </div>
          <div className="filters-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Recorded On</th>
                  <th>Employees</th>
                  <th>Working Days</th>
                  <th>Total Net</th>
                  <th>Status</th>
                  <th>Emails</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(run => {
                  const sc = statusColor(run.status)
                  return (
                    <tr key={run.id}>
                      <td><strong>{run.month} {run.year}</strong></td>
                      <td>{run.createdAt ? new Date(run.createdAt).toLocaleDateString() : '—'}</td>
                      <td>{run.totalEmployees}</td>
                      <td>{run.workingDays}</td>
                      <td>{fmt(run.totalNet)}</td>
                      <td><span className="status-badge-table" style={{ background: sc.bg, color: sc.text }}>{displayStatus(run.status)}</span></td>
                      <td>
                        {run.payslipEmailsDispatched
                          ? `${run.payslipEmailCount ?? 0} sent${run.payslipEmailFailed ? `, ${run.payslipEmailFailed} failed` : ''}`
                          : '—'}
                      </td>
                      <td>
                        <div className="action-buttons">
                          {canPerform('manage', 'salary') || canPerform('manage', 'payroll') ? (
                            <button className="action-btn view" title="Email Salary Slips (each employee + admin/company summary)" onClick={() => handleEmailRun(run)} disabled={!!emailingId}>
                              {emailingId === run.id ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                            </button>
                          ) : null}
                          <button className="action-btn" title="Export CSV" onClick={() => exportRunCsv(run)} disabled={!!emailingId}>
                            <Download size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {runs.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>No payroll records found{companyName ? ` for ${companyName}` : ''}. Generate payroll to begin.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={runs.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
          />
        </div>
      </div>
    </div>
  )
}

export function PayrollHistory() {
  return (
    <ErrorBoundary>
      <PayrollHistoryContent />
    </ErrorBoundary>
  )
}