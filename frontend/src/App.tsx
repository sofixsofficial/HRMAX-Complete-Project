import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { useAuth } from './context/AuthContext'
import { ProtectedRoute, MasterAdminRoute, ExecutiveRoute, TeamLeaderRoute } from './components/ProtectedRoute'
import { CompanyRouteGuard } from './components/CompanyRouteGuard'
import { AuthenticatedLayout } from './components/AuthenticatedLayout'
import {
  RoleRouteGuard,
  ExecutivePageRoute,
  TeamLeaderPageRoute,
  MasterAdminPageRoute,
  CompanyAdminPageRoute,
  EmployeePageRoute,
  ReportingManagerPageRoute,
} from './components/RoleRouteGuard'
import { Login } from './pages/Login'
import { Register } from './pages/auth/Register'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { VerifyResetCode } from './pages/auth/VerifyResetCode'
import { SetNewPassword } from './pages/auth/SetNewPassword'
import { ForcePasswordChange } from './pages/auth/ForcePasswordChange'
import { AcceptInvite } from './pages/auth/AcceptInvite'
import { DashboardRouter } from './pages/DashboardRouter'
import { ExecutiveDashboard } from './pages/dashboards/ExecutiveDashboard'
import { TLOperationalDashboard } from './pages/dashboards/TLOperationalDashboard'
import { CompanyDashboard } from './pages/dashboards/CompanyDashboard'
import { EmployeeDashboard } from './pages/dashboards/EmployeeDashboard'
import { ReportingManagerDashboard } from './pages/dashboards/ReportingManagerDashboard'
import { Dashboard as AdminDashboard } from './pages/Dashboard'
import { Companies } from './pages/Companies'
import { CompanyDetailsView } from './pages/CompanyDetailsView'
import { Employees } from './pages/Employees'
import { EmployeeDashboard as EmployeeViewDashboard } from './pages/employees/EmployeeDashboard'
import { EmployeeProfile } from './pages/employees/EmployeeProfile'
import { Departments } from './pages/Departments'
import { Executives } from './pages/Executives'
import { ExecutiveProfile } from './pages/executives/ExecutiveProfile'
import { TeamLeaders } from './pages/TeamLeaders'
import { TeamLeaderProfile } from './pages/team-leaders/TeamLeaderProfile'
import { Announcements } from './pages/Announcements'
import { MyTeam } from './pages/MyTeam'
import { CompanyProfile } from './pages/CompanyProfile'
import { HRMSDashboard } from './pages/HRMSDashboard'
import { LeaveManagement } from './pages/LeaveManagement'

import { HolidayCalendar } from './pages/HolidayCalendar'
import { SalarySlips } from './pages/SalarySlips'
import { Tasks } from './pages/Tasks'
import { Payroll } from './pages/Payroll'
import { PayrollHistory } from './pages/PayrollHistory'
import { SalaryStructure } from './pages/SalaryStructure'
import { AccessManagement } from './pages/AccessManagement'
import { CalendarCenter } from './pages/CalendarCenter'
import { EmailCenter } from './pages/EmailCenter'
import { AddressBook } from './pages/AddressBook'
import { Birthdays } from './pages/Birthdays'
import { Reports } from './pages/Reports'
import { Analytics } from './pages/Analytics'
import { SupportTickets } from './pages/SupportTickets'
import { Assets } from './pages/Assets'
import { CompanyAdminApprovals } from './pages/CompanyAdminApprovals'
import { MyProfile } from './pages/MyProfile'
import { MyLeavesAttendance } from './pages/MyLeavesAttendance'
import { Performance } from './pages/Performance'
import { Attendance } from './pages/Attendance'
import { AttendanceSettings } from './pages/AttendanceSettings'
import { AttendanceDashboard } from './pages/AttendanceDashboard'
import { DocumentsManagement } from './pages/DocumentsManagement'
import { TransferManagement } from './pages/TransferManagement'
import { AuditLogs } from './pages/AuditLogs'
import { ExecutiveOversight } from './pages/ExecutiveOversight'
import { Navbar } from './pages/public/Navbar'
import { Footer } from './pages/public/Footer'
import { Landing } from './pages/public/Landing'
import { About } from './pages/public/About'
import { Contact } from './pages/public/Contact'
import { Features } from './pages/public/Features'
import { PrivacyPolicy } from './pages/public/PrivacyPolicy'
import { DeleteAccount } from './pages/public/DeleteAccount'
import './App.css'

const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const Support = lazy(() => import('./pages/Support').then(m => ({ default: m.Support })))

function PageLoader() {
  return (
    <div className="loading-container">
      <div className="animate-spin" style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#f97316', borderRadius: '50%' }} />
      <p>Loading...</p>
    </div>
  )
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
      <Footer />
    </>
  );
}

function RoleDashboardRedirect() {
  const { user } = useAuth()
  const rolePathMap: Record<string, string> = {
    'master-admin': '/master-admin/dashboard',
    'company-admin': '/company-admin/dashboard',
    'executive': '/executive/dashboard',
    'team-leader': '/team-leader/dashboard',
    'reporting-manager': '/reporting-manager/dashboard',
    'employee': '/employee/dashboard',
  }
  const target = user?.role ? rolePathMap[user.role] : '/master-admin/dashboard'
  return <Navigate to={target} replace />
}

function RoleAwareRedirect({ to }: { to: string }) {
  const { user } = useAuth()
  const location = useLocation()
  const rolePathMap: Record<string, string> = {
    'master-admin': '/master-admin',
    'company-admin': '/company-admin',
    'executive': '/executive',
    'team-leader': '/team-leader',
    'reporting-manager': '/reporting-manager',
    'employee': '/employee',
  }
  const prefix = user?.role ? rolePathMap[user.role] : '/master-admin'
  // Preserve query params (e.g. ?edit= / ?delete= deep-links from detail pages)
  return <Navigate to={{ pathname: `${prefix}${to}`, search: location.search }} replace />
}

function AppRoutes() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="animate-spin" style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#f97316', borderRadius: '50%' }} />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={
        isAuthenticated ? (
          <RoleDashboardRedirect />
        ) : (
          <PublicLayout><Landing /></PublicLayout>
        )
      } />
      <Route path="/features" element={<PublicLayout><Features /></PublicLayout>} />
      <Route path="/about" element={<PublicLayout><About /></PublicLayout>} />
      <Route path="/contact" element={<PublicLayout><Contact /></PublicLayout>} />
      <Route path="/privacy" element={<PublicLayout><PrivacyPolicy /></PublicLayout>} />
      <Route path="/delete-account" element={<PublicLayout><DeleteAccount /></PublicLayout>} />

      {/* Auth Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify-reset-code" element={<VerifyResetCode />} />
      <Route path="/set-new-password" element={<SetNewPassword />} />
      <Route path="/force-password-change" element={<ForcePasswordChange />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      
      {/* Legacy Dashboard Routes - Redirect to role-based dashboard */}
      <Route path="/admin/dashboard" element={<RoleDashboardRedirect />} />
      <Route path="/hr/dashboard" element={<RoleDashboardRedirect />} />
      <Route path="/manager/dashboard" element={<RoleDashboardRedirect />} />
      
      {/* Role-Based Dashboard Routes */}
      <Route path="/master-admin/dashboard" element={<MasterAdminPageRoute><DashboardRouter /></MasterAdminPageRoute>} />
      <Route path="/company-admin/dashboard" element={<CompanyAdminPageRoute><CompanyDashboard /></CompanyAdminPageRoute>} />
      <Route path="/executive/dashboard" element={<ExecutivePageRoute requireScope={false}><ExecutiveDashboard /></ExecutivePageRoute>} />
      <Route path="/team-leader/dashboard" element={<TeamLeaderPageRoute requireScope={false}><TLOperationalDashboard /></TeamLeaderPageRoute>} />
      <Route path="/employee/dashboard" element={<EmployeePageRoute><EmployeeDashboard /></EmployeePageRoute>} />
      <Route path="/reporting-manager/dashboard" element={<ReportingManagerPageRoute><ReportingManagerDashboard /></ReportingManagerPageRoute>} />
      
      {/* ============================================
           ROLE-PREFIXED MODULE ROUTES
           ============================================ */}
      
      {/* Executive Routes */}
      <Route path="/executive/companies" element={<ExecutivePageRoute><Companies /></ExecutivePageRoute>} />
      <Route path="/executive/companies/:companyId" element={<ExecutivePageRoute><CompanyDetailsView /></ExecutivePageRoute>} />
<Route path="/executive/departments" element={<ExecutivePageRoute><Departments /></ExecutivePageRoute>} />
      <Route path="/executive/employees" element={<ExecutivePageRoute><Employees /></ExecutivePageRoute>} />
      <Route path="/executive/executives" element={<ExecutivePageRoute><Executives /></ExecutivePageRoute>} />
      <Route path="/executive/executives/:id" element={<ExecutivePageRoute><ExecutiveProfile /></ExecutivePageRoute>} />
      <Route path="/executive/employee-profile/:slug" element={<ExecutivePageRoute requireScope={false}><EmployeeProfile /></ExecutivePageRoute>} />
      <Route path="/executive/attendance" element={<ExecutivePageRoute><Attendance /></ExecutivePageRoute>} />
      <Route path="/executive/leaves" element={<ExecutivePageRoute><LeaveManagement /></ExecutivePageRoute>} />
      
      <Route path="/executive/tasks" element={<ExecutivePageRoute><Tasks /></ExecutivePageRoute>} />
      <Route path="/executive/payroll" element={<ExecutivePageRoute><Payroll /></ExecutivePageRoute>} />
      <Route path="/executive/payroll-history" element={<ExecutivePageRoute><PayrollHistory /></ExecutivePageRoute>} />
      <Route path="/executive/salary-slips" element={<ExecutivePageRoute><SalarySlips /></ExecutivePageRoute>} />
      <Route path="/executive/salary-structure" element={<ExecutivePageRoute><SalaryStructure /></ExecutivePageRoute>} />
      <Route path="/executive/holidays" element={<ExecutivePageRoute requireScope={false}><HolidayCalendar /></ExecutivePageRoute>} />
      <Route path="/executive/birthdays" element={<ExecutivePageRoute requireScope={false}><Birthdays /></ExecutivePageRoute>} />
      <Route path="/executive/emails" element={<ExecutivePageRoute requireScope={false}><EmailCenter /></ExecutivePageRoute>} />
      <Route path="/executive/announcements" element={<ExecutivePageRoute><Announcements /></ExecutivePageRoute>} />
      <Route path="/executive/calendar" element={<ExecutivePageRoute requireScope={false}><CalendarCenter /></ExecutivePageRoute>} />
      <Route path="/executive/address-book" element={<ExecutivePageRoute><AddressBook /></ExecutivePageRoute>} />
      <Route path="/executive/reports" element={<ExecutivePageRoute><Reports /></ExecutivePageRoute>} />
      <Route path="/executive/analytics" element={<ExecutivePageRoute><Analytics /></ExecutivePageRoute>} />
      <Route path="/executive/documents-management" element={<ExecutivePageRoute requireScope={false}><DocumentsManagement /></ExecutivePageRoute>} />
      <Route path="/executive/support-tickets" element={<ExecutivePageRoute requireScope={false}><SupportTickets /></ExecutivePageRoute>} />
      <Route path="/executive/my-profile" element={<ExecutivePageRoute requireScope={false}><MyProfile /></ExecutivePageRoute>} />
      <Route path="/executive/performance" element={<ExecutivePageRoute requireScope={false}><Performance /></ExecutivePageRoute>} />
      <Route path="/executive/my-leaves-attendance" element={<ExecutivePageRoute requireScope={false}><MyLeavesAttendance /></ExecutivePageRoute>} />
      
      {/* Team Leader Routes */}
      <Route path="/team-leader/companies" element={<TeamLeaderPageRoute><Companies /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/companies/:companyId" element={<TeamLeaderPageRoute><CompanyDetailsView /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/employees" element={<TeamLeaderPageRoute><Employees /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/executives" element={<TeamLeaderPageRoute><Executives /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/executives/:id" element={<TeamLeaderPageRoute><ExecutiveProfile /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/departments" element={<TeamLeaderPageRoute><Departments /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/attendance" element={<TeamLeaderPageRoute><Attendance /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/leaves" element={<TeamLeaderPageRoute><LeaveManagement /></TeamLeaderPageRoute>} />
      
      <Route path="/team-leader/tasks" element={<TeamLeaderPageRoute><Tasks /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/payroll" element={<TeamLeaderPageRoute><Payroll /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/payroll-history" element={<TeamLeaderPageRoute><PayrollHistory /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/salary-slips" element={<TeamLeaderPageRoute><SalarySlips /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/emails" element={<TeamLeaderPageRoute requireScope={false}><EmailCenter /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/announcements" element={<TeamLeaderPageRoute><Announcements /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/holidays" element={<TeamLeaderPageRoute requireScope={false}><HolidayCalendar /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/birthdays" element={<TeamLeaderPageRoute requireScope={false}><Birthdays /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/calendar" element={<TeamLeaderPageRoute requireScope={false}><CalendarCenter /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/address-book" element={<TeamLeaderPageRoute><AddressBook /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/reports" element={<TeamLeaderPageRoute><Reports /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/analytics" element={<TeamLeaderPageRoute><Analytics /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/support-tickets" element={<TeamLeaderPageRoute requireScope={false}><SupportTickets /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/my-profile" element={<TeamLeaderPageRoute requireScope={false}><MyProfile /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/performance" element={<TeamLeaderPageRoute requireScope={false}><Performance /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/employee-profile/:slug" element={<TeamLeaderPageRoute requireScope={false}><EmployeeProfile /></TeamLeaderPageRoute>} />
      <Route path="/team-leader/my-leaves-attendance" element={<TeamLeaderPageRoute requireScope={false}><MyLeavesAttendance /></TeamLeaderPageRoute>} />
      
      {/* Company Admin Routes */}
      <Route path="/company-admin/departments" element={<CompanyAdminPageRoute><Departments /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/employees" element={<CompanyAdminPageRoute><Employees /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/employee-profile/:slug" element={<CompanyAdminPageRoute requireScope={false}><EmployeeProfile /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/attendance" element={<CompanyAdminPageRoute><Attendance /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/leaves" element={<CompanyAdminPageRoute><LeaveManagement /></CompanyAdminPageRoute>} />
      
      <Route path="/company-admin/tasks" element={<CompanyAdminPageRoute><Tasks /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/payroll" element={<CompanyAdminPageRoute><Payroll /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/payroll-history" element={<CompanyAdminPageRoute><PayrollHistory /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/salary-slips" element={<CompanyAdminPageRoute><SalarySlips /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/salary-structure" element={<CompanyAdminPageRoute><SalaryStructure /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/company-profile" element={<CompanyAdminPageRoute requireScope={false}><CompanyProfile /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/executives" element={<CompanyAdminPageRoute requireScope={false}><Executives /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/executives/:id" element={<CompanyAdminPageRoute requireScope={false}><ExecutiveProfile /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/team-leaders" element={<CompanyAdminPageRoute requireScope={false}><TeamLeaders /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/team-leaders/:id" element={<CompanyAdminPageRoute requireScope={false}><TeamLeaderProfile /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/announcements" element={<CompanyAdminPageRoute><Announcements /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/emails" element={<CompanyAdminPageRoute requireScope={false}><EmailCenter /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/holidays" element={<CompanyAdminPageRoute requireScope={false}><HolidayCalendar /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/birthdays" element={<CompanyAdminPageRoute requireScope={false}><Birthdays /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/calendar" element={<CompanyAdminPageRoute requireScope={false}><CalendarCenter /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/reports" element={<CompanyAdminPageRoute><Reports /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/analytics" element={<CompanyAdminPageRoute><Analytics /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/assets" element={<CompanyAdminPageRoute requireScope={false}><Assets /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/support-tickets" element={<CompanyAdminPageRoute requireScope={false}><SupportTickets /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/my-profile" element={<CompanyAdminPageRoute requireScope={false}><MyProfile /></CompanyAdminPageRoute>} />
      <Route path="/company-admin/performance" element={<CompanyAdminPageRoute requireScope={false}><Performance /></CompanyAdminPageRoute>} />
      
      {/* Master Admin Routes */}
      <Route path="/master-admin/companies" element={<MasterAdminPageRoute><Companies /></MasterAdminPageRoute>} />
      <Route path="/master-admin/companies/:companyId" element={<MasterAdminPageRoute><CompanyDetailsView /></MasterAdminPageRoute>} />
      <Route path="/master-admin/departments" element={<MasterAdminPageRoute><Departments /></MasterAdminPageRoute>} />
      <Route path="/master-admin/employees" element={<MasterAdminPageRoute><Employees /></MasterAdminPageRoute>} />
      <Route path="/master-admin/employee-profile/:slug" element={<MasterAdminPageRoute><EmployeeProfile /></MasterAdminPageRoute>} />
      <Route path="/master-admin/executives" element={<MasterAdminPageRoute><Executives /></MasterAdminPageRoute>} />
      <Route path="/master-admin/executives/:id" element={<MasterAdminPageRoute><ExecutiveProfile /></MasterAdminPageRoute>} />
      <Route path="/master-admin/team-leaders" element={<MasterAdminPageRoute><TeamLeaders /></MasterAdminPageRoute>} />
      <Route path="/master-admin/team-leaders/:id" element={<MasterAdminPageRoute><TeamLeaderProfile /></MasterAdminPageRoute>} />
      <Route path="/master-admin/attendance" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Attendance /></RoleRouteGuard>} />
      <Route path="/master-admin/attendance/settings" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><AttendanceSettings /></RoleRouteGuard>} />
      <Route path="/master-admin/attendance/dashboard" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><AttendanceDashboard /></RoleRouteGuard>} />
      <Route path="/master-admin/leaves" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><LeaveManagement /></RoleRouteGuard>} />
      
      <Route path="/master-admin/tasks" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Tasks /></RoleRouteGuard>} />
      <Route path="/master-admin/payroll" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Payroll /></RoleRouteGuard>} />
      <Route path="/master-admin/payroll-history" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><PayrollHistory /></RoleRouteGuard>} />
      <Route path="/master-admin/salary-slips" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><SalarySlips /></RoleRouteGuard>} />
      <Route path="/master-admin/salary-structure" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><SalaryStructure /></RoleRouteGuard>} />
      <Route path="/master-admin/holidays" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope={false}><HolidayCalendar /></RoleRouteGuard>} />
      <Route path="/master-admin/birthdays" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope={false}><Birthdays /></RoleRouteGuard>} />
      <Route path="/master-admin/emails" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope={false}><EmailCenter /></RoleRouteGuard>} />
      <Route path="/master-admin/announcements" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Announcements /></RoleRouteGuard>} />
      <Route path="/master-admin/calendar" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope={false}><CalendarCenter /></RoleRouteGuard>} />
      <Route path="/master-admin/address-book" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><AddressBook /></RoleRouteGuard>} />
      <Route path="/master-admin/reports" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Reports /></RoleRouteGuard>} />
      <Route path="/master-admin/analytics" element={<RoleRouteGuard allowedRoles={['master-admin']} requireScope><Analytics /></RoleRouteGuard>} />
      <Route path="/master-admin/executive-oversight" element={<MasterAdminPageRoute><ExecutiveOversight /></MasterAdminPageRoute>} />
      <Route path="/master-admin/documents-management" element={<MasterAdminPageRoute><DocumentsManagement /></MasterAdminPageRoute>} />
      <Route path="/master-admin/transfer-management" element={<MasterAdminPageRoute><TransferManagement /></MasterAdminPageRoute>} />
      <Route path="/master-admin/audit-logs" element={<MasterAdminPageRoute><AuditLogs /></MasterAdminPageRoute>} />
      <Route path="/master-admin/access-management" element={<MasterAdminPageRoute><AccessManagement /></MasterAdminPageRoute>} />
      <Route path="/master-admin/hrms-dashboard" element={<MasterAdminPageRoute><HRMSDashboard /></MasterAdminPageRoute>} />
      <Route path="/master-admin/employee-dashboard" element={<CompanyAdminPageRoute><EmployeeViewDashboard /></CompanyAdminPageRoute>} />
      <Route path="/master-admin/assets" element={<MasterAdminPageRoute><Assets /></MasterAdminPageRoute>} />
      <Route path="/master-admin/support-tickets" element={<MasterAdminPageRoute><SupportTickets /></MasterAdminPageRoute>} />
      <Route path="/master-admin/company-admin-approvals" element={<MasterAdminPageRoute><CompanyAdminApprovals /></MasterAdminPageRoute>} />
      <Route path="/master-admin/my-profile" element={<MasterAdminPageRoute><MyProfile /></MasterAdminPageRoute>} />
      <Route path="/master-admin/performance" element={<MasterAdminPageRoute><Performance /></MasterAdminPageRoute>} />
      
      {/* Employee Routes */}
      <Route path="/employee/attendance" element={<EmployeePageRoute><Attendance /></EmployeePageRoute>} />
      <Route path="/employee/leaves" element={<EmployeePageRoute><LeaveManagement /></EmployeePageRoute>} />
      
      <Route path="/employee/tasks" element={<EmployeePageRoute><Tasks /></EmployeePageRoute>} />
      <Route path="/employee/salary-slips" element={<EmployeePageRoute><SalarySlips /></EmployeePageRoute>} />
      <Route path="/employee/holidays" element={<EmployeePageRoute><HolidayCalendar /></EmployeePageRoute>} />
      <Route path="/employee/birthdays" element={<EmployeePageRoute><Birthdays /></EmployeePageRoute>} />
      <Route path="/employee/calendar" element={<EmployeePageRoute><CalendarCenter /></EmployeePageRoute>} />
      <Route path="/employee/announcements" element={<EmployeePageRoute><Announcements /></EmployeePageRoute>} />
      <Route path="/employee/support-tickets" element={<EmployeePageRoute><SupportTickets /></EmployeePageRoute>} />
      <Route path="/employee/my-profile" element={<EmployeePageRoute><MyProfile /></EmployeePageRoute>} />
      
      {/* Reporting Manager Routes */}
      <Route path="/reporting-manager/my-team" element={<ReportingManagerPageRoute><MyTeam /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/employee-profile/:slug" element={<ReportingManagerPageRoute><EmployeeProfile /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/attendance" element={<ReportingManagerPageRoute><Attendance /></ReportingManagerPageRoute>} />
<Route path="/reporting-manager/leaves" element={<ReportingManagerPageRoute><LeaveManagement /></ReportingManagerPageRoute>} />
      
      <Route path="/reporting-manager/my-leaves-attendance" element={<ReportingManagerPageRoute><MyLeavesAttendance /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/tasks" element={<ReportingManagerPageRoute><Tasks /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/salary-slips" element={<ReportingManagerPageRoute><SalarySlips /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/holidays" element={<ReportingManagerPageRoute><HolidayCalendar /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/birthdays" element={<ReportingManagerPageRoute><Birthdays /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/calendar" element={<ReportingManagerPageRoute><CalendarCenter /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/support-tickets" element={<ReportingManagerPageRoute><SupportTickets /></ReportingManagerPageRoute>} />
      <Route path="/reporting-manager/my-profile" element={<ReportingManagerPageRoute><MyProfile /></ReportingManagerPageRoute>} />
      
      {/* Cross-role module routes (settings, support) */}
      <Route path="/master-admin/settings" element={<MasterAdminPageRoute><Suspense fallback={<PageLoader />}><Settings /></Suspense></MasterAdminPageRoute>} />
      <Route path="/company-admin/settings" element={<CompanyAdminPageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Settings /></Suspense></CompanyAdminPageRoute>} />
      <Route path="/executive/settings" element={<ExecutivePageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Settings /></Suspense></ExecutivePageRoute>} />
      <Route path="/team-leader/settings" element={<TeamLeaderPageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Settings /></Suspense></TeamLeaderPageRoute>} />
      <Route path="/employee/settings" element={<EmployeePageRoute><Suspense fallback={<PageLoader />}><Settings /></Suspense></EmployeePageRoute>} />

      <Route path="/master-admin/support" element={<MasterAdminPageRoute><Suspense fallback={<PageLoader />}><Support /></Suspense></MasterAdminPageRoute>} />
      <Route path="/company-admin/support" element={<CompanyAdminPageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Support /></Suspense></CompanyAdminPageRoute>} />
      <Route path="/executive/support" element={<ExecutivePageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Support /></Suspense></ExecutivePageRoute>} />
      <Route path="/team-leader/support" element={<TeamLeaderPageRoute requireScope={false}><Suspense fallback={<PageLoader />}><Support /></Suspense></TeamLeaderPageRoute>} />
      <Route path="/employee/support" element={<EmployeePageRoute><Suspense fallback={<PageLoader />}><Support /></Suspense></EmployeePageRoute>} />
      
      {/* Flat route redirects -> role-prefixed */}
      <Route path="/dashboard" element={<RoleAwareRedirect to="/dashboard" />} />
      <Route path="/departments" element={<RoleAwareRedirect to="/departments" />} />
      <Route path="/employees" element={<RoleAwareRedirect to="/employees" />} />
      <Route path="/employee-profile/:slug" element={<RoleAwareRedirect to="/employee-profile" />} />
      <Route path="/attendance/*" element={<RoleAwareRedirect to="/attendance" />} />
      <Route path="/leaves" element={<RoleAwareRedirect to="/leaves" />} />
      
      <Route path="/tasks" element={<RoleAwareRedirect to="/tasks" />} />
      <Route path="/payroll" element={<RoleAwareRedirect to="/payroll" />} />
      <Route path="/payroll-history" element={<RoleAwareRedirect to="/payroll-history" />} />
      <Route path="/salary-slips" element={<RoleAwareRedirect to="/salary-slips" />} />
      <Route path="/salary-structure" element={<RoleAwareRedirect to="/salary-structure" />} />
      <Route path="/holidays" element={<RoleAwareRedirect to="/holidays" />} />
      <Route path="/birthdays" element={<RoleAwareRedirect to="/birthdays" />} />
      <Route path="/emails" element={<RoleAwareRedirect to="/emails" />} />
      <Route path="/announcements" element={<RoleAwareRedirect to="/announcements" />} />
      <Route path="/calendar" element={<RoleAwareRedirect to="/calendar" />} />
      <Route path="/address-book" element={<RoleAwareRedirect to="/address-book" />} />
      <Route path="/reports" element={<RoleAwareRedirect to="/reports" />} />
      <Route path="/analytics" element={<RoleAwareRedirect to="/analytics" />} />
      <Route path="/settings" element={<RoleAwareRedirect to="/settings" />} />
      <Route path="/support" element={<RoleAwareRedirect to="/support" />} />
      <Route path="/companies" element={<RoleAwareRedirect to="/companies" />} />
      <Route path="/companies/:companyId" element={<RoleAwareRedirect to="/companies" />} />
      <Route path="/executives" element={<RoleAwareRedirect to="/executives" />} />
      <Route path="/team-leaders" element={<RoleAwareRedirect to="/team-leaders" />} />
      <Route path="/company-profile" element={<RoleAwareRedirect to="/company-profile" />} />
      <Route path="/documents-management" element={<RoleAwareRedirect to="/documents-management" />} />
      <Route path="/transfer-management" element={<RoleAwareRedirect to="/transfer-management" />} />
      <Route path="/audit-logs" element={<RoleAwareRedirect to="/audit-logs" />} />
      <Route path="/executive-oversight" element={<RoleAwareRedirect to="/executive-oversight" />} />
      <Route path="/roles" element={<RoleAwareRedirect to="/roles" />} />
      <Route path="/access-management" element={<RoleAwareRedirect to="/access-management" />} />
      <Route path="/hrms-dashboard" element={<RoleAwareRedirect to="/hrms-dashboard" />} />
      <Route path="/employee-dashboard" element={<RoleAwareRedirect to="/employee-dashboard" />} />
      <Route path="/assets" element={<RoleAwareRedirect to="/assets" />} />
      <Route path="/support-tickets" element={<RoleAwareRedirect to="/support-tickets" />} />
      <Route path="/company-admin-approvals" element={<RoleAwareRedirect to="/company-admin-approvals" />} />
      <Route path="/my-profile" element={<RoleAwareRedirect to="/my-profile" />} />
      <Route path="/performance" element={<RoleAwareRedirect to="/performance" />} />

      <Route path="/unauthorized" element={
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100vh',
          padding: '20px',
          background: '#0f172a',
          color: '#fff'
        }}>
          <h1 style={{ fontSize: '48px', marginBottom: '16px' }}>&#128683;</h1>
          <h2 style={{ marginBottom: '8px' }}>Access Denied</h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '24px' }}>
            You don't have permission to access this page.
          </p>
          <a href="/" style={{ 
            padding: '10px 20px', 
            background: '#f97316', 
            color: 'white', 
            textDecoration: 'none',
            borderRadius: '8px'
          }}>
            Go to Dashboard
          </a>
        </div>
      } />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return <AppRoutes />
}

export default App
