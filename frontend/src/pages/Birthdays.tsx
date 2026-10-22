import { useState, useEffect } from 'react'
import { Gift, Calendar, Users, Cake, Search, Download, ChevronRight, Mail, Pencil, Trash2, Filter, LayoutGrid, List, ChevronLeft, Loader2, X, AlertCircle, Send, Eye } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { ActionErrorBanner } from '../components/ActionErrorBanner'
import { errText } from '../aws/errors'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { scopedCompanyIds } from '../utils/companyScope'
import { useRoleBasedStats } from '../hooks/useRoleBasedData'
import { getAllEmployees, getEmployeesByCompany, updateEmployee } from '../services/employeeService'
import type { Employee } from '../types/user'
import './Birthdays.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface BirthdayEmployee extends Employee {
  birthMonth?: number;
  birthDay?: number;
  age?: number;
  daysUntil?: number;
}

export function Birthdays() {
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [employees, setEmployees] = useState<BirthdayEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({
    thisMonth: 0,
    upcoming: 0,
    total: 0,
    today: 0
  })
  
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  // Modal states
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isWishModalOpen, setIsWishModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<BirthdayEmployee | null>(null)
  const [wishMessage, setWishMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  
  // Edit form state
  const [editForm, setEditForm] = useState({
    birthDate: ''
  })
  
  // Filters
  const [departmentFilter, setDepartmentFilter] = useState('All')
  const [monthFilter, setMonthFilter] = useState(String(new Date().getMonth()))
  const [cardFilter, setCardFilter] = useState('All')
  
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('birthdays')
  const { canViewAllStats } = useRoleBasedStats()
  const companyId = effectiveCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  // Helper function to parse birthDate
  const parseBirthDate = (birthDate: string | Date | undefined): { month: number, day: number, year: number } | null => {
    if (!birthDate) return null
    const date = new Date(birthDate)
    if (isNaN(date.getTime())) return null
    return {
      month: date.getMonth(),
      day: date.getDate(),
      year: date.getFullYear()
    }
  }

  // Helper function to calculate days until birthday
  const calculateDaysUntil = (birthMonth: number, birthDay: number): number => {
    const today = new Date()
    const currentYear = today.getFullYear()
    let nextBirthday = new Date(currentYear, birthMonth, birthDay)
    
    // Set to midnight for accurate comparison
    today.setHours(0, 0, 0, 0)
    nextBirthday.setHours(0, 0, 0, 0)
    
    if (nextBirthday < today) {
      nextBirthday = new Date(currentYear + 1, birthMonth, birthDay)
    }
    
    const diffTime = nextBirthday.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  // Helper function to calculate age
  const calculateAge = (birthYear: number, birthMonth: number, birthDay: number): number => {
    const today = new Date()
    let age = today.getFullYear() - birthYear
    const monthDiff = today.getMonth() - birthMonth
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDay)) {
      age--
    }
    return age
  }

  useEffect(() => {
    fetchEmployees()
  }, [companyId, effectiveCompanyId, availableCompanies])

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      setError(null)
      let data: Employee[]
      
      if (effectiveCompanyId && !canViewAllStats) {
        data = await getEmployeesByCompany(effectiveCompanyId)
      } else if (!canViewAllStats) {
        // All Companies mode — only authorized companies
        const ids = scopedCompanyIds(null, availableCompanies)
        const results = await Promise.all(ids.map(id => getEmployeesByCompany(id).catch(() => [] as Employee[])))
        data = results.flat()
      } else {
        data = await getAllEmployees()
      }
      
      // Process employees with birthDate data
      const processedEmployees: BirthdayEmployee[] = data.map((employee) => {
        const parsed = parseBirthDate(employee.birthDate)
        
        if (parsed) {
          const daysUntil = calculateDaysUntil(parsed.month, parsed.day)
          return {
            ...employee,
            birthMonth: parsed.month,
            birthDay: parsed.day,
            age: calculateAge(parsed.year, parsed.month, parsed.day),
            daysUntil
          }
        }
        
        return {
          ...employee,
          daysUntil: undefined
        }
      })
      
      // Filter to only show employees with birth dates
      const employeesWithBirthdays = processedEmployees.filter(e => e.birthDate)
      setEmployees(employeesWithBirthdays)
      
      // Calculate stats
      const currentMonth = new Date().getMonth()
      const thisMonthBirthdays = employeesWithBirthdays.filter(e => e.birthMonth === currentMonth).length
      const upcomingBirthdays = employeesWithBirthdays.filter(e => e.daysUntil !== undefined && e.daysUntil <= 7).length
      const todayBirthdays = employeesWithBirthdays.filter(e => e.daysUntil === 0).length
      
      setStats({
        thisMonth: thisMonthBirthdays,
        upcoming: upcomingBirthdays,
        total: employeesWithBirthdays.length,
        today: todayBirthdays
      })
      
      setError(null)
    } catch (err: any) {
      console.error('Error fetching employees:', err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError(`Access denied. You do not have permission to view birthday data${companyName ? ` for ${companyName}` : ''}.`)
      } else if (err?.code === 'unavailable' || err?.message?.includes('timeout')) {
        setError('Request timed out. Please check your connection and try again.')
      } else {
        setError('Failed to load birthday data.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Get unique departments for filter
  const departments = Array.from(new Set(employees.map(e => e.department))).filter(Boolean)

  const filteredEmployees = employees.filter(employee => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const matchesSearch = 
        employee.name.toLowerCase().includes(search) ||
        employee.email.toLowerCase().includes(search) ||
        employee.department.toLowerCase().includes(search)
      if (!matchesSearch) return false
    }
    
    if (departmentFilter !== 'All' && employee.department !== departmentFilter) return false

    if (cardFilter === 'thisMonth') {
      if (employee.birthMonth !== new Date().getMonth()) return false
    } else if (cardFilter === 'upcoming') {
      if (employee.daysUntil === undefined || employee.daysUntil < 0 || employee.daysUntil > 7) return false
    } else if (cardFilter === 'today') {
      if (employee.daysUntil !== 0) return false
    } else if (cardFilter === 'All' && monthFilter !== 'All') {
      if (employee.birthMonth !== parseInt(monthFilter)) return false
    }

    return true
  }).sort((a, b) => (a.daysUntil || 365) - (b.daysUntil || 365))

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize))
  const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const handleExport = () => {
    const csvContent = [
      ['Name', 'Email', 'Employee ID', 'Department', 'Birth Date', 'Age', 'Days Until'].join(','),
      ...filteredEmployees.map(e => [
        e.name,
        e.email,
        e.employeeId || '',
        e.department,
        e.birthDate ? `${e.birthDay} ${MONTHS[e.birthMonth || 0]}` : '',
        e.age || '',
        e.daysUntil === 0 ? 'Today' : e.daysUntil
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `birthdays-${MONTHS[parseInt(monthFilter) || new Date().getMonth()].toLowerCase()}.csv`
    a.click()
  }

  const handleSendWish = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee) return
    setIsWishModalOpen(false)
    setWishMessage('')
    setSelectedEmployee(null)
  }

  const handleSaveBirthDate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee || !editForm.birthDate) return
    
    setActionError(null)
    setIsSaving(true)
    try {
      await updateEmployee(selectedEmployee.id, {
        birthDate: editForm.birthDate
      })
      
      // Refresh the list
      await fetchEmployees()
      
      setIsEditModalOpen(false)
      setSelectedEmployee(null)
      setEditForm({ birthDate: '' })
    } catch (err) {
      console.error('Error saving birth date:', err)
      setActionError(errText(err, 'Failed to save birth date. Please try again.'))
    } finally {
      setIsSaving(false)
    }
  }

  const openViewModal = (employee: BirthdayEmployee) => {
    setSelectedEmployee(employee)
    setIsViewModalOpen(true)
  }

  const openEditModal = (employee: BirthdayEmployee) => {
    setSelectedEmployee(employee)
    setEditForm({
      birthDate: employee.birthDate ? new Date(employee.birthDate).toISOString().split('T')[0] : ''
    })
    setIsEditModalOpen(true)
  }

  const openWishModal = (employee: BirthdayEmployee) => {
    setSelectedEmployee(employee)
    setWishMessage(`Happy Birthday ${employee.name}! Wishing you a fantastic year ahead filled with joy, success, and wonderful moments. Enjoy your special day!`)
    setIsWishModalOpen(true)
  }

  const handleCardFilter = (filterValue: string | null) => {
    if (!filterValue) return
    setCardFilter(prev => prev === filterValue ? 'All' : filterValue)
  }

  const getStatsCards = () => [
    { icon: Gift, label: 'Birthdays This Month', value: String(stats.thisMonth), action: 'View all birthdays', color: '#f97316', bgColor: '#fff7ed', filterValue: 'thisMonth' },
    { icon: Calendar, label: 'Upcoming', value: String(stats.upcoming), subtext: 'Next 7 days', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'upcoming' },
    { icon: Cake, label: 'Today', value: String(stats.today), subtext: 'Celebrating today', color: '#ef4444', bgColor: '#fef2f2', filterValue: 'today' }
  ]

  const formatBirthDate = (employee: BirthdayEmployee) => {
    if (!employee.birthMonth && !employee.birthDay) return '-'
    return `${employee.birthDay} ${MONTHS[employee.birthMonth || 0]}`
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Birthdays" breadcrumbs={['Dashboard', 'Birthdays']} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading birthdays...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Birthdays" breadcrumbs={['Dashboard', 'Birthdays']} />
        <div className="error-container">
          <AlertCircle size={48} color="#ef4444" />
          <p>{error}</p>
          <button onClick={fetchEmployees} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Birthdays" breadcrumbs={['Dashboard', 'Birthdays']} />
      
      <div className="page-content">
        <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        {/* Stats Cards */}
        <div className="stats-row birthday-stats">
          {getStatsCards().map((stat, idx) => (
            <div
              key={idx}
              className="stat-card-birthday"
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
                  <ChevronRight size={14} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="birthday-filters-section">
          <div className="search-add-row">
            <div className="search-filter birthday-search">
              <Search size={18} />
              <input type="text" placeholder="Search by employee name, department..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <button className="btn-outline" onClick={handleExport}><Download size={18} />Export</button>
          </div>
          <div className="filters-row birthday-filters">
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <select className="filter-select" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="All">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="filter-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="All">All Months</option>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <button className="btn-filter" onClick={() => {setDepartmentFilter('All'); setMonthFilter('All'); setSearchTerm(''); setCardFilter('All')}}>
              <X size={16} />Clear Filters
            </button>
          </div>
        </div>

        {/* Birthdays List Section */}
        <div className="birthday-section">
          <div className="section-header-birthday">
            <div className="section-title-group"><h3>Upcoming Birthdays</h3><p>View and manage employee birthdays. ({filteredEmployees.length} employees)</p></div>
            <div className="section-actions-birthday">
              <div className="view-toggle">
                <button className={viewMode === 'grid' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('grid')}><LayoutGrid size={18} /></button>
                <button className={viewMode === 'list' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('list')}><List size={18} /></button>
              </div>
            </div>
          </div>

          <div className="table-container">
            <table className="birthday-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Birth Date</th>
                  <th>Age</th>
                  <th>Days Until</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="no-data-cell">
                      <div className="no-data-message">
                        <Cake size={48} color="#9ca3af" />
                        <p>No birthdays found{companyName ? ` for ${companyName}` : ''}</p>
                        <span>Employees without birth dates won't appear here</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedEmployees.map((employee) => (
                    <tr key={employee.id} className={employee.daysUntil === 0 ? 'birthday-today' : ''}>
                      <td>
                        <div className="employee-cell">
                          <div className="employee-details">
                            <span className="employee-name">{employee.name}</span>
                            <span className="employee-email">{employee.email}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className="employee-id">{employee.employeeId || '-'}</span></td>
                      <td><span className="dept-badge" style={{ background: (employee.departmentColor || '#f97316') + '20', color: employee.departmentColor || '#f97316' }}>{employee.department}</span></td>
                      <td><span className="birth-date">{formatBirthDate(employee)}</span></td>
                      <td><span className="age-text">{employee.age ? `${employee.age} years` : '-'}</span></td>
                      <td>
                        <span className={`days-until ${employee.daysUntil === 0 ? 'today' : employee.daysUntil !== undefined && employee.daysUntil <= 7 ? 'soon' : ''}`}>
                          {employee.daysUntil === 0 ? '🎉 Today' : employee.daysUntil === 1 ? 'Tomorrow' : employee.daysUntil ? `${employee.daysUntil} days` : '-'}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button className="action-btn view" onClick={() => openViewModal(employee)}><Eye size={16} /></button>
                          {(hasPermission('employees.edit') || user?.role === 'executive') && (
                            <button className="action-btn edit" onClick={() => openEditModal(employee)}><Pencil size={16} /></button>
                          )}
                          {employee.daysUntil !== undefined && employee.daysUntil <= 7 && (
                            <button className="action-btn mail" onClick={() => openWishModal(employee)}><Mail size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bottom">
            <div className="pagination-info">
              <span className="showing-text">Showing {paginatedEmployees.length} of {employees.length} entries</span>
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

      {/* View Birthday Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Birthday Details" size="medium">
        {selectedEmployee && (
          <div className="birthday-details-view">
            <div className="birthday-header-modal">
              <div className="birthday-avatar-wrapper">
                {selectedEmployee.daysUntil === 0 && <span className="birthday-badge">🎂</span>}
              </div>
              <div className="birthday-header-info">
                <h3>{selectedEmployee.name}</h3>
                <p>{selectedEmployee.email}</p>
                <span className="dept-badge" style={{ background: (selectedEmployee.departmentColor || '#f97316') + '20', color: selectedEmployee.departmentColor || '#f97316' }}>
                  {selectedEmployee.department}
                </span>
              </div>
            </div>
            <div className="birthday-info-grid">
              <div className="detail-row"><span className="detail-label">Birth Date:</span><span className="detail-value">{formatBirthDate(selectedEmployee)}</span></div>
              <div className="detail-row"><span className="detail-label">Age:</span><span className="detail-value">{selectedEmployee.age ? `${selectedEmployee.age} years` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Employee ID:</span><span className="detail-value">{selectedEmployee.employeeId || '-'}</span></div>
              <div className="detail-row">
                <span className="detail-label">Days Until:</span>
                <span className={`detail-value ${selectedEmployee.daysUntil === 0 ? 'today' : ''}`}>
                  {selectedEmployee.daysUntil === 0 ? '🎉 Today!' : selectedEmployee.daysUntil === 1 ? 'Tomorrow' : selectedEmployee.daysUntil ? `${selectedEmployee.daysUntil} days` : '-'}
                </span>
              </div>
              <div className="detail-row"><span className="detail-label">Phone:</span><span className="detail-value">{selectedEmployee.phone || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Designation:</span><span className="detail-value">{selectedEmployee.designation || '-'}</span></div>
            </div>
            {selectedEmployee.daysUntil !== undefined && selectedEmployee.daysUntil <= 7 && (
              <div className="birthday-actions-modal">
                <button className="btn-primary" onClick={() => openWishModal(selectedEmployee)}>
                  <Send size={16} /> Send Birthday Wish
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Edit Birthday Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Birth Date" size="small">
        {selectedEmployee && (
          <form onSubmit={handleSaveBirthDate} className="modal-form">
            <div className="form-group">
              <label>Employee</label>
              <div className="employee-display" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#f9fafb', borderRadius: '8px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{selectedEmployee.name}</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>{selectedEmployee.email}</div>
                </div>
              </div>
            </div>
            <div className="form-group">
              <label>Birth Date</label>
              <input 
                type="date" 
                value={editForm.birthDate}
                onChange={(e) => setEditForm({ birthDate: e.target.value })}
                required
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Send Wish Modal */}
      <Modal isOpen={isWishModalOpen} onClose={() => setIsWishModalOpen(false)} title="Send Birthday Wish" size="medium">
        {selectedEmployee && (
          <form onSubmit={handleSendWish} className="modal-form">
            <div className="wish-recipient">
              <div>
                <h4>{selectedEmployee.name}</h4>
                <p>{selectedEmployee.email}</p>
              </div>
            </div>
            <div className="form-group">
              <label>Your Birthday Message</label>
              <textarea 
                value={wishMessage}
                onChange={(e) => setWishMessage(e.target.value)}
                placeholder="Write your birthday wish..."
                rows={5}
                required
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsWishModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={isSending}>
                {isSending ? 'Sending...' : <><Send size={16} /> Send Wish</>}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
