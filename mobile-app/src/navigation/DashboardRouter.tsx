import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';
import { RoleGate } from '../components/RoleGate';
import type { UserRole } from '../types/user';
import { MasterAdminDashboard } from '../screens/dashboards/MasterAdminDashboard';
import { CompanyDashboard } from '../screens/dashboards/CompanyDashboard';
import { EmployeeDashboard } from '../screens/dashboards/EmployeeDashboard';
import { ExecutiveDashboard } from '../screens/dashboards/ExecutiveDashboard';
import { ReportingManagerDashboard } from '../screens/dashboards/ReportingManagerDashboard';
import { TLOperationalDashboard } from '../screens/dashboards/TLOperationalDashboard';
import { EmployeesScreen } from '../screens/master-admin/EmployeesScreen';
import { DepartmentsScreen } from '../screens/master-admin/DepartmentsScreen';
import { TaskManagementScreen } from '../screens/master-admin/TaskManagementScreen';
import { LeaveManagementScreen } from '../screens/master-admin/LeaveManagementScreen';
import { AssetsScreen } from '../screens/master-admin/AssetsScreen';
import { HolidayCalendarScreen } from '../screens/master-admin/HolidayCalendarScreen';
import { CompaniesScreen } from '../screens/master-admin/CompaniesScreen';
import { ExecutivesScreen } from '../screens/master-admin/ExecutivesScreen';
import { TeamLeadersScreen } from '../screens/master-admin/TeamLeadersScreen';
import { CompanyApprovalsScreen } from '../screens/master-admin/CompanyApprovalsScreen';
import { AttendanceOverviewScreen } from '../screens/master-admin/AttendanceOverviewScreen';
import { AuditLogsScreen } from '../screens/master-admin/AuditLogsScreen';
import { ApplyLeaveScreen } from '../screens/modules/ApplyLeaveScreen';
import { NotificationsScreen } from '../screens/modules/NotificationsScreen';
import { AnnouncementsScreen } from '../screens/modules/AnnouncementsScreen';
import { MyProfileScreen } from '../screens/modules/MyProfileScreen';
import { EmployeeProfileScreen } from '../screens/modules/EmployeeProfileScreen';
import { SalaryStructureScreen } from '../screens/modules/SalaryStructureScreen';
import { SalarySlipsScreen } from '../screens/modules/SalarySlipsScreen';
import { RunPayrollScreen } from '../screens/modules/RunPayrollScreen';
import { SettingsScreen } from '../screens/modules/SettingsScreen';
import { AttendanceSettingsScreen } from '../screens/modules/AttendanceSettingsScreen';
import EmailCenterScreen from '../screens/modules/EmailCenterScreen';
import CalendarCenterScreen from '../screens/modules/CalendarCenterScreen';
import MyTeamScreen from '../screens/modules/MyTeamScreen';
import AddressBookScreen from '../screens/modules/AddressBookScreen';
import BirthdaysScreen from '../screens/modules/BirthdaysScreen';
import ReportsScreen from '../screens/modules/ReportsScreen';
import AnalyticsScreen from '../screens/modules/AnalyticsScreen';
import SupportScreen from '../screens/modules/SupportScreen';
import SupportTicketsScreen from '../screens/modules/SupportTicketsScreen';
import CompanyDetailsViewScreen from '../screens/modules/CompanyDetailsViewScreen';
import ExecutiveProfileScreen from '../screens/modules/ExecutiveProfileScreen';
import TeamLeaderProfileScreen from '../screens/modules/TeamLeaderProfileScreen';
import ExecutiveOversightScreen from '../screens/modules/ExecutiveOversightScreen';
import AccessManagementScreen from '../screens/modules/AccessManagementScreen';
import TransferManagementScreen from '../screens/modules/TransferManagementScreen';
import DocumentsManagementScreen from '../screens/modules/DocumentsManagementScreen';
import { PayrollHistoryScreen } from '../screens/master-admin/PayrollHistoryScreen';
import HRMSDashboardScreen from '../screens/modules/HRMSDashboardScreen';
import CompanyProfileScreen from '../screens/modules/CompanyProfileScreen';
import PerformanceScreen from '../screens/modules/PerformanceScreen';
import DocumentsScreen from '../screens/modules/DocumentsScreen';
import AttendanceDashboardScreen from '../screens/modules/AttendanceDashboardScreen';
import EmployeeViewDashboardScreen from '../screens/modules/EmployeeViewDashboardScreen';
import { ExecutiveCompaniesScreen } from '../screens/modules/ExecutiveCompaniesScreen';
import { ExecutiveTeamLeadersScreen } from '../screens/modules/ExecutiveTeamLeadersScreen';
import { HandledCompaniesScreen } from '../screens/modules/HandledCompaniesScreen';
import { TeamOperationsScreen } from '../screens/modules/TeamOperationsScreen';
import { MyLeavesAttendanceScreen } from '../screens/modules/MyLeavesAttendanceScreen';

const Stack = createNativeStackNavigator();

const MA_ONLY = ['master-admin'] as UserRole[];
const EMPLOYEES_ROLES = ['master-admin', 'company-admin', 'executive', 'team-leader'] as UserRole[];
const DEPARTMENTS_ROLES = ['master-admin', 'company-admin', 'executive', 'team-leader'] as UserRole[];
const LEAVE_MGMT_ROLES = ['master-admin', 'company-admin', 'executive', 'reporting-manager', 'team-leader'] as UserRole[];
const TASKS_ROLES = ['master-admin', 'executive', 'team-leader'] as UserRole[];
const ATTENDANCE_OVR_ROLES = ['master-admin', 'company-admin', 'executive', 'team-leader', 'reporting-manager', 'hr-manager'] as UserRole[];
const ASSETS_ROLES = ['master-admin', 'executive', 'team-leader'] as UserRole[];
const SETTINGS_ROLES = ['master-admin', 'executive'] as UserRole[];
const RM_ROLES = ['reporting-manager'] as UserRole[];
const PAYROLL_ROLES = ['master-admin', 'executive', 'team-leader'] as UserRole[];
// TL/Executive: full CRUD over Companies + Employees
const COMPANIES_ROLES = ['master-admin', 'team-leader', 'executive'] as UserRole[];
const EXECUTIVES_ROLES = ['master-admin', 'team-leader'] as UserRole[];
const ACCESS_MGMT_ROLES = ['master-admin', 'executive', 'team-leader'] as UserRole[];
// Company Admin never creates own leave records — verify-only role (web parity:
// LeaveManagement's Apply button explicitly excludes company-admin).
const APPLY_LEAVE_ROLES = ['master-admin', 'executive', 'team-leader', 'reporting-manager', 'employee'] as UserRole[];

const guard = (roles: UserRole[]) =>
  (Component: React.ComponentType<any>): React.FC<any> =>
  (props) => (
    <RoleGate allowedRoles={roles}>
      <Component {...props} />
    </RoleGate>
  );

const GuardedCompanies = guard(COMPANIES_ROLES)(CompaniesScreen);
const GuardedExecutives = guard(EXECUTIVES_ROLES)(ExecutivesScreen);
const GuardedTeamLeaders = guard(MA_ONLY)(TeamLeadersScreen);
const GuardedCompanyApprovals = guard(MA_ONLY)(CompanyApprovalsScreen);
const GuardedAuditLogs = guard(['master-admin', 'executive'])(AuditLogsScreen);
const GuardedExecutiveOversight = guard(MA_ONLY)(ExecutiveOversightScreen);
const GuardedAccessManagement = guard(MA_ONLY)(AccessManagementScreen);
const GuardedTransferManagement = guard(MA_ONLY)(TransferManagementScreen);
const GuardedDocumentsManagement = guard(MA_ONLY)(DocumentsManagementScreen);
const GuardedSupportTickets = guard(MA_ONLY)(SupportTicketsScreen);
const GuardedPayrollHistory = guard(['master-admin', 'company-admin'])(PayrollHistoryScreen);
const GuardedRunPayroll = guard(PAYROLL_ROLES)(RunPayrollScreen);
const GuardedEmployees = guard(EMPLOYEES_ROLES)(EmployeesScreen);
const GuardedDepartments = guard(DEPARTMENTS_ROLES)(DepartmentsScreen);
const GuardedLeaveManagement = guard(LEAVE_MGMT_ROLES)(LeaveManagementScreen);
const GuardedTaskManagement = guard(TASKS_ROLES)(TaskManagementScreen);
const GuardedAttendanceOverview = guard(ATTENDANCE_OVR_ROLES)(AttendanceOverviewScreen);
const GuardedAssets = guard(ASSETS_ROLES)(AssetsScreen);
const GuardedAttendanceSettings = guard(SETTINGS_ROLES)(AttendanceSettingsScreen);
const GuardedSalaryStructure = guard(SETTINGS_ROLES)(SalaryStructureScreen);
const GuardedMyTeam = guard(RM_ROLES)(MyTeamScreen);
const GuardedPerformance = guard(RM_ROLES)(PerformanceScreen);
const GuardedApplyLeave = guard(APPLY_LEAVE_ROLES)(ApplyLeaveScreen);

const DashboardContent: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const dashboards: Record<string, React.FC<any>> = {
    'master-admin': MasterAdminDashboard,
    'company-admin': CompanyDashboard,
    executive: ExecutiveDashboard,
    'reporting-manager': ReportingManagerDashboard,
    'team-leader': TLOperationalDashboard,
    employee: EmployeeDashboard,
  };
  const Dash = dashboards[user?.role || 'employee'] || EmployeeDashboard;
  return <Dash navigation={navigation} />;
};

export const DashboardRouter: React.FC = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="DashboardHome"
        options={({ navigation }) => ({
          headerShown: true,
          header: () => (
            <Header
              title="HR MAX"
              subtitle="Dashboard"
              onMenuPress={() => (navigation as any).openDrawer()}
              onNotificationPress={() => navigation.navigate('Notifications')}
              navigation={navigation}
            />
          ),
        })}
      >
        {(props) => <DashboardContent navigation={props.navigation} />}
      </Stack.Screen>
      <Stack.Screen name="Employees" component={GuardedEmployees} options={{ headerTitle: 'Employees' }} />
      <Stack.Screen name="Departments" component={GuardedDepartments} options={{ headerTitle: 'Departments' }} />
      <Stack.Screen name="TaskManagement" component={GuardedTaskManagement} options={{ headerTitle: 'Task Management' }} />
      <Stack.Screen name="LeaveManagement" component={GuardedLeaveManagement} options={{ headerTitle: 'Leave Management' }} />
      <Stack.Screen name="Assets" component={GuardedAssets} options={{ headerTitle: 'Assets' }} />
      <Stack.Screen name="HolidayCalendar" component={HolidayCalendarScreen} options={{ headerTitle: 'Holiday Calendar' }} />
      <Stack.Screen name="Companies" component={GuardedCompanies} options={{ headerTitle: 'Companies' }} />
      <Stack.Screen name="Executives" component={GuardedExecutives} options={{ headerTitle: 'Executives' }} />
      <Stack.Screen name="TeamLeaders" component={GuardedTeamLeaders} options={{ headerTitle: 'Team Leaders' }} />
      <Stack.Screen name="CompanyApprovals" component={GuardedCompanyApprovals} options={{ headerTitle: 'Admin Approvals' }} />
      <Stack.Screen name="AttendanceOverview" component={GuardedAttendanceOverview} options={{ headerTitle: "Today's Attendance" }} />
      <Stack.Screen name="AuditLogs" component={GuardedAuditLogs} options={{ headerTitle: 'Audit Logs' }} />
      <Stack.Screen name="ApplyLeave" component={GuardedApplyLeave} options={{ headerTitle: 'Apply Leave' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerTitle: 'Notifications' }} />
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ headerTitle: 'Announcements' }} />
      <Stack.Screen name="MyProfile" component={MyProfileScreen} options={{ headerTitle: 'My Profile' }} />
      <Stack.Screen name="EmployeeProfile" component={EmployeeProfileScreen} options={{ headerTitle: 'Employee Profile' }} />
      <Stack.Screen name="SalaryStructure" component={GuardedSalaryStructure} options={{ headerTitle: 'Salary Structures' }} />
      <Stack.Screen name="SalarySlips" component={SalarySlipsScreen} options={{ headerTitle: 'Salary Slips' }} />
      <Stack.Screen name="RunPayroll" component={GuardedRunPayroll} options={{ headerTitle: 'Run Payroll' }} />
      <Stack.Screen name="PayrollHistory" component={GuardedPayrollHistory} options={{ headerTitle: 'Payroll History' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerTitle: 'Settings' }} />
      <Stack.Screen name="AttendanceSettings" component={GuardedAttendanceSettings} options={{ headerTitle: 'Attendance Settings' }} />
      <Stack.Screen name="EmailCenter" component={EmailCenterScreen} options={{ headerTitle: 'Email Center' }} />
      <Stack.Screen name="CalendarCenter" component={CalendarCenterScreen} options={{ headerTitle: 'Calendar Center' }} />
      <Stack.Screen name="MyTeam" component={GuardedMyTeam} options={{ headerTitle: 'My Team' }} />
      <Stack.Screen name="AddressBook" component={AddressBookScreen} options={{ headerTitle: 'Address Book' }} />
      <Stack.Screen name="Birthdays" component={BirthdaysScreen} options={{ headerTitle: 'Birthdays' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ headerTitle: 'Reports' }} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ headerTitle: 'Analytics' }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ headerTitle: 'Support' }} />
      <Stack.Screen name="SupportTickets" component={GuardedSupportTickets} options={{ headerTitle: 'Support Tickets' }} />
      <Stack.Screen name="CompanyDetailsView" component={CompanyDetailsViewScreen} options={{ headerTitle: 'Company Details' }} />
      <Stack.Screen name="ExecutiveProfile" component={ExecutiveProfileScreen} options={{ headerTitle: 'Executive Profile' }} />
      <Stack.Screen name="TeamLeaderProfile" component={TeamLeaderProfileScreen} options={{ headerTitle: 'Team Leader Profile' }} />
      <Stack.Screen name="ExecutiveOversight" component={GuardedExecutiveOversight} options={{ headerTitle: 'Executive Oversight' }} />
      <Stack.Screen name="AccessManagement" component={GuardedAccessManagement} options={{ headerTitle: 'Access Management' }} />
      <Stack.Screen name="TransferManagement" component={GuardedTransferManagement} options={{ headerTitle: 'Transfer Management' }} />
      <Stack.Screen name="DocumentsManagement" component={GuardedDocumentsManagement} options={{ headerTitle: 'Document Management' }} />
      <Stack.Screen name="HRMSDashboard" component={HRMSDashboardScreen} options={{ headerTitle: 'HRMS Dashboard' }} />
      <Stack.Screen name="CompanyProfile" component={CompanyProfileScreen} options={{ headerTitle: 'Company Profile' }} />
      <Stack.Screen name="Performance" component={GuardedPerformance} options={{ headerTitle: 'Performance' }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ headerTitle: 'Documents' }} />
      <Stack.Screen name="AttendanceDashboard" component={AttendanceDashboardScreen} options={{ headerTitle: 'Attendance Dashboard' }} />
      <Stack.Screen name="EmployeeViewDashboard" component={EmployeeViewDashboardScreen} options={{ headerTitle: 'Employee Dashboard' }} />
      <Stack.Screen name="ExecutiveCompanies" component={ExecutiveCompaniesScreen} options={{ headerTitle: 'Assigned Companies' }} />
      <Stack.Screen name="ExecutiveTeamLeaders" component={ExecutiveTeamLeadersScreen} options={{ headerTitle: 'My Team Leaders' }} />
      <Stack.Screen name="HandledCompanies" component={HandledCompaniesScreen} options={{ headerTitle: 'Handled Companies' }} />
      <Stack.Screen name="TeamOperations" component={TeamOperationsScreen} options={{ headerTitle: 'Team Operations' }} />
      <Stack.Screen name="MyLeavesAttendance" component={MyLeavesAttendanceScreen} options={{ headerTitle: 'My Leaves & Attendance' }} />
    </Stack.Navigator>
  );
};
