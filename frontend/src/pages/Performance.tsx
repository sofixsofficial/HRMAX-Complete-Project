import { useState, useEffect } from 'react'
import { TrendingUp, Search, Eye, Loader2, ChevronLeft, ChevronRight, Star, BarChart3, Target, Award } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useCompany } from '../context/CompanyContext'
import { useAuth } from '../context/AuthContext'
import './Employees.css'
import './Assets.css'

interface Rating {
  id: string; name: string; department: string; rating: number; reviews: number; kpi: number; trend: 'up' | 'down' | 'stable';
}

const TREND_ICONS: Record<string, string> = { up: '▲', down: '▼', stable: '→' }
const TREND_COLORS: Record<string, string> = { up: '#16a34a', down: '#ef4444', stable: '#6b7280' }

const getStars = (r: number) => {
  const full = Math.floor(r)
  const half = r % 1 >= 0.5
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))
}

export function Performance() {
  const { user } = useAuth()
  const { effectiveCompanyId, isLoading: companyLoading } = useCompany()
  const [ratings, setRatings] = useState<Rating[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cardFilter, setCardFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Rating | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)

  useEffect(() => {
    if (companyLoading) return
    const ref = collection(db, 'performanceReviews')
    const q = user?.role === 'master-admin' && !effectiveCompanyId
      ? ref
      : query(ref, where('companyId', '==', effectiveCompanyId))
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Rating[]
      setRatings(data)
      setLoading(false)
    }, () => { setLoading(false); setRatings([]) })
    return () => unsub()
  }, [effectiveCompanyId, user?.role, companyLoading])

  const handleCardFilter = (filterValue: string) => {
    setCardFilter(prev => prev === filterValue ? 'All' : filterValue)
  }

  const avg = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length
  const avgKpi = Math.round(ratings.reduce((s, r) => s + r.kpi, 0) / ratings.length)
  const avgReviews = Math.round(ratings.reduce((s, r) => s + r.reviews, 0) / ratings.length)
  const topRated = [...ratings].sort((a, b) => b.rating - a.rating).slice(0, 3)

  const filtered = ratings.filter(r => {
    const s = searchTerm.toLowerCase()
    if (s && !r.name.toLowerCase().includes(s) && !r.department.toLowerCase().includes(s)) return false
    if (cardFilter === 'topPerformer' && r.rating < 4.5) return false
    if (cardFilter === 'totalReviews' && r.reviews < avgReviews) return false
    if (cardFilter === 'avgRating' && r.rating < avg) return false
    if (cardFilter === 'avgKpi' && r.kpi < avgKpi) return false
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="page-container">
      <Header title="Performance" />
      <div className="page-content">
          <div className="emp-stats-row">
            <div className={`emp-mini-stat clickable${cardFilter === 'avgRating' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('avgRating')}>
              <TrendingUp size={22} /><div><strong>{avg.toFixed(1)}</strong><span>Avg Rating</span></div></div>
            <div className={`emp-mini-stat clickable${cardFilter === 'avgKpi' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('avgKpi')}>
              <Target size={22} /><div><strong>{avgKpi}%</strong><span>Avg KPI</span></div></div>
            <div className={`emp-mini-stat clickable${cardFilter === 'totalReviews' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('totalReviews')}>
              <Award size={22} /><div><strong>{ratings.length}</strong><span>Total Reviews</span></div></div>
            <div className={`emp-mini-stat clickable${cardFilter === 'topPerformer' ? ' stat-active' : ''}`} onClick={() => handleCardFilter('topPerformer')}>
              <Star size={22} /><div><strong>{topRated[0]?.name || '-'}</strong><span>Top Performer</span></div></div>
          </div>

        <div className="emp-toolbar">
          <div className="emp-search-box">
            <Search size={16} />
            <input type="text" placeholder="Search by name or department..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }} />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Department</th><th>Rating</th><th>KPI Score</th><th>Reviews</th><th>Trend</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={7} className="empty-cell">No performance data found</td></tr>
              ) : paginated.map(r => (
                <tr key={r.id}>
                  <td><div className="emp-name-cell"><span>{r.name}</span></div></td>
                  <td>{r.department}</td>
                  <td style={{ color: '#f59e0b' }}>{getStars(r.rating)} <span style={{ color: '#6b7280', fontSize: 12 }}>({r.rating})</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="stats-bar" style={{ width: 80, height: 6 }}>
                        <div className="stats-bar-fill" style={{ width: `${r.kpi}%`, background: r.kpi >= 80 ? '#16a34a' : r.kpi >= 60 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span>{r.kpi}%</span>
                    </div>
                  </td>
                  <td>{r.reviews}</td>
                  <td style={{ color: TREND_COLORS[r.trend], fontWeight: 600 }}>{TREND_ICONS[r.trend]}</td>
                  <td>
                    <div className="emp-actions">
                      <button className="emp-action-icon view" onClick={() => { setSelected(r); setIsViewOpen(true) }} title="View"><Eye size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
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
      </div>

      <Modal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} title="Performance Review" size="medium">
        {selected && (
          <div className="emp-profile">
            <div className="emp-profile-header">
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={24} color="#f97316" />
              </div>
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.department}</p>
                <span className="emp-status-badge" style={{ background: '#fef3c7', color: '#f59e0b' }}>{getStars(selected.rating)}</span>
              </div>
            </div>
            <div className="emp-profile-grid">
              <div className="emp-profile-section">
                <h4><Star size={16} /> Rating Overview</h4>
                <div className="emp-profile-fields">
                  <div><label>Overall Rating</label><span style={{ color: '#f59e0b', fontSize: 18 }}>{selected.rating} / 5</span></div>
                  <div><label>KPI Score</label><span>{selected.kpi}%</span></div>
                  <div><label>Total Reviews</label><span>{selected.reviews}</span></div>
                  <div><label>Trend</label><span style={{ color: TREND_COLORS[selected.trend] }}>{selected.trend.toUpperCase()}</span></div>
                </div>
              </div>
              <div className="emp-profile-section">
                <h4><BarChart3 size={16} /> Monthly Breakdown</h4>
                <div className="emp-profile-fields">
                  {['Jan', 'Feb', 'Mar'].map((m, i) => (
                    <div key={m}><label>{m}</label><span>{Math.round(selected.rating + (i - 1) * 0.2 * 10) / 10} / 5</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
