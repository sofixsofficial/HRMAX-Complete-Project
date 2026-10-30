import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckSquare, CheckCircle, Clock, AlertCircle, CalendarDays, PlusCircle, Search, Download, Plus, ChevronDown, Eye, Pencil, Trash2, Filter, LayoutGrid, List, ChevronLeft, ChevronRight, Loader2, Building2, Briefcase, Crown } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { ActionErrorBanner } from '../components/ActionErrorBanner'
import { errText } from '../aws/errors'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { useRoleBasedStats, useRoleBasedTitle } from '../hooks/useRoleBasedData'
import { getAllTasks, getTasksByCompany, getTasksByUser, createTask, updateTask, deleteTask, getTaskStats, updateTaskProgress } from '../services/taskService'
import { notifyTaskAssigned, notifyTlAction } from '../services/notificationService'
import { getAllEmployees, getEmployeesByCompany } from '../services/employeeService'
import { getAllUsers } from '../services/authService'
import { getAllCompanies } from '../services/companyService'
import type { Task, Employee, User, Company } from '../types/user'
import { isDate } from '../utils/dateUtils'
import { scopedCompanyIds } from '../utils/companyScope'
import './Tasks.css'
import './HolidayCalendar.css'

const PRIORITY_OPTIONS = ['High', 'Medium', 'Low']
const STATUS_OPTIONS = ['Pending', 'In Progress', 'Completed']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const INITIAL_FORM_DATA: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
  title: '',
  description: '',
  assignedTo: '',
  assignedToId: '',
  avatar: '',
  priority: 'Medium',
  status: 'Pending',
  dueDate: new Date(),
  progress: 0,
  companyId: '',
  departmentId: '',
  createdBy: ''
}

interface TaskFormProps {
  formData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
  setFormData: React.Dispatch<React.SetStateAction<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>>;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  onCancel: () => void;
  isSubmitting: boolean;
  employees: Employee[];
}

const TaskForm = ({ formData, setFormData, onSubmit, submitLabel, onCancel, isSubmitting, employees }: TaskFormProps) => {
  const handleEmployeeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedEmployeeId = e.target.value;
    if (selectedEmployeeId) {
      const selectedEmployee = employees.find(emp => emp.userId === selectedEmployeeId || emp.id === selectedEmployeeId);
      if (selectedEmployee) {
        setFormData(prev => ({
          ...prev,
          assignedToId: selectedEmployee.userId || selectedEmployee.id,
          assignedTo: selectedEmployee.name,
          avatar: selectedEmployee.avatar,
          departmentId: selectedEmployee.departmentId,
          companyId: selectedEmployee.companyId
        }));
      }
    }
  };

  return (
    <form onSubmit={onSubmit} className="modal-form">
      <div className="form-group">
        <label>Task Title *</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({...prev, title: e.target.value}))}
          placeholder="Enter task title"
          required
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))}
          placeholder="Task description..."
          rows={3}
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Assigned To *</label>
          <select
            value={formData.assignedToId}
            onChange={handleEmployeeChange}
            required
          >
            <option value="">Select Employee</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.userId || emp.id}>
                {emp.name} ({emp.employeeId})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Due Date *</label>
          <input
            type="date"
            value={formData.dueDate && isDate(formData.dueDate) ? formData.dueDate.toISOString().split('T')[0] : formData.dueDate}
            onChange={(e) => setFormData(prev => ({...prev, dueDate: new Date(e.target.value)}))}
            required
          />
        </div>
      </div>

    <div className="form-row">
      <div className="form-group">
        <label>Priority *</label>
        <select 
          value={formData.priority}
          onChange={(e) => setFormData(prev => ({...prev, priority: e.target.value as 'High' | 'Medium' | 'Low'}))}
          required
        >
          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Status *</label>
        <select 
          value={formData.status}
          onChange={(e) => setFormData(prev => ({...prev, status: e.target.value as 'Pending' | 'In Progress' | 'Completed'}))}
          required
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>

    <div className="form-group">
      <label>Progress: {formData.progress}%</label>
      <input 
        type="range" 
        min="0" 
        max="100" 
        value={formData.progress}
        onChange={(e) => setFormData(prev => ({...prev, progress: parseInt(e.target.value)}))}
      />
    </div>

    <div className="modal-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : submitLabel}</button>
    </div>
  </form>
  );
};

export function Tasks() {
  const [searchParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ total: 0, completed: 0, pending: 0, overdue: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Employees for dropdown
  const [employees, setEmployees] = useState<Employee[]>([])

  // Org context data
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])

  // Filters
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [executiveFilter, setExecutiveFilter] = useState('all')
  const [tlFilter, setTlFilter] = useState('all')

  // Track which card filter is active for visual state
  const [activeCardFilter, setActiveCardFilter] = useState<string>('All')

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  useEffect(() => {
    const status = searchParams.get('status')
    if (status) {
      setStatusFilter(status)
      setActiveCardFilter(status)
    }
  }, [])
  
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies: userCompanies, canAccessAllCompanies, selectedCompanyName, isLoading: companyLoading } = usePermissionScope('tasks')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const { canViewAllStats, isManager } = useRoleBasedStats()
  const canManageTasks = (canViewAllStats || isManager) && user?.role !== 'company-admin'
  const showOrgColumns = ['master-admin', 'company-admin', 'executive', 'team-leader'].includes(user?.role || '')
  const pageTitle = useRoleBasedTitle('Tasks')

  useEffect(() => {
    if (companyLoading) return
    fetchTasks()
    fetchStats()
    fetchEmployees()
    fetchOrgData()
  }, [effectiveCompanyId, userCompanies, user?.id, companyLoading])

  const fetchOrgData = async () => {
    const [users, comps] = await Promise.all([
      getAllUsers().catch(() => [] as User[]),
      getAllCompanies().catch(() => [] as Company[])
    ])
    setAllUsers(users)
    setCompanies(comps)
  }

  // Deep-linked "Assign Task" from a dashboard: `?assignee=<userId|employeeId>`
  // pre-fills the Add Task modal with that employee and opens it.
  const assigneeParam = searchParams.get('assignee')
  const assigneeApplied = useRef(false)
  useEffect(() => {
    if (!assigneeParam || assigneeApplied.current || employees.length === 0) return
    const target = employees.find(e => e.userId === assigneeParam || e.id === assigneeParam)
    if (target) {
      setFormData(prev => ({
        ...prev,
        assignedToId: target.userId || target.id,
        assignedTo: target.name,
        avatar: target.avatar,
        departmentId: target.departmentId,
        companyId: target.companyId,
      }))
      setIsAddModalOpen(true)
      assigneeApplied.current = true
    }
  }, [assigneeParam, employees])

  const fetchTasks = async () => {
    try {
      setLoading(true)
      let data: Task[]

      if (user?.role === 'master-admin') {
        data = await getAllTasks()
      } else if (user?.role === 'reporting-manager') {
        // RM: own + assigned employees' tasks. Company fetch, then the
        // visibleTasks scope below narrows it to self + team (fail-closed).
        // Without a company scope there is nothing safe to list → own rows.
        const cid = effectiveCompanyId || user.companyId || ''
        data = cid ? await getTasksByCompany(cid) : await getTasksByUser(user.id || '')
      } else if (effectiveCompanyId) {
        data = await getTasksByCompany(effectiveCompanyId)
      } else if (user?.role === 'executive' || user?.role === 'team-leader') {
        // All Companies mode — tasks across authorized companies
        const ids = scopedCompanyIds(null, userCompanies)
        const results = await Promise.all(ids.map(id => getTasksByCompany(id).catch(() => [] as Task[])))
        data = results.flat()
      } else {
        data = await getTasksByUser(user?.id || '')
      }

      setTasks(data)
      setError(null)
    } catch (err) {
      console.error('Error fetching tasks:', err)
      setError('Failed to load tasks. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const statsData = await getTaskStats(
        user?.role === 'master-admin' ? undefined : effectiveCompanyId || undefined,
        user?.role === 'executive' && !effectiveCompanyId ? user?.id || undefined : undefined
      )
      setStats(statsData)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }

  const fetchEmployees = async () => {
    try {
      let data: Employee[]
      if (user?.role === 'master-admin') {
        data = await getAllEmployees()
      } else if (effectiveCompanyId) {
        data = await getEmployeesByCompany(effectiveCompanyId)
      } else if (user?.role === 'executive' || user?.role === 'team-leader') {
        const ids = scopedCompanyIds(null, userCompanies)
        const results = await Promise.all(ids.map(id => getEmployeesByCompany(id).catch(() => [] as Employee[])))
        data = results.flat()
      } else if (user?.role === 'reporting-manager' && user?.companyId) {
        data = await getEmployeesByCompany(user.companyId).catch(() => [] as Employee[])
      } else {
        data = []
      }
      setEmployees(data)
    } catch (err) {
      console.error('Error fetching employees:', err)
    }
  }

  // ── lookup helpers ──────────────────────────────────────────
  const getCompanyName = (cid: string) => companies.find(c => c.id === cid)?.name || cid
  const getAssignedExecutiveId = (cid: string) => {
    const c = companies.find(c => c.id === cid)
    if (!c) return ''
    return (c as any).assignedExecutiveId || ''
  }
  const getAssignedExecutive = (cid: string) => {
    const execId = getAssignedExecutiveId(cid)
    if (!execId) return ''
    const exec = allUsers.find(u => u.id === execId)
    return exec?.name || ''
  }
  const getTLsForCompany = (cid: string) => {
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
  // Reporting Manager: own + assigned employees' tasks ONLY ("khud ka and
  // assigned employee ka tasks"). Team set mirrors the Attendance/Leave RM
  // resolvers (employee docs whose managerId/reportingManagerId is this RM),
  // plus the RM's own uid. Fail-closed: while the set is unresolved/empty of
  // team, ONLY self rows show — never the whole company's tasks.
  const rmScope = useMemo(() => {
    if (user?.role !== 'reporting-manager' || !user?.id) return null
    const ids = new Set<string>([user.id])
    employees.forEach(e => {
      if ((e as any).managerId === user.id || e.reportingManagerId === user.id) {
        if (e.userId) ids.add(e.userId)
        ids.add(e.id)
        if (e.employeeId) ids.add(e.employeeId)
      }
    })
    return ids
  }, [user?.role, user?.id, employees])

  const visibleTasks = tasks.filter(t => {
    if (user?.role === 'master-admin') return true
    if (user?.role === 'reporting-manager') {
      if (!rmScope) return false
      return rmScope.has(t.assignedToId) || rmScope.has(t.assignedTo)
    }
    if (user?.role === 'executive') {
      const execUser = allUsers.find(u => u.id === user.id)
      const cids: string[] = (execUser as any)?.assignedCompanyIds || []
      return cids.includes(t.companyId)
    }
    if (user?.role === 'team-leader') {
      const tlUser = allUsers.find(u => u.id === user.id)
      const linkedIds: string[] = (tlUser as any)?.linkedExecutiveIds || ((tlUser as any)?.reportingExecutiveId ? [(tlUser as any).reportingExecutiveId] : [])
      const allCompanyIds: string[] = allUsers
        .filter(u => linkedIds.includes(u.id))
        .flatMap((ex: any) => ex.assignedCompanyIds || [])
      return allCompanyIds.includes(t.companyId)
    }
    return true
  })

  // RM stat cards must reflect the SELF+TEAM list, not the company-wide
  // getTaskStats totals (those leak other teams' counts).
  const rmScopedStats = useMemo(() => {
    if (user?.role !== 'reporting-manager') return null
    return {
      total: visibleTasks.length,
      completed: visibleTasks.filter(t => t.status === 'Completed').length,
      pending: visibleTasks.filter(t => t.status === 'Pending').length,
      overdue: visibleTasks.filter(t => new Date(t.dueDate) < new Date() && t.status !== 'Completed').length,
    }
  }, [user?.role, visibleTasks])
  const effStats = rmScopedStats || stats

  // Assignment dropdown for RM: only their assigned employees ("My Team") —
  // never the whole company's staff.
  const rmTeamEmployees = useMemo(() => {
    if (user?.role !== 'reporting-manager') return employees
    return employees.filter(
      e => (e as any).managerId === user?.id || e.reportingManagerId === user?.id
    )
  }, [user?.role, user?.id, employees])

  // ── cascading filter options ──────────────────────────────
  const visibleExecIds = companyFilter === 'all'
    ? [...new Set(companies.map(c => getAssignedExecutiveId(c.id)).filter(Boolean))]
    : [getAssignedExecutiveId(companyFilter)].filter(Boolean)

  const filteredTlIds = (execId: string) => {
    const exec = allUsers.find(u => u.id === execId)
    return (exec as any)?.assignedTeamLeaderIds || []
  }

  const filteredCompanies = companyFilter === 'all' ? companies : companies.filter(c => c.id === companyFilter)
  const filteredExecUsers = executiveFilter === 'all'
    ? allUsers.filter(u => visibleExecIds.includes(u.id))
    : allUsers.filter(u => u.id === executiveFilter)

  const filteredTlUsers = tlFilter === 'all'
    ? allUsers.filter(u => filteredExecUsers.some(ex => filteredTlIds(ex.id).includes(u.id)))
    : allUsers.filter(u => u.id === tlFilter)

  const filteredTasks = visibleTasks.filter(task => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const matchesSearch = 
        task.title.toLowerCase().includes(search) ||
        task.description.toLowerCase().includes(search) ||
        task.assignedTo.toLowerCase().includes(search)
      if (!matchesSearch) return false
    }
    
    if (priorityFilter !== 'All' && task.priority !== priorityFilter) return false
    
    if (statusFilter !== 'All') {
      if (statusFilter === 'Overdue') {
        const now = new Date()
        const due = isDate(task.dueDate) ? task.dueDate : new Date(task.dueDate)
        if (!(due < now && task.status !== 'Completed')) return false
      } else if (task.status !== statusFilter) {
        return false
      }
    }

    if (companyFilter !== 'all' && task.companyId !== companyFilter) return false
    if (executiveFilter !== 'all') {
      const execId = getAssignedExecutiveId(task.companyId)
      if (execId !== executiveFilter) return false
    }
    if (tlFilter !== 'all') {
      const tlNames = getTLsForCompany(task.companyId)
      const tlUser = allUsers.find(u => u.id === tlFilter)
      if (!tlUser || !tlNames.includes(tlUser.name)) return false
    }

    if (selectedDate) {
      const due = isDate(task.dueDate) ? task.dueDate : new Date(task.dueDate)
      if (due.toDateString() !== selectedDate.toDateString()) return false
    } else {
      const due = isDate(task.dueDate) ? task.dueDate : new Date(task.dueDate)
      if (due.getMonth() !== currentMonth || due.getFullYear() !== currentYear) return false
    }
    
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const handleExport = () => {
    const csvContent = [
      ['Title', 'Assigned To', 'Company', 'Assigned Executive', 'Reporting TL', 'Priority', 'Status', 'Due Date', 'Progress'].join(','),
      ...filteredTasks.map(task => [
        task.title,
        task.assignedTo,
        getCompanyName(task.companyId),
        getAssignedExecutive(task.companyId),
        getTLsForCompany(task.companyId).join('; '),
        task.priority,
        task.status,
        task.dueDate && isDate(task.dueDate) ? task.dueDate.toLocaleDateString() : task.dueDate,
        task.progress + '%'
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tasks.csv'
    a.click()
  }

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError(null)
    setIsSubmitting(true)
    try {
      const cid = effectiveCompanyId || user?.companyId || ''
      await createTask({
        ...formData,
        companyId: cid,
        createdBy: user?.id || ''
      })
      if (formData.assignedToId) {
        notifyTaskAssigned(
          formData.assignedToId,
          user?.name || 'Manager',
          formData.title,
          cid
        ).catch(() => {})
      }
      if (user?.role === 'team-leader') {
        notifyTlAction(
          cid, 'task_created', 'New Task Created',
          `${user?.name || 'Team Leader'} assigned a task: ${formData.title}`,
          '/tasks', allUsers
        ).catch(() => {})
      }
      await fetchTasks()
      await fetchStats()
      setIsAddModalOpen(false)
      setFormData(INITIAL_FORM_DATA)
    } catch (err) {
      console.error('Error adding task:', err)
      setActionError(errText(err, 'Failed to add task. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTask) return
    
    setActionError(null)
    setIsSubmitting(true)
    try {
      await updateTask(selectedTask.id, formData)
      if (user?.role === 'team-leader') {
        notifyTlAction(
          selectedTask.companyId, 'task_updated', 'Task Updated',
          `${user?.name || 'Team Leader'} updated task: ${formData.title}`,
          '/tasks', allUsers
        ).catch(() => {})
      }
      await fetchTasks()
      await fetchStats()
      setIsEditModalOpen(false)
      setSelectedTask(null)
    } catch (err) {
      console.error('Error updating task:', err)
      setActionError(errText(err, 'Failed to update task. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return
    
    setActionError(null)
    try {
      const t = tasks.find(x => x.id === id)
      await deleteTask(id)
      if (user?.role === 'team-leader' && t) {
        notifyTlAction(
          t.companyId, 'task_deleted', 'Task Deleted',
          `${user?.name || 'Team Leader'} deleted task: ${t.title}`,
          '/tasks', allUsers
        ).catch(() => {})
      }
      await fetchTasks()
      await fetchStats()
    } catch (err) {
      console.error('Error deleting task:', err)
      setActionError(errText(err, 'Failed to delete task. Please try again.'))
    }
  }

  const handleProgressUpdate = async (id: string, progress: number) => {
    try {
      await updateTaskProgress(id, progress)
      await fetchTasks()
      await fetchStats()
    } catch (err) {
      console.error('Error updating progress:', err)
    }
  }

  const openEditModal = (task: Task) => {
    setSelectedTask(task)
    setFormData({
      title: task.title,
      description: task.description,
      assignedTo: task.assignedTo,
      assignedToId: task.assignedToId,
      avatar: task.avatar,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      progress: task.progress,
      companyId: task.companyId,
      departmentId: task.departmentId || '',
      createdBy: task.createdBy
    })
    setIsEditModalOpen(true)
  }

  const openViewModal = (task: Task) => {
    setSelectedTask(task)
    setIsViewModalOpen(true)
  }

  const handleCardFilter = (filterValue: string) => {
    if (activeCardFilter === filterValue) {
      setStatusFilter('All')
      setActiveCardFilter('All')
    } else {
      setStatusFilter(filterValue)
      setActiveCardFilter(filterValue)
    }
    setCurrentPage(1)
  }

  const handleStatusDropdownChange = (value: string) => {
    setStatusFilter(value)
    setActiveCardFilter(value)
    setCurrentPage(1)
  }

  const navigateMonth = (direction: number) => {
    const newMonth = currentMonth + direction
    if (newMonth > 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1) }
    else if (newMonth < 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1) }
    else { setCurrentMonth(newMonth) }
    setSelectedDate(null)
    setCurrentPage(1)
  }

  const getTasksForDate = (date: Date) => {
    const dateStr = date.toDateString()
    return visibleTasks.filter(t => {
      const d = isDate(t.dueDate) ? t.dueDate : new Date(t.dueDate)
      return d.toDateString() === dateStr && d.getMonth() === currentMonth && d.getFullYear() === currentYear
    })
  }

  const getStatsCards = () => {
    if (user?.role === 'executive') {
      return [
        { icon: CheckSquare, label: 'My Tasks', value: String(effStats.total), subtext: 'Assigned to me', color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' as const },
        { icon: CheckCircle, label: 'Completed', value: String(effStats.completed), subtext: 'Done', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'Completed' as const },
        { icon: AlertCircle, label: 'Pending', value: String(effStats.pending), subtext: 'To start', color: '#22c55e', bgColor: '#f0fdf4', filterValue: 'Pending' as const },
      ]
    }
    
    if (isManager) {
      return [
        { icon: CheckSquare, label: 'Team Tasks', value: String(effStats.total), action: 'View all', color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' as const },
        { icon: CheckCircle, label: 'Completed', value: String(effStats.completed), subtext: 'Done', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'Completed' as const },
        { icon: PlusCircle, label: 'Overdue', value: String(effStats.overdue), subtext: 'Requires attention', color: '#ef4444', bgColor: '#fef2f2', filterValue: 'Overdue' as const },
      ]
    }
    
    return [
      { icon: CheckSquare, label: 'Total Tasks', value: String(effStats.total), action: 'View all tasks', color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' as const },
      { icon: CheckCircle, label: 'Completed', value: String(effStats.completed), subtext: 'Done', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'Completed' as const },
      { icon: AlertCircle, label: 'Pending', value: String(effStats.pending), subtext: 'To start', color: '#22c55e', bgColor: '#f0fdf4', filterValue: 'Pending' as const },
      { icon: PlusCircle, label: 'Overdue', value: String(effStats.overdue), subtext: 'Requires attention', color: '#ef4444', bgColor: '#fef2f2', filterValue: 'Overdue' as const },
    ]
  }

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'High': return { bg: '#fee2e2', text: '#ef4444' }
      case 'Medium': return { bg: '#fef3c7', text: '#f59e0b' }
      case 'Low': return { bg: '#ffedd5', text: '#f97316' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'Completed': return { bg: '#dcfce7', text: '#16a34a' }
      case 'In Progress': return { bg: '#fef3c7', text: '#f59e0b' }
      case 'Pending': return { bg: '#f3f4f6', text: '#6b7280' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading tasks...</p>
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
          <button onClick={fetchTasks} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  const getTaskDots = (date: Date) => {
    const dateTasks = getTasksForDate(date)
    if (dateTasks.length === 0) return null
    const high = dateTasks.filter(t => t.priority === 'High').length
    const medium = dateTasks.filter(t => t.priority === 'Medium').length
    const low = dateTasks.filter(t => t.priority === 'Low').length
    const total = dateTasks.length
    return (
      <div className="holiday-dots-container">
        {high > 0 && <span className="holiday-dot" style={{ background: '#ef4444' }}></span>}
        {medium > 0 && <span className="holiday-dot" style={{ background: '#f59e0b' }}></span>}
        {low > 0 && <span className="holiday-dot" style={{ background: '#f97316' }}></span>}
        {total > 3 && <span className="holiday-dot-more">+{total - 3}</span>}
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
      
      <div className="page-content">
        <ScopeIndicator />
        <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        {/* Stats Cards */}
        <div className="stats-row holiday-stats">
          {getStatsCards().map((stat, idx) => {
            const Icon = stat.icon
            return (
              <div
                key={idx}
                className="stat-card-holiday"
                onClick={() => handleCardFilter(stat.filterValue)}
                style={{
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  border: activeCardFilter === stat.filterValue ? `2px solid ${stat.color}` : '2px solid transparent',
                  boxShadow: activeCardFilter === stat.filterValue ? `0 0 0 3px ${stat.color}30` : 'none'
                }}
              >
                <div className="stat-card-content">
                  <div className="stat-icon-wrapper" style={{ background: stat.bgColor, color: stat.color }}>
                    <Icon size={24} />
                  </div>
                  <div className="stat-details">
                    <span className="stat-label">{stat.label}</span>
                    <span className="stat-value">{stat.value}</span>
                    {stat.subtext && <span className="stat-subtext-single">{stat.subtext}</span>}
                  </div>
                </div>
                {(stat as any).action && (
                  <div className="stat-action">
                    <span>{(stat as any).action}</span>
                    <ChevronRight size={14} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Filters Section */}
        <div className="holiday-filters-section">
          <div className="search-add-row">
            <div className="search-filter">
              <Search size={18} />
              <input
                type="text"
                placeholder={user?.role === 'executive' ? "Search my tasks..." : "Search tasks..."}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
            {canViewAllStats && (
              <button className="btn-outline" onClick={handleExport}><Download size={18} />Export</button>
            )}
            {canPerform('create', 'tasks') && (
              <button className="btn-primary" onClick={() => setIsAddModalOpen(true)}><Plus size={18} />Add Task</button>
            )}
          </div>
          <div className="filters-row holiday-filters">
            <select className="filter-select" value={currentYear} onChange={(e) => setCurrentYear(parseInt(e.target.value))}>
              {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="filter-select" value={MONTHS[currentMonth]} onChange={(e) => setCurrentMonth(MONTHS.indexOf(e.target.value))}>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="filter-select" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Priorities</option>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="filter-select" value={statusFilter} onChange={(e) => { handleStatusDropdownChange(e.target.value); setCurrentPage(1) }}>
              <option value="All">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="Overdue">Overdue</option>
            </select>
            <select className="filter-select" value={companyFilter} onChange={(e) => { setCompanyFilter(e.target.value); setExecutiveFilter('all'); setTlFilter('all'); setCurrentPage(1) }}>
              {canAccessAllCompanies && <option value="all">All Companies</option>}
              {(canAccessAllCompanies ? companies : userCompanies).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Calendar and Tasks Section */}
        <div className="holiday-calendar-section">
          {/* Calendar View */}
          <div className="calendar-view">
            <div className="calendar-header">
              <div className="calendar-nav">
                <button className="calendar-nav-btn" onClick={() => navigateMonth(-1)}><ChevronLeft size={20} /></button>
                <button className="calendar-nav-btn" onClick={() => navigateMonth(1)}><ChevronRight size={20} /></button>
              </div>
              <h3 className="calendar-title">{MONTHS[currentMonth]} {currentYear}</h3>
              <button className="today-btn" onClick={() => { setCurrentMonth(new Date().getMonth()); setCurrentYear(new Date().getFullYear()); setSelectedDate(null); setCurrentPage(1) }}>Today</button>
            </div>
            <div className="calendar-grid">
              <div className="calendar-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="weekday">{day}</div>)}
              </div>
              <div className="calendar-days">
                {Array.from({ length: 42 }, (_, i) => {
                  const date = new Date(currentYear, currentMonth, 1)
                  const firstDay = date.getDay()
                  const dayNum = i - firstDay + 1
                  const currentDate = new Date(currentYear, currentMonth, dayNum)
                  const isCurrentMonth = currentDate.getMonth() === currentMonth
                  const isToday = currentDate.toDateString() === new Date().toDateString()
                  const isSelected = selectedDate && currentDate.toDateString() === selectedDate.toDateString()
                  return (
                    <div
                      key={i}
                      className={`calendar-day ${!isCurrentMonth ? 'prev-month' : ''} ${isToday ? 'today' : ''}`}
                      style={isSelected ? { background: '#f97316', color: '#fff', boxShadow: '0 0 0 2px #f97316' } : {}}
                      onClick={() => { if (isCurrentMonth) { setSelectedDate(currentDate); setCurrentPage(1) } }}
                    >
                      <span className="day-number">{currentDate.getDate()}</span>
                      {isCurrentMonth && getTaskDots(currentDate)}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="calendar-legend">
              <div className="legend-item"><span className="legend-dot" style={{ background: '#ef4444' }}></span>High Priority</div>
              <div className="legend-item"><span className="legend-dot" style={{ background: '#f59e0b' }}></span>Medium Priority</div>
              <div className="legend-item"><span className="legend-dot" style={{ background: '#f97316' }}></span>Low Priority</div>
            </div>
          </div>

          {/* Tasks List */}
          <div className="holidays-list-section">
            <div className="section-header-holidays">
              <div className="section-title-group">
                <h3>Tasks List</h3>
                <p>{selectedDate ? `Tasks due on ${selectedDate.toLocaleDateString('en-GB')}` : `Tasks for ${MONTHS[currentMonth]} ${currentYear}`}</p>
              </div>
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
                    <th>Task</th>
                    {showOrgColumns && <th>Assigned To</th>}
                    {showOrgColumns && <th>Company</th>}
                    {showOrgColumns && <th>Assigned Executive</th>}
                    {showOrgColumns && <th>Reporting TL</th>}
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Progress</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTasks.length === 0 ? (
                    <tr>
                      <td colSpan={showOrgColumns ? 10 : 6}>
                        <div className="empty-state">
                          <CheckSquare size={48} />
                          <h4>No tasks found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</h4>
                          <p>Try adjusting your search or filters</p>
                        </div>
                      </td>
                    </tr>
                  ) : paginatedTasks.map((task) => {
                    const priorityColors = getPriorityBadgeColor(task.priority)
                    const statusColors = getStatusBadgeColor(task.status)
                    return (
                      <tr key={task.id}>
                        <td className="holiday-name">{task.title}</td>
                        {showOrgColumns && (
                          <td><span className="text-sm text-gray-600 truncate max-w-[120px] block">{task.assignedTo}</span></td>
                        )}
                        {showOrgColumns && (
                          <td><span className="company-code">{getCompanyName(task.companyId)}</span></td>
                        )}
                        {showOrgColumns && (
                          <td>{getAssignedExecutive(task.companyId) ? <span className="company-code">{getAssignedExecutive(task.companyId)}</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        )}
                        {showOrgColumns && (
                          <td>{getTLsForCompany(task.companyId).length > 0
                            ? getTLsForCompany(task.companyId).map((tn: string, i: number) => <span key={i} className="company-code" style={{ marginRight: 4 }}>{tn}</span>)
                            : <span style={{ color: '#9ca3af' }}>—</span>}
                          </td>
                        )}
                        <td><span className="type-badge" style={{ background: priorityColors.bg, color: priorityColors.text }}>{task.priority}</span></td>
                        <td><span className="status-badge-holiday" style={{ background: statusColors.bg, color: statusColors.text }}>{task.status}</span></td>
                        <td><span className="holiday-date">{task.dueDate && isDate(task.dueDate) ? task.dueDate.toLocaleDateString('en-GB') : new Date(task.dueDate).toLocaleDateString('en-GB')}</span></td>
                        <td>
                          <div className="flex items-center gap-2.5 min-w-[120px]">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${task.progress}%`, background: task.progress === 100 ? '#10b981' : '#f97316' }}></div>
                            </div>
                            <span className="text-xs font-medium text-gray-500 w-8 text-right">{task.progress}%</span>
                          </div>
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button className="action-btn view" title="View" onClick={() => openViewModal(task)}><Eye size={16} /></button>
                            {canManageTasks && (
                              <>
                                {canPerform('edit', 'tasks') && (
                                  <button className="action-btn edit" title="Edit" onClick={() => openEditModal(task)}><Pencil size={16} /></button>
                                )}
                                {canPerform('delete', 'tasks') && (
                                  <button className="action-btn delete" title="Delete" onClick={() => handleDelete(task.id)}><Trash2 size={16} /></button>
                                )}
                              </>
                            )}
                            {(user?.role === 'executive') && task.status !== 'Completed' && (
                              <input type="range" min="0" max="100" value={task.progress} onChange={(e) => handleProgressUpdate(task.id, parseInt(e.target.value))} className="w-14" />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-bottom-holidays">
              <div className="pagination-info">
                <span className="showing-text">Showing {paginatedTasks.length} of {filteredTasks.length} entries</span>
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

      {/* Add Task Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Task" size="large">
        <TaskForm
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleAddTask}
          submitLabel="Add Task"
          onCancel={() => { setIsAddModalOpen(false); setFormData(INITIAL_FORM_DATA); }}
          isSubmitting={isSubmitting}
          employees={rmTeamEmployees}
        />
      </Modal>

      {/* Edit Task Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Task" size="large">
        <TaskForm
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleEditTask}
          submitLabel="Save Changes"
          onCancel={() => { setIsEditModalOpen(false); setSelectedTask(null); }}
          isSubmitting={isSubmitting}
          employees={rmTeamEmployees}
        />
      </Modal>

      {/* View Task Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Task Details" size="medium">
        {selectedTask && (
          <div className="company-details-view">
            <div className="detail-row"><span className="detail-label">Title:</span><span className="detail-value">{selectedTask.title}</span></div>
            <div className="detail-row"><span className="detail-label">Description:</span><span className="detail-value">{selectedTask.description}</span></div>
            <div className="detail-row"><span className="detail-label">Assigned To:</span><span className="detail-value">{selectedTask.assignedTo}</span></div>
            <div className="detail-row"><span className="detail-label">Company:</span><span className="detail-value">{getCompanyName(selectedTask.companyId)}</span></div>
            <div className="detail-row"><span className="detail-label">Assigned Executive:</span><span className="detail-value">{getAssignedExecutive(selectedTask.companyId) || '—'}</span></div>
            <div className="detail-row"><span className="detail-label">Reporting TL:</span><span className="detail-value">{getTLsForCompany(selectedTask.companyId).join(', ') || '—'}</span></div>
            <div className="detail-row"><span className="detail-label">Priority:</span><span className="detail-value">{selectedTask.priority}</span></div>
            <div className="detail-row"><span className="detail-label">Status:</span><span className="detail-value">{selectedTask.status}</span></div>
            <div className="detail-row"><span className="detail-label">Due Date:</span><span className="detail-value">{selectedTask.dueDate && isDate(selectedTask.dueDate) ? selectedTask.dueDate.toLocaleDateString() : selectedTask.dueDate}</span></div>
            <div className="detail-row"><span className="detail-label">Progress:</span><span className="detail-value">{selectedTask.progress}%</span></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
