import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ReceiptText, Plus, Search, Pencil, Trash2, Loader2, Wallet, TrendingUp } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { ActionErrorBanner } from '../components/ActionErrorBanner'
import { errText } from '../aws/errors'
import { Pagination } from '../components/Pagination'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import {
  getAllSalaryStructures,
  getSalaryStructuresByCompany,
  createSalaryStructure,
  updateSalaryStructure,
  deleteSalaryStructure,
  computeGross
} from '../services/salaryStructureService'
import type { SalaryStructure } from '../types/user'
import './Companies.css'

interface FormState {
  name: string
  basicSalary: number
  hra: number
  da: number
  conveyance: number
  medical: number
  specialAllowance: number
  pf: number
  professionalTax: number
  overtimeRate: number
  description: string
}

const INITIAL_FORM: FormState = {
  name: '',
  basicSalary: 0,
  hra: 0,
  da: 0,
  conveyance: 0,
  medical: 0,
  specialAllowance: 0,
  pf: 0,
  professionalTax: 0,
  overtimeRate: 0,
  description: ''
}

const fmt = (n: number) => '₹' + (n || 0).toLocaleString('en-IN')

interface StructureFormProps {
  formData: FormState
  setFormData: React.Dispatch<React.SetStateAction<FormState>>
  onSubmit: (e: React.FormEvent) => void
  submitLabel: string
  onCancel: () => void
  isSubmitting: boolean
}

const numField = (
  label: string,
  value: number,
  onChange: (v: number) => void
) => (
  <div className="form-group">
    <label>{label}</label>
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      placeholder="0"
    />
  </div>
)

const StructureForm = ({ formData, setFormData, onSubmit, submitLabel, onCancel, isSubmitting }: StructureFormProps) => {
  const gross = computeGross(formData)
  const totalDeductions = (formData.pf || 0) + (formData.professionalTax || 0)
  const net = gross - totalDeductions
  return (
    <form onSubmit={onSubmit} className="modal-form">
      <div className="form-group">
        <label>Structure Name *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Senior Engineer Grade A"
          required
        />
      </div>

      <h4 style={{ margin: '8px 0', color: '#374151' }}>Earnings</h4>
      <div className="form-row">
        {numField('Basic Salary *', formData.basicSalary, (v) => setFormData(prev => ({ ...prev, basicSalary: v })))}
        {numField('HRA', formData.hra, (v) => setFormData(prev => ({ ...prev, hra: v })))}
      </div>
      <div className="form-row">
        {numField('Dearness Allowance (DA)', formData.da, (v) => setFormData(prev => ({ ...prev, da: v })))}
        {numField('Conveyance', formData.conveyance, (v) => setFormData(prev => ({ ...prev, conveyance: v })))}
      </div>
      <div className="form-row">
        {numField('Medical Allowance', formData.medical, (v) => setFormData(prev => ({ ...prev, medical: v })))}
        {numField('Special Allowance', formData.specialAllowance, (v) => setFormData(prev => ({ ...prev, specialAllowance: v })))}
      </div>

      <h4 style={{ margin: '8px 0', color: '#374151' }}>Deductions</h4>
      <div className="form-row">
        {numField('Provident Fund (PF)', formData.pf, (v) => setFormData(prev => ({ ...prev, pf: v })))}
        {numField('Professional Tax', formData.professionalTax, (v) => setFormData(prev => ({ ...prev, professionalTax: v })))}
      </div>

      <h4 style={{ margin: '8px 0', color: '#374151' }}>Overtime</h4>
      <div className="form-row">
        {numField('Overtime Rate (per hour)', formData.overtimeRate, (v) => setFormData(prev => ({ ...prev, overtimeRate: v })))}
        <div className="form-group" />
      </div>

      <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '14px', margin: '8px 0', display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
        <div>Gross: <strong>{fmt(gross)}</strong></div>
        <div>Deductions: <strong style={{ color: '#ef4444' }}>{fmt(totalDeductions)}</strong></div>
        <div>Net: <strong style={{ color: '#16a34a' }}>{fmt(net)}</strong></div>
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          rows={2}
          placeholder="Notes about this structure..."
        />
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : submitLabel}</button>
      </div>
    </form>
  )
}

export function SalaryStructure() {
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('salary')
  const [searchParams] = useSearchParams()
  const companyId = effectiveCompanyId || searchParams.get('company') || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''
  const [structures, setStructures] = useState<SalaryStructure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Search/company scope changes the result set — restart from page 1
  useEffect(() => {
    setPage(1)
  }, [searchTerm, companyId])

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [selected, setSelected] = useState<SalaryStructure | null>(null)
  const [formData, setFormData] = useState<FormState>(INITIAL_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [companyId, user?.role])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      let data: SalaryStructure[]
      if (user?.role === 'master-admin' && !companyId) {
        data = await getAllSalaryStructures()
      } else if (companyId) {
        data = await getSalaryStructuresByCompany(companyId)
      } else {
        data = []
      }
      setStructures(data)
    } catch (err: any) {
      console.error('Error fetching salary structures:', err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError('Access denied. You do not have permission to view salary structures for this company.')
      } else if (err?.code === 'unavailable' || err?.message?.includes('timeout')) {
        setError('Request timed out. Please check your connection and try again.')
      } else {
        setError('Failed to load salary structures.')
      }
    } finally {
      setLoading(false)
    }
  }

  const filtered = structures.filter(s => !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()))

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pagedRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError(null)
    setIsSubmitting(true)
    try {
      await createSalaryStructure({
        name: formData.name,
        companyId,
        basicSalary: formData.basicSalary,
        hra: formData.hra,
        da: formData.da,
        conveyance: formData.conveyance,
        medical: formData.medical,
        specialAllowance: formData.specialAllowance,
        pf: formData.pf,
        professionalTax: formData.professionalTax,
        overtimeRate: formData.overtimeRate,
        description: formData.description
      })
      await fetchData()
      setIsAddModalOpen(false)
      setFormData(INITIAL_FORM)
    } catch (err) {
      console.error('Error adding structure:', err)
      setActionError(errText(err, 'Failed to add salary structure. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setActionError(null)
    setIsSubmitting(true)
    try {
      await updateSalaryStructure(selected.id, { ...formData })
      await fetchData()
      setIsEditModalOpen(false)
      setSelected(null)
    } catch (err) {
      console.error('Error updating structure:', err)
      setActionError(errText(err, 'Failed to update salary structure. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this salary structure?')) return
    setActionError(null)
    try {
      await deleteSalaryStructure(id)
      await fetchData()
    } catch (err) {
      console.error('Error deleting structure:', err)
      setActionError(errText(err, 'Failed to delete salary structure. Please try again.'))
    }
  }

  const openEdit = (s: SalaryStructure) => {
    setSelected(s)
    setFormData({
      name: s.name,
      basicSalary: s.basicSalary,
      hra: s.hra,
      da: s.da,
      conveyance: s.conveyance,
      medical: s.medical,
      specialAllowance: s.specialAllowance,
      pf: s.pf,
      professionalTax: s.professionalTax,
      overtimeRate: s.overtimeRate,
      description: s.description || ''
    })
    setIsEditModalOpen(true)
  }

  const totalGross = structures.reduce((sum, s) => sum + s.grossSalary, 0)
  const avgGross = structures.length ? Math.round(totalGross / structures.length) : 0

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Salary Structure" breadcrumbs={['Dashboard', 'Salary Structure']} />
        <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading...</p></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Salary Structure" breadcrumbs={['Dashboard', 'Salary Structure']} />
        <div className="error-container"><p>{error}</p><button onClick={fetchData} className="btn-primary">Retry</button></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Salary Structure" breadcrumbs={['Dashboard', 'Salary Structure']} />

      <div className="page-content">
        <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        <div className="stats-row">
          <div className="stat-card-companies">
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#eff6ff', color: '#3b82f6' }}><ReceiptText size={24} /></div>
              <div className="stat-details"><span className="stat-label">Total Structures</span><span className="stat-value">{structures.length}</span></div>
            </div>
          </div>
          <div className="stat-card-companies">
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#ecfdf5', color: '#10b981' }}><Wallet size={24} /></div>
              <div className="stat-details"><span className="stat-label">Avg Gross</span><span className="stat-value">{fmt(avgGross)}</span></div>
            </div>
          </div>
          <div className="stat-card-companies">
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#fffbeb', color: '#f59e0b' }}><TrendingUp size={24} /></div>
              <div className="stat-details"><span className="stat-label">Total Gross</span><span className="stat-value">{fmt(totalGross)}</span></div>
            </div>
          </div>
        </div>

        <div className="companies-section">
          <div className="section-header-companies">
            <h3>Salary Structures</h3>
            <div className="section-actions">
              {hasPermission('salary.create') && (
                <button className="btn-primary" onClick={() => { setFormData(INITIAL_FORM); setIsAddModalOpen(true) }}>
                  <Plus size={16} />Add Structure
                </button>
              )}
            </div>
          </div>

          <div className="filters-row">
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="search-filter">
              <Search size={16} />
              <input type="text" placeholder="Search structures..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>

          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th>Structure</th>
                  <th>Basic</th>
                  <th>Allowances</th>
                  <th>Gross</th>
                  <th>Deductions</th>
                  <th>OT Rate/hr</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(s => {
                  const allowances = s.hra + s.da + s.conveyance + s.medical + s.specialAllowance
                  const deductions = s.pf + s.professionalTax
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="company-details">
                          <span className="company-name">{s.name}</span>
                          {s.description && <span className="company-domain">{s.description}</span>}
                        </div>
                      </td>
                      <td>{fmt(s.basicSalary)}</td>
                      <td>{fmt(allowances)}</td>
                      <td><strong>{fmt(s.grossSalary)}</strong></td>
                      <td style={{ color: '#ef4444' }}>{fmt(deductions)}</td>
                      <td>{fmt(s.overtimeRate)}</td>
                      <td>
                        <div className="action-buttons">
                          {hasPermission('salary.edit') && (
                            <button className="action-btn edit" onClick={() => openEdit(s)}><Pencil size={16} /></button>
                          )}
                          {hasPermission('salary.delete') && (
                            <button className="action-btn delete" onClick={() => handleDelete(s.id)}><Trash2 size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>No salary structures found{companyName ? ` for ${companyName}` : ''}.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
          />
        </div>
      </div>

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add Salary Structure" size="large">
        <StructureForm formData={formData} setFormData={setFormData} onSubmit={handleAdd} submitLabel="Add Structure" onCancel={() => { setIsAddModalOpen(false); setFormData(INITIAL_FORM) }} isSubmitting={isSubmitting} />
      </Modal>

      <Modal isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setSelected(null) }} title="Edit Salary Structure" size="large">
        <StructureForm formData={formData} setFormData={setFormData} onSubmit={handleEdit} submitLabel="Save Changes" onCancel={() => { setIsEditModalOpen(false); setSelected(null) }} isSubmitting={isSubmitting} />
      </Modal>
    </div>
  )
}
