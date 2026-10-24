import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { errText, safeDisplayText } from '../aws/errors';
import { doc, deleteDoc } from '../aws/firestore-compat'
import { Calculator, Loader2, Eye, AlertTriangle, CheckSquare, Square, X } from 'lucide-react'
import { Header } from '../components/Header'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'
import { db } from '../aws/clients'
import { useAuth } from '../context/AuthContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { getPayrollRunsByCompany, generateBulkPayroll, previewBulkPayroll } from '../services/payrollService'
import { getSalarySlipsByCompany, deleteSalarySlip } from '../services/salaryService'
import { getEmployeesByCompany } from '../services/employeeService'
import { logAudit } from '../services/auditLogService'
import type { PayrollRun, PayrollItem, Employee } from '../types/user'
import './Companies.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
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

const EMAILED_OR_LOCKED_STATUSES = ['Emailed', 'Submitted', 'Approved', 'Disbursed', 'Locked', 'Reviewed', 'Generated', 'Corrected']

const chipStyle = (on: boolean) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px', borderRadius: 999,
  border: `1px solid ${on ? '#7c3aed' : '#e5e7eb'}`, background: on ? '#ede9fe' : '#fff', color: on ? '#7c3aed' : '#374151', cursor: 'pointer',
})

function PayrollContent() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId, isLoading: companyLoading } = usePermissionScope('payroll')
  const { canPerform } = useAccessControl()
  const companyId = effectiveCompanyId || user?.companyId || ''

  const now = new Date()
  const [monthIndex, setMonthIndex] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())

  // Mandatory preview modal — generation is blocked until the user reviews + confirms.
  const [preview, setPreview] = useState<{ items: PayrollItem[]; workingDays: number; totalNet: number; employeeCount: number } | null>(null)

  // Pagination for the preview line-items table — footer totals still span every item.
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageSize, setPreviewPageSize] = useState(10)

  // Reset to the first page whenever a new preview opens (or is dismissed).
  useEffect(() => { setPreviewPage(1) }, [preview])

  // After generation, land the admin in the dashboard Mail section (Email Center)
  // with company + month + year filters already applied.
  const goToMailSection = (cid: string, mi: number, y: number) => {
    const base = {
      'master-admin': '/master-admin/emails',
      'company-admin': '/company-admin/emails',
      'executive': '/executive/emails',
      'team-leader': '/team-leader/emails',
    }[(user?.role || '') as string] || '/master-admin/emails'
    navigate(`${base}?tab=sent&company=${encodeURIComponent(cid)}&month=${mi}&year=${y}`)
  }

  useEffect(() => {
    if (companyLoading) return
    fetchRuns()
  }, [companyId, user?.role, companyLoading, availableCompanies])

  useEffect(() => {
    if (companyLoading) return
    if (companyId) {
      // Auto-list every active employee of the selected company.
      getEmployeesByCompany(companyId)
        .then(emps => {
          const active = emps.filter(e => e.status === 'Active' || e.status === 'On Leave')
          setEmployees(active)
          setSelectedEmployeeIds(new Set(active.map(e => e.userId || e.id).filter(Boolean)))
        })
        .catch(() => { setEmployees([]); setSelectedEmployeeIds(new Set()) })
    } else {
      setEmployees([])
      setSelectedEmployeeIds(new Set())
    }
  }, [companyId])

  const fetchRuns = async () => {
    try {
      setLoading(true)
      if (companyId) {
        setRuns(await getPayrollRunsByCompany(companyId))
      } else {
        setRuns([])
      }
    } catch {
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  const existingRun = runs.find(r => r.monthIndex === monthIndex && r.year === year)
  const existingRunFinal = existingRun ? EMAILED_OR_LOCKED_STATUSES.includes(existingRun.status) : false

  const visibleEmployees = employees
  const selectedCount = selectedEmployeeIds.size

  const toggleSelectEmployee = (empId: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  const toggleSelectAllEmployees = () => {
    const keys = visibleEmployees.map(e => e.userId || e.id).filter(Boolean)
    if (selectedEmployeeIds.size === keys.length && keys.length > 0) setSelectedEmployeeIds(new Set())
    else setSelectedEmployeeIds(new Set(keys))
  }

  // STEP 1 — MANDATORY preview. No writes happen here.
  const handlePreview = async () => {
    setActionError(null)
    if (!companyId) {
      setActionError('No company selected. Please select a company.')
      return
    }
    if (selectedCount === 0) {
      setActionError('Please select at least one employee to include in the payroll.')
      return
    }
    if (existingRun && EMAILED_OR_LOCKED_STATUSES.includes(existingRun.status)) {
      setActionError(`Payroll for ${MONTHS[monthIndex]} ${year} has already been finalized (status: ${existingRun.status}). Check Payroll History, or correct slips with the salary-slip flow.`)
      return
    }
    setPreviewing(true)
    try {
      const result = await previewBulkPayroll({ companyId, monthIndex, year, selectedEmployeeIds: Array.from(selectedEmployeeIds) })
      if (!result.success) {
        setActionError(safeDisplayText(result.error) || 'Failed to preview payroll. Please try again.')
        return
      }
      setPreview({ items: result.items ?? [], workingDays: result.workingDays ?? 0, totalNet: result.totalNet ?? 0, employeeCount: result.employeeCount ?? 0 })
    } catch (err: any) {
      console.error('Error previewing payroll:', err)
      setActionError(errText(err, 'Failed to preview payroll. Please try again.'))
    } finally {
      setPreviewing(false)
    }
  }

  // STEP 2 — confirm the preview, then write the salary slips. Mandatory.
  const handleConfirmGenerate = async () => {
    if (!preview) return
    setActionError(null)
    if (selectedCount === 0) {
      setActionError('Please select at least one employee to include in the payroll.')
      setPreview(null)
      return
    }
    const existing = runs.find(r => r.monthIndex === monthIndex && r.year === year)
    if (existing && EMAILED_OR_LOCKED_STATUSES.includes(existing.status)) {
      setActionError(`Payroll for ${MONTHS[monthIndex]} ${year} has already been finalized (status: ${existing.status}).`)
      setPreview(null)
      return
    }
    if (existing) {
      if (!confirm(`A payroll for ${MONTHS[monthIndex]} ${year} already exists (status: ${existing.status}). Generating again will replace it with a fresh calculation (previous run and slips are removed). Continue?`)) return
    }
    setGenerating(true)
    try {
      // Remove any previous non-final run + its salary slips so the period stays unique.
      if (existing) {
        const slips = await getSalarySlipsByCompany(companyId)
        const runSlips = slips.filter(s => (s as any).payrollRunId === existing.id || (s as any).runId === existing.id)
        for (const s of runSlips) {
          try { await deleteSalarySlip(s.id) } catch { }
        }
        try { await deleteDoc(doc(db, 'payrollRuns', existing.id)) } catch { }
      }

      const result = await generateBulkPayroll({
        companyId,
        monthIndex,
        year,
        selectedEmployeeIds: Array.from(selectedEmployeeIds),
      })
      if (!result.success) {
        setActionError(safeDisplayText(result.error) || 'Payroll generation failed. Please try again.')
        return
      }
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `Generated payroll for ${MONTHS[monthIndex]} ${year} (${result.employeeCount ?? 0} employees)`,
          actionType: 'create', module: 'Payroll',
          targetEntity: `${MONTHS[monthIndex]} ${year}`, status: 'success',
        })
      }
      await fetchRuns()
      setPreview(null)
      // Slides generated & saved (drafts → Payroll History). Land the admin in the
      // dashboard Mail section with company + month + year filters pre-applied.
      goToMailSection(companyId, monthIndex, year)
    } catch (err: any) {
      console.error('Error generating payroll:', err)
      if (user) {
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `Failed to generate payroll for ${MONTHS[monthIndex]} ${year}`,
          actionType: 'create', module: 'Payroll',
          targetEntity: `${MONTHS[monthIndex]} ${year}`, status: 'failure',
        })
      }
      setActionError(errText(err, 'Failed to generate payroll. Please try again.'))
    } finally {
      setGenerating(false)
    }
  }

  const previewItems = preview?.items ?? []
  const safePreviewPage = Math.min(previewPage, Math.max(1, Math.ceil(previewItems.length / previewPageSize)))
  const pagedPreviewItems = previewItems.slice((safePreviewPage - 1) * previewPageSize, safePreviewPage * previewPageSize)

  const busy = previewing || generating

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Payroll" breadcrumbs={['Dashboard', 'Payroll']} />
        <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading...</p></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Payroll" breadcrumbs={['Dashboard', 'Payroll']} />

      <div className="page-content">
        <ScopeIndicator />

        {actionError && !preview && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16, color: '#b91c1c', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{actionError}</span>
            <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={16} /></button>
          </div>
        )}

        {/* Run Payroll */}
        <div className="companies-section">
          <div className="section-header-companies">
            <h3><Calculator size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />Run Payroll</h3>
          </div>
          <div className="filters-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <select className="filter-select" value={monthIndex} onChange={(e) => setMonthIndex(parseInt(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select className="filter-select" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {canPerform('create', 'payroll') && (
              <button className="btn-primary" onClick={handlePreview} disabled={busy}>
                {previewing ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                {previewing ? 'Calculating...' : 'Preview & Generate Salary Slips'}
              </button>
            )}
          </div>

          {companyId && (
            <div style={{ margin: '12px 0 0', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>Employees ({visibleEmployees.length} active):</b>
                <button className="btn-outline" onClick={toggleSelectAllEmployees} disabled={visibleEmployees.length === 0}>
                  <CheckSquare size={14} /> Select All
                </button>
                <button className="btn-outline" onClick={() => setSelectedEmployeeIds(new Set())} disabled={selectedCount === 0}>
                  <Square size={14} /> Clear
                </button>
                <span style={{ fontSize: 13, color: '#6b7280' }}>{selectedCount} of {visibleEmployees.length} selected</span>
              </div>
              {visibleEmployees.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, maxHeight: 150, overflowY: 'auto' }}>
                  {visibleEmployees.map(e => {
                    const key = e.userId || e.id
                    const on = selectedEmployeeIds.has(key)
                    return (
                      <button key={key} onClick={() => toggleSelectEmployee(key)} style={chipStyle(on)}>
                        {on ? <CheckSquare size={12} /> : <Square size={12} />}
                        {e.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: 13, color: '#6b7280', margin: '12px 0 0' }}>
            Select a company to auto-load its active employees. Generate a <strong>mandatory preview</strong> for all of them
            (Select All) or only the ones you pick — review it, confirm, and the slips are saved (drafts) into Payroll History. You will then be
            taken to the dashboard <b>Email Center</b> with company + month + year filters pre-applied so you can instantly review and send
            individual salary-slip emails to employees and their company admins.
          </p>
          {existingRun && (
            <div style={{
              margin: '12px 0 0', padding: '12px 16px', borderRadius: 12,
              background: existingRunFinal ? '#fef2f2' : '#f9fafb',
              border: `1px solid ${existingRunFinal ? '#fecaca' : '#e5e7eb'}`,
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#374151',
            }}>
              <AlertTriangle size={16} color={existingRunFinal ? '#b91c1c' : '#f59e0b'} />
              <span>
                Salary slips for <strong>{existingRun.month} {existingRun.year}</strong> already exist — status:{' '}
                <span className="status-badge-table" style={{ ...statusColor(existingRun.status), padding: '2px 8px', marginLeft: 4 }}>{existingRun.status}</span>.
                {existingRunFinal
                  ? ' This payroll has already been finalized/mailed — generating again is blocked. See Payroll History.'
                  : ' This payroll is not finalized yet — generating again will replace it with a fresh calculation, or email the slips from Payroll History.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mandatory preview modal */}
      <Modal
        isOpen={!!preview}
        onClose={() => { if (!generating) setPreview(null) }}
        title={`Preview Payroll — ${MONTHS[monthIndex]} ${year} (${preview?.employeeCount ?? 0} employees)`}
        size="large"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#374151', marginRight: 'auto' }}>
              Total Net: <b>{fmt(preview?.totalNet ?? 0)}</b> · Working Days: <b>{preview?.workingDays ?? 0}</b>
            </span>
            <button className="btn-outline" onClick={() => setPreview(null)} disabled={generating}>Back to Selection</button>
            <button className="btn-primary" onClick={handleConfirmGenerate} disabled={generating}>
              {generating ? <Loader2 size={16} className="animate-spin" /> : <CheckSquare size={16} />}
              {generating ? 'Generating...' : 'Confirm & Generate Salary Slips'}
            </button>
          </div>
        }
      >
        {actionError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, color: '#b91c1c', fontSize: 13 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{actionError}</span>
          </div>
        )}
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Reviewing this preview is <b>mandatory</b> — nothing is saved until you confirm. Check the line items and
          totals below, then confirm. Salary slips are saved as drafts into Payroll History and you will be taken to the
          dashboard <b>Email Center</b> with company + month + year filters already applied — instantly review and send
          individual emails to employees and their company admins without manual re-filtering.
        </div>
        <div className="table-container" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="companies-table" style={{ minWidth: 1300 }}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>WD</th>
                <th>Present</th>
                <th>Paid Lv</th>
                <th>Unpaid Lv</th>
                <th>Absent</th>
                <th>OT Hrs</th>
                <th>Basic</th>
                <th>Allowances</th>
                <th>Leave Ded.</th>
                <th>PF + PT</th>
                <th>Earnings</th>
                <th>Deductions</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {pagedPreviewItems.map(it => {
                const allowances = (it.hra || 0) + (it.da || 0) + (it.conveyance || 0) + (it.medical || 0) + (it.specialAllowance || 0) + (it.overtimePay || 0) + (it.leaveEncashment || 0)
                const pfpt = (it.pf || 0) + (it.professionalTax || 0)
                return (
                  <tr key={it.userId || it.employeeId}>
                    <td><strong>{it.employeeName}</strong><div style={{ fontSize: 11, color: '#9ca3af' }}>{it.employeeId}</div></td>
                    <td>{it.department}</td>
                    <td>{it.workingDays}</td>
                    <td>{it.presentDays}</td>
                    <td>{it.paidLeaveDays}</td>
                    <td>{it.unpaidLeaveDays}</td>
                    <td>{it.absentDays}</td>
                    <td>{it.overtimeHours}</td>
                    <td>{fmt(it.basicSalary)}</td>
                    <td>{fmt(allowances)}</td>
                    <td>{fmt(it.otherDeductions || 0)}</td>
                    <td>{fmt(pfpt)}</td>
                    <td>{fmt(it.totalEarnings)}</td>
                    <td>{fmt(it.totalDeductions)}</td>
                    <td><b>{fmt(it.netSalary)}</b></td>
                  </tr>
                )
              })}
            </tbody>
            {preview && preview.items.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f9fafb', fontWeight: 600 }}>
                  <td colSpan={12}>Total ({preview.employeeCount} employees)</td>
                  <td>{fmt(preview.items.reduce((s, i) => s + (i.totalEarnings || 0), 0))}</td>
                  <td>{fmt(preview.items.reduce((s, i) => s + (i.totalDeductions || 0), 0))}</td>
                  <td>{fmt(preview.totalNet)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination
          page={safePreviewPage}
          pageSize={previewPageSize}
          total={previewItems.length}
          onPageChange={setPreviewPage}
          onPageSizeChange={(n) => { setPreviewPageSize(n); setPreviewPage(1) }}
        />
      </Modal>
    </div>
  )
}

export function Payroll() {
  return (
    <ErrorBoundary>
      <PayrollContent />
    </ErrorBoundary>
  )
}