import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Search, Download, Eye, Trash2, Filter,
  Loader2, Building2, Users, FolderOpen, ChevronLeft, ChevronRight,
  AlertCircle, CheckCircle, X, ExternalLink
} from 'lucide-react'
import { collection, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { ref, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { getAllUsers } from '../services/authService'
import { isDate } from '../utils/dateUtils'
import './DocumentsManagement.css'

// ─── Types ─────────────────────────────────────────────────────────
interface DocRecord {
  id: string
  docName: string
  employeeName: string
  employeeId: string
  companyName: string
  department: string
  category: string
  subCategory: string
  fileUrl: string
  fileSize: string
  mimeType: string
  uploadDate: Date | null
  source: 'employee-field' | 'subcollection' | 'contract' | 'company'
  storagePath?: string
}

const CATEGORY_OPTIONS = ['All', 'Identity', 'Employment', 'Education', 'Experience', 'Bank', 'Corporate', 'Other']
const DEPARTMENT_OPTIONS = ['All', 'Design', 'Development', 'HR', 'Sales', 'Marketing', 'Finance', 'IT']
const PAGE_SIZE_OPTIONS = [10, 20, 50]

const categoryIcon = (cat: string) => {
  switch (cat) {
    case 'Identity': return FolderOpen
    case 'Employment': return FileText
    case 'Education': return FolderOpen
    case 'Experience': return Users
    case 'Bank': return Building2
    case 'Corporate': return Building2
    case 'Other': return FolderOpen
    default: return FileText
  }
}

const categoryColor = (cat: string) => {
  const m: Record<string, { bg: string; text: string }> = {
    Identity: { bg: '#fff7ed', text: '#f97316' },
    Employment: { bg: '#dcfce7', text: '#16a34a' },
    Education: { bg: '#eff6ff', text: '#3b82f6' },
    Experience: { bg: '#f5f3ff', text: '#8b5cf6' },
    Bank: { bg: '#fef3c7', text: '#d97706' },
    Corporate: { bg: '#fce7f3', text: '#ec4899' },
    Other: { bg: '#f3f4f6', text: '#6b7280' },
  }
  return m[cat] || { bg: '#f3f4f6', text: '#6b7280' }
}

const formatFileSize = (bytes: number) => {
  if (!bytes || bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const formatDate = (d: Date | null | undefined) => {
  if (!d) return '--'
  const date = isDate(d) ? d : new Date(d)
  if (isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Component ─────────────────────────────────────────────────────
export function DocumentsManagement() {
  const { user } = useAuth()
  const { canAccessAllCompanies, availableCompanies, effectiveCompanyId, selectedCompanyName } = usePermissionScope('documents')
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [companyFilter, setCompanyFilter] = useState('All')
  const [departmentFilter, setDepartmentFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [viewModal, setViewModal] = useState<DocRecord | null>(null)
  const [execManagedCompanyIds, setExecManagedCompanyIds] = useState<string[]>([])

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) } }, [toast])

  // Sync local company filter with global context
  useEffect(() => {
    setCompanyFilter(effectiveCompanyId || 'All')
  }, [effectiveCompanyId])

  // Role-based redirect — master-admin and executives can access
  useEffect(() => {
    const checkAccess = async () => {
      if (!user) return
      if (user.role === 'master-admin') return
      if (user.role === 'executive') {
        const all = await getAllUsers()
        const current = all.find(u => u.id === user.id)
        const ids: string[] = (current as any)?.assignedCompanyIds || []
        setExecManagedCompanyIds(ids)
        return
      }
      navigate('/unauthorized', { replace: true })
    }
    checkAccess()
  }, [user, navigate])

  // Determine allowed company IDs
  const allowedCompanyIds = user?.role === 'master-admin' ? null : execManagedCompanyIds

  // Fetch all data
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        // Fetch companies
        const companiesSnap = await getDocs(collection(db, 'companies'))
        const companyMap: Record<string, string> = {}
        const companyList: { id: string; name: string }[] = []
        companiesSnap.forEach(d => {
          const data = d.data() as any
          companyMap[d.id] = data.name || d.id
          companyList.push({ id: d.id, name: data.name || d.id })
        })
        setCompanies(companyList)

        // Fetch employees
        const employeesSnap = await getDocs(collection(db, 'employees'))
        const docs: DocRecord[] = []

        for (const empDoc of employeesSnap.docs) {
          const emp = empDoc.data() as any
          const empId = empDoc.id
          const empName = emp.name || 'Unknown'
          const empDept = emp.department || '--'
          const empCompanyId = emp.companyId || ''
          const empCompanyName = companyMap[empCompanyId] || '--'

          // Check employee document fields
          const docFields: { field: string; docName: string; category: string; subCategory: string }[] = [
            { field: 'aadharDoc', docName: 'Aadhar Card', category: 'Identity', subCategory: 'Aadhar' },
            { field: 'panDoc', docName: 'PAN Card', category: 'Identity', subCategory: 'PAN' },
            { field: 'joiningLetterDoc', docName: 'Joining Letter', category: 'Employment', subCategory: 'Joining Letter' },
            { field: 'offerLetterDoc', docName: 'Offer Letter', category: 'Employment', subCategory: 'Offer Letter' },
          ]

          for (const df of docFields) {
            const url = emp[df.field]
            if (url && typeof url === 'string' && url.startsWith('http')) {
              docs.push({
                id: `${empId}_${df.field}`,
                docName: df.docName,
                employeeName: empName,
                employeeId: emp.employeeId || empId,
                companyName: empCompanyName,
                department: empDept,
                category: df.category,
                subCategory: df.subCategory,
                fileUrl: url,
                fileSize: '--',
                mimeType: url.includes('.pdf') ? 'application/pdf' : 'image/*',
                uploadDate: emp.createdAt || emp.joinDate || null,
                source: 'employee-field',
                storagePath: `employees/${empId}/${df.field}`,
              })
            }
          }

          // Fetch employee subcollection documents
          try {
            const subDocsSnap = await getDocs(collection(db, 'employees', empId, 'documents'))
            subDocsSnap.forEach(sd => {
              const sdData = sd.data() as any
              if (sdData.fileUrl) {
                docs.push({
                  id: `${empId}_sub_${sd.id}`,
                  docName: sdData.name || 'Document',
                  employeeName: empName,
                  employeeId: emp.employeeId || empId,
                  companyName: empCompanyName,
                  department: empDept,
                  category: sdData.category || 'Other',
                  subCategory: sdData.category || 'Other',
                  fileUrl: sdData.fileUrl,
                  fileSize: formatFileSize(sdData.fileSize || 0),
                  mimeType: sdData.mimeType || '--',
                  uploadDate: sdData.uploadedAt?.toDate ? sdData.uploadedAt.toDate() : sdData.uploadedAt || null,
                  source: 'subcollection',
                })
              }
            })
          } catch {
            // Subcollection may not exist for some employees
          }

          // Fetch employee contracts with documentUrl
          try {
            const contractsSnap = await getDocs(collection(db, 'employees', empId, 'contracts'))
            contractsSnap.forEach(c => {
              const cData = c.data() as any
              if (cData.documentUrl) {
                docs.push({
                  id: `${empId}_contract_${c.id}`,
                  docName: `${cData.type || 'Contract'} Agreement`,
                  employeeName: empName,
                  employeeId: emp.employeeId || empId,
                  companyName: empCompanyName,
                  department: empDept,
                  category: 'Employment',
                  subCategory: 'Contract',
                  fileUrl: cData.documentUrl,
                  fileSize: '--',
                  mimeType: '--',
                  uploadDate: cData.createdAt?.toDate ? cData.createdAt.toDate() : cData.createdAt || null,
                  source: 'contract',
                })
              }
            })
          } catch {
            // Contracts subcollection may not exist
          }
        }

        if (user?.role === 'executive' && execManagedCompanyIds.length > 0) {
          const managedCompanyNames = new Set(companyList.filter(c => execManagedCompanyIds.includes(c.id)).map(c => c.name))
          setDocuments(docs.filter(d => managedCompanyNames.has(d.companyName)))
        } else {
          setDocuments(docs)
        }
      } catch (err) {
        console.error('Error fetching documents:', err)
        setToast({ type: 'error', message: 'Failed to load documents. Please try again.' })
      } finally {
        setLoading(false)
      }
    }

    if (user && (user.role === 'master-admin' || (user.role === 'executive' && execManagedCompanyIds.length > 0))) {
      fetchAll()
    }
  }, [user, execManagedCompanyIds])

  // ─── Derived ───────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: documents.length,
    identity: documents.filter(d => d.category === 'Identity').length,
    employment: documents.filter(d => d.category === 'Employment').length,
    other: documents.filter(d => !['Identity', 'Employment'].includes(d.category)).length,
  }), [documents])

  const filteredDocuments = useMemo(() => documents.filter(d => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      const matches = d.docName.toLowerCase().includes(q) ||
        d.employeeName.toLowerCase().includes(q) ||
        d.companyName.toLowerCase().includes(q) ||
        d.department.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.subCategory.toLowerCase().includes(q)
      if (!matches) return false
    }
    if (companyFilter !== 'All' && d.companyName !== companyFilter) return false
    if (departmentFilter !== 'All' && d.department !== departmentFilter) return false
    if (categoryFilter !== 'All' && d.category !== categoryFilter) return false
    return true
  }), [documents, searchTerm, companyFilter, departmentFilter, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize))
  const paginatedDocuments = filteredDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // ─── Actions ───────────────────────────────────────────────────
  const handleView = (doc: DocRecord) => {
    setViewModal(doc)
  }

  const handleDownload = (doc: DocRecord) => {
    const a = document.createElement('a')
    a.href = doc.fileUrl
    a.download = doc.docName
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleDelete = async (doc: DocRecord) => {
    if (!confirm(`Are you sure you want to delete "${doc.docName}"? This action cannot be undone.`)) return
    setDeletingId(doc.id)
    try {
      // Delete from Firebase Storage if it's an employee-field document
      if (doc.source === 'employee-field' && doc.storagePath) {
        const storageRef = ref(storage, doc.storagePath)
        await deleteObject(storageRef)
      }
      // Remove from local state
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
      setToast({ type: 'success', message: `Document "${doc.docName}" deleted successfully` })
    } catch (err) {
      console.error('Error deleting document:', err)
      setToast({ type: 'error', message: `Failed to delete "${doc.docName}". It may still exist in storage.` })
      // Still remove from UI even if storage delete fails
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
    } finally {
      setDeletingId(null)
    }
  }

  const handleExport = () => {
    const headers = ['Document Name', 'Employee Name', 'Employee ID', 'Company', 'Department', 'Category', 'Upload Date', 'File Size']
    const rows = filteredDocuments.map(d => [
      d.docName,
      d.employeeName,
      d.employeeId,
      d.companyName,
      d.department,
      d.category,
      formatDate(d.uploadDate),
      d.fileSize,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `documents-export-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
    setToast({ type: 'success', message: `Exported ${filteredDocuments.length} documents` })
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Document Management" breadcrumbs={['Dashboard', 'Document Management']} />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading documents...</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Document Management" breadcrumbs={['Dashboard', 'Document Management']} />

      <div className="page-content">
        {/* Toast */}
        {toast && (
          <div className={`doc-toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}><X size={14} /></button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="doc-stats-grid">
          <div className="doc-stat-card">
            <div className="doc-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><FileText size={24} /></div>
            <div className="doc-stat-info">
              <span className="doc-stat-label">Total Documents</span>
              <span className="doc-stat-value">{stats.total}</span>
            </div>
          </div>
          <div className="doc-stat-card">
            <div className="doc-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><FolderOpen size={24} /></div>
            <div className="doc-stat-info">
              <span className="doc-stat-label">Identity Docs</span>
              <span className="doc-stat-value">{stats.identity}</span>
            </div>
          </div>
          <div className="doc-stat-card">
            <div className="doc-stat-icon" style={{ background: '#dcfce7', color: '#16a34a' }}><FileText size={24} /></div>
            <div className="doc-stat-info">
              <span className="doc-stat-label">Employment Docs</span>
              <span className="doc-stat-value">{stats.employment}</span>
            </div>
          </div>
          <div className="doc-stat-card">
            <div className="doc-stat-icon" style={{ background: '#f3f4f6', color: '#6b7280' }}><FolderOpen size={24} /></div>
            <div className="doc-stat-info">
              <span className="doc-stat-label">Other Docs</span>
              <span className="doc-stat-value">{stats.other}</span>
            </div>
          </div>
        </div>

        {/* Filters Section */}
        <div className="doc-filters-section">
          <div className="doc-search-row">
            <div className="doc-search-wrapper">
              <Search size={18} className="doc-search-icon" />
              <input
                type="text"
                placeholder="Search by document name, employee, company, or category..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
            <button className="doc-btn-outline" onClick={handleExport}>
              <Download size={18} /> Export CSV
            </button>
          </div>
          <div className="doc-filter-row">
            <div className="doc-filter-group">
              <label>Company</label>
              <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setCurrentPage(1) }}>
                {canAccessAllCompanies && <option value="All">All Companies</option>}
                {(canAccessAllCompanies ? companies : availableCompanies).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="doc-filter-group">
              <label>Department</label>
              <select value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setCurrentPage(1) }}>
                {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{d === 'All' ? 'All Departments' : d}</option>)}
              </select>
            </div>
            <div className="doc-filter-group">
              <label>Category</label>
              <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setCurrentPage(1) }}>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>)}
              </select>
            </div>
            <button className="doc-clear-btn" onClick={() => { setSearchTerm(''); setCompanyFilter('All'); setDepartmentFilter('All'); setCategoryFilter('All'); setCurrentPage(1) }}>
              <X size={14} /> Clear Filters
            </button>
          </div>
        </div>

        {/* Results Count */}
        <div className="doc-results-count">
          Showing <strong>{filteredDocuments.length}</strong> of <strong>{documents.length}</strong> documents
        </div>

        {/* Table */}
        <div className="doc-table-wrapper">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Employee</th>
                <th>Company</th>
                <th>Category</th>
                <th>Upload Date</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="doc-empty-cell">
                    <FileText size={48} color="#d1d5db" />
                    <p>No documents found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
                    <span>Try adjusting your search or filters</span>
                  </td>
                </tr>
              ) : paginatedDocuments.map(d => {
                const cc = categoryColor(d.category)
                const CatIcon = categoryIcon(d.category)
                return (
                  <tr key={d.id}>
                    <td className="doc-name-cell">
                      <div className="doc-name-icon" style={{ background: cc.bg, color: cc.text }}>
                        <CatIcon size={16} />
                      </div>
                      <div className="doc-name-info">
                        <span className="doc-name-title">{d.docName}</span>
                        <span className="doc-name-sub">{d.subCategory} · {d.source === 'employee-field' ? 'Employee Doc' : d.source === 'subcollection' ? 'Uploaded Doc' : 'Contract'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="doc-employee-cell">
                        <span className="doc-employee-name">{d.employeeName}</span>
                        <span className="doc-employee-id">{d.employeeId}</span>
                      </div>
                    </td>
                    <td><span className="doc-company">{d.companyName}</span></td>
                    <td>
                      <span className="doc-category-badge" style={{ background: cc.bg, color: cc.text }}>
                        {d.category}
                      </span>
                    </td>
                    <td><span className="doc-date">{formatDate(d.uploadDate)}</span></td>
                    <td><span className="doc-size">{d.fileSize}</span></td>
                    <td>
                      <div className="doc-actions">
                        <button className="doc-action-btn view" onClick={() => handleView(d)} title="View">
                          <Eye size={15} />
                        </button>
                        <button className="doc-action-btn download" onClick={() => handleDownload(d)} title="Download">
                          <Download size={15} />
                        </button>
                        <button className="doc-action-btn delete" onClick={() => handleDelete(d)} title="Delete" disabled={deletingId === d.id}>
                          {deletingId === d.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="doc-pagination">
          <div className="doc-pagination-info">
            <span>Showing {paginatedDocuments.length} of {filteredDocuments.length} entries</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}/page</option>)}
            </select>
          </div>
          <div className="doc-pagination-controls">
            <button className="doc-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}><ChevronLeft size={14} /></button>
            <button className="doc-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={14} /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} className={`doc-page-btn ${currentPage === p ? 'doc-page-btn-active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
            ))}
            <button className="doc-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></button>
            <button className="doc-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* View Modal */}
      {viewModal && (
        <div className="doc-view-overlay" onClick={() => setViewModal(null)}>
          <div className="doc-view-modal" onClick={e => e.stopPropagation()}>
            <div className="doc-view-header">
              <div className="doc-view-title-group">
                <div className="doc-view-icon" style={{ background: categoryColor(viewModal.category).bg, color: categoryColor(viewModal.category).text }}>
                  {(() => { const I = categoryIcon(viewModal.category); return <I size={20} /> })()}
                </div>
                <div>
                  <h3>{viewModal.docName}</h3>
                  <span>{viewModal.employeeName} · {viewModal.companyName}</span>
                </div>
              </div>
              <button className="doc-view-close" onClick={() => setViewModal(null)}><X size={20} /></button>
            </div>
            <div className="doc-view-details">
              <div className="doc-view-row"><span>Category</span><strong>{viewModal.category}</strong></div>
              <div className="doc-view-row"><span>Department</span><strong>{viewModal.department}</strong></div>
              <div className="doc-view-row"><span>Upload Date</span><strong>{formatDate(viewModal.uploadDate)}</strong></div>
              <div className="doc-view-row"><span>File Size</span><strong>{viewModal.fileSize}</strong></div>
              <div className="doc-view-row"><span>Source</span><strong>{viewModal.source === 'employee-field' ? 'Employee Document' : viewModal.source === 'subcollection' ? 'Uploaded Document' : 'Contract'}</strong></div>
            </div>
            <div className="doc-view-actions">
              <a href={viewModal.fileUrl} target="_blank" rel="noopener noreferrer" className="doc-view-btn primary">
                <ExternalLink size={16} /> Open in New Tab
              </a>
              <button className="doc-view-btn secondary" onClick={() => handleDownload(viewModal)}>
                <Download size={16} /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
