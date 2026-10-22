import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Package, Search, Plus, Eye, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, Filter, Download, X,
  Laptop, Monitor, Smartphone, CreditCard, Truck, Printer,
  ScanLine, Fingerprint, Armchair, Wrench, KeyRound,
  Building2, MapPin, Calendar, DollarSign,
  UserCheck, AlertTriangle, RotateCcw, CheckCircle2, Clock, Wifi
} from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { ActionErrorBanner } from '../components/ActionErrorBanner'
import { errText } from '../aws/errors'
import { useAuth } from '../context/AuthContext'
import { useAccessControl } from '../context/AccessControlContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../config/firebase'
import { isDate } from '../utils/dateUtils'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import './Employees.css'
import './Assets.css'

interface Asset {
  id: string
  name: string
  category: string
  serialNumber: string
  assetTag: string
  status: string
  assignedTo: string
  assignedToName: string
  assignedDate: string
  location: string
  purchaseDate: string
  purchaseCost: number
  currentValue: number
  vendor: string
  warrantyExpiry: string
  notes: string
  companyId: string
  createdAt: any
  returnDate: string
  condition: string
}

const ASSET_CATEGORIES = [
  'Laptop', 'Desktop', 'Mobile', 'SIM Card', 'Vehicle', 'Printer',
  'Scanner', 'Biometric Device', 'Furniture', 'Office Equipment',
  'Software License', 'ID Card', 'Access Card', 'Other Assets'
]

const ASSET_STATUSES = ['Available', 'Assigned', 'In Repair', 'Damaged', 'Returned', 'Lost']
const CONDITION_OPTIONS = ['Excellent', 'Good', 'Fair', 'Poor']

const CATEGORY_ICONS: Record<string, any> = {
  'Laptop': Laptop,
  'Desktop': Monitor,
  'Mobile': Smartphone,
  'SIM Card': Wifi,
  'Vehicle': Truck,
  'Printer': Printer,
  'Scanner': ScanLine,
  'Biometric Device': Fingerprint,
  'Furniture': Armchair,
  'Office Equipment': Wrench,
  'Software License': KeyRound,
  'ID Card': CreditCard,
  'Access Card': Building2,
  'Other Assets': Package,
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Available': return { bg: '#e0f2fe', text: '#0284c7' }
    case 'Assigned': return { bg: '#dcfce7', text: '#16a34a' }
    case 'In Repair': return { bg: '#ffedd5', text: '#f97316' }
    case 'Damaged': return { bg: '#fee2e2', text: '#ef4444' }
    case 'Returned': return { bg: '#f3f4f6', text: '#6b7280' }
    case 'Lost': return { bg: '#fce7f3', text: '#db2777' }
    default: return { bg: '#f3f4f6', text: '#6b7280' }
  }
}

const INITIAL_FORM_DATA = (): Omit<Asset, 'id' | 'createdAt'> => ({
  name: '',
  category: '',
  serialNumber: '',
  assetTag: '',
  status: 'Available',
  assignedTo: '',
  assignedToName: '',
  assignedDate: '',
  location: '',
  purchaseDate: '',
  purchaseCost: 0,
  currentValue: 0,
  vendor: '',
  warrantyExpiry: '',
  notes: '',
  companyId: '',
  returnDate: '',
  condition: 'Good',
})

const generateAssetTag = (existingAssets: Asset[]): string => {
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const prefix = `AST-${dateStr}-`
  const existingNums = existingAssets
    .filter(a => a.assetTag.startsWith(prefix))
    .map(a => {
      const num = parseInt(a.assetTag.replace(prefix, ''), 10)
      return isNaN(num) ? 0 : num
    })
  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1
  return `${prefix}${String(nextNum).padStart(3, '0')}`
}

const formatDate = (val: any): string => {
  if (!val) return '-'
  if (val.toDate && typeof val.toDate === 'function') return val.toDate().toLocaleDateString()
  if (isDate(val)) return val.toLocaleDateString()
  if (typeof val === 'string') return val
  return '-'
}

const formatCurrency = (val: number): string => {
  if (!val && val !== 0) return '-'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val)
}

export function Assets() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { canPerform } = useAccessControl()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('assets')
  const companyId = effectiveCompanyId || searchParams.get('company') || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategory, setFilterCategory] = useState(searchParams.get('category') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '')
  const [filterLocation, setFilterLocation] = useState('')

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    if (status) setFilterStatus(status)
    if (category) setFilterCategory(category)
  }, [searchParams])

  const fetchAssets = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // Scope: selected company, or ALL authorized companies in "All Companies" mode
      const toList = (snapshot: any) => snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as Asset))
      if (user?.role === 'master-admin') {
        const snapshot = await getDocs(collection(db, 'assets'))
        setAssets(toList(snapshot))
      } else {
        const scopeIds = scopedCompanyIds(effectiveCompanyId, availableCompanies)
        if (scopeIds.length === 0) {
          const snapshot = await getDocs(collection(db, 'assets'))
          setAssets(toList(snapshot))
        } else {
          const mergedMap = new Map<string, Asset>()
          await Promise.all(chunkCompanyIds(scopeIds).map(async chunk => {
            const snapshot = await getDocs(query(collection(db, 'assets'), companyIdWhere(chunk)!))
            snapshot.docs.forEach(d => mergedMap.set(d.id, { id: d.id, ...d.data() } as Asset))
          }))
          setAssets([...mergedMap.values()])
        }
      }
    } catch (err: any) {
      console.error(err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError(`Access denied. You do not have permission to view assets${companyName ? ` for ${companyName}` : ''}.`)
      } else if (err?.code === 'unavailable' || err?.message?.includes('timeout')) {
        setError('Request timed out. Please check your connection and try again.')
      } else {
        setError('Failed to load assets.')
      }
    } finally {
      setLoading(false)
    }
  }, [companyId, effectiveCompanyId, availableCompanies, user?.role])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  const stats = {
    total: assets.length,
    assigned: assets.filter(a => a.status === 'Assigned').length,
    available: assets.filter(a => a.status === 'Available').length,
    damaged: assets.filter(a => a.status === 'Damaged').length,
    returned: assets.filter(a => a.status === 'Returned').length,
    pendingReturns: assets.filter(a => a.status === 'In Repair').length,
  }

  const uniqueLocations = [...new Set(assets.map(a => a.location).filter(Boolean))].sort()

  const getFiltered = () => {
    return assets.filter(a => {
      if (searchTerm) {
        const s = searchTerm.toLowerCase()
        const match = a.name?.toLowerCase().includes(s) ||
          a.assetTag?.toLowerCase().includes(s) ||
          a.serialNumber?.toLowerCase().includes(s) ||
          a.assignedToName?.toLowerCase().includes(s) ||
          a.vendor?.toLowerCase().includes(s) ||
          a.category?.toLowerCase().includes(s)
        if (!match) return false
      }
      if (filterCategory && a.category !== filterCategory) return false
      if (filterStatus && a.status !== filterStatus) return false
      if (filterLocation && a.location !== filterLocation) return false
      return true
    })
  }

  const filtered = getFiltered()
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (p: number) => { if (p >= 1 && p <= totalPages) setCurrentPage(p) }

  const handleStatClick = (param: string, value: string) => {
    setSearchParams({ [param]: value })
  }

  const handleExport = () => {
    const csv = [
      ['Asset Tag', 'Name', 'Category', 'Serial Number', 'Status', 'Assigned To', 'Assigned Date', 'Location', 'Purchase Date', 'Purchase Cost', 'Current Value', 'Vendor', 'Warranty Expiry', 'Condition', 'Notes'].join(','),
      ...filtered.map(a => [
        a.assetTag, a.name, a.category, a.serialNumber, a.status,
        a.assignedToName || '-', a.assignedDate || '-', a.location || '-',
        a.purchaseDate || '-', a.purchaseCost || 0, a.currentValue || 0,
        a.vendor || '-', a.warrantyExpiry || '-', a.condition || '-', a.notes || '-'
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'assets.csv'
    link.click()
  }

  const openAdd = () => {
    setFormData({
      ...INITIAL_FORM_DATA(),
      assetTag: generateAssetTag(assets),
      companyId: companyId || '',
    })
    setIsAddModalOpen(true)
  }

  const openEdit = (a: Asset) => {
    setSelectedAsset(a)
    setFormData({
      name: a.name || '',
      category: a.category || '',
      serialNumber: a.serialNumber || '',
      assetTag: a.assetTag || '',
      status: a.status || 'Available',
      assignedTo: a.assignedTo || '',
      assignedToName: a.assignedToName || '',
      assignedDate: a.assignedDate || '',
      location: a.location || '',
      purchaseDate: a.purchaseDate || '',
      purchaseCost: a.purchaseCost || 0,
      currentValue: a.currentValue || 0,
      vendor: a.vendor || '',
      warrantyExpiry: a.warrantyExpiry || '',
      notes: a.notes || '',
      companyId: a.companyId || '',
      returnDate: a.returnDate || '',
      condition: a.condition || 'Good',
    })
    setIsEditModalOpen(true)
  }

  const openView = (a: Asset) => {
    setSelectedAsset(a)
    setIsViewModalOpen(true)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError(null)
    setIsSubmitting(true)
    try {
      const id = formData.assetTag || generateAssetTag(assets)
      await setDoc(doc(db, 'assets', id), {
        ...formData,
        createdAt: new Date(),
      })
      await fetchAssets()
      setIsAddModalOpen(false)
    } catch (err) {
      console.error(err)
      setActionError(errText(err, 'Failed to add asset. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAsset) return
    setIsSubmitting(true)
    try {
      await updateDoc(doc(db, 'assets', selectedAsset.id), {
        ...formData,
      })
      await fetchAssets()
      setIsEditModalOpen(false)
      setSelectedAsset(null)
    } catch (err) {
      console.error(err)
      setActionError(errText(err, 'Failed to update asset. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (a: Asset) => {
    if (!confirm(`Delete asset "${a.name}" (${a.assetTag})? This action cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'assets', a.id))
      await fetchAssets()
    } catch (err) {
      console.error(err)
      setActionError(errText(err, 'Failed to delete asset. Please try again.'))
    }
  }

  const clearFilters = () => {
    setSearchTerm('')
    setFilterCategory('')
    setFilterStatus('')
    setFilterLocation('')
    setSearchParams({})
    setCurrentPage(1)
  }

  const activeFilters = [filterCategory, filterStatus, filterLocation].filter(Boolean).length

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Assets" breadcrumbs={['Dashboard', 'Assets']} />
        <div className="loading-container"><Loader2 className="spin" size={32} /><p>Loading assets...</p></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Assets" breadcrumbs={['Dashboard', 'Assets']} />
        <div className="loading-container"><AlertTriangle size={32} color="#ef4444" /><p>{error}</p><button onClick={fetchAssets} className="btn-primary" style={{ marginTop: 12 }}>Retry</button></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Assets" breadcrumbs={['Dashboard', 'Assets']} />

      <div className="page-content">
        <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        {/* Stats Cards */}
        <div className="emp-stats-row asset-stats-row">
          <div className="emp-mini-stat asset-stat-card" onClick={() => handleStatClick('status', 'Assigned')} style={{ cursor: 'pointer' }}>
            <UserCheck size={20} /><div><strong>{stats.total}</strong><span>Total Assets</span></div>
          </div>
          <div className="emp-mini-stat asset-stat-card" onClick={() => handleStatClick('status', 'Assigned')} style={{ cursor: 'pointer' }}>
            <CheckCircle2 size={20} /><div><strong>{stats.assigned}</strong><span>Assigned</span></div>
          </div>
          <div className="emp-mini-stat asset-stat-card" onClick={() => handleStatClick('status', 'Available')} style={{ cursor: 'pointer' }}>
            <Package size={20} /><div><strong>{stats.available}</strong><span>Available</span></div>
          </div>
          <div className="emp-mini-stat asset-stat-card" onClick={() => handleStatClick('status', 'Damaged')} style={{ cursor: 'pointer' }}>
            <AlertTriangle size={20} /><div><strong>{stats.damaged}</strong><span>Damaged</span></div>
          </div>
          <div className="emp-mini-stat asset-stat-card" onClick={() => handleStatClick('status', 'Returned')} style={{ cursor: 'pointer' }}>
            <RotateCcw size={20} /><div><strong>{stats.returned}</strong><span>Returned</span></div>
          </div>
          <div className="emp-mini-stat asset-stat-card" style={{ cursor: 'default' }}>
            <Clock size={20} /><div><strong>{stats.pendingReturns}</strong><span>In Repair</span></div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search by name, tag, serial, assignee, vendor..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
            {searchTerm && <button className="emp-clear-btn" onClick={() => setSearchTerm('')}><X size={14} /></button>}
          </div>
          <div className="emp-toolbar-actions">
            <div className="emp-filter-group">
              <Building2 size={16} />
              <select value={companyId} onChange={e => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <Filter size={16} />
              <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setCurrentPage(1) }}>
                <option value="">All Categories</option>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); if (e.target.value) setSearchParams({ status: e.target.value }); else setSearchParams({}); }}>
                <option value="">All Status</option>
                {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="emp-filter-group">
              <MapPin size={16} />
              <select value={filterLocation} onChange={e => { setFilterLocation(e.target.value); setCurrentPage(1) }}>
                <option value="">All Locations</option>
                {uniqueLocations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            {activeFilters > 0 && <button className="emp-clear-filters" onClick={clearFilters}>Clear ({activeFilters})</button>}
          </div>
        </div>

        {/* Actions Bar */}
        <div className="emp-actions-bar">
          <div className="emp-actions-left">
            <span style={{ fontSize: 13, color: '#6b7280' }}>{filtered.length} asset{filtered.length !== 1 ? 's' : ''} found</span>
          </div>
          <div className="emp-actions-right">
            <button className="btn-outline btn-sm" onClick={handleExport} disabled={filtered.length === 0}><Download size={14} /> Export CSV</button>
            {canPerform('create', 'assets') && (
              <button className="btn-primary btn-sm" onClick={openAdd}><Plus size={16} /> Add Asset</button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="table-container">
          <table className="emp-table">
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Name</th>
                <th>Category</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="emp-empty">
                      <Package size={48} />
                      <h4>No assets found{companyName ? ` for ${companyName}` : ''}</h4>
                      <p>Click 'Add Asset' to create your first asset.</p>
                      {canPerform('create', 'assets') && (
                        <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Asset</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : paginated.map(a => {
                const sc = getStatusColor(a.status)
                const CatIcon = CATEGORY_ICONS[a.category] || Package
                return (
                  <tr key={a.id}>
                    <td><span className="emp-id-badge">{a.assetTag || '-'}</span></td>
                    <td>
                      <div className="emp-name-cell">
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <CatIcon size={16} color="#f97316" />
                        </div>
                        <div>
                          <span className="emp-name">{a.name}</span>
                          <span className="emp-sub">{a.serialNumber || 'No serial'}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className="emp-dept-badge" style={{ background: '#fff7ed', color: '#ea580c' }}>{a.category}</span></td>
                    <td>{a.assignedToName || '-'}</td>
                    <td><span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{a.status}</span></td>
                    <td><span className="emp-date-cell">{a.location || '-'}</span></td>
                    <td>
                      <div className="emp-actions">
                        <button className="emp-action-icon view" onClick={() => openView(a)} title="View"><Eye size={15} /></button>
                        {canPerform('edit', 'assets') && (
                          <button className="emp-action-icon edit" onClick={() => openEdit(a)} title="Edit"><Pencil size={15} /></button>
                        )}
                        {canPerform('delete', 'assets') && (
                          <button className="emp-action-icon delete" onClick={() => handleDelete(a)} title="Delete"><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="emp-pagination">
          <div className="emp-page-info">
            <span>Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
          <div className="emp-page-controls">
            <button disabled={currentPage === 1} onClick={() => handlePageChange(1)}><ChevronLeft size={14} /></button>
            <button disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1).map((p, i, arr) => (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {i > 0 && arr[i - 1] !== p - 1 && <span className="emp-page-dots">...</span>}
                <button className={`emp-page-btn${currentPage === p ? ' active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
              </span>
            ))}
            <button disabled={currentPage >= totalPages} onClick={() => handlePageChange(currentPage + 1)}><ChevronRight size={14} /></button>
            <button disabled={currentPage >= totalPages} onClick={() => handlePageChange(totalPages)}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Asset" size="large">
        <AssetForm formData={formData} setFormData={setFormData} onSubmit={handleAdd} submitLabel={isSubmitting ? 'Adding...' : 'Add Asset'} isSubmitting={isSubmitting} />
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Asset" size="large">
        <AssetForm formData={formData} setFormData={setFormData} onSubmit={handleEdit} submitLabel={isSubmitting ? 'Saving...' : 'Save Changes'} isSubmitting={isSubmitting} />
      </Modal>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Asset Details" size="large">
        {selectedAsset && (() => {
          const sc = getStatusColor(selectedAsset.status)
          const CatIcon = CATEGORY_ICONS[selectedAsset.category] || Package
          return (
            <div className="emp-profile">
              <div className="emp-profile-header">
                <div style={{ width: 64, height: 64, borderRadius: 12, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <CatIcon size={28} color="#f97316" />
                </div>
                <div>
                  <h2>{selectedAsset.name}</h2>
                  <p>{selectedAsset.category} &middot; {selectedAsset.assetTag}</p>
                  <span className="emp-status-badge" style={{ background: sc.bg, color: sc.text }}>{selectedAsset.status}</span>
                </div>
              </div>
              <div className="emp-profile-grid">
                <div className="emp-profile-section">
                  <h4><Package size={16} /> Asset Info</h4>
                  <div className="emp-profile-fields">
                    <div><label>Asset Tag</label><span>{selectedAsset.assetTag || '-'}</span></div>
                    <div><label>Name</label><span>{selectedAsset.name}</span></div>
                    <div><label>Category</label><span>{selectedAsset.category}</span></div>
                    <div><label>Serial Number</label><span>{selectedAsset.serialNumber || '-'}</span></div>
                    <div><label>Condition</label><span>{selectedAsset.condition || '-'}</span></div>
                    <div><label>Location</label><span>{selectedAsset.location || '-'}</span></div>
                  </div>
                </div>
                <div className="emp-profile-section">
                  <h4><UserCheck size={16} /> Assignment</h4>
                  <div className="emp-profile-fields">
                    <div><label>Assigned To</label><span>{selectedAsset.assignedToName || 'Unassigned'}</span></div>
                    <div><label>Assigned Date</label><span>{formatDate(selectedAsset.assignedDate)}</span></div>
                    <div><label>Status</label><span style={{ color: sc.text }}>{selectedAsset.status}</span></div>
                    <div><label>Return Date</label><span>{formatDate(selectedAsset.returnDate)}</span></div>
                  </div>
                </div>
                <div className="emp-profile-section">
                  <h4><DollarSign size={16} /> Financial</h4>
                  <div className="emp-profile-fields">
                    <div><label>Purchase Date</label><span>{formatDate(selectedAsset.purchaseDate)}</span></div>
                    <div><label>Purchase Cost</label><span>{formatCurrency(selectedAsset.purchaseCost)}</span></div>
                    <div><label>Current Value</label><span>{formatCurrency(selectedAsset.currentValue)}</span></div>
                    <div><label>Vendor</label><span>{selectedAsset.vendor || '-'}</span></div>
                  </div>
                </div>
                <div className="emp-profile-section">
                  <h4><Calendar size={16} /> Warranty & Notes</h4>
                  <div className="emp-profile-fields">
                    <div><label>Warranty Expiry</label><span>{formatDate(selectedAsset.warrantyExpiry)}</span></div>
                    <div><label>Notes</label><span>{selectedAsset.notes || '-'}</span></div>
                  </div>
                </div>
                <div className="emp-profile-section" style={{ gridColumn: '1 / -1' }}>
                  <h4><Clock size={16} /> Timeline</h4>
                  <div className="emp-profile-fields">
                    <div><label>Created At</label><span>{formatDate(selectedAsset.createdAt)}</span></div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                {canPerform('edit', 'assets') && (
                  <button className="btn-primary btn-sm" onClick={() => { setIsViewModalOpen(false); openEdit(selectedAsset) }}><Pencil size={14} /> Edit</button>
                )}
                {canPerform('delete', 'assets') && (
                  <button className="btn-outline btn-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }} onClick={() => { setIsViewModalOpen(false); handleDelete(selectedAsset) }}><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

interface AssetFormProps {
  formData: Omit<Asset, 'id' | 'createdAt'>
  setFormData: React.Dispatch<React.SetStateAction<Omit<Asset, 'id' | 'createdAt'>>>
  onSubmit: (e: React.FormEvent) => void
  submitLabel: string
  isSubmitting: boolean
}

function AssetForm({ formData, setFormData, onSubmit, submitLabel, isSubmitting }: AssetFormProps) {
  return (
    <form onSubmit={onSubmit} className="modal-form">
      <div className="form-row">
        <div className="form-group">
          <label>Asset Name *</label>
          <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Dell Latitude 5420" required />
        </div>
        <div className="form-group">
          <label>Category *</label>
          <select value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.target.value }))} required>
            <option value="">Select Category</option>
            {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Asset Tag</label>
          <input type="text" value={formData.assetTag} onChange={e => setFormData(p => ({ ...p, assetTag: e.target.value }))} placeholder="Auto-generated" />
        </div>
        <div className="form-group">
          <label>Serial Number</label>
          <input type="text" value={formData.serialNumber} onChange={e => setFormData(p => ({ ...p, serialNumber: e.target.value }))} placeholder="Enter serial number" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Status</label>
          <select value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))}>
            {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Condition</label>
          <select value={formData.condition} onChange={e => setFormData(p => ({ ...p, condition: e.target.value }))}>
            {CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Assigned To (Employee ID)</label>
          <input type="text" value={formData.assignedTo} onChange={e => setFormData(p => ({ ...p, assignedTo: e.target.value }))} placeholder="Employee ID" />
        </div>
        <div className="form-group">
          <label>Assigned To (Name)</label>
          <input type="text" value={formData.assignedToName} onChange={e => setFormData(p => ({ ...p, assignedToName: e.target.value }))} placeholder="Employee name" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Assigned Date</label>
          <input type="date" value={formData.assignedDate} onChange={e => setFormData(p => ({ ...p, assignedDate: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Return Date</label>
          <input type="date" value={formData.returnDate} onChange={e => setFormData(p => ({ ...p, returnDate: e.target.value }))} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Location</label>
          <input type="text" value={formData.location} onChange={e => setFormData(p => ({ ...p, location: e.target.value }))} placeholder="Office / Floor / Room" />
        </div>
        <div className="form-group">
          <label>Vendor</label>
          <input type="text" value={formData.vendor} onChange={e => setFormData(p => ({ ...p, vendor: e.target.value }))} placeholder="Vendor name" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Purchase Date</label>
          <input type="date" value={formData.purchaseDate} onChange={e => setFormData(p => ({ ...p, purchaseDate: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Warranty Expiry</label>
          <input type="date" value={formData.warrantyExpiry} onChange={e => setFormData(p => ({ ...p, warrantyExpiry: e.target.value }))} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Purchase Cost (INR)</label>
          <input type="number" value={formData.purchaseCost || ''} onChange={e => setFormData(p => ({ ...p, purchaseCost: Number(e.target.value) || 0 }))} placeholder="0" />
        </div>
        <div className="form-group">
          <label>Current Value (INR)</label>
          <input type="number" value={formData.currentValue || ''} onChange={e => setFormData(p => ({ ...p, currentValue: Number(e.target.value) || 0 }))} placeholder="0" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Notes</label>
          <textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Additional notes..." rows={3} style={{ width: '100%', padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
      </div>

      <div className="modal-footer">
        <button type="submit" className="btn-primary" disabled={isSubmitting}>{submitLabel}</button>
      </div>
    </form>
  )
}