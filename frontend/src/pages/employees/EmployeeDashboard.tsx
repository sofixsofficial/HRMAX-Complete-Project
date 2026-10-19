import { useState, useEffect } from 'react'
import { 
  Users, UserCheck, UserX, UserPlus, Building2, Shield,
  TrendingUp, ArrowRight, Loader2 
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { getAllDepartments } from '../../services/departmentService'
import { isDate } from '../../utils/dateUtils'
import './EmployeeDashboard.css'

const STAT_CARDS = [
  { key: 'total', icon: Users, label: 'Total Employees', color: '#f97316', bg: '#fff7ed', path: '/employees' },
  { key: 'active', icon: UserCheck, label: 'Active Employees', color: '#10b981', bg: '#ecfdf5', path: '/employees?status=Active' },
  { key: 'inactive', icon: UserX, label: 'Inactive Employees', color: '#ef4444', bg: '#fef2f2', path: '/employees?status=Inactive' },
  { key: 'newHires', icon: UserPlus, label: 'New This Month', color: '#3b82f6', bg: '#eff6ff', path: '/employees' },
  { key: 'departments', icon: Building2, label: 'Departments', color: '#8b5cf6', bg: '#f5f3ff', path: '/departments' },
  { key: 'roles', icon: Shield, label: 'Roles Assigned', color: '#06b6d4', bg: '#ecfeff', path: '/roles' },
]

export function EmployeeDashboard() {
  const [loading, setLoading] = useState(true)
  const [newHires, setNewHires] = useState(0)
  const [deptCount, setDeptCount] = useState(0)
  const navigate = useNavigate()
  const { user } = useAuth()
  const stats = useDashboardStats()

  useEffect(() => {
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const empsQuery = user?.companyId
      ? query(collection(db, 'employees'), where('companyId', '==', user.companyId))
      : collection(db, 'employees')

    const unsubEmps = onSnapshot(empsQuery, (snap) => {
      const newThisMonth = snap.docs.filter(d => {
        const data = d.data()
        const joinDate = isDate(data.joinDate) ? data.joinDate
          : data.joinDate?.toDate ? data.joinDate.toDate()
          : new Date(data.joinDate)
        return !isNaN(joinDate.getTime()) && joinDate >= firstOfMonth
      }).length
      setNewHires(newThisMonth)
      setLoading(false)
    }, () => setLoading(false))

    getAllDepartments().then(depts => {
      const filtered = user?.companyId
        ? depts.filter(d => d.companyId === user.companyId)
        : depts
      setDeptCount(filtered.length)
    }).catch(() => {})

    return () => unsubEmps()
  }, [user?.companyId])

  const displayStats = {
    total: stats.totalEmployees,
    active: stats.activeEmployees,
    inactive: stats.inactiveEmployees,
    newHires,
    departments: deptCount || stats.activeDepartments,
    roles: stats.totalRoles,
  }

  if (loading && stats.loading) {
    return (
      <div className="emp-dashboard-loading">
        <Loader2 size={32} className="spin" />
        <p>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="emp-dashboard">
      <div className="emp-dashboard-header">
        <div>
          <h2>Employee Dashboard</h2>
          <p>Overview of employee statistics and metrics</p>
        </div>
      </div>

      <div className="emp-stats-grid">
        {STAT_CARDS.map(card => {
          const Icon = card.icon
          const value = displayStats[card.key as keyof typeof displayStats]
          return (
            <div key={card.key} className="emp-stat-card" onClick={() => navigate(card.path)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(card.path) }}}>
              <div className="emp-stat-icon" style={{ background: card.bg, color: card.color }}>
                <Icon size={24} />
              </div>
              <div className="emp-stat-info">
                <span className="emp-stat-label">{card.label}</span>
                <span className="emp-stat-value">{value}</span>
              </div>
              <div className="emp-stat-trend">
                <TrendingUp size={14} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="emp-dashboard-bottom">
        <div className="emp-dashboard-card">
          <div className="emp-card-header">
            <h3><Users size={16} /> Quick Actions</h3>
          </div>
          <div className="emp-card-body">
            <button className="emp-action-btn" onClick={() => navigate('/employees')}>
              <UserPlus size={18} /> Add New Employee
            </button>
            <button className="emp-action-btn" onClick={() => navigate('/employees')}>
              <Users size={18} /> View All Employees
            </button>
            <button className="emp-action-btn" onClick={() => navigate('/roles')}>
              <Shield size={18} /> Manage Roles
            </button>
          </div>
        </div>

        <div className="emp-dashboard-card">
          <div className="emp-card-header">
            <h3><Building2 size={16} /> Department Summary</h3>
          </div>
          <div className="emp-card-body">
            <div className="emp-summary-row">
              <span>Total Departments</span>
              <strong>{displayStats.departments}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Total Employees</span>
              <strong>{displayStats.total}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Active Ratio</span>
              <strong>{displayStats.total > 0 ? Math.round((displayStats.active / displayStats.total) * 100) : 0}%</strong>
            </div>
            <div className="emp-summary-row">
              <span>Roles</span>
              <strong>{displayStats.roles}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
