import { useState, useEffect } from 'react'
import { errText } from '../aws/errors';
import { Megaphone, Search, Plus, Eye, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Bell, Clock, Pin, PinOff } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Toast } from '../components/Toast'
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import './Employees.css'
import './Assets.css'

interface Announcement {
  id: string; title: string; content: string; category: string;
  priority: 'High' | 'Medium' | 'Low'; author: string;
  createdAt: string | Date; pinned: boolean; companyId?: string;
}

const CATEGORIES = ['All', 'Holiday', 'Policy', 'Event', 'Finance', 'Notice']
const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High: { bg: '#fee2e2', text: '#ef4444' },
  Medium: { bg: '#fef3c7', text: '#f59e0b' },
  Low: { bg: '#e0f2fe', text: '#0284c7' },
}

export function Announcements() {
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('announcements')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [cardFilter, setCardFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Announcement | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [form, setForm] = useState({ title: '', category: '', priority: 'Medium', content: '', pinned: false })

  useEffect(() => {
    const toData = (snapshot: any) => snapshot.docs.map((d: any) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : (d.data().createdAt || ''),
    })) as Announcement[]

    const applySnap = (snapshot: any) => {
      setAnnouncements(toData(snapshot))
      setLoading(false)
    }
    const onErr = () => { setLoading(false); setAnnouncements([]) }

    const unsubs: (() => void)[] = []

    if (user?.role === 'master-admin') {
      unsubs.push(onSnapshot(collection(db, 'announcements'), applySnap, onErr))
    } else {
      const scopeIds = scopedCompanyIds(effectiveCompanyId, availableCompanies)
      if (scopeIds.length > 0) {
        const mergedMap = new Map<string, Announcement>()
        for (const chunk of chunkCompanyIds(scopeIds)) {
          const un = onSnapshot(query(collection(db, 'announcements'), companyIdWhere(chunk)!), (snapshot) => {
            snapshot.docs.forEach(d => {
              mergedMap.set(d.id, {
                id: d.id,
                ...d.data(),
                createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : (d.data().createdAt || ''),
              } as Announcement)
            })
            setAnnouncements([...mergedMap.values()])
            setLoading(false)
          }, onErr)
          unsubs.push(un)
        }
      } else {
        unsubs.push(onSnapshot(collection(db, 'announcements'), applySnap, onErr))
      }
    }

    return () => unsubs.forEach(u => u())
  }, [effectiveCompanyId, availableCompanies, user?.role])

  const handleCardFilter = (filterValue: string | null) => {
    if (!filterValue) return
    setCardFilter(prev => prev === filterValue ? 'All' : filterValue)
  }

  const sorted = [...announcements].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))

  const filtered = sorted.filter(a => {
    const s = searchTerm.toLowerCase()
    if (s && !a.title.toLowerCase().includes(s) && !a.content.toLowerCase().includes(s)) return false
    if (categoryFilter !== 'All' && a.category !== categoryFilter) return false
    if (cardFilter === 'pinned' && !a.pinned) return false
    if (cardFilter === 'highPriority' && a.priority !== 'High') return false
    return true
  })

  const resetForm = () => setForm({ title: '', category: '', priority: 'Medium', content: '', pinned: false })

  const handleCreate = async () => {
    if (!form.title.trim()) { setToast({ message: 'Please enter a title', type: 'error' }); return }
    if (!form.category) { setToast({ message: 'Please select a category', type: 'error' }); return }
    if (!form.content.trim()) { setToast({ message: 'Please enter content', type: 'error' }); return }
    setIsSubmitting(true)
    try {
      await addDoc(collection(db, 'announcements'), {
        title: form.title.trim(),
        category: form.category,
        priority: form.priority,
        content: form.content.trim(),
        pinned: form.pinned,
        author: user?.name || user?.email || 'Unknown',
        companyId: effectiveCompanyId || user?.companyId || '',
        createdAt: serverTimestamp(),
      })
      setIsAddOpen(false)
      resetForm()
      setToast({ message: 'Announcement created successfully!', type: 'success' })
    } catch (err: any) {
      setToast({ message: errText(err, 'Failed to create announcement'), type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const companyName = availableCompanies.find(c => c.id === effectiveCompanyId)?.name || ''

  return (
    <div className="page-container">
      <Header title="Announcements" />
      <div className="page-content">
        {loading && (
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading announcements...</p></div>
        )}

        {!loading && (<>
          <div className="emp-stats-row">
            <div className={`emp-mini-stat clickable${cardFilter === 'All' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('All')}>
              <Megaphone size={22} /><div><strong>{announcements.length}</strong><span>Total Announcements</span></div></div>
            <div className={`emp-mini-stat clickable${cardFilter === 'pinned' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('pinned')}>
              <Bell size={22} /><div><strong>{announcements.filter(a => a.pinned).length}</strong><span>Pinned</span></div></div>
            <div className={`emp-mini-stat clickable${cardFilter === 'highPriority' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('highPriority')}>
              <Clock size={22} /><div><strong>{announcements.filter(a => a.priority === 'High').length}</strong><span>High Priority</span></div></div>
          </div>

        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search announcements..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
          </div>
          <div className="emp-filter-group">
            <select value={effectiveCompanyId || ''} onChange={e => setSelectedCompanyId(e.target.value || '')} style={{ marginRight: 8 }}>
              {canAccessAllCompanies && <option value="">All Companies</option>}
              {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {hasPermission('announcements.create') && (
              <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', cursor: 'pointer' }} onClick={() => setIsAddOpen(true)}><Plus size={16} /> New Announcement</button>
            )}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th><th>Category</th><th>Priority</th><th>Author</th><th>Date</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={6} className="empty-cell">No announcements found{companyName ? ` for ${companyName}` : ''}</td></tr>
              ) : paginated.map(a => {
                const pc = PRIORITY_COLORS[a.priority]
                return (
                  <tr key={a.id} style={{ background: a.pinned ? '#fffbeb' : undefined }}>
                    <td><div className="emp-name-cell">{a.pinned && <Pin size={14} color="#f59e0b" />}<span>{a.title}</span></div></td>
                    <td><span className="emp-status-badge" style={{ background: '#fff7ed', color: '#f97316' }}>{a.category}</span></td>
                    <td><span className="emp-status-badge" style={{ background: pc.bg, color: pc.text }}>{a.priority}</span></td>
                    <td>{a.author}</td>
                    <td>{typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="emp-actions">
                        <button className="emp-action-icon view" onClick={() => { setSelected(a); setIsViewOpen(true) }} title="View"><Eye size={15} /></button>
                        {hasPermission('announcements.edit') && (
                          <button className="emp-action-icon edit" title="Edit"><Pencil size={15} /></button>
                        )}
                        {hasPermission('announcements.delete') && (
                          <button className="emp-action-icon delete" title="Delete"><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="pagination-info">Showing {Math.min(1, filtered.length) > 0 ? (currentPage - 1) * pageSize + 1 : 0}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="pagination-controls">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
            <span className="pagination-page">{currentPage} / {totalPages || 1}</span>
            <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
          </div>
        </div>
      </>)}
      </div>

      <Modal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} title="Announcement" size="medium">
        {selected && (
          <div className="emp-profile">
            <div className="emp-profile-header" style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: 16, marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Megaphone size={24} color="#f97316" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ margin: 0 }}>{selected.title}</h2>
                  {selected.pinned && <Pin size={14} color="#f59e0b" />}
                </div>
                <p style={{ color: '#6b7280', fontSize: 13 }}>{selected.category} &middot; By {selected.author} &middot; {typeof selected.createdAt === 'string' ? selected.createdAt : new Date(selected.createdAt).toLocaleDateString()}</p>
                <span className="emp-status-badge" style={{ background: PRIORITY_COLORS[selected.priority].bg, color: PRIORITY_COLORS[selected.priority].text }}>{selected.priority} Priority</span>
              </div>
            </div>
            <p style={{ color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{selected.content}</p>
          </div>
        )}
      </Modal>

      <Modal isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); resetForm() }} title="New Announcement" size="medium">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Title</label>
            <input type="text" placeholder="Enter announcement title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#111827', background: '#fff', width: '100%', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                <option value="">Select category</option>
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#111827', background: '#fff', width: '100%', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>Content</label>
            <textarea rows={5} placeholder="Enter announcement content" value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="pin" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer', accentColor: '#f97316' }} />
            <label htmlFor="pin" style={{ fontSize: 13, color: '#374151', fontWeight: 600, cursor: 'pointer', margin: 0 }}>Pin this announcement</label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
            <button onClick={() => { setIsAddOpen(false); resetForm() }} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>Cancel</button>
            <button onClick={handleCreate} disabled={isSubmitting} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: isSubmitting ? '#fdba74' : '#f97316', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isSubmitting ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>{isSubmitting ? 'Creating...' : 'Create Announcement'}</button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
