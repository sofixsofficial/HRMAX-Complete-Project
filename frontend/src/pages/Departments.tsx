import { useState, useEffect, useMemo } from 'react'
import { Network, Users, UserCheck, Plus, Search, Eye, Pencil, Trash2, Loader2, X, ChevronLeft, ChevronRight, Building2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../config/firebase'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { createDepartment, updateDepartment, deleteDepartment } from '../services/departmentService'
import { getAllEmployees, getEmployeesByCompany } from '../services/employeeService'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import type { Department, Employee } from '../types/user'
import './Companies.css'

const departmentSchema = z.object({
  name: z.string().min(1, 'Department name is required').max(100),
  companyId: z.string().min(1, 'Company is required'),
})

type DepartmentFormData = z.infer<typeof departmentSchema> & {
  managerId?: string
  managerName?: string
  description?: string
}

type SortField = 'name' | 'employeeCount'
type SortDir = 'asc' | 'desc'

export function Departments() {
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('departments')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const companyId = effectiveCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''
  const canDelete = canPerform('delete', 'departments')
  const canEdit = canPerform('edit', 'departments')
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selected, setSelected] = useState<Department | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [activeFilter, setActiveFilter] = useState<'all' | 'withManager' | 'employees'>('all')

  const { register, handleSubmit, reset, formState: { errors }, setValue, watch } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: '', companyId: companyId }
  })

  const watchCompanyId = watch('companyId')

  useEffect(() => {
    const scopeIds = canAccessAllCompanies
      ? []
      : scopedCompanyIds(effectiveCompanyId, availableCompanies)

    const parse = (d: any) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || new Date(),
    }) as Department

    const processDepts = async (depts: Department[]) => {
      try {
        const emps = canAccessAllCompanies
          ? await getAllEmployees()
          : effectiveCompanyId
            ? await getEmployeesByCompany(companyId)
            : (await Promise.all(
                scopedCompanyIds(null, availableCompanies).map(id => getEmployeesByCompany(id).catch(() => []))
              )).flat()
        const deptsWithCount = depts.map(d => ({
          ...d,
          employeeCount: emps.filter(e => e.departmentId === d.id).length
        }))
        setDepartments(deptsWithCount)
        setEmployees(emps)
      } catch { /* ignore */ }
    }

    const applySnap = (snap: any) => {
      const depts = snap.docs.map(parse).sort((a: any, b: any) => a.name.localeCompare(b.name))
      processDepts(depts)
      setLoading(false)
      setError(null)
    }

    const onErr = (err: any) => {
      console.error('Departments listener error:', err)
      setError('Failed to load departments')
      setLoading(false)
    }

    const unsubs: (() => void)[] = []

    if (canAccessAllCompanies) {
      unsubs.push(onSnapshot(query(collection(db, 'departments')), applySnap, onErr))
    } else if (scopeIds.length > 0) {
      const mergedMap = new Map<string, Department>()
      for (const chunk of chunkCompanyIds(scopeIds)) {
        const un = onSnapshot(query(collection(db, 'departments'), companyIdWhere(chunk)!), (snap) => {
          snap.docs.forEach(d => mergedMap.set(d.id, parse(d)))
          processDepts([...mergedMap.values()].sort((a: any, b: any) => a.name.localeCompare(b.name)))
          setLoading(false)
          setError(null)
        }, onErr)
        unsubs.push(un)
      }
    } else {
      unsubs.push(onSnapshot(query(collection(db, 'departments'), where('companyId', '==', 'none')), applySnap, onErr))
    }

    return () => unsubs.forEach(u => u())
  }, [companyId, canAccessAllCompanies, effectiveCompanyId, availableCompanies])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setCurrentPage(1)
  }

  const filteredData = useMemo(() => {
    return departments.filter(d => {
      if (activeFilter === 'withManager' && !d.managerId) return false
      if (activeFilter === 'employees' && (d.employeeCount || 0) <= 0) return false
      if (searchTerm) {
        const s = searchTerm.toLowerCase()
        if (!d.name.toLowerCase().includes(s) && !(d.managerName || '').toLowerCase().includes(s)) return false
      }
      return true
    }).sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortField === 'employeeCount') cmp = (a.employeeCount || 0) - (b.employeeCount || 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [departments, searchTerm, sortField, sortDir, activeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize))
  const paginated = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const onSubmitAdd = async (data: DepartmentFormData) => {
    setIsSubmitting(true)
    try {
      const role = user?.role
      const isTLCreator = role === 'team-leader'
      const isExecCreator = role === 'executive'
      const creatorName = user?.name || ''
      const creatorRole = isTLCreator ? 'Team Leader'
        : isExecCreator ? 'Executive'
        : role === 'master-admin' ? 'Master Admin'
        : role === 'company-admin' ? 'Company Admin'
        : 'Admin'
      const teamLeaderName = isTLCreator ? creatorName : ''
      const executiveName = isExecCreator ? creatorName : ''
      await createDepartment({
        name: data.name,
        companyId: data.companyId,
        employeeCount: 0,
        createdBy: user?.id || '',
        createdByName: creatorName,
        createdByRole: creatorRole,
        teamLeaderName,
        executiveName,
      })
      setIsAddModalOpen(false)
      reset({ name: '', companyId: companyId })
    } catch (err) {
      console.error('Error adding department:', err)
      setError('Failed to add department. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const onSubmitEdit = async (data: DepartmentFormData) => {
    if (!selected) return
    setIsSubmitting(true)
    try {
      await updateDepartment(selected.id, {
        name: data.name,
        managerId: data.managerId || undefined,
        managerName: data.managerName || undefined,
        description: data.description || undefined,
      })
      setIsEditModalOpen(false)
      setSelected(null)
    } catch (err) {
      console.error('Error updating department:', err)
      setError('Failed to update department. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this department? This action cannot be undone.')) return
    try {
      await deleteDepartment(id)
    } catch (err: any) {
      console.error('Error deleting department:', err)
      if (err?.code === 'permission-denied') {
        setError('Access denied: Your role does not have permission to delete departments.')
      } else {
        setError('Failed to delete department. Please try again.')
      }
    }
  }

  const openEdit = (dept: Department) => {
    setSelected(dept)
    setValue('name', dept.name)
    setValue('companyId', dept.companyId)
    setIsEditModalOpen(true)
  }

  const openAdd = () => {
    reset({ name: '', companyId: companyId })
    setIsAddModalOpen(true)
  }

  const deptEmployees = selected
    ? employees.filter(e => e.departmentId === selected.id)
    : []

  const stats = {
    total: departments.length,
    withManager: departments.filter(d => !!d.managerId).length,
    totalEmployees: departments.reduce((sum, d) => sum + (d.employeeCount || 0), 0)
  }

  const handleFilterClick = (filter: 'all' | 'withManager' | 'employees') => {
    setActiveFilter(prev => prev === filter ? 'all' : filter)
    setCurrentPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Departments" breadcrumbs={['Dashboard', 'Departments']} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading departments...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Departments" breadcrumbs={['Dashboard', 'Departments']} />

      <div className="page-content">
        {error && (
          <div className="error-banner" style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><X size={16} /></button>
          </div>
        )}

        <ScopeIndicator />

        <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-card-companies" onClick={() => handleFilterClick('all')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: activeFilter === 'all' ? '2px solid #f97316' : '2px solid transparent', boxShadow: activeFilter === 'all' ? '0 0 0 3px rgba(249,115,22,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#eff6ff', color: '#3b82f6' }}><Network size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">Total Departments</span>
                <span className="stat-value">{stats.total}</span>
              </div>
            </div>
          </div>
          <div className="stat-card-companies" onClick={() => handleFilterClick('employees')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: activeFilter === 'employees' ? '2px solid #f97316' : '2px solid transparent', boxShadow: activeFilter === 'employees' ? '0 0 0 3px rgba(249,115,22,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#ecfdf5', color: '#10b981' }}><Users size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">Total Employees</span>
                <span className="stat-value">{stats.totalEmployees}</span>
              </div>
            </div>
          </div>
          <div className="stat-card-companies" onClick={() => handleFilterClick('withManager')} style={{ cursor: 'pointer', transition: 'all 0.15s', border: activeFilter === 'withManager' ? '2px solid #f97316' : '2px solid transparent', boxShadow: activeFilter === 'withManager' ? '0 0 0 3px rgba(249,115,22,0.15)' : 'none' }}>
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#fffbeb', color: '#f59e0b' }}><UserCheck size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">With Manager</span>
                <span className="stat-value">{stats.withManager}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="companies-section">
          <div className="section-header-companies">
            <h3>All Departments</h3>
            <div className="section-actions">
              {canPerform('create', 'departments') && (
                <button className="btn-primary" onClick={openAdd}>
                  <Plus size={16} />
                  Add Department
                </button>
              )}
            </div>
          </div>

          <div className="filters-row">
            <div className="search-filter">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search departments..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
            <div className="search-filter" style={{ minWidth: 200 }}>
              <Building2 size={16} />
              <select
                value={companyId}
                onChange={e => { setSelectedCompanyId(e.target.value || ''); setCurrentPage(1) }}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, background: '#fff' }}
              >
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('name')}>
                    Department Name <SortIcon field="name" />
                  </th>
                  <th>Company Name</th>
                  <th>Created By Role</th>
                  <th>Team Leader Name</th>
                  <th>Executive Name</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((dept, idx) => (
                  <tr key={dept.id || `dept-${idx}`}>
                    <td>
                      <div className="company-details">
                        <span className="company-name">{dept.name}</span>
                      </div>
                    </td>
                    <td><span className="company-domain">{availableCompanies.find(c => c.id === dept.companyId)?.name || dept.companyId}</span></td>
                    <td>
                      {dept.createdByRole ? (
                        <span style={{ fontSize: 11, color: '#8b5cf6', background: '#f5f3ff', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                          {dept.createdByRole}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td><span className="admin-name">{dept.teamLeaderName || '—'}</span></td>
                    <td><span className="admin-name">{dept.executiveName || '—'}</span></td>
                    <td>
                      <span className="company-domain">
                        {dept.createdAt ? new Date(dept.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button className="action-btn view" onClick={() => { setSelected(dept); setIsViewModalOpen(true) }} title="View"><Eye size={16} /></button>
                        {canPerform('edit', 'departments') && (
                          <button className="action-btn edit" onClick={() => openEdit(dept)} title="Edit"><Pencil size={16} /></button>
                        )}
                        {canDelete && (
                          <button className="action-btn delete" onClick={() => handleDelete(dept.id)} title="Delete"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                      {searchTerm ? 'No departments match your search.' : activeFilter !== 'all' ? `No departments match the "${activeFilter === 'withManager' ? 'With Manager' : 'With Employees'}" filter.` : `No departments yet${companyName ? ` for ${companyName}` : ''}. Click "Add Department" to create one.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="showing-text">
                Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} departments
              </span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
                style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, background: '#fff' }}
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="action-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                style={{ opacity: currentPage <= 1 ? 0.4 : 1 }}
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  style={{
                    minWidth: 32, height: 32, borderRadius: 6, border: '1px solid #e5e7eb',
                    background: currentPage === p ? '#f97316' : '#fff',
                    color: currentPage === p ? '#fff' : '#374151',
                    cursor: 'pointer', fontSize: 13, fontWeight: currentPage === p ? 600 : 400,
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                className="action-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                style={{ opacity: currentPage >= totalPages ? 0.4 : 1 }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Department Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); reset({ name: '', companyId: companyId }) }} title="Add New Department" size="medium">
        <form onSubmit={handleSubmit(onSubmitAdd)} className="modal-form">
          <div className="form-group">
            <label>Department Name *</label>
            <input type="text" {...register('name')} placeholder="e.g., Engineering" className={errors.name ? 'input-error' : ''} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="form-group">
            <label>Select Company *</label>
            <select
              {...register('companyId')}
              className={errors.companyId ? 'input-error' : ''}
            >
              <option value="">-- Select Company --</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.companyId && <span className="field-error">{errors.companyId.message}</span>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => { setIsAddModalOpen(false); reset({ name: '', companyId: companyId }) }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Add Department'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Department Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setSelected(null); reset() }} title="Edit Department" size="medium">
        <form onSubmit={handleSubmit(onSubmitEdit)} className="modal-form">
          <div className="form-group">
            <label>Department Name *</label>
            <input type="text" {...register('name')} placeholder="e.g., Engineering" className={errors.name ? 'input-error' : ''} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="form-group">
            <label>Department Manager</label>
            <select {...register('managerId', {
              onChange: (e) => {
                const emp = employees.find(emp => emp.userId === e.target.value || emp.id === e.target.value)
                setValue('managerName', emp ? emp.name : '')
              }
            })}>
              <option value="">-- Select Manager --</option>
              {employees.map((emp, idx) => (
                <option key={emp.id || emp.userId || `emp-edit-${idx}`} value={emp.userId || emp.id}>{emp.name} ({emp.employeeId})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea {...register('description')} placeholder="Department description..." rows={3} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => { setIsEditModalOpen(false); setSelected(null) }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Department Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => { setIsViewModalOpen(false); setSelected(null) }} title="Department Details" size="medium">
        {selected && (
          <div className="modal-form">
            <div className="form-group">
              <label>Department Name</label>
              <div className="field-value">{selected.name}</div>
            </div>
            <div className="form-group">
              <label>Code</label>
              <div className="field-value">{selected.code}</div>
            </div>
            <div className="form-group">
              <label>Company Name</label>
              <div className="field-value">{availableCompanies.find(c => c.id === selected.companyId)?.name || selected.companyId}</div>
            </div>
            <div className="form-group">
              <label>Created By Role</label>
              <div className="field-value">
                {selected.createdByRole ? (
                  <span style={{ fontSize: 12, color: '#8b5cf6', background: '#f5f3ff', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                    {selected.createdByRole}
                  </span>
                ) : '—'}
              </div>
            </div>
            <div className="form-group">
              <label>Created By</label>
              <div className="field-value">{selected.createdByName || '—'}</div>
            </div>
            <div className="form-group">
              <label>Team Leader Name</label>
              <div className="field-value">{selected.teamLeaderName || '—'}</div>
            </div>
            <div className="form-group">
              <label>Executive Name</label>
              <div className="field-value">{selected.executiveName || '—'}</div>
            </div>
            <div className="form-group">
              <label>Date of Creation</label>
              <div className="field-value">
                {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <div className="form-group">
              <label>Manager</label>
              <div className="field-value">{selected.managerName || 'Not assigned'}</div>
            </div>
            <div className="form-group">
              <label>Total Employees</label>
              <div className="field-value">{selected.employeeCount || 0}</div>
            </div>
            {deptEmployees.length > 0 && (
              <div className="form-group">
                <label>Assigned Employees ({deptEmployees.length})</label>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                  {deptEmployees.map((emp, idx) => (
                    <div key={emp.id || `dept-emp-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{emp.name}</span>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>{emp.employeeId}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={() => { setIsViewModalOpen(false); setSelected(null) }}>Close</button>
        </div>
      </Modal>
    </div>
  )
}
