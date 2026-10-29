import { useState, useEffect, useCallback } from 'react'
import {
  LayoutDashboard, Building2, Users, FileText, CheckSquare,
  BarChart3, Settings, LogOut,
  Wallet, PartyPopper, ChevronLeft, ChevronRight,
  Calendar, Crown, UserPlus, Megaphone,
  UserCog, Building, User, Mail, Cake,
  HelpCircle, Network, Clock, UserRound,
  TrendingUp, ArrowRightLeft, AlertCircle, ChevronDown,
  CalendarDays, BadgeDollarSign, Percent, History, FolderOpen, ScrollText,
  Landmark, BookUser, KeyRound, MapPinned
} from 'lucide-react'
import { Logo } from './Logo'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccessControl } from '../context/AccessControlContext'
import { useCompany } from '../context/CompanyContext'
import { useSidebar } from '../context/SidebarContext'
import { useTLFilter } from '../context/TLFilterContext'
import { getEmployeeByUserId } from '../services/employeeService'
import { roleDepartmentLabel } from '../utils/roleLabels'
import './Sidebar.css'

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  requiredPermission?: string;
  requiredRoles?: string[];
  /** Operations that need a company scope (CRUD-heavy pages) */
  requiresScope?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, hasPermission, hasRole } = useAuth()
  const { isScopeReady } = useAccessControl()
  const { selectedCompanyId: scopeCid, selectedCompanyName, availableCompanies, setSelectedCompanyId } = useCompany()
  const { collapsed, toggle } = useSidebar()
  const currentPath = location.pathname
  const [scopeToast, setScopeToast] = useState<string | null>(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActive = (path: string) => {
    if (path === '/') {
      return currentPath === '/' || currentPath === `${rolePrefix}/dashboard`
    }
    return currentPath === `${rolePrefix}${path}` || currentPath.startsWith(`${rolePrefix}${path}/`)
  }

  const filterItems = (items: NavItem[]) =>
    items.filter(item => {
      if (item.requiredPermission && !hasPermission(item.requiredPermission)) return false
      if (item.requiredRoles && !hasRole(item.requiredRoles as any)) return false
      return true
    })

  /** Scope-aware navigation: blocks CRUD-heavy pages when no company selected */
  const rolePrefix = user?.role ? `/${user.role}` : ''
  const handleNav = useCallback((item: NavItem) => {
    if (item.requiresScope && !isScopeReady) {
      const msg = 'Please select a company first to access this section.'
      setScopeToast(msg)
      setTimeout(() => setScopeToast(null), 3000)
      return
    }
    // The Dashboard entry is authored as '/' so it reads identically in every
    // role sidebar, but joining that onto the role prefix produced
    // `/master-admin/` - a path no route matches, so the app dropped to 404.
    const target = item.path === '/' ? `${rolePrefix}/dashboard` : `${rolePrefix}${item.path}`
    navigate(target)
  }, [isScopeReady, rolePrefix, navigate])

  const isTeamLeader = user?.role === 'team-leader'
  const isExecutive = user?.role === 'executive'
  const isReportingManagerRole = user?.role === 'reporting-manager'
  const [isReportingManager, setIsReportingManager] = useState(false)

  // ── Role-specific sidebar data ──
  const tlFilter = useTLFilter()
  const [tlExecOpen, setTlExecOpen] = useState(false)

  useEffect(() => {
    if (!user || isTeamLeader || isExecutive || isReportingManagerRole) {
      setIsReportingManager(isReportingManagerRole)
      return
    }
    getEmployeeByUserId(user.id).then(emp => {
      setIsReportingManager(!!(emp as any)?.isReportingManager)
    }).catch(() => setIsReportingManager(false))
  }, [user, isTeamLeader, isExecutive, isReportingManagerRole])

  const teamLeaderSections: NavSection[] = [
    {
      title: 'Main',
      items: filterItems([
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: UserRound, label: 'My Leaves & Attendance', path: '/my-leaves-attendance' },
      ])
    },
    {
      title: 'Organization',
      items: filterItems([
        { icon: Building2, label: 'Companies', path: '/companies', requiredRoles: ['team-leader'], requiredPermission: 'companies.view' },
        { icon: Users, label: 'Employees', path: '/employees', requiredRoles: ['team-leader'], requiredPermission: 'employees.view', requiresScope: true },
        { icon: Crown, label: 'Executives', path: '/executives', requiredRoles: ['team-leader'], requiredPermission: 'executives.view', requiresScope: true },
        { icon: Network, label: 'Departments', path: '/departments', requiredRoles: ['team-leader'], requiredPermission: 'departments.view', requiresScope: true },
        { icon: MapPinned, label: 'Branches', path: '/branches', requiredRoles: ['team-leader'], requiresScope: true },
      ])
    },
    {
      title: 'Team Management',
      items: filterItems([
        { icon: Clock, label: 'Attendance', path: '/attendance', requiresScope: true },
        { icon: CalendarDays, label: 'Leaves', path: '/leaves', requiresScope: true },
        { icon: Cake, label: 'Birthdays', path: '/birthdays' },
        { icon: BookUser, label: 'Address Book', path: '/address-book', requiredRoles: ['team-leader'] },
        { icon: Mail, label: 'Emails', path: '/emails' },
        { icon: Wallet, label: 'Payroll', path: '/payroll', requiredRoles: ['team-leader'], requiresScope: true },
        { icon: History, label: 'Payroll History', path: '/payroll-history', requiredRoles: ['team-leader'], requiresScope: true },
        { icon: FileText, label: 'Salary Slips', path: '/salary-slips', requiredRoles: ['team-leader'], requiresScope: true },
      ])
    },
    {
      title: 'Work Management',
      items: filterItems([
        { icon: CheckSquare, label: 'Tasks', path: '/tasks', requiresScope: true },
        { icon: Calendar, label: 'Calendar', path: '/calendar' },
      ])
    },
    {
      title: 'Company Info',
      items: filterItems([
        { icon: PartyPopper, label: 'Holidays', path: '/holidays' },
        { icon: Megaphone, label: 'Announcements', path: '/announcements', requiredRoles: ['team-leader'] },
      ])
    },
    {
      title: 'Analytics & Reporting',
      items: filterItems([
        { icon: BarChart3, label: 'Reports', path: '/reports', requiredRoles: ['team-leader'] },
        { icon: TrendingUp, label: 'Analytics', path: '/analytics', requiredRoles: ['team-leader'] },
      ])
    },
    {
      title: 'System',
      items: filterItems([
        { icon: Settings, label: 'Settings', path: '/settings' },
        { icon: HelpCircle, label: 'Support', path: '/support' },
      ])
    },
  ]

  const executiveSections: NavSection[] = [
    {
      title: 'Main',
      items: filterItems([
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: UserRound, label: 'My Leaves & Attendance', path: '/my-leaves-attendance' },
      ])
    },
    {
      title: 'People',
      items: filterItems([
        { icon: Users, label: 'Employees', path: '/employees', requiredPermission: 'employees.view', requiresScope: true },
        { icon: Crown, label: 'Executives', path: '/executives', requiredPermission: 'employees.view', requiresScope: true },
        { icon: BookUser, label: 'Address Book', path: '/address-book', requiredPermission: 'employees.view' },
      ])
    },
    {
      title: 'Operations',
      items: filterItems([
        { icon: Clock, label: 'Attendance', path: '/attendance', requiredPermission: 'attendance.view', requiresScope: true },
        { icon: CalendarDays, label: 'Leaves', path: '/leaves', requiredPermission: 'leave.view', requiresScope: true },
        { icon: CheckSquare, label: 'Tasks', path: '/tasks', requiredPermission: 'tasks.view', requiresScope: true },
        { icon: Wallet, label: 'Payroll', path: '/payroll', requiredPermission: 'payroll.view', requiresScope: true },
        { icon: History, label: 'Payroll History', path: '/payroll-history', requiredPermission: 'payroll.view', requiresScope: true },
        { icon: FileText, label: 'Salary Slips', path: '/salary-slips', requiredPermission: 'salary.view', requiresScope: true },
        { icon: Percent, label: 'Salary Structure', path: '/salary-structure', requiredPermission: 'salary.view', requiresScope: true },
        { icon: Network, label: 'Departments', path: '/departments', requiredPermission: 'departments.view', requiresScope: true },
        { icon: MapPinned, label: 'Branches', path: '/branches', requiredPermission: 'settings.edit', requiresScope: true },
      ])
    },
    {
      title: 'Time Off',
      items: filterItems([
        { icon: PartyPopper, label: 'Holidays', path: '/holidays', requiredPermission: 'holidays.view' },
        { icon: Cake, label: 'Birthdays', path: '/birthdays', requiredPermission: 'employees.view' },
      ])
    },
    {
      title: 'Communication',
      items: filterItems([
        { icon: Mail, label: 'Emails', path: '/emails', requiredPermission: 'employees.view' },
        { icon: Megaphone, label: 'Announcements', path: '/announcements', requiredPermission: 'announcements.view' },
      ])
    },
    {
      title: 'Calendar',
      items: filterItems([
        { icon: Calendar, label: 'Calendar', path: '/calendar' },
      ])
    },
    {
      title: 'Analytics & Reporting',
      items: filterItems([
        { icon: BarChart3, label: 'Reports', path: '/reports', requiredPermission: 'reports.view' },
      ])
    },
    {
      title: 'System',
      items: filterItems([
        { icon: Settings, label: 'Settings', path: '/settings', requiredPermission: 'settings.view' },
        { icon: HelpCircle, label: 'Support', path: '/support', requiredPermission: 'support.view' },
      ])
    },
  ]

  const defaultSections: NavSection[] = [
    {
      title: 'Main',
      items: filterItems([
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        // Personal leaves + attendance hub. HR already had the /hr route but no
        // menu entry; employees never had either (their attendance/leaves lived
        // only on the Operations pages) — both now land on the same personal
        // page every other role uses.
        { icon: UserRound, label: 'My Leaves & Attendance', path: '/my-leaves-attendance', requiredRoles: ['employee', 'hr'] },
      ])
    },
    {
      title: 'Organization',
      items: filterItems([
        { icon: Building2, label: 'Companies', path: '/companies', requiredRoles: ['master-admin', 'team-leader', 'executive'], requiredPermission: 'companies.view' },

        { icon: Network, label: 'Departments', path: '/departments', requiredRoles: ['master-admin', 'company-admin', 'executive', 'hr'], requiredPermission: 'departments.view' },
        { icon: MapPinned, label: 'Branches', path: '/branches', requiredRoles: ['master-admin', 'executive'], requiredPermission: 'settings.edit' },
        { icon: MapPinned, label: 'Branches', path: '/branches', requiredRoles: ['company-admin', 'hr'], requiredPermission: 'departments.view' },
        { icon: KeyRound, label: 'Access Management', path: '/access-management', requiredRoles: ['master-admin'] },
      ])
    },
    {
      title: 'People',
      items: filterItems([
        { icon: Users, label: 'Employees', path: '/employees', requiredRoles: ['master-admin', 'company-admin', 'executive', 'hr'] },
        ...(isReportingManager ? [{ icon: UserCog as typeof LayoutDashboard, label: 'My Team', path: '/my-team' as string }] : []),
        { icon: Crown, label: 'Executives', path: '/executives', requiredRoles: ['master-admin'] },
        { icon: UserPlus, label: 'Team Leaders', path: '/team-leaders', requiredRoles: ['master-admin'] },
      ])
    },
    {
      title: 'Operations',
      items: filterItems([
        { icon: Clock, label: 'Attendance', path: '/attendance' },
        { icon: CalendarDays, label: 'Leaves', path: '/leaves' },
        { icon: Wallet, label: 'Payroll', path: '/payroll', requiredRoles: ['master-admin', 'company-admin'] },
        { icon: History, label: 'Payroll History', path: '/payroll-history', requiredRoles: ['master-admin', 'company-admin', 'executive', 'team-leader'] },
        { icon: FileText, label: 'Salary Slips', path: '/salary-slips', requiredRoles: ['master-admin', 'company-admin', 'employee'] },
        { icon: Percent, label: 'Salary Structure', path: '/salary-structure', requiredRoles: ['master-admin', 'executive'] },
        { icon: CheckSquare, label: 'Tasks', path: '/tasks' },
      ])
    },
    {
      title: 'Time Off',
      items: filterItems([
        { icon: PartyPopper, label: 'Holidays', path: '/holidays' },
        { icon: Cake, label: 'Birthdays', path: '/birthdays' },
      ])
    },
    {
      title: 'Resources',
      items: filterItems([
        { icon: BookUser, label: 'Address Book', path: '/address-book', requiredRoles: ['master-admin', 'company-admin', 'team-leader', 'executive', 'hr'] },
      ])
    },
    {
      title: 'Communication',
      items: filterItems([
        { icon: Mail, label: 'Emails', path: '/emails', requiredRoles: ['master-admin', 'company-admin'] },
        { icon: Megaphone, label: 'Announcements', path: '/announcements', requiredRoles: ['master-admin', 'company-admin', 'team-leader', 'executive', 'hr'] },
      ])
    },
    {
      title: 'Calendar',
      items: filterItems([
        { icon: Calendar, label: 'Calendar', path: '/calendar' },
      ])
    },
    {
      title: 'Company',
      items: filterItems([
        { icon: Building, label: 'Company Profile', path: '/company-profile', requiredRoles: ['company-admin'] },
      ])
    },
    {
      title: 'Analytics',
      items: filterItems([
        { icon: BarChart3, label: 'Reports', path: '/reports', requiredRoles: ['master-admin', 'company-admin', 'team-leader', 'executive', 'hr'] },
      ])
    },
    {
      title: 'Administration',
      items: filterItems([
        { icon: Landmark, label: 'Executive Oversight', path: '/executive-oversight', requiredRoles: ['master-admin'] },
        { icon: FolderOpen, label: 'Document Management', path: '/documents-management', requiredRoles: ['master-admin'] },
        { icon: ArrowRightLeft, label: 'Transfer Management', path: '/transfer-management', requiredRoles: ['master-admin'] },
        { icon: ScrollText, label: 'Audit Logs', path: '/audit-logs', requiredRoles: ['master-admin'] },
        { icon: Settings, label: 'Settings', path: '/settings' },
        { icon: HelpCircle, label: 'Support', path: '/support' },
      ])
    },
  ]

  const reportingManagerSections: NavSection[] = [
    {
      title: 'Main',
      items: filterItems([
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        { icon: UserRound, label: 'My Leaves & Attendance', path: '/my-leaves-attendance' },
      ])
    },
    {
      title: 'My Team',
      items: filterItems([
        { icon: Users, label: 'My Team', path: '/my-team' },
        { icon: CalendarDays, label: 'Leaves', path: '/leaves' },
        { icon: Clock, label: 'Attendance', path: '/attendance' },
        { icon: Cake, label: 'Birthdays', path: '/birthdays' },
      ])
    },
    {
      title: 'Work',
      items: filterItems([
        { icon: Wallet, label: 'Payroll', path: '/salary-slips' },
        { icon: CheckSquare, label: 'Tasks', path: '/tasks' },
        { icon: Calendar, label: 'Calendar', path: '/calendar' },
      ])
    },
    {
      title: 'Company',
      items: filterItems([
        { icon: PartyPopper, label: 'Holidays', path: '/holidays' },
      ])
    },
    {
      title: 'Account',
      items: filterItems([
        { icon: User, label: 'My Profile', path: '/my-profile' },
        { icon: HelpCircle, label: 'Support', path: '/support-tickets' },
      ])
    },
  ]

  const sections = isTeamLeader
    ? teamLeaderSections
    : isExecutive
      ? executiveSections
      : isReportingManager
        ? reportingManagerSections
        : defaultSections

  return (
    <>
      {/* Scope warning toast */}
      {scopeToast && (
        <div className="sidebar-scope-toast">
          <AlertCircle size={14} />
          <span>{scopeToast}</span>
        </div>
      )}

      {!collapsed && <div className="sidebar-overlay" onClick={toggle} />}
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        {collapsed ? (
          <Logo variant="icon" size="sm" />
        ) : (
          <Logo variant="compact" size="md" />
        )}
      </div>

      <nav className="sidebar-nav">
        {/* ── Role: Team Leader — Executive Filter ── */}
        {isTeamLeader && !collapsed && (
          <div className="nav-section">
            <div className="nav-section-title">Executive View</div>

            {/* Executive selector trigger */}
            <div className="tl-exec-trigger" onClick={() => setTlExecOpen(!tlExecOpen)}>
              <User size={16} />
              <span>{tlFilter.currentExecutive?.name || 'Select Executive...'}</span>
              <ChevronDown size={14} className={`tl-exec-chevron ${tlExecOpen ? 'open' : ''}`} />
            </div>

            {/* Executive dropdown */}
            {tlExecOpen && (
              <div className="tl-exec-dropdown">
                {tlFilter.executives.length === 0 ? (
                  <div className="tl-exec-empty">No executives assigned</div>
                ) : tlFilter.executives.map(exec => (
                  <div key={exec.id}
                    className={`tl-exec-option ${tlFilter.selectedExecutiveId === exec.id ? 'active' : ''}`}
                    onClick={() => { tlFilter.setExecutive(exec.id); setTlExecOpen(false) }}>
                    <div className="tl-exec-option-info">
                      <span className="tl-exec-option-name">{exec.name}</span>
                      <span className="tl-exec-option-email">{exec.email}</span>
                    </div>
                    {tlFilter.selectedExecutiveId === exec.id && <CheckSquare size={14} className="tl-exec-check" />}
                  </div>
                ))}
              </div>
            )}

            {/* Scoped company list */}
            {tlFilter.selectedExecutiveId && (
              <>
                <div className="tl-companies-divider">Companies</div>
                {tlFilter.companies.length === 0 ? (
                  <div className="tl-exec-empty">No companies assigned</div>
                ) : tlFilter.companies.map(comp => (
                  <div key={comp.id}
                    className={`nav-item ${tlFilter.selectedCompanyId === comp.id ? 'active' : ''}`}
                    onClick={() => tlFilter.setCompany(comp.id)}>
                    <Building2 size={18} />
                    <span>{comp.name}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Role: Executive — My Companies ── */}
        {isExecutive && !collapsed && availableCompanies.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title">My Companies</div>
            {availableCompanies.map(comp => (
              <div key={comp.id}
                className={`nav-item ${scopeCid === comp.id ? 'active' : ''}`}
                onClick={() => setSelectedCompanyId(comp.id)}>
                <Building2 size={18} />
                <span>{comp.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Standard nav sections ── */}
        {sections.map(section => {
          if (section.items.length === 0) return null
          return (
            <div key={section.title} className="nav-section">
              {!collapsed && <div className="nav-section-title">{section.title}</div>}
              {section.items.map((item, idx) => (
                <div
                  key={idx}
                  className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => handleNav(item)}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </div>
              ))}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-collapse-btn" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        {!collapsed && (
          <>
            {/* Current scope badge — Master Admin in global mode, no scope badge */}
            {user?.role !== 'master-admin' && selectedCompanyName && (
              <div className="sidebar-scope-badge">
                <Building2 size={12} />
                <span>{selectedCompanyName}</span>
              </div>
            )}
            <div className="user-card">
              <div className="user-details">
                <h4>{user?.name || 'Admin'}</h4>
                <span>{roleDepartmentLabel(user)}</span>
              </div>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </>
        )}
        {collapsed && (
          <button className="logout-btn logout-btn-icon" onClick={handleLogout} title="Logout">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
    </>
  )
}