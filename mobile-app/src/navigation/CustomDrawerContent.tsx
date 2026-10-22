import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Image, Platform } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/user';

interface DrawerItem {
  label: string;
  icon: string;
  screen: string;
  params?: any;
  roles?: UserRole[];
}

interface DrawerSection {
  title: string;
  items: DrawerItem[];
}

const home = (screen: string) => ({ screen: 'Home' as const, params: { screen } });

const getSectionsByRole = (userRole?: UserRole): DrawerSection[] => {
  switch (userRole) {
    // ── Master Admin: platform owner, full global control ──
    case 'master-admin':
      return [
        { title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] },
        {
          title: 'Self Service',
          items: [
            { label: 'My Leaves & Attendance', icon: 'briefcase-outline', screen: 'MyLeavesAttendance' },
          ],
        },
        {
          title: 'Organization',
          items: [
            { label: 'Companies', icon: 'business-outline', ...home('Companies') },
            { label: 'Departments', icon: 'git-network-outline', ...home('Departments') },
            { label: 'Access Management', icon: 'lock-closed-outline', ...home('AccessManagement') },
          ],
        },
        {
          title: 'People',
          items: [
            { label: 'Employees', icon: 'people-outline', ...home('Employees') },
            { label: 'Executives', icon: 'ribbon-outline', ...home('Executives') },
            { label: 'Team Leaders', icon: 'person-add-outline', ...home('TeamLeaders') },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance' },
            { label: 'Leaves', icon: 'umbrella-outline', screen: 'Leaves' },
            { label: 'Payroll', icon: 'wallet-outline', ...home('SalarySlips') },
            { label: 'Run Payroll', icon: 'calculator-outline', ...home('RunPayroll') },
            { label: 'Payroll History', icon: 'time-outline', ...home('PayrollHistory') },
            { label: 'Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks' },
          ],
        },
        {
          title: 'Time Off',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Birthdays', icon: 'gift-outline', ...home('Birthdays') },
          ],
        },
        {
          title: 'Resources',
          items: [{ label: 'Address Book', icon: 'book-outline', ...home('AddressBook') }],
        },
        {
          title: 'Communication',
          items: [
            { label: 'Emails', icon: 'mail-outline', ...home('EmailCenter') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
        {
          title: 'Calendar',
          items: [{ label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') }],
        },
        {
          title: 'Analytics',
          items: [{ label: 'Reports', icon: 'bar-chart-outline', ...home('Reports') }],
        },
        {
          title: 'Administration',
          items: [
            { label: 'Executive Oversight', icon: 'eye-outline', ...home('ExecutiveOversight') },
            { label: 'Document Management', icon: 'folder-outline', ...home('DocumentsManagement') },
            { label: 'Transfer Management', icon: 'swap-horizontal-outline', ...home('TransferManagement') },
            { label: 'Audit Logs', icon: 'document-text-outline', ...home('AuditLogs') },
            { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
            { label: 'Support', icon: 'headset-outline', ...home('Support') },
            { label: 'Support Tickets', icon: 'chatbox-ellipses-outline', ...home('SupportTickets') },
          ],
        },
      ];

    // ── Executive: regional / multi-company overseer ──
    case 'executive':
      return [
        { title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] },
        {
          title: 'Self Service',
          items: [
            { label: 'My Leaves & Attendance', icon: 'briefcase-outline', screen: 'MyLeavesAttendance' },
          ],
        },
        {
          title: 'My Oversight',
          items: [
            { label: 'Assigned Companies', icon: 'business-outline', ...home('ExecutiveCompanies') },
            { label: 'All Companies', icon: 'business-outline', ...home('Companies') },
            { label: 'Team Leaders', icon: 'people-outline', ...home('ExecutiveTeamLeaders') },
          ],
        },
        {
          title: 'People',
          items: [
            { label: 'Employees', icon: 'people-outline', ...home('Employees') },
            { label: 'Address Book', icon: 'book-outline', ...home('AddressBook') },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance' },
            { label: 'Leaves', icon: 'umbrella-outline', screen: 'Leaves' },
            { label: 'Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks' },
            { label: 'Payroll', icon: 'wallet-outline', ...home('SalarySlips') },
            { label: 'Run Payroll', icon: 'calculator-outline', ...home('RunPayroll') },
            { label: 'Salary Slips', icon: 'document-text-outline', ...home('SalarySlips') },
            { label: 'Salary Structure', icon: 'wallet-outline', ...home('SalaryStructure') },
            { label: 'Departments', icon: 'git-network-outline', ...home('Departments') },
          ],
        },
        {
          title: 'Time Off',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Birthdays', icon: 'gift-outline', ...home('Birthdays') },
          ],
        },
        {
          title: 'Communication',
          items: [
            { label: 'Emails', icon: 'mail-outline', ...home('EmailCenter') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
        {
          title: 'Calendar',
          items: [{ label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') }],
        },
        {
          title: 'Analytics & Reporting',
          items: [{ label: 'Reports', icon: 'bar-chart-outline', ...home('Reports') }],
        },
        {
          title: 'System',
          items: [
            { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
            { label: 'Support', icon: 'headset-outline', ...home('Support') },
          ],
        },
      ];

    // ── Company Admin: single company boss (view-only, verify tiers only —
    //    no self-service leave/attendance creation surfaces) ──
    case 'company-admin':
      return [
        { title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] },
        {
          title: 'Organization',
          items: [{ label: 'Departments', icon: 'git-network-outline', ...home('Departments') }],
        },
        {
          title: 'People',
          items: [{ label: 'Employees', icon: 'people-outline', ...home('Employees') }],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Payroll', icon: 'wallet-outline', ...home('SalarySlips') },
          ],
        },
        {
          title: 'Time Off',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Birthdays', icon: 'gift-outline', ...home('Birthdays') },
          ],
        },
        {
          title: 'Communication',
          items: [
            { label: 'Emails', icon: 'mail-outline', ...home('EmailCenter') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
        {
          title: 'Calendar',
          items: [{ label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') }],
        },
        {
          title: 'Company',
          items: [{ label: 'Company Profile', icon: 'shield-checkmark-outline', ...home('CompanyProfile') }],
        },
        {
          title: 'Analytics',
          items: [{ label: 'Reports', icon: 'bar-chart-outline', ...home('Reports') }],
        },
        {
          title: 'System',
          items: [
            { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
            { label: 'Support', icon: 'headset-outline', ...home('Support') },
          ],
        },
      ];

    // ── Team Leader: operational / project controller ──
    case 'team-leader':
      return [
        { title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] },
        {
          title: 'Self Service',
          items: [
            { label: 'My Leaves & Attendance', icon: 'briefcase-outline', screen: 'MyLeavesAttendance' },
          ],
        },
        {
          title: 'My Assignment',
          items: [
            { label: 'Handled Companies', icon: 'business-outline', ...home('HandledCompanies') },
            { label: 'All Companies', icon: 'business-outline', ...home('Companies') },
            { label: 'Team Operations', icon: 'settings-outline', ...home('TeamOperations') },
          ],
        },
        {
          title: 'Team Management',
          items: [
            { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance' },
            { label: 'Leaves', icon: 'umbrella-outline', screen: 'Leaves' },
            { label: 'Birthdays', icon: 'gift-outline', ...home('Birthdays') },
            { label: 'Address Book', icon: 'book-outline', ...home('AddressBook') },
            { label: 'Emails', icon: 'mail-outline', ...home('EmailCenter') },
            { label: 'Payroll', icon: 'wallet-outline', ...home('SalarySlips') },
            { label: 'Run Payroll', icon: 'calculator-outline', ...home('RunPayroll') },
            { label: 'Salary Slips', icon: 'document-text-outline', ...home('SalarySlips') },
          ],
        },
        {
          title: 'Work Management',
          items: [
            { label: 'Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks' },
            { label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') },
          ],
        },
        {
          title: 'Company Info',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
        {
          title: 'Analytics & Reporting',
          items: [
            { label: 'Reports', icon: 'bar-chart-outline', ...home('Reports') },
            { label: 'Analytics', icon: 'stats-chart-outline', ...home('Analytics') },
          ],
        },
        {
          title: 'System',
          items: [
            { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
            { label: 'Support', icon: 'headset-outline', ...home('Support') },
          ],
        },
      ];

    // ── Reporting Manager: direct supervisor, attendance + leave approval ──
    case 'reporting-manager':
      return [
        { title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] },
        {
          title: 'Self Service',
          items: [
            { label: 'My Leaves & Attendance', icon: 'briefcase-outline', screen: 'MyLeavesAttendance' },
            { label: 'Salary Slips', icon: 'wallet-outline', ...home('SalarySlips') },
            { label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') },
            { label: 'Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks' },
          ],
        },
        {
          title: 'My Team',
          items: [
            { label: 'My Team', icon: 'people-outline', ...home('MyTeam') },
            { label: 'Review Leaves', icon: 'umbrella-outline', ...home('LeaveManagement') },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance' },
          ],
        },
        {
          title: 'Company',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
      ];

    // ── Employee: the execution unit ──
    case 'employee':
      return [
        {
          title: 'Main',
          items: [
            { label: 'Dashboard', icon: 'grid-outline', screen: 'Home' },
            { label: 'My Profile', icon: 'person-circle-outline', ...home('MyProfile') },
          ],
        },
        {
          title: 'Operations',
          items: [
            { label: 'Attendance', icon: 'clipboard-outline', screen: 'Attendance' },
            { label: 'Leaves', icon: 'umbrella-outline', screen: 'Leaves' },
            { label: 'Payroll', icon: 'wallet-outline', ...home('SalarySlips') },
            { label: 'Tasks', icon: 'checkmark-circle-outline', screen: 'Tasks' },
          ],
        },
        {
          title: 'Time Off',
          items: [
            { label: 'Holidays', icon: 'calendar-outline', ...home('HolidayCalendar') },
            { label: 'Birthdays', icon: 'gift-outline', ...home('Birthdays') },
          ],
        },
        {
          title: 'Resources',
          items: [{ label: 'Documents', icon: 'folder-outline', ...home('Documents') }],
        },
        {
          title: 'Communication',
          items: [
            { label: 'Emails', icon: 'mail-outline', ...home('EmailCenter') },
            { label: 'Announcements', icon: 'megaphone-outline', ...home('Announcements') },
          ],
        },
        {
          title: 'Calendar',
          items: [{ label: 'Calendar', icon: 'calendar-outline', ...home('CalendarCenter') }],
        },
        {
          title: 'System',
          items: [
            { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
            { label: 'Support', icon: 'headset-outline', ...home('Support') },
          ],
        },
      ];

    default:
      return [{ title: 'Main', items: [{ label: 'Dashboard', icon: 'grid-outline', screen: 'Home' }] }];
  }
};

export const CustomDrawerContent: React.FC<DrawerContentComponentProps> = (props) => {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const userRole = user?.role as UserRole | undefined;
  const sections = getSectionsByRole(userRole);

  const handleLogout = async () => {
    // RN-web's Alert.alert is a no-op — without window.confirm the confirm
    // dialog never appears in the browser preview and Sign Out does nothing.
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Are you sure you want to logout?')
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Logout', style: 'destructive', onPress: () => resolve(true) },
          ]);
        });
    if (!confirmed) return;
    try {
      await logout();
    } catch (error: any) {
      const msg = error?.message || 'Logout failed';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  };

  const currentRoute = props.state.routes[props.state.index]?.name;

  const isActive = (item: DrawerItem) => {
    if (item.screen === 'Home' && currentRoute === 'Home' && !item.params) return true;
    if (currentRoute === item.screen && !item.params) return true;
    return false;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.sidebarBg }}>
      <View style={{ paddingTop: insets.top + 20, paddingHorizontal: 20, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('../../assets/icon.png')} style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#FF6600' }} resizeMode="cover" />
          <Text style={{ marginLeft: 12, fontSize: 20, fontWeight: '700', color: '#fff' }}>HR MAX</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {sections.map((section) => {
          if (section.items.length === 0) return null;
          return (
            <View key={section.title} style={{ marginBottom: 8 }}>
              <Text style={{
                fontSize: 11, fontWeight: '600', color: colors.sidebarSection,
                textTransform: 'uppercase', letterSpacing: 1,
                paddingHorizontal: 24, paddingVertical: 8, marginTop: 4,
              }}>
                {section.title}
              </Text>
              {section.items.map((item) => {
                const active = isActive(item);
                return (
                  <TouchableOpacity
                    key={item.label}
                    onPress={() => { props.navigation.navigate(item.screen, item.params); props.navigation.closeDrawer(); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 11,
                      paddingHorizontal: 24,
                      backgroundColor: active ? `${colors.sidebarActive}20` : 'transparent',
                      borderLeftWidth: 3,
                      borderLeftColor: active ? colors.sidebarActive : 'transparent',
                    }}
                  >
                    <Ionicons name={item.icon as any} size={18} color={active ? colors.sidebarActive : colors.sidebarText} />
                    <Text style={{
                      marginLeft: 14,
                      fontSize: 14,
                      fontWeight: active ? '600' : '400',
                      color: active ? '#fff' : colors.sidebarText,
                    }}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.sidebarHover, paddingVertical: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 12 }}>
          <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sidebarHover }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{user?.name || 'User'}</Text>
            <Text style={{ fontSize: 11, color: colors.sidebarSection }}>{user?.role === 'master-admin' ? 'Full Access' : (userRole?.replace('-', ' ') || '')}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8 }}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={{ marginLeft: 14, fontSize: 14, color: colors.danger, fontWeight: '500' }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
