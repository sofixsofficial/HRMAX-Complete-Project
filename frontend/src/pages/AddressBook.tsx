import { useState, useEffect } from 'react'
import { BookOpen, Users, Building2, MapPin, Phone, Search, Download, Plus, ChevronDown, Eye, Pencil, Trash2, Filter, LayoutGrid, List, ChevronLeft, ChevronRight, Loader2, X, AlertCircle } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { getAllEmployees, getEmployeesByCompany, updateEmployee } from '../services/employeeService'
import type { Employee } from '../types/user'
import './AddressBook.css'

const INITIAL_FORM_DATA: Partial<Employee> = {
  name: '',
  email: '',
  phone: '',
  address: '',
  emergencyContact: '',
  department: '',
  employeeId: ''
}

// Form component defined OUTSIDE main component to prevent re-renders
interface ContactFormProps {
  formData: Partial<Employee>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Employee>>>;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  onCancel: () => void;
  isSubmitting: boolean;
}

const ContactForm = ({ formData, setFormData, onSubmit, submitLabel, onCancel, isSubmitting }: ContactFormProps) => (
  <form onSubmit={onSubmit} className="modal-form">
    <div className="form-row">
      <div className="form-group">
        <label>Full Name</label>
        <input 
          type="text" 
          value={formData.name}
          onChange={(e) => setFormData(prev => ({...prev, name: e.target.value}))}
          placeholder="Enter full name"
          required
        />
      </div>
      <div className="form-group">
        <label>Email</label>
        <input 
          type="email" 
          value={formData.email}
          onChange={(e) => setFormData(prev => ({...prev, email: e.target.value}))}
          placeholder="Enter email"
          required
        />
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Employee ID</label>
        <input 
          type="text" 
          value={formData.employeeId}
          onChange={(e) => setFormData(prev => ({...prev, employeeId: e.target.value}))}
          placeholder="Enter employee ID"
        />
      </div>
      <div className="form-group">
        <label>Department</label>
        <input 
          type="text" 
          value={formData.department}
          onChange={(e) => setFormData(prev => ({...prev, department: e.target.value}))}
          placeholder="Enter department"
        />
      </div>
    </div>

    <div className="form-group">
      <label>Phone Number</label>
      <input 
        type="tel" 
        value={formData.phone}
        onChange={(e) => setFormData(prev => ({...prev, phone: e.target.value}))}
        placeholder="Enter phone number"
      />
    </div>

    <div className="form-group">
      <label>Address</label>
      <textarea 
        value={formData.address}
        onChange={(e) => setFormData(prev => ({...prev, address: e.target.value}))}
        placeholder="Enter full address"
        rows={3}
      />
    </div>

    <div className="form-group">
      <label>Emergency Contact</label>
      <input 
        type="tel" 
        value={formData.emergencyContact}
        onChange={(e) => setFormData(prev => ({...prev, emergencyContact: e.target.value}))}
        placeholder="Enter emergency contact number"
      />
    </div>

    <div className="modal-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : submitLabel}</button>
    </div>
  </form>
)

export function AddressBook() {
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Filters
  const [departmentFilter, setDepartmentFilter] = useState('All')
  const [cardFilter, setCardFilter] = useState('All')
  
  const { user } = useAuth()
  const { effectiveCompanyId, canAccessAllCompanies, availableCompanies, setSelectedCompanyId, selectedCompanyName } = usePermissionScope('addressbook')
  const [companyFilter, setCompanyFilter] = useState('all')

  // Use effectiveCompanyId for scoped fetching; null for unrestricted roles
  const activeCompanyId = canAccessAllCompanies && companyFilter === 'all' ? null : effectiveCompanyId
  const displayCompanyName = activeCompanyId ? (availableCompanies.find(c => c.id === activeCompanyId)?.name || '') : ''

  useEffect(() => {
    fetchEmployees()
  }, [activeCompanyId, user?.role])

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      setError(null)

      if (activeCompanyId) {
        const data = await getEmployeesByCompany(activeCompanyId)
        setEmployees(data)
      } else {
        const data = await getAllEmployees()
        setEmployees(data)
      }
    } catch (err: any) {
      console.error('Error fetching employees:', err)
      if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        setError(`Access denied. You do not have permission to view contacts${displayCompanyName ? ` for ${displayCompanyName}` : ''}.`)
      } else if (err?.code === 'unavailable' || err?.message?.includes('timeout')) {
        setError('Request timed out. Please check your connection and try again.')
      } else if (err?.message?.includes('index')) {
        setError('Database index is being built. Please wait a moment and retry.')
      } else {
        setError('Failed to load employee contacts.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Compute stats from loaded employees
  const stats = {
    total: employees.length,
    active: employees.filter(e => e.status === 'Active').length,
    departments: new Set(employees.map(e => e.department)).size,
    locations: new Set(employees.map(e => e.address?.split(',').pop()?.trim() || '')).size,
    withEmergencyContact: employees.filter(e => e.emergencyContact).length,
  }

  // Get unique departments for filter
  const departments = Array.from(new Set(employees.map(e => e.department))).filter(Boolean)

  const filteredEmployees = employees.filter(employee => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const matchesSearch = 
        employee.name.toLowerCase().includes(search) ||
        employee.email.toLowerCase().includes(search) ||
        employee.phone?.toLowerCase().includes(search) ||
        employee.address?.toLowerCase().includes(search) ||
        employee.employeeId?.toLowerCase().includes(search)
      if (!matchesSearch) return false
    }
    
    if (cardFilter === 'locations' && !employee.address) return false
    if (cardFilter === 'emergency' && !employee.emergencyContact) return false

    if (cardFilter === 'All' && departmentFilter !== 'All' && employee.department !== departmentFilter) return false

    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize))
  const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const handleExport = () => {
    const csvContent = [
      ['Name', 'Email', 'Employee ID', 'Department', 'Phone', 'Address', 'Emergency Contact'].join(','),
      ...filteredEmployees.map(e => [
        e.name,
        e.email,
        e.employeeId || '',
        e.department,
        e.phone || '',
        e.address || '',
        e.emergencyContact || ''
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `address-book-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee) return
    
    setIsSubmitting(true)
    try {
      await updateEmployee(selectedEmployee.id, formData)
      await fetchEmployees()
      setIsEditModalOpen(false)
      setSelectedEmployee(null)
      setFormData(INITIAL_FORM_DATA)
    } catch (err) {
      console.error('Error updating employee:', err)
      alert('Failed to update contact information')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee)
    setFormData({
      name: employee.name,
      email: employee.email,
      phone: employee.phone || '',
      address: employee.address || '',
      emergencyContact: employee.emergencyContact || '',
      department: employee.department,
      employeeId: employee.employeeId || ''
    })
    setIsEditModalOpen(true)
  }

  const openViewModal = (employee: Employee) => {
    setSelectedEmployee(employee)
    setIsViewModalOpen(true)
  }

  const handleCardFilter = (filterValue: string | null) => {
    if (!filterValue) return
    setCardFilter(prev => prev === filterValue ? 'All' : filterValue)
  }

  const getStatsCards = () => [
    { icon: Users, label: 'Total Contacts', value: String(stats.total), action: 'View all contacts', color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' },
    { icon: Building2, label: 'Departments', value: String(stats.departments), subtext: 'Across all teams', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'departments' },
    { icon: MapPin, label: 'Locations', value: String(stats.locations), subtext: 'Office locations', color: '#f59e0b', bgColor: '#fffbeb', filterValue: 'locations' },
    { icon: Phone, label: 'Emergency Contacts', value: String(stats.withEmergencyContact), subtext: 'Verified numbers', color: '#22c55e', bgColor: '#f0fdf4', filterValue: 'emergency' }
  ]

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Address Book" breadcrumbs={['Dashboard', 'Address Book']} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading contacts...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title="Address Book" breadcrumbs={['Dashboard', 'Address Book']} />
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
      <Header title="Address Book" breadcrumbs={['Dashboard', 'Address Book']} />
      
      <div className="page-content">
        {/* Stats Cards */}
        <div className="stats-row address-stats">
          {getStatsCards().map((stat, idx) => (
            <div
              key={idx}
              className="stat-card-address"
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
        <div className="address-filters-section">
          <div className="search-add-row">
            <div className="search-filter address-search">
              <Search size={18} />
              <input type="text" placeholder="Search contacts by name, email, phone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <button className="btn-outline" onClick={handleExport}><Download size={18} />Export</button>
          </div>
          <div className="filters-row address-filters">
            {canAccessAllCompanies && (
              <select className="filter-select" value={companyFilter} onChange={(e) => {
                setCompanyFilter(e.target.value)
                if (e.target.value !== 'all') {
                  const company = availableCompanies.find(c => c.id === e.target.value)
                  if (company) setSelectedCompanyId(company.id)
                }
                setCurrentPage(1)
              }}>
                <option value="all">All Companies</option>
                {availableCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <select className="filter-select" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="All">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button className="btn-filter" onClick={() => {setDepartmentFilter('All'); setSearchTerm(''); setCardFilter('All')}}>
              <X size={16} />Clear Filters
            </button>
          </div>
        </div>

        {/* Address Book List Section */}
        <div className="address-section">
          <div className="section-header-address">
            <div className="section-title-group"><h3>Address Book</h3><p>Manage and view contact information. ({filteredEmployees.length} contacts)</p></div>
            <div className="section-actions-address">
              <div className="view-toggle">
                <button className={viewMode === 'grid' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('grid')}><LayoutGrid size={18} /></button>
                <button className={viewMode === 'list' ? 'view-btn active' : 'view-btn'} onClick={() => setViewMode('list')}><List size={18} /></button>
              </div>
            </div>
          </div>

          <div className="table-container">
            <table className="address-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Emergency Contact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="no-data-cell">
                      <div className="no-data-message">
                        <BookOpen size={48} color="#9ca3af" />
                        <p>No contacts found{displayCompanyName ? ` for ${displayCompanyName}` : ''}</p>
                        <span>Try adjusting your search or filters</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <div className="contact-cell">
                          <div className="contact-details">
                            <span className="contact-name">{employee.name}</span>
                            <span className="contact-email">{employee.email}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className="employee-id">{employee.employeeId || '-'}</span></td>
                      <td><span className="dept-badge" style={{ background: (employee.departmentColor || '#f97316') + '20', color: employee.departmentColor || '#f97316' }}>{employee.department}</span></td>
                      <td><span className="phone-text">{employee.phone || '-'}</span></td>
                      <td><span className="address-text" title={employee.address}>{employee.address || '-'}</span></td>
                      <td><span className="emergency-text">{employee.emergencyContact || '-'}</span></td>
                      <td>
                        <div className="action-buttons">
                          <button className="action-btn view" onClick={() => openViewModal(employee)}><Eye size={16} /></button>
                          {canAccessAllCompanies && (
                            <button className="action-btn edit" onClick={() => openEditModal(employee)}><Pencil size={16} /></button>
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

      {/* Edit Contact Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Contact Information" size="large">
        <ContactForm 
          formData={formData} 
          setFormData={setFormData} 
          onSubmit={handleEdit} 
          submitLabel="Save Changes"
          onCancel={() => { setIsEditModalOpen(false); setSelectedEmployee(null); }}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* View Contact Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Contact Details" size="medium">
        {selectedEmployee && (
          <div className="contact-details-view">
            <div className="contact-header-modal">
              <div className="contact-header-info">
                <h3>{selectedEmployee.name}</h3>
                <p>{selectedEmployee.email}</p>
                <span className="dept-badge" style={{ background: (selectedEmployee.departmentColor || '#f97316') + '20', color: selectedEmployee.departmentColor || '#f97316' }}>
                  {selectedEmployee.department}
                </span>
              </div>
            </div>
            <div className="contact-info-grid">
              <div className="detail-row"><span className="detail-label">Employee ID:</span><span className="detail-value">{selectedEmployee.employeeId || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Designation:</span><span className="detail-value">{selectedEmployee.designation || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Phone:</span><span className="detail-value">{selectedEmployee.phone || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Address:</span><span className="detail-value">{selectedEmployee.address || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Emergency Contact:</span><span className="detail-value">{selectedEmployee.emergencyContact || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Employment Type:</span><span className="detail-value">{selectedEmployee.employmentType || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Status:</span><span className="detail-value">{selectedEmployee.status}</span></div>
              <div className="detail-row"><span className="detail-label">Join Date:</span><span className="detail-value">{selectedEmployee.joinDate ? new Date(selectedEmployee.joinDate).toLocaleDateString() : '-'}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
