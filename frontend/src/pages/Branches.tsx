import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Network, CheckCircle, XCircle, Plus, Search, Eye, Pencil, Trash2, Loader2, X, ChevronLeft, ChevronRight, Building2, QrCode, Copy, RefreshCw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { collection, onSnapshot, query, where } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import QRCode from 'qrcode'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Toast } from '../components/Toast'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { useAuth } from '../context/AuthContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { createBranch, updateBranch, deleteBranch, generateQrToken, mapBranch, regenerateQrToken, DEFAULT_RADIUS_IN_METERS } from '../services/branchService'
import type { Branch } from '../services/branchService'
import { getAllEmployees, getEmployeesByCompany } from '../services/employeeService'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import { errText } from '../aws/errors'
import type { Employee } from '../types/user'
import './Companies.css'

// Numeric fields are kept as strings in the form (native <input type="number">
// values arrive as strings) so the zod input/output types stay identical and
// zodResolver needs no cast. They are converted to numbers on submit.
const numericField = (label: string, min?: number, max?: number) =>
  z.string().refine(
    (v) => {
      const t = v.trim()
      if (t === '') return true // optional — absent coordinates are allowed
      const n = Number(t)
      if (!Number.isFinite(n)) return false
      if (min !== undefined && n < min) return false
      if (max !== undefined && n > max) return false
      return true
    },
    min !== undefined && max !== undefined
      ? `${label} must be a number between ${min} and ${max}`
      : `${label} must be a number`
  )

const branchSchema = z.object({
  companyId: z.string().min(1, 'Company is required'),
  name: z.string().trim().min(1, 'Branch name is required').max(100, 'Branch name must be 100 characters or fewer'),
  address: z.string().trim().min(1, 'Address is required').max(300, 'Address must be 300 characters or fewer'),
  city: z.string().max(100, 'City must be 100 characters or fewer'),
  latitude: numericField('Latitude', -90, 90),
  longitude: numericField('Longitude', -180, 180),
  radiusInMeters: numericField('Radius', 50, 500),
  managerId: z.string(),
  shifts: z.string().max(2000, 'Shifts list is too long'),
  qrEnabled: z.boolean(),
  isActive: z.boolean(),
})

type BranchFormData = z.infer<typeof branchSchema>

type SortField = 'name'
type SortDir = 'asc' | 'desc'

type StatusFilter = 'all' | 'active' | 'inactive'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All Branches' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
]

/** Backend throws 403 / permission-denied when `settings.edit` is missing. */
const isPermissionDenied = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code
  return code === 'permission-denied' || code === 'auth/access-denied' || code === 'forbidden'
}

const writeErrorMessage = (err: unknown, verb: 'add' | 'update' | 'delete'): string => {
  if (isPermissionDenied(err)) {
    return `Access denied: your role does not have permission to ${verb} branches. The Branches (or Settings › Edit) permission is required.`
  }
  return errText(err, `Failed to ${verb} branch. Please try again.`)
}

const toOptionalNumber = (value: string): number | undefined => {
  const t = value.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

const parseShifts = (value: string): string[] =>
  value.split('\n').map(s => s.trim()).filter(Boolean)

const formatDate = (value?: Date) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

const formatDateTime = (value?: Date) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

export function Branches() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('branches')
  const { canPerform } = useAccessControl()
  const [searchParams] = useSearchParams()

  // Companies.tsx deep-links here after creating a company (?company=<id>).
  const urlCompanyId = searchParams.get('company') || ''
  const companyId = effectiveCompanyId || urlCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''
  // Branch writes are allowed via the legacy `settings.edit` umbrella OR a
  // dedicated `branches.create`/`branches.edit` grant (Access Permissions).
  const canWrite = canPerform('edit', 'settings') || canPerform('create', 'branches') || canPerform('edit', 'branches')

  const [branches, setBranches] = useState<Branch[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const [selected, setSelected] = useState<Branch | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { register, handleSubmit, reset, formState: { errors }, watch } = useForm<BranchFormData>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      companyId: companyId,
      name: '',
      address: '',
      city: '',
      latitude: '',
      longitude: '',
      radiusInMeters: String(DEFAULT_RADIUS_IN_METERS),
      managerId: '',
      shifts: '',
      qrEnabled: false,
      isActive: true,
    },
  })

  const watchCompanyId = watch('companyId')

  // Seed the company scope from the ?company= deep link (mount-only, so later
  // user selection in the dropdown is never overridden).
  useEffect(() => {
    if (urlCompanyId && urlCompanyId !== effectiveCompanyId) {
      setSelectedCompanyId(urlCompanyId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const hasExplicitSelection = !!effectiveCompanyId || !!urlCompanyId
    const scopeIds = hasExplicitSelection
      ? scopedCompanyIds(effectiveCompanyId || urlCompanyId, availableCompanies)
      : canAccessAllCompanies
        ? []
        : scopedCompanyIds(effectiveCompanyId, availableCompanies)

    const parse = (d: any): Branch => mapBranch(d.id, (d.data() || {}) as Record<string, unknown>)

    const applySnap = (snap: any) => {
      const list = snap.docs.map(parse).sort((a: Branch, b: Branch) => a.name.localeCompare(b.name))
      setBranches(list)
      setLoading(false)
      setError(null)
    }

    const onErr = (err: any) => {
      console.error('Branches listener error:', err)
      setError('Failed to load branches')
      setLoading(false)
    }

    const unsubs: (() => void)[] = []

    if (scopeIds.length === 0) {
      // "All Companies" mode — the backend scopes rows to the caller anyway.
      unsubs.push(onSnapshot(query(collection(db, 'branches')), applySnap, onErr))
    } else {
      const mergedMap = new Map<string, Branch>()
      for (const chunk of chunkCompanyIds(scopeIds)) {
        const un = onSnapshot(query(collection(db, 'branches'), companyIdWhere(chunk)!), (snap) => {
          snap.docs.forEach(d => mergedMap.set(d.id, parse(d)))
          const list = [...mergedMap.values()].sort((a, b) => a.name.localeCompare(b.name))
          setBranches(list)
          setLoading(false)
          setError(null)
        }, onErr)
        unsubs.push(un)
      }
    }

    return () => unsubs.forEach(u => u())
  }, [companyId, canAccessAllCompanies, effectiveCompanyId, availableCompanies, urlCompanyId])

  // Employees of the current scope — used to pick a branch manager.
  useEffect(() => {
    let active = true
    const loadEmployees = async () => {
      try {
        const scopeCompany = effectiveCompanyId || urlCompanyId
        const emps = canAccessAllCompanies && !urlCompanyId
          ? await getAllEmployees()
          : scopeCompany
            ? await getEmployeesByCompany(scopeCompany)
            : (await Promise.all(
                scopedCompanyIds(null, availableCompanies).map(id => getEmployeesByCompany(id).catch(() => []))
              )).flat()
        if (active) setEmployees(emps)
      } catch {
        /* manager dropdown degrades to an empty list */
      }
    }
    loadEmployees()
    return () => { active = false }
  }, [companyId, canAccessAllCompanies, effectiveCompanyId, availableCompanies, urlCompanyId])

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
    return branches.filter(b => {
      if (statusFilter === 'active' && !b.isActive) return false
      if (statusFilter === 'inactive' && b.isActive) return false
      if (searchTerm) {
        const s = searchTerm.toLowerCase()
        if (!b.name.toLowerCase().includes(s) && !(b.city || '').toLowerCase().includes(s)) return false
      }
      return true
    }).sort((a, b) => {
      const cmp = sortField === 'name' ? a.name.localeCompare(b.name) : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [branches, searchTerm, statusFilter, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize))
  const paginated = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const stats = {
    total: branches.length,
    active: branches.filter(b => b.isActive).length,
    inactive: branches.filter(b => !b.isActive).length,
  }

  const statusCount = (key: StatusFilter) =>
    key === 'all' ? stats.total : key === 'active' ? stats.active : stats.inactive

  const defaultFormValues = (companyIdOverride?: string): BranchFormData => ({
    companyId: companyIdOverride ?? companyId,
    name: '',
    address: '',
    city: '',
    latitude: '',
    longitude: '',
    radiusInMeters: String(DEFAULT_RADIUS_IN_METERS),
    managerId: '',
    shifts: '',
    qrEnabled: false,
    isActive: true,
  })

  const openAdd = () => {
    reset(defaultFormValues())
    setIsAddModalOpen(true)
  }

  const openEdit = (branch: Branch) => {
    setSelected(branch)
    reset({
      companyId: branch.companyId || companyId,
      name: branch.name || '',
      address: branch.address || '',
      city: branch.city || '',
      latitude: branch.latitude !== undefined ? String(branch.latitude) : '',
      longitude: branch.longitude !== undefined ? String(branch.longitude) : '',
      radiusInMeters: String(branch.radiusInMeters ?? DEFAULT_RADIUS_IN_METERS),
      managerId: branch.managerId || '',
      shifts: (branch.shifts || []).join('\n'),
      qrEnabled: branch.qrEnabled === true,
      isActive: branch.isActive !== false,
    })
    setIsEditModalOpen(true)
  }

  const resolveManager = (managerId: string): { id?: string; name?: string } => {
    if (!managerId) return {}
    const emp = employees.find(e => (e.userId || e.id) === managerId)
    return { id: managerId, name: emp?.name || '' }
  }

  const onSubmitAdd = async (data: BranchFormData) => {
    setIsSubmitting(true)
    try {
      const manager = resolveManager(data.managerId)
      await createBranch({
        companyId: data.companyId,
        name: data.name.trim(),
        address: data.address.trim(),
        city: data.city.trim(),
        latitude: toOptionalNumber(data.latitude),
        longitude: toOptionalNumber(data.longitude),
        radiusInMeters: data.radiusInMeters.trim() === '' ? DEFAULT_RADIUS_IN_METERS : Number(data.radiusInMeters),
        managerId: manager.id || '',
        managerName: manager.name || '',
        shifts: parseShifts(data.shifts),
        qrEnabled: data.qrEnabled,
        // QR attendance on → the token the QR image encodes must exist before
        // anyone opens the QR modal, so mint it now if the branch has none.
        qrToken: data.qrEnabled ? generateQrToken() : '',
        isActive: data.isActive,
      })
      setIsAddModalOpen(false)
      reset(defaultFormValues())
      setToast({ type: 'success', message: 'Branch created successfully' })
    } catch (err) {
      console.error('Error adding branch:', err)
      setToast({ type: 'error', message: writeErrorMessage(err, 'add') })
    } finally {
      setIsSubmitting(false)
    }
  }

  const onSubmitEdit = async (data: BranchFormData) => {
    if (!selected) return
    setIsSubmitting(true)
    try {
      const manager = resolveManager(data.managerId)
      await updateBranch(selected.id, {
        companyId: data.companyId,
        name: data.name.trim(),
        address: data.address.trim(),
        city: data.city.trim(),
        latitude: toOptionalNumber(data.latitude),
        longitude: toOptionalNumber(data.longitude),
        radiusInMeters: data.radiusInMeters.trim() === '' ? DEFAULT_RADIUS_IN_METERS : Number(data.radiusInMeters),
        managerId: manager.id || '',
        managerName: manager.name || '',
        shifts: parseShifts(data.shifts),
        qrEnabled: data.qrEnabled,
        // Keep an existing token; mint one only when QR is on and there is none.
        qrToken: data.qrEnabled ? (selected.qrToken || generateQrToken()) : undefined,
        isActive: data.isActive,
      })
      setIsEditModalOpen(false)
      setSelected(null)
      setToast({ type: 'success', message: 'Branch updated successfully' })
    } catch (err) {
      console.error('Error updating branch:', err)
      setToast({ type: 'error', message: writeErrorMessage(err, 'update') })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this branch? This action cannot be undone.')) return
    try {
      await deleteBranch(id)
      setToast({ type: 'success', message: 'Branch deleted' })
    } catch (err) {
      console.error('Error deleting branch:', err)
      setToast({ type: 'error', message: writeErrorMessage(err, 'delete') })
    }
  }

  // ---- QR modal ----------------------------------------------------------------
  useEffect(() => {
    if (!isQrModalOpen || !selected?.qrToken) {
      setQrImage(null)
      setQrError(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(selected.qrToken, { width: 320, margin: 2 })
      .then(url => { if (!cancelled) { setQrImage(url); setQrError(null) } })
      .catch(err => {
        console.error('QR generation failed:', err)
        if (!cancelled) {
          setQrImage(null)
          setQrError('Could not render the QR code. The token below still works — copy it manually.')
        }
      })
    return () => { cancelled = true }
  }, [isQrModalOpen, selected])

  const openQr = (branch: Branch) => {
    setSelected(branch)
    setQrImage(null)
    setQrError(null)
    setIsQrModalOpen(true)
  }

  const handleRegenerateQr = async () => {
    if (!selected) return
    const verb = selected.qrToken ? 'Regenerate' : 'Generate'
    if (!window.confirm(`${verb} the QR code for "${selected.name}"? ${selected.qrToken ? 'The previous code will stop working immediately.' : ''}`.trim())) return
    setIsRegenerating(true)
    try {
      const token = await regenerateQrToken(selected.id)
      const next: Branch = { ...selected, qrToken: token }
      setSelected(next)
      setBranches(prev => prev.map(b => (b.id === next.id ? { ...b, qrToken: token } : b)))
      setToast({ type: 'success', message: `QR code ${selected.qrToken ? 'regenerated' : 'generated'}` })
    } catch (err) {
      console.error('Error regenerating QR token:', err)
      setToast({ type: 'error', message: writeErrorMessage(err, 'update') })
    } finally {
      setIsRegenerating(false)
    }
  }

  const copyToken = async () => {
    if (!selected?.qrToken) return
    try {
      await navigator.clipboard.writeText(selected.qrToken)
      setToast({ type: 'success', message: 'QR token copied to clipboard' })
    } catch {
      setToast({ type: 'error', message: 'Could not copy automatically — select the token and copy it manually.' })
    }
  }

  const handleFilterClick = (filter: StatusFilter) => {
    setStatusFilter(prev => (prev === filter && filter !== 'all' ? 'all' : filter))
    setCurrentPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const badge = (label: string, background: string, color: string) => (
    <span className="status-badge-table" style={{ background, color }}>{label}</span>
  )

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Branches" breadcrumbs={['Dashboard', 'Branches']} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading branches...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Branches" breadcrumbs={['Dashboard', 'Branches']} />

      <div className="page-content">
        {error && (
          <div className="error-banner" style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><X size={16} /></button>
          </div>
        )}

        <ScopeIndicator />

        {/* stats-row is repeat(auto-fit, minmax(200px,1fr)) so it reflows to a
            single column on phones — never hard-code a 3-column grid here. */}
        <div className="stats-row">
          <div
            className="stat-card-companies"
            onClick={() => handleFilterClick('all')}
            style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'all' ? '2px solid #f97316' : '2px solid transparent', boxShadow: statusFilter === 'all' ? '0 0 0 3px rgba(249,115,22,0.15)' : 'none' }}
          >
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#eff6ff', color: '#3b82f6' }}><Network size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">Total Branches</span>
                <span className="stat-value">{stats.total}</span>
              </div>
            </div>
          </div>
          <div
            className="stat-card-companies"
            onClick={() => handleFilterClick('active')}
            style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'active' ? '2px solid #10b981' : '2px solid transparent', boxShadow: statusFilter === 'active' ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none' }}
          >
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#ecfdf5', color: '#10b981' }}><CheckCircle size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">Active</span>
                <span className="stat-value">{stats.active}</span>
              </div>
            </div>
          </div>
          <div
            className="stat-card-companies"
            onClick={() => handleFilterClick('inactive')}
            style={{ cursor: 'pointer', transition: 'all 0.15s', border: statusFilter === 'inactive' ? '2px solid #f59e0b' : '2px solid transparent', boxShadow: statusFilter === 'inactive' ? '0 0 0 3px rgba(245,158,11,0.15)' : 'none' }}
          >
            <div className="stat-card-content">
              <div className="stat-icon-wrapper" style={{ background: '#fffbeb', color: '#f59e0b' }}><XCircle size={24} /></div>
              <div className="stat-details">
                <span className="stat-label">Inactive</span>
                <span className="stat-value">{stats.inactive}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="companies-section">
          <div className="section-header-companies">
            <h3>All Branches</h3>
            <div className="section-actions">
              {canWrite && (
                <button className="btn-primary" onClick={openAdd}>
                  <Plus size={16} />
                  Add Branch
                </button>
              )}
            </div>
          </div>

          <div className="filters-row">
            <div className="search-filter">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search by name or city..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
            <div className="search-filter" style={{ minWidth: 200 }}>
              <Building2 size={16} />
              <select
                value={companyId}
                onChange={e => { setSelectedCompanyId(e.target.value || ''); setCurrentPage(1) }}
                // padding-left must clear the absolute .search-filter svg
                // (left:12px, 16px wide → ends at 28px).
                style={{ width: '100%', padding: '10px 12px 10px 40px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, background: '#fff' }}
              >
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {urlCompanyId && !availableCompanies.some(c => c.id === urlCompanyId) && (
                  <option value={urlCompanyId}>{urlCompanyId}</option>
                )}
              </select>
            </div>
          </div>

          {/* Status filter chips — horizontally scrollable so they stay usable
              at 360px instead of wrapping into an unreadable column stack. */}
          <div
            className="filter-chips"
            style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16, WebkitOverflowScrolling: 'touch' }}
          >
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { setStatusFilter(f.key); setCurrentPage(1) }}
                  style={{
                    flex: '0 0 auto',
                    whiteSpace: 'nowrap',
                    padding: '8px 16px',
                    borderRadius: 999,
                    border: active ? '1px solid #f97316' : '1px solid #e5e7eb',
                    background: active ? '#fff7ed' : '#fff',
                    color: active ? '#c2410c' : '#374151',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {f.label}
                  <span style={{ opacity: 0.65, marginLeft: 6 }}>{statusCount(f.key)}</span>
                </button>
              )
            })}
          </div>

          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('name')}>
                    Branch Name <SortIcon field="name" />
                  </th>
                  <th>Address / City</th>
                  <th>Geofence</th>
                  <th>Manager</th>
                  <th>Shifts</th>
                  <th>QR</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((branch, idx) => (
                  <tr key={branch.id || `branch-${idx}`}>
                    <td>
                      <div className="company-details">
                        <span className="company-name">{branch.name}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 13, color: '#374151', display: 'block', maxWidth: 240 }}>
                        {branch.address || '—'}
                        {branch.city && (
                          <span className="company-domain" style={{ display: 'block' }}>{branch.city}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="company-domain" style={{ display: 'block' }}>
                        {branch.latitude !== undefined && branch.longitude !== undefined
                          ? `${branch.latitude.toFixed(5)}, ${branch.longitude.toFixed(5)}`
                          : 'No coordinates'}
                      </span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>Radius {branch.radiusInMeters} m</span>
                    </td>
                    <td><span className="admin-name">{branch.managerName || '—'}</span></td>
                    <td>
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        {branch.shifts.length > 0 ? branch.shifts.join(', ') : '—'}
                      </span>
                    </td>
                    <td>
                      {branch.qrEnabled
                        ? badge('QR On', '#ecfdf5', '#047857')
                        : badge('QR Off', '#f3f4f6', '#6b7280')}
                    </td>
                    <td>
                      {branch.isActive
                        ? badge('Active', '#ecfdf5', '#047857')
                        : badge('Inactive', '#fef2f2', '#b91c1c')}
                    </td>
                    <td><span className="company-domain">{formatDate(branch.createdAt)}</span></td>
                    <td>
                      <div className="action-buttons">
                        <button className="action-btn view" onClick={() => { setSelected(branch); setIsViewModalOpen(true) }} title="View"><Eye size={16} /></button>
                        {canWrite && (
                          <button className="action-btn edit" onClick={() => openEdit(branch)} title="Edit"><Pencil size={16} /></button>
                        )}
                        <button className="action-btn" onClick={() => openQr(branch)} title="View QR code" style={{ color: '#8b5cf6' }}><QrCode size={16} /></button>
                        {canWrite && (
                          <button className="action-btn delete" onClick={() => handleDelete(branch.id)} title="Delete"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                      {searchTerm || statusFilter !== 'all'
                        ? 'No branches found matching your filters.'
                        : `No branches found${companyName ? ` for ${companyName}` : ''}. Click "Add Branch" to create one.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="showing-text">
                Showing {filteredData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} branches
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

      {/* Add Branch Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => { setIsAddModalOpen(false); reset(defaultFormValues()) }}
        title="Add New Branch"
        size="medium"
      >
        <form onSubmit={handleSubmit(onSubmitAdd)} className="modal-form">
          <div className="form-group">
            <label>Select Company *</label>
            <select {...register('companyId')} className={errors.companyId ? 'input-error' : ''}>
              <option value="">-- Select Company --</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.companyId && <span className="field-error">{errors.companyId.message}</span>}
          </div>
          <div className="form-group">
            <label>Branch Name *</label>
            <input type="text" {...register('name')} placeholder="e.g., Head Office" className={errors.name ? 'input-error' : ''} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="form-group">
            <label>Address *</label>
            <input type="text" {...register('address')} placeholder="Street, area, landmark" className={errors.address ? 'input-error' : ''} />
            {errors.address && <span className="field-error">{errors.address.message}</span>}
          </div>
          <div className="form-group">
            <label>City</label>
            <input type="text" {...register('city')} placeholder="Your city" />
            {errors.city && <span className="field-error">{errors.city.message}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label>Latitude</label>
              <input type="number" step="any" {...register('latitude')} placeholder="e.g., 19.0760" className={errors.latitude ? 'input-error' : ''} />
              {errors.latitude && <span className="field-error">{errors.latitude.message}</span>}
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label>Longitude</label>
              <input type="number" step="any" {...register('longitude')} placeholder="e.g., 72.8777" className={errors.longitude ? 'input-error' : ''} />
              {errors.longitude && <span className="field-error">{errors.longitude.message}</span>}
            </div>
          </div>
          <div className="form-group">
            <label>Geofence Radius (metres, 50–500)</label>
            <input type="number" min={50} max={500} step={1} {...register('radiusInMeters')} className={errors.radiusInMeters ? 'input-error' : ''} />
            {errors.radiusInMeters && <span className="field-error">{errors.radiusInMeters.message}</span>}
          </div>
          <div className="form-group">
            <label>Branch Manager</label>
            <select {...register('managerId')}>
              <option value="">-- Select Manager --</option>
              {employees
                .filter(e => !watchCompanyId || e.companyId === watchCompanyId)
                .map((emp, idx) => (
                  <option key={emp.id || emp.userId || `emp-${idx}`} value={emp.userId || emp.id}>
                    {emp.name} ({emp.employeeId})
                  </option>
                ))}
            </select>
          </div>
          <div className="form-group">
            <label>Shifts (one per line)</label>
            <textarea {...register('shifts')} rows={3} placeholder={'09:00-18:00\n10:00-19:00'} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>Applicable shift labels for this branch, one per line.</span>
            {errors.shifts && <span className="field-error">{errors.shifts.message}</span>}
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" {...register('qrEnabled')} />
              QR attendance (employees scan this branch's QR code at check-in)
            </label>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" {...register('isActive')} />
              Active
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => { setIsAddModalOpen(false); reset(defaultFormValues()) }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Add Branch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Branch Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setSelected(null) }}
        title="Edit Branch"
        size="medium"
      >
        <form onSubmit={handleSubmit(onSubmitEdit)} className="modal-form">
          <div className="form-group">
            <label>Select Company *</label>
            <select {...register('companyId')} className={errors.companyId ? 'input-error' : ''}>
              <option value="">-- Select Company --</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.companyId && <span className="field-error">{errors.companyId.message}</span>}
          </div>
          <div className="form-group">
            <label>Branch Name *</label>
            <input type="text" {...register('name')} placeholder="e.g., Head Office" className={errors.name ? 'input-error' : ''} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="form-group">
            <label>Address *</label>
            <input type="text" {...register('address')} placeholder="Street, area, landmark" className={errors.address ? 'input-error' : ''} />
            {errors.address && <span className="field-error">{errors.address.message}</span>}
          </div>
          <div className="form-group">
            <label>City</label>
            <input type="text" {...register('city')} placeholder="Your city" />
            {errors.city && <span className="field-error">{errors.city.message}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label>Latitude</label>
              <input type="number" step="any" {...register('latitude')} placeholder="e.g., 19.0760" className={errors.latitude ? 'input-error' : ''} />
              {errors.latitude && <span className="field-error">{errors.latitude.message}</span>}
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label>Longitude</label>
              <input type="number" step="any" {...register('longitude')} placeholder="e.g., 72.8777" className={errors.longitude ? 'input-error' : ''} />
              {errors.longitude && <span className="field-error">{errors.longitude.message}</span>}
            </div>
          </div>
          <div className="form-group">
            <label>Geofence Radius (metres, 50–500)</label>
            <input type="number" min={50} max={500} step={1} {...register('radiusInMeters')} className={errors.radiusInMeters ? 'input-error' : ''} />
            {errors.radiusInMeters && <span className="field-error">{errors.radiusInMeters.message}</span>}
          </div>
          <div className="form-group">
            <label>Branch Manager</label>
            <select {...register('managerId')}>
              <option value="">-- Select Manager --</option>
              {employees
                .filter(e => !watchCompanyId || e.companyId === watchCompanyId)
                .map((emp, idx) => (
                  <option key={emp.id || emp.userId || `emp-edit-${idx}`} value={emp.userId || emp.id}>
                    {emp.name} ({emp.employeeId})
                  </option>
                ))}
            </select>
          </div>
          <div className="form-group">
            <label>Shifts (one per line)</label>
            <textarea {...register('shifts')} rows={3} placeholder={'09:00-18:00\n10:00-19:00'} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>Applicable shift labels for this branch, one per line.</span>
            {errors.shifts && <span className="field-error">{errors.shifts.message}</span>}
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" {...register('qrEnabled')} />
              QR attendance (employees scan this branch's QR code at check-in)
            </label>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" {...register('isActive')} />
              Active
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => { setIsEditModalOpen(false); setSelected(null) }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Branch Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => { setIsViewModalOpen(false); setSelected(null) }}
        title="Branch Details"
        size="medium"
      >
        {selected && (
          <div className="modal-form">
            <div className="form-group">
              <label>Branch Name</label>
              <div className="field-value" style={{ fontWeight: 600 }}>{selected.name}</div>
            </div>
            <div className="form-group">
              <label>Company</label>
              <div className="field-value">{availableCompanies.find(c => c.id === selected.companyId)?.name || selected.companyId || '—'}</div>
            </div>
            <div className="form-group">
              <label>Address</label>
              <div className="field-value">{selected.address || '—'}</div>
            </div>
            <div className="form-group">
              <label>City</label>
              <div className="field-value">{selected.city || '—'}</div>
            </div>
            <div className="form-group">
              <label>Geofence</label>
              <div className="field-value">
                {selected.latitude !== undefined && selected.longitude !== undefined
                  ? `${selected.latitude}, ${selected.longitude} · radius ${selected.radiusInMeters} m`
                  : `No coordinates set · radius ${selected.radiusInMeters} m`}
              </div>
            </div>
            <div className="form-group">
              <label>Branch Manager</label>
              <div className="field-value">{selected.managerName || 'Not assigned'}</div>
            </div>
            <div className="form-group">
              <label>Shifts</label>
              <div className="field-value">
                {selected.shifts.length > 0 ? selected.shifts.join(', ') : 'None configured'}
              </div>
            </div>
            <div className="form-group">
              <label>QR Attendance</label>
              <div className="field-value">
                {selected.qrEnabled ? badge('QR On', '#ecfdf5', '#047857') : badge('QR Off', '#f3f4f6', '#6b7280')}
              </div>
            </div>
            <div className="form-group">
              <label>QR Token</label>
              <div className="field-value" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selected.qrToken || '—'}</div>
            </div>
            <div className="form-group">
              <label>Status</label>
              <div className="field-value">
                {selected.isActive ? badge('Active', '#ecfdf5', '#047857') : badge('Inactive', '#fef2f2', '#b91c1c')}
              </div>
            </div>
            <div className="form-group">
              <label>Created</label>
              <div className="field-value">{formatDateTime(selected.createdAt)}</div>
            </div>
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={() => { setIsViewModalOpen(false); setSelected(null) }}>Close</button>
        </div>
      </Modal>

      {/* QR Modal */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => { setIsQrModalOpen(false); setSelected(null); setQrImage(null); setQrError(null) }}
        title="Branch QR Code"
        size="medium"
      >
        {selected && (
          <div className="modal-form">
            <div className="form-group">
              <label>Branch</label>
              <div className="field-value" style={{ fontWeight: 600 }}>{selected.name}</div>
            </div>
            <div className="form-group">
              <label>Address</label>
              <div className="field-value">
                {[selected.address, selected.city].filter(Boolean).join(', ') || '—'}
              </div>
            </div>
            <div className="form-group">
              <label>QR Code</label>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
                {!selected.qrToken ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
                    QR attendance has no code yet. Use "Generate QR code" below (or turn QR attendance on while editing this branch).
                  </p>
                ) : qrImage ? (
                  <img src={qrImage} alt={`QR code for ${selected.name}`} style={{ width: 240, maxWidth: '100%', height: 'auto' }} />
                ) : qrError ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#b91c1c', textAlign: 'center' }}>{qrError}</p>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                    <Loader2 size={16} className="animate-spin" /> Generating QR code...
                  </div>
                )}
                <p style={{ margin: 0, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
                  This is the code employees scan at check-in — print it or display it at the branch entrance.
                </p>
              </div>
            </div>
            {selected.qrToken && (
              <div className="form-group">
                <label>QR Token</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ flex: '1 1 200px', minWidth: 0, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontSize: 13, wordBreak: 'break-all' }}>
                    {selected.qrToken}
                  </code>
                  <button type="button" className="btn-secondary" onClick={copyToken}>
                    <Copy size={14} /> Copy
                  </button>
                </div>
              </div>
            )}
            {!selected.qrEnabled && (
              <p style={{ margin: 0, fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                QR attendance is turned off for this branch — employees cannot check in with it yet.
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setIsQrModalOpen(false); setSelected(null); setQrImage(null); setQrError(null) }}
              >
                Close
              </button>
              {canWrite && (
                <button type="button" className="btn-primary" onClick={handleRegenerateQr} disabled={isRegenerating}>
                  {isRegenerating
                    ? <><Loader2 size={16} className="animate-spin" /> Saving...</>
                    : <><RefreshCw size={16} /> {selected.qrToken ? 'Regenerate QR code' : 'Generate QR code'}</>}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
