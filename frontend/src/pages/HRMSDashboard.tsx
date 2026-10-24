import { useState, useEffect } from 'react'
import {
  LayoutDashboard, User, Clock, CalendarDays, Wallet, ListChecks, Umbrella,
  Sun, Cake, BookOpen, Mail, Megaphone, Calendar, LifeBuoy, LogOut,
  Menu, Bell, Search, ChevronRight, ChevronLeft,
  ArrowUpRight, Lock,
  Building2, Users, Shield, Briefcase, BarChart3, TrendingUp, FileText, Loader2
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { UserRole } from '../types/user'
import { collection, query, where, onSnapshot } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { useRealtimeDashboard } from '../hooks/useRealtimeDashboard'

type RoleOption = UserRole

interface NavItem {
  id: string
  label: string
  icon: any
  section: string
  employeeAccess: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Main', employeeAccess: true },
  { id: 'profile', label: 'My Profile', icon: User, section: 'Main', employeeAccess: true },
  { id: 'attendance', label: 'Attendance', icon: Clock, section: 'Operations', employeeAccess: false },
  { id: 'leaves', label: 'Leaves', icon: Umbrella, section: 'Operations', employeeAccess: false },
  { id: 'payroll', label: 'Payroll', icon: Wallet, section: 'Operations', employeeAccess: true },
  { id: 'tasks', label: 'Tasks', icon: ListChecks, section: 'Operations', employeeAccess: true },
  { id: 'timeoff', label: 'Time Off', icon: CalendarDays, section: 'Operations', employeeAccess: false },
  { id: 'holidays', label: 'Holidays', icon: Sun, section: 'Resources', employeeAccess: false },
  { id: 'birthdays', label: 'Birthdays', icon: Cake, section: 'Resources', employeeAccess: false },
  { id: 'addressbook', label: 'Address Book', icon: BookOpen, section: 'Resources', employeeAccess: false },
  { id: 'emails', label: 'Emails', icon: Mail, section: 'Communication', employeeAccess: false },
  { id: 'announcements', label: 'Announcements', icon: Megaphone, section: 'Communication', employeeAccess: false },
  { id: 'calendar', label: 'Calendar', icon: Calendar, section: 'Calendar', employeeAccess: false },
  { id: 'support', label: 'Support', icon: LifeBuoy, section: 'Administration', employeeAccess: false },
]

const SECTIONS = ['Main', 'Operations', 'Resources', 'Communication', 'Calendar', 'Administration']

interface DeptData {
  name: string
  count: number
  color: string
}

export function HRMSDashboard() {
  const { user } = useAuth()
  const companyId = user?.role === 'master-admin' ? null : user?.companyId
  const dashData = useRealtimeDashboard(companyId)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [departments, setDepartments] = useState<DeptData[]>([])

  useEffect(() => {
    const deptRef = companyId
      ? query(collection(db, 'departments'), where('companyId', '==', companyId))
      : collection(db, 'departments')
    const unsub = onSnapshot(deptRef, (snapshot) => {
      const depts = snapshot.docs.map(d => d.data())
      const colors = ['#f97316', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#3b82f6', '#14b8a6']
      setDepartments(depts.map((d: any, i: number) => ({
        name: d.name || 'Unknown',
        count: d.employeeCount || 0,
        color: d.color || colors[i % colors.length],
      })))
    }, () => setDepartments([]))
    return () => unsub()
  }, [companyId])
  const [activeItem, setActiveItem] = useState('dashboard')

  const effectiveRole: RoleOption = (user?.role as RoleOption) || 'master-admin'
  const isEmployee = effectiveRole === 'employee'

  const visibleItems = NAV_ITEMS.filter(i => isEmployee ? i.employeeAccess : true)

  const activeNav = NAV_ITEMS.find(i => i.id === activeItem)!

  const renderContent = () => {
    if (activeItem === 'dashboard') {
      if (isEmployee) return renderEmployeeDashboard()
      return renderHRDashboard()
    }
    if (activeItem === 'profile') return renderProfile()
    if (activeItem === 'payroll') return renderPayroll()
    if (activeItem === 'tasks') return renderTasks()
    if (!isEmployee) {
      if (activeItem === 'attendance') return renderAttendance()
      if (activeItem === 'leaves') return renderLeaves()
      if (activeItem === 'timeoff') return renderTimeOff()
      if (activeItem === 'holidays') return renderHolidays()
      if (activeItem === 'birthdays') return renderBirthdays()
      if (activeItem === 'addressbook') return renderAddressBook()
      if (activeItem === 'emails') return renderEmails()
      if (activeItem === 'announcements') return renderAnnouncements()
      if (activeItem === 'calendar') return renderCalendar()
      if (activeItem === 'support') return renderSupport()
    }
    return <AccessDenied />
  }

  return (
    <div className="h-screen flex bg-gray-50 font-sans overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-40 flex flex-col bg-slate-900 text-white transition-all duration-300 ease-in-out ${
        sidebarOpen ? 'w-64' : 'w-0 lg:w-16'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>

        {/* Logo */}
        <div className={`flex items-center h-16 px-4 border-b border-slate-700/50 ${!sidebarOpen && 'lg:justify-center'}`}>
          {sidebarOpen ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold text-sm">H</div>
              <span className="font-semibold text-sm tracking-wide">HRMS Portal</span>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold text-sm">H</div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin scrollbar-thumb-slate-600">
          {SECTIONS.map(section => {
            const items = visibleItems.filter(i => i.section === section)
            if (items.length === 0) return null
            return (
              <div key={section}>
                {sidebarOpen && (
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 px-3 mb-2">{section}</p>
                )}
                <div className="space-y-0.5">
                  {items.map(item => {
                    const Icon = item.icon
                    const active = activeItem === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveItem(item.id); setMobileOpen(false) }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                          active
                            ? 'bg-orange-500/15 text-orange-400 font-medium'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        } ${!sidebarOpen && 'lg:justify-center lg:px-0'}`}
                        title={sidebarOpen ? undefined : item.label}
                      >
                        <Icon size={20} className="shrink-0" />
                        {sidebarOpen && <span className="truncate">{item.label}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Sidebar footer */}
        <div className={`p-3 border-t border-slate-700/50 ${!sidebarOpen && 'lg:flex lg:justify-center'}`}>
          {sidebarOpen ? (
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-red-400 transition-all">
              <LogOut size={20} />
              <span>Sign Out</span>
            </button>
          ) : (
            <button className="p-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-red-400 transition-all">
              <LogOut size={20} />
            </button>
          )}
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top navbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{activeNav?.label || 'Dashboard'}</h1>
              <p className="text-xs text-gray-400 hidden sm:block">Dashboard &gt; {activeNav?.label || 'Dashboard'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400 w-48 lg:w-64">
              <Search size={16} />
              <input type="text" placeholder="Search anything..." className="bg-transparent outline-none text-gray-600 w-full placeholder:text-gray-400" />
            </div>

            {/* Bell */}
            <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Bell size={20} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
            </button>

            {/* Avatar */}
            <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
              <div className="hidden lg:block">
                <p className="text-sm font-medium text-gray-900 leading-tight">{user?.name || 'User'}</p>
                <p className="text-xs text-gray-400 capitalize">{effectiveRole.replace('-', ' ')}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  )

  function renderEmployeeDashboard() {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'My Tasks', value: 'Assigned to you', icon: ListChecks, color: '#f97316', bg: '#fff7ed' },
            { label: 'Payroll', value: 'Your payslips only', icon: Wallet, color: '#10b981', bg: '#ecfdf5' },
            { label: 'Access', value: 'Employee view', icon: Shield, color: '#f59e0b', bg: '#fffbeb' },
            { label: 'HR/Admin', value: 'Restricted', icon: Lock, color: '#8b5cf6', bg: '#f5f3ff' },
          ].map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{s.label}</p>
                    <p className="text-lg font-medium text-gray-900 mt-1">{s.value}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: s.bg, color: s.color }}>
                    <Icon size={20} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">My Tasks</h3>
            </div>
            <div className="p-8 flex flex-col items-center justify-center text-center text-gray-400">
              <ListChecks size={40} className="mb-3 opacity-50" />
              <p className="font-medium text-gray-600">Tasks assigned to you will appear here</p>
              <p className="text-sm mt-1">Only tasks explicitly assigned to you are visible</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">My Payslips</h3>
            </div>
            <div className="p-8 flex flex-col items-center justify-center text-center text-gray-400">
              <Wallet size={40} className="mb-3 opacity-50" />
              <p className="font-medium text-gray-600">Your payslips will appear here</p>
              <p className="text-sm mt-1">You can only view your own payroll records</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Restricted Access</h3>
          </div>
          <div className="p-5 flex flex-wrap gap-3">
            {[
              { icon: Clock, label: 'Attendance', color: '#f97316', desc: 'HR/Admin only' },
              { icon: Umbrella, label: 'Leaves', color: '#10b981', desc: 'HR/Admin only' },
              { icon: CalendarDays, label: 'Time Off', color: '#f59e0b', desc: 'HR/Admin only' },
              { icon: Sun, label: 'Holidays', color: '#8b5cf6', desc: 'HR/Admin only' },
            ].map((q, i) => {
              const Icon = q.icon
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-gray-50/50 text-sm text-gray-400">
                  <Icon size={16} style={{ color: q.color }} />
                  <div>
                    <span className="text-gray-600">{q.label}</span>
                    <span className="text-xs ml-2 text-gray-400">({q.desc})</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderHRDashboard() {
    if (dashData.loading) {
      return (
        <div className="p-4 lg:p-6 flex items-center justify-center min-h-[300px]">
          <div className="text-center text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading dashboard data...</p>
          </div>
        </div>
      )
    }
    const totalEmp = dashData.totalEmployees
    const maxDeptCount = Math.max(...departments.map(d => d.count), 1)
    return (
      <div className="p-4 lg:p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Employees', value: totalEmp, icon: Users, color: '#f97316', bg: '#fff7ed', trend: `${dashData.activeEmployees} active` },
            { label: 'Present Today', value: dashData.presentToday, icon: Clock, color: '#10b981', bg: '#ecfdf5', trend: `${dashData.lateToday} late` },
            { label: 'On Leave', value: dashData.onLeaveToday, icon: Umbrella, color: '#f59e0b', bg: '#fffbeb', trend: `${dashData.pendingLeaves} pending` },
            { label: 'Payroll Records', value: dashData.salaryGenerated, icon: Wallet, color: '#8b5cf6', bg: '#f5f3ff', trend: 'Total records' },
          ].map((card, i) => {
            const Icon = card.icon
            return (
              <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{card.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{card.trend}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: card.bg, color: card.color }}>
                    <Icon size={20} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Department breakdown */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Department Overview</h3>
              <span className="text-xs text-orange-500 font-medium cursor-pointer hover:underline">View All</span>
            </div>
            <div className="p-5 space-y-4">
              {departments.length === 0 ? (
                <div className="text-center text-gray-400 py-6">
                  <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No departments yet</p>
                </div>
              ) : (
                departments.map((dept, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: dept.color }} />
                        <span className="font-medium text-gray-900">{dept.name}</span>
                      </div>
                      <span className="text-gray-500">{dept.count} employees</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(dept.count / maxDeptCount) * 100}%`, background: dept.color }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Quick Actions</h3>
            </div>
            <div className="p-5 space-y-2">
              {[
                { icon: User, label: 'Add Employee', desc: 'Create new employee record', color: '#f97316' },
                { icon: FileText, label: 'Process Payroll', desc: 'Run the complete monthly payroll', color: '#10b981' },
                { icon: BarChart3, label: 'Generate Report', desc: 'Export HR analytics', color: '#f59e0b' },
                { icon: Building2, label: 'Manage Departments', desc: 'Update department structure', color: '#8b5cf6' },
                { icon: Briefcase, label: 'Post Job', desc: 'Create new job listing', color: '#ec4899' },
                { icon: TrendingUp, label: 'View Analytics', desc: 'Review performance metrics', color: '#06b6d4' },
              ].map((action, i) => {
                const Icon = action.icon
                return (
                  <button key={i} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-all text-left">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${action.color}15`, color: action.color }}>
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{action.label}</p>
                      <p className="text-xs text-gray-400 truncate">{action.desc}</p>
                    </div>
                    <ArrowUpRight size={16} className="text-gray-300 shrink-0" />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Attendance summary */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Today's Attendance</h3>
            <span className="text-xs text-orange-500 font-medium cursor-pointer hover:underline">Full Report</span>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Present', value: dashData.presentToday, color: '#10b981', bg: '#ecfdf5' },
              { label: 'Absent', value: dashData.absentToday, color: '#ef4444', bg: '#fef2f2' },
              { label: 'Late', value: dashData.lateToday, color: '#f59e0b', bg: '#fffbeb' },
              { label: 'On Leave', value: dashData.onLeaveToday, color: '#8b5cf6', bg: '#f5f3ff' },
            ].map((item, i) => (
              <div key={i} className="text-center p-4 rounded-lg" style={{ background: item.bg }}>
                <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                <p className="text-sm text-gray-600 mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderProfile() {
    return (
      <div className="p-4 lg:p-6 max-w-3xl space-y-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.name || 'User'}</h2>
              <p className="text-sm text-gray-500">{user?.email || ''}</p>
              <span className="inline-block mt-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-600 capitalize">{effectiveRole.replace('-', ' ')}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Personal Information</h3>
          <p className="text-sm text-gray-400">Profile details from user record will be displayed here.</p>
        </div>
      </div>
    )
  }

  function renderPayroll() {
    if (isEmployee) {
      return (
        <div className="p-4 lg:p-6 max-w-2xl">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 flex flex-col items-center justify-center text-center">
            <Wallet size={48} className="mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">Your Payslips</h3>
            <p className="text-sm text-gray-500 mt-2 max-w-md">
              As an Employee, you can only view your own payroll records. 
              Your payslips will appear here once generated by HR/Admin.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-4 py-2 rounded-lg">
              <Lock size={14} />
              <span>Employee access — your records only</span>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Payslips', value: dashData.salaryGenerated.toString(), sub: `${dashData.salaryGenerated > 0 ? 'Recorded' : 'No records'}` },
            { label: 'Pending Payslips', value: '0', sub: 'Awaiting generation' },
            { label: 'YTD Records', value: dashData.salaryGenerated.toString(), sub: 'Year to date' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Payslip History</h3>
            <span className="text-xs text-orange-500 font-medium cursor-pointer hover:underline">Download All</span>
          </div>
          <div className="p-8 flex flex-col items-center justify-center text-center text-gray-400">
            <Wallet size={40} className="mb-3 opacity-50" />
            <p className="font-medium text-gray-600">No payslips yet</p>
            <p className="text-sm mt-1">Payslips will appear here once generated from payroll processing</p>
          </div>
        </div>
      </div>
    )
  }

  function renderTasks() {
    if (isEmployee) {
      return (
        <div className="p-4 lg:p-6 max-w-2xl">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 flex flex-col items-center justify-center text-center">
            <ListChecks size={48} className="mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">My Tasks</h3>
            <p className="text-sm text-gray-500 mt-2 max-w-md">
              As an Employee, you can only see tasks explicitly assigned to you. 
              Your assigned tasks will appear here with due dates and priority levels.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-4 py-2 rounded-lg">
              <Lock size={14} />
              <span>Employee access — your tasks only</span>
            </div>
          </div>
        </div>
      )
    }

    const totalTasks = dashData.pendingTasks + dashData.completedTasks + dashData.inProgressTasks + dashData.overdueTasks
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Tasks', value: totalTasks, color: '#f97316' },
            { label: 'In Progress', value: dashData.inProgressTasks, color: '#10b981' },
            { label: 'Pending', value: dashData.pendingTasks, color: '#f59e0b' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">All Tasks</h3>
            <div className="flex items-center gap-2">
              <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Filter</button>
              <button className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600">+ New Task</button>
            </div>
          </div>
          <div className="p-8 flex flex-col items-center justify-center text-center text-gray-400">
            <ListChecks size={40} className="mb-3 opacity-50" />
            <p className="font-medium text-gray-600">No tasks yet</p>
            <p className="text-sm mt-1">Tasks will appear here once created in the Task Management module</p>
          </div>
        </div>
      </div>
    )
  }

  function renderAttendance() {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Present', value: dashData.presentToday, color: '#10b981' },
            { label: 'Absent', value: dashData.absentToday, color: '#ef4444' },
            { label: 'Late', value: dashData.lateToday, color: '#f59e0b' },
            { label: 'On Leave', value: dashData.onLeaveToday, color: '#8b5cf6' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <Clock size={40} className="mx-auto mb-3" />
            <p className="font-medium">Attendance Overview</p>
            <p className="text-sm mt-1">View detailed attendance in the Attendance module</p>
          </div>
        </div>
      </div>
    )
  }

  function renderLeaves() {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending', value: dashData.pendingLeaves, color: '#f59e0b' },
            { label: 'Approved', value: dashData.approvedLeaves, color: '#10b981' },
            { label: 'On Leave Today', value: dashData.onLeaveToday, color: '#8b5cf6' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <Umbrella size={40} className="mx-auto mb-3" />
            <p className="font-medium">Leave Management</p>
            <p className="text-sm mt-1">Manage leave requests in the Leaves module</p>
          </div>
        </div>
      </div>
    )
  }

  function renderTimeOff() { return <Placeholder icon={CalendarDays} title="Time Off" /> }
  function renderHolidays() { return <Placeholder icon={Sun} title="Holidays" /> }
  function renderBirthdays() { return <Placeholder icon={Cake} title="Birthdays" /> }
  function renderAddressBook() { return <Placeholder icon={BookOpen} title="Address Book" /> }
  function renderEmails() { return <Placeholder icon={Mail} title="Emails" /> }
  function renderAnnouncements() { return <Placeholder icon={Megaphone} title="Announcements" /> }
  function renderCalendar() { return <Placeholder icon={Calendar} title="Calendar" /> }
  function renderSupport() { return <Placeholder icon={LifeBuoy} title="Support" /> }

  function Placeholder({ icon: Icon, title }: { icon: any; title: string }) {
    return (
      <div className="p-4 lg:p-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <Icon size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium text-gray-600">{title}</p>
            <p className="text-sm mt-1">{effectiveRole === 'employee' ? 'This section is not available in employee view.' : 'Full module view available.'}</p>
          </div>
        </div>
      </div>
    )
  }

  function AccessDenied() {
    return (
      <div className="p-4 lg:p-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 flex items-center justify-center">
          <div className="text-center">
            <Shield size={48} className="mx-auto mb-4 text-red-300" />
            <p className="text-lg font-semibold text-gray-900">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-1">This section requires HR/Admin privileges.</p>
            <span className="inline-block mt-3 text-xs font-medium px-3 py-1.5 rounded-full bg-red-50 text-red-600">
              Switch to HR MAX role to access this module
            </span>
          </div>
        </div>
      </div>
    )
  }
}

function Download({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
