import { useState, useEffect } from 'react'
import { Calendar, CalendarDays, Users, Clock, Building, Search, Download, Plus, ChevronDown, ChevronLeft, ChevronRight, Pencil, Trash2, List, LayoutGrid, Eye, Loader2, Briefcase, Crown } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { collection, getDocs, query } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import { useRoleBasedStats, useRoleBasedTitle } from '../hooks/useRoleBasedData'
import { getAllHolidays, getHolidaysByCompany, createHoliday, updateHoliday, deleteHoliday } from '../services/holidayService'
import { notifyTlAction } from '../services/notificationService'
import { getAllUsers } from '../services/authService'
import { getAllCompanies } from '../services/companyService'
import type { Holiday, User, Company } from '../types/user'
import { isDate } from '../utils/dateUtils'
import './HolidayCalendar.css'

const TYPE_OPTIONS = ['Public', 'Company', 'Optional', 'Restricted']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const INITIAL_FORM_DATA: Omit<Holiday, 'id'> = {
  name: '',
  date: new Date(),
  type: 'Public',
  description: '',
  companyId: ''
}

// Form component defined OUTSIDE main component to prevent re-renders
interface HolidayFormProps {
  formData: Omit<Holiday, 'id'>;
  setFormData: React.Dispatch<React.SetStateAction<Omit<Holiday, 'id'>>>;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  onCancel: () => void;
  isSubmitting: boolean;
}

const HolidayForm = ({ formData, setFormData, onSubmit, submitLabel, onCancel, isSubmitting }: HolidayFormProps) => (
  <form onSubmit={onSubmit} className="modal-form">
    <div className="form-group">
      <label>Holiday Name *</label>
      <input 
        type="text" 
        value={formData.name}
        onChange={(e) => setFormData(prev => ({...prev, name: e.target.value}))}
        placeholder="Enter holiday name"
        required
      />
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Date *</label>
        <input 
          type="date" 
          value={formData.date && isDate(formData.date) ? formData.date.toISOString().split('T')[0] : formData.date}
          onChange={(e) => setFormData(prev => ({...prev, date: new Date(e.target.value)}))}
          required
        />
      </div>
      <div className="form-group">
        <label>Type *</label>
        <select 
          value={formData.type}
          onChange={(e) => setFormData(prev => ({...prev, type: e.target.value as any}))}
          required
        >
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>

    <div className="form-group">
      <label>Description</label>
      <textarea 
        value={formData.description}
        onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))}
        placeholder="Holiday description..."
        rows={3}
      />
    </div>

    <div className="modal-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : submitLabel}</button>
    </div>
  </form>
)

export function HolidayCalendar() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [cardFilter, setCardFilter] = useState('All')
  const [companyFilter, setCompanyFilter] = useState('all')

  // Org context
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])

  const { user, hasPermission } = useAuth()
  const { canAccessAllCompanies, availableCompanies, effectiveCompanyId } = usePermissionScope('holidays')
  const { canViewAllStats } = useRoleBasedStats()
  const showOrgColumns = ['master-admin', 'company-admin', 'executive', 'team-leader'].includes(user?.role || '')
  const pageTitle = useRoleBasedTitle('Holiday Calendar')
  const companyName = availableCompanies.find(c => c.id === effectiveCompanyId)?.name || ''

  useEffect(() => {
    fetchOrgData()
    fetchHolidays()
  }, [effectiveCompanyId, availableCompanies, user?.role])

  const fetchOrgData = async () => {
    const [users, comps] = await Promise.all([
      getAllUsers().catch(() => [] as User[]),
      getAllCompanies().catch(() => [] as Company[])
    ])
    setAllUsers(users)
    setCompanies(comps)
  }

  const fetchHolidays = async () => {
    try {
      setLoading(true)
      let data: Holiday[]

      if (user?.role === 'master-admin') {
        data = await getAllHolidays()
      } else if (effectiveCompanyId) {
        data = await getHolidaysByCompany(effectiveCompanyId)
      } else if (user?.role === 'executive' || user?.role === 'team-leader') {
        // All Companies mode — only authorized companies
        const scopeIds = scopedCompanyIds(null, availableCompanies)
        data = scopeIds.length > 0
          ? (await Promise.all(chunkCompanyIds(scopeIds).map(async chunk => {
              return (await getDocs(query(collection(db, 'holidays'), companyIdWhere(chunk)!))).docs.map(d => ({ id: d.id, ...(d.data() as any) } as Holiday))
            }))).flat()
          : []
      } else {
        data = await getAllHolidays()
      }

      setHolidays(data)
      setError(null)
    } catch (err) {
      console.error('Error fetching holidays:', err)
      setError('Failed to load holidays. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── lookup helpers ──────────────────────────────────────────
  const getCompanyName = (cid?: string) => {
    if (!cid) return ''
    return companies.find(c => c.id === cid)?.name || ''
  }
  const getCompanyColor = (cid?: string) => {
    if (!cid) return '#6b7280'
    return companies.find(c => c.id === cid)?.logoColor || '#6b7280'
  }
  const getAssignedExecutiveId = (cid?: string) => {
    if (!cid) return ''
    const c = companies.find(c => c.id === cid)
    if (!c) return ''
    return (c as any).assignedExecutiveId || ''
  }
  const getAssignedExecutive = (cid?: string) => {
    const execId = getAssignedExecutiveId(cid)
    if (!execId) return ''
    const exec = allUsers.find(u => u.id === execId)
    return exec?.name || ''
  }
  const getTLsForCompany = (cid?: string) => {
    const execId = getAssignedExecutiveId(cid)
    if (!execId) return []
    const exec = allUsers.find(u => u.id === execId)
    const tlIds: string[] = (exec as any)?.assignedTeamLeaderIds || []
    return tlIds.map((tid: string) => {
      const tl = allUsers.find(u => u.id === tid)
      return tl?.name || ''
    }).filter(Boolean)
  }

  // ── role-based visibility ───────────────────────────────────
  const visibleHolidays = holidays.filter(h => {
    if (user?.role === 'master-admin' || user?.role === 'company-admin') return true
    if (user?.role === 'executive') {
      const execUser = allUsers.find(u => u.id === user.id)
      const cids: string[] = (execUser as any)?.assignedCompanyIds || []
      return !h.companyId || cids.includes(h.companyId)
    }
    if (user?.role === 'team-leader') {
      const tlUser = allUsers.find(u => u.id === user.id)
      const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
      const allCompanyIds: string[] = allUsers
        .filter(u => linkedIds.includes(u.id))
        .flatMap((ex: any) => ex.assignedCompanyIds || [])
      return !h.companyId || allCompanyIds.includes(h.companyId)
    }
    return true
  })

  const filteredHolidays = visibleHolidays.filter(holiday => {
    const holidayDate = new Date(holiday.date)
    if (holidayDate.getMonth() !== currentMonth || holidayDate.getFullYear() !== currentYear) return false

    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      if (!holiday.name.toLowerCase().includes(s) && !(holiday.description || '').toLowerCase().includes(s)) return false
    }

    if (cardFilter === 'Upcoming' && holidayDate < new Date()) return false
    else if (cardFilter !== 'All' && cardFilter !== 'Upcoming' && holiday.type !== cardFilter) return false
    else if (cardFilter === 'All' && typeFilter !== 'All' && holiday.type !== typeFilter) return false

    if (companyFilter !== 'all' && holiday.companyId !== companyFilter) return false

    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredHolidays.length / pageSize))
  const paginatedHolidays = filteredHolidays.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const upcomingHolidays = visibleHolidays
    .filter(h => new Date(h.date) >= new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 3)

  const handleExport = () => {
    const csvContent = [
      ['Holiday Name', 'Company', 'Assigned Executive', 'Reporting TL', 'Date', 'Type', 'Description'].join(','),
      ...filteredHolidays.map(h => [
        h.name,
        getCompanyName(h.companyId),
        getAssignedExecutive(h.companyId),
        getTLsForCompany(h.companyId).join('; '),
        isDate(h.date) ? h.date.toLocaleDateString('en-GB') : h.date,
        h.type,
        h.description || ''
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'holidays.csv'
    a.click()
  }

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const cid = effectiveCompanyId || user?.companyId || ''
      await createHoliday({
        ...formData,
        companyId: effectiveCompanyId || undefined
      })
      if (user?.role === 'team-leader') {
        notifyTlAction(
          cid, 'holiday_created', 'Holiday Added',
          `${user?.name || 'Team Leader'} added holiday: ${formData.name}`,
          '/holidays', allUsers
        ).catch(() => {})
      }
      await fetchHolidays()
      setIsAddModalOpen(false)
      setFormData(INITIAL_FORM_DATA)
    } catch (err) {
      console.error('Error adding holiday:', err)
      alert('Failed to add holiday')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHoliday) return
    
    setIsSubmitting(true)
    try {
      await updateHoliday(selectedHoliday.id, formData)
      if (user?.role === 'team-leader') {
        notifyTlAction(
          selectedHoliday.companyId || effectiveCompanyId || '', 'holiday_updated', 'Holiday Updated',
          `${user?.name || 'Team Leader'} updated holiday: ${formData.name}`,
          '/holidays', allUsers
        ).catch(() => {})
      }
      await fetchHolidays()
      setIsEditModalOpen(false)
      setSelectedHoliday(null)
    } catch (err) {
      console.error('Error updating holiday:', err)
      alert('Failed to update holiday')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this holiday?')) return
    
    try {
      const h = holidays.find(x => x.id === id)
      await deleteHoliday(id)
      if (user?.role === 'team-leader' && h) {
        notifyTlAction(
          h.companyId || effectiveCompanyId || '', 'holiday_deleted', 'Holiday Deleted',
          `${user?.name || 'Team Leader'} deleted holiday: ${h.name}`,
          '/holidays', allUsers
        ).catch(() => {})
      }
      await fetchHolidays()
    } catch (err) {
      console.error('Error deleting holiday:', err)
      alert('Failed to delete holiday')
    }
  }

  const openEditModal = (holiday: Holiday) => {
    setSelectedHoliday(holiday)
    setFormData({
      name: holiday.name,
      date: holiday.date,
      type: holiday.type,
      description: holiday.description || '',
      companyId: holiday.companyId
    })
    setIsEditModalOpen(true)
  }

  const openViewModal = (holiday: Holiday) => {
    setSelectedHoliday(holiday)
    setIsViewModalOpen(true)
  }

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'Public': return { bg: '#dcfce7', text: '#16a34a' }
      case 'Optional': return { bg: '#f0fdf4', text: '#22c55e' }
      case 'Company': return { bg: '#ffedd5', text: '#f97316' }
      case 'Restricted': return { bg: '#fee2e2', text: '#ef4444' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }

  const getDayName = (date: Date | string) => {
    const d = new Date(date)
    return d.toLocaleDateString('en-US', { weekday: 'long' })
  }

  const handleCardFilter = (filterValue: string | null) => {
    if (!filterValue) return
    if (cardFilter === filterValue) {
      setCardFilter('All')
      setTypeFilter('All')
    } else {
      setCardFilter(filterValue)
      if (filterValue !== 'Upcoming') setTypeFilter(filterValue)
      else setTypeFilter('All')
    }
  }

  const getStatsCards = () => [
    { icon: Calendar, label: 'Total Holidays', value: String(visibleHolidays.length), action: 'View all holidays', color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' },
    { icon: CalendarDays, label: 'Upcoming', value: String(upcomingHolidays.length), subtext: upcomingHolidays[0] ? new Date(upcomingHolidays[0].date).toLocaleDateString('en-GB') : 'No upcoming', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'Upcoming' },
    { icon: Building, label: 'Public Holidays', value: String(visibleHolidays.filter(h => h.type === 'Public').length), subtext: 'This year', color: '#f59e0b', bgColor: '#fffbeb', filterValue: 'Public' },
    { icon: Clock, label: 'Optional Holidays', value: String(visibleHolidays.filter(h => h.type === 'Optional').length), subtext: 'This year', color: '#22c55e', bgColor: '#f0fdf4', filterValue: 'Optional' },
    { icon: Users, label: 'Company Holidays', value: String(visibleHolidays.filter(h => h.type === 'Company').length), subtext: 'This year', color: '#ef4444', bgColor: '#fef2f2', filterValue: 'Company' }
  ]



  const navigateMonth = (direction: number) => {
    const newMonth = currentMonth + direction
    if (newMonth > 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else if (newMonth < 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(newMonth)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading holidays...</p>
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
          <button onClick={fetchHolidays} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
      
      <div className="page-content">
        {/* Stats Cards */}
        <div className="stats-row holiday-stats">
          {getStatsCards().map((stat, idx) => (
            <div
              key={idx}
              className="stat-card-holiday"
              onClick={() => handleCardFilter(stat.filterValue)}
              style={{
                cursor: stat.filterValue !== null ? 'pointer' : 'default',
                transition: 'all 0.15s',
                border: stat.filterValue !== null && cardFilter === stat.filterValue ? '2px solid ' + stat.color : '2px solid transparent',
                boxShadow: stat.filterValue !== null && cardFilter === stat.filterValue ? '0 0 0 3px ' + stat.color + '30' : 'none'
              }}
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
              {stat.action && (
                <div className="stat-action">
                  <span>{stat.action}</span>
                  <ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="holiday-filters-section">
          <div className="search-add-row">
            <div className="search-filter">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search holidays..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {hasPermission('holidays.export') && (
              <button className="btn-outline" onClick={handleExport}><Download size={18} />Export</button>
            )}
            {hasPermission('holidays.create') && (
              <button className="btn-primary" onClick={() => setIsAddModalOpen(true)}><Plus size={18} />Add Holiday</button>
            )}
          </div>
          <div className="filters-row holiday-filters">
            <select className="filter-select" value={currentYear} onChange={(e) => setCurrentYear(parseInt(e.target.value))}>
              {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="filter-select" value={MONTHS[currentMonth]} onChange={(e) => setCurrentMonth(MONTHS.indexOf(e.target.value))}>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="filter-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCardFilter(e.target.value === 'All' ? 'All' : e.target.value) }}>
              <option value="All">All Types</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="filter-select" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
              {canAccessAllCompanies && <option value="all">All Companies</option>}
              {(canAccessAllCompanies ? companies : availableCompanies).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Calendar and List Section */}
        <div className="holiday-calendar-section">
          {/* Calendar View */}
          <div className="calendar-view">
            <div className="calendar-header">
              <div className="calendar-nav">
                <button className="calendar-nav-btn" onClick={() => navigateMonth(-1)}><ChevronLeft size={20} /></button>
                <button className="calendar-nav-btn" onClick={() => navigateMonth(1)}><ChevronRight size={20} /></button>
              </div>
              <h3 className="calendar-title">{MONTHS[currentMonth]} {currentYear}</h3>
              <button className="today-btn" onClick={() => {setCurrentMonth(new Date().getMonth()); setCurrentYear(new Date().getFullYear())}}>Today</button>
            </div>
            <div className="calendar-grid">
              <div className="calendar-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="weekday">{day}</div>)}
              </div>
              <div className="calendar-days">
                {Array.from({ length: 35 }, (_, i) => {
                  const date = new Date(currentYear, currentMonth, 1)
                  const firstDay = date.getDay()
                  const dayNum = i - firstDay + 1
                  const currentDate = new Date(currentYear, currentMonth, dayNum)
                  const isCurrentMonth = currentDate.getMonth() === currentMonth
                  const isToday = currentDate.toDateString() === new Date().toDateString()
                  const dayHolidays = visibleHolidays.filter(h => new Date(h.date).toDateString() === currentDate.toDateString())
                  
                  return (
                    <div key={i} className={`calendar-day ${!isCurrentMonth ? 'prev-month' : ''} ${isToday ? 'today' : ''}`}>
                      <span className="day-number">{currentDate.getDate()}</span>
                      {dayHolidays.length > 0 && (
                        <div className="holiday-dots-container">
                          {dayHolidays.slice(0, 3).map((h, idx) => (
                            <span key={idx} className="holiday-dot" style={{ background: h.companyId ? getCompanyColor(h.companyId) : '#6b7280' }}></span>
                          ))}
                          {dayHolidays.length > 3 && <span className="holiday-dot-more">+{dayHolidays.length - 3}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="calendar-legend">
              <div className="legend-item"><span className="legend-dot public"></span>Public Holiday</div>
              <div className="legend-item"><span className="legend-dot optional"></span>Optional Holiday</div>
              <div className="legend-item"><span className="legend-dot company"></span>Company Holiday</div>
              <div className="legend-item"><span className="legend-dot restricted"></span>Restricted Holiday</div>
              {showOrgColumns && [...new Set(filteredHolidays.filter(h => h.companyId).map(h => h.companyId))].slice(0, 5).map(cid => {
                const c = companies.find(c => c.id === cid)
                return c ? <div key={cid} className="legend-item"><span className="legend-dot" style={{ background: c.logoColor || '#6b7280' }}></span>{c.name}</div> : null
              })}
              {showOrgColumns && [...new Set(filteredHolidays.filter(h => h.companyId).map(h => h.companyId))].length > 5 && (
                <div className="legend-item"><span className="legend-dot-more">+{[...new Set(filteredHolidays.filter(h => h.companyId).map(h => h.companyId))].length - 5}</span></div>
              )}
            </div>
          </div>

          {/* Holidays List */}
          <div className="holidays-list-section">
            <div className="section-header-holidays">
              <div className="section-title-group"><h3>Holidays List</h3><p>Manage and view holidays for {MONTHS[currentMonth]} {currentYear}.</p></div>
              <div className="section-actions-holidays">
                <button className="btn-outline" onClick={handleExport}><Download size={16} />Export</button>
                <div className="view-toggle">
                  <button className={viewMode === 'list' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('list')}><List size={18} /></button>
                  <button className={viewMode === 'grid' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('grid')}><LayoutGrid size={18} /></button>
                </div>
              </div>
            </div>

            <div className="table-container">
              <table className="holidays-table">
                <thead>
                    <tr>
                      <th>Holiday Name</th>
                      {showOrgColumns && <th>Company</th>}
                      {showOrgColumns && <th>Assigned Executive</th>}
                      {showOrgColumns && <th>Reporting TL</th>}
                      <th>Date</th>
                      <th>Day</th>
                      <th>Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHolidays.map((holiday) => {
                      const typeColors = getTypeBadgeColor(holiday.type)
                      const companyName = getCompanyName(holiday.companyId)
                      const execName = getAssignedExecutive(holiday.companyId)
                      const tlNames = getTLsForCompany(holiday.companyId)
                      return (
                        <tr key={holiday.id}>
                          <td><span className="holiday-name">{holiday.name}</span></td>
                          {showOrgColumns && (
                            <td>{companyName ? <span className="company-code">{companyName}</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                          )}
                          {showOrgColumns && (
                            <td>{execName ? <span className="company-code">{execName}</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                          )}
                          {showOrgColumns && (
                            <td>{tlNames.length > 0 ? tlNames.map((tn, i) => <span key={i} className="company-code" style={{ marginRight: 4 }}>{tn}</span>) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                          )}
                        <td><span className="holiday-date">{holiday.date && isDate(holiday.date) ? holiday.date.toLocaleDateString('en-GB') : new Date(holiday.date).toLocaleDateString('en-GB')}</span></td>
                        <td><span className="holiday-day">{getDayName(holiday.date)}</span></td>
                        <td><span className="type-badge" style={{ background: typeColors.bg, color: typeColors.text }}>{holiday.type}</span></td>
                        <td>
                          <div className="action-buttons">
                            <button className="action-btn view" onClick={() => openViewModal(holiday)}><Eye size={16} /></button>
                            {(hasPermission('holidays.edit') || hasPermission('holidays.delete')) && (
                              <>
                                {hasPermission('holidays.edit') && (
                                  <button className="action-btn edit" onClick={() => openEditModal(holiday)}><Pencil size={16} /></button>
                                )}
                                {hasPermission('holidays.delete') && (
                                  <button className="action-btn delete" onClick={() => handleDelete(holiday.id)}><Trash2 size={16} /></button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                    })}
                  {paginatedHolidays.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>No holidays found{companyName ? ` for ${companyName}` : ''}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination-bottom-holidays">
              <div className="pagination-info">
                <span className="showing-text">Showing {paginatedHolidays.length} of {visibleHolidays.length} entries</span>
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
      </div>

      {/* Add Holiday Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Holiday" size="medium">
        <HolidayForm 
          formData={formData} 
          setFormData={setFormData} 
          onSubmit={handleAddHoliday} 
          submitLabel="Add Holiday"
          onCancel={() => { setIsAddModalOpen(false); setFormData(INITIAL_FORM_DATA); }}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Edit Holiday Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Holiday" size="medium">
        <HolidayForm 
          formData={formData} 
          setFormData={setFormData} 
          onSubmit={handleEditHoliday} 
          submitLabel="Save Changes"
          onCancel={() => { setIsEditModalOpen(false); setSelectedHoliday(null); }}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* View Holiday Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Holiday Details" size="small">
        {selectedHoliday && (
          <div className="company-details-view">
            <div className="detail-row"><span className="detail-label">Holiday Name:</span><span className="detail-value">{selectedHoliday.name}</span></div>
            {showOrgColumns && <div className="detail-row"><span className="detail-label">Company:</span><span className="detail-value">{getCompanyName(selectedHoliday.companyId) || '—'}</span></div>}
            {showOrgColumns && <div className="detail-row"><span className="detail-label">Assigned Executive:</span><span className="detail-value">{getAssignedExecutive(selectedHoliday.companyId) || '—'}</span></div>}
            {showOrgColumns && <div className="detail-row"><span className="detail-label">Reporting TL:</span><span className="detail-value">{getTLsForCompany(selectedHoliday.companyId).join(', ') || '—'}</span></div>}
            <div className="detail-row"><span className="detail-label">Date:</span><span className="detail-value">{selectedHoliday.date && isDate(selectedHoliday.date) ? selectedHoliday.date.toLocaleDateString('en-GB') : new Date(selectedHoliday.date).toLocaleDateString('en-GB')}</span></div>
            <div className="detail-row"><span className="detail-label">Day:</span><span className="detail-value">{getDayName(selectedHoliday.date)}</span></div>
            <div className="detail-row"><span className="detail-label">Type:</span><span className="detail-value">{selectedHoliday.type}</span></div>
            {selectedHoliday.description && <div className="detail-row"><span className="detail-label">Description:</span><span className="detail-value">{selectedHoliday.description}</span></div>}
          </div>
        )}
      </Modal>
    </div>
  )
}
