import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

// Drawer-level screens (registered directly on the Drawer.Navigator)
const DRAWER_SCREENS = new Set([
  'Home', 'Attendance', 'Leaves', 'Tasks', 'Payroll', 'Settings', 'Notifications',
]);

// DashboardRouter stack screens (nested inside the 'Home' drawer screen)
const MODULE_SCREENS: Record<string, string> = {
  '/attendance': 'Attendance',
  '/leaves': 'Leaves',
  '/leave': 'LeaveManagement',
  '/tasks': 'Tasks',
  '/payroll': 'Payroll',
  '/run-payroll': 'RunPayroll',
  '/salary-slips': 'SalarySlips',
  '/salary-structure': 'SalaryStructure',
  '/holidays': 'HolidayCalendar',
  '/birthdays': 'Birthdays',
  '/emails': 'EmailCenter',
  '/announcements': 'Announcements',
  '/calendar': 'CalendarCenter',
  '/address-book': 'AddressBook',
  '/reports': 'Reports',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
  '/support': 'Support',
  '/support-tickets': 'SupportTickets',
  '/my-profile': 'MyProfile',
  '/employees': 'Employees',
  '/departments': 'Departments',
  '/branches': 'Branches',
  '/companies': 'Companies',
  '/executives': 'Executives',
  '/team-leaders': 'TeamLeaders',
  '/documents-management': 'DocumentsManagement',
  '/documents': 'Documents',
  '/company-profile': 'CompanyProfile',
  '/performance': 'Performance',
  '/assets': 'Assets',
  '/access-management': 'AccessManagement',
  '/notifications': 'Notifications',
  // Personal links from notifications — resolve to the screens that exist
  // for every role (Drawer + DashboardRouter both register these).
  '/my-leaves': 'Leaves',
  '/my-attendance': 'MyLeavesAttendance',
  '/my-leaves-attendance': 'MyLeavesAttendance',
};

/**
 * Resolve a notification link (web-style path) to a mobile screen name.
 * Leave notifications route applicants to the apply screen and approvers to
 * the management screen.
 */
export const screenForLink = (link: string, userRole?: string): string | null => {
  if (!link) return null;
  const path = link.split('?')[0];
  if (path === '/leaves') return 'Leaves';
  if (path === '/leave') {
    return userRole === 'employee' ? 'Leaves' : 'LeaveManagement';
  }
  return MODULE_SCREENS[path] || null;
};

/**
 * Navigate to a screen resolved from a notification link. Falls back to the
 * notification feed when the link can't be resolved.
 */
export const navigateToNotificationLink = (link: string, userRole?: string): void => {
  if (!navigationRef.isReady()) return;
  const screen = screenForLink(link, userRole) || 'Notifications';
  if (DRAWER_SCREENS.has(screen)) {
    navigationRef.navigate(screen);
  } else {
    navigationRef.navigate('Home', { screen });
  }
};

/** Navigate to a screen inside the Home (DashboardRouter) stack by name. */
export const navigateToModule = (screen: string): void => {
  if (!navigationRef.isReady()) return;
  if (DRAWER_SCREENS.has(screen)) {
    navigationRef.navigate(screen);
  } else {
    navigationRef.navigate('Home', { screen });
  }
};

/** Reset the navigator to the Home screen (e.g. after logout). */
export const resetNavigationToHome = (): void => {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] })
  );
};
