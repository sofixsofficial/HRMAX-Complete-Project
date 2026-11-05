import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTheme } from '../context/ThemeContext';
import { CustomDrawerContent } from './CustomDrawerContent';
import { DashboardRouter } from './DashboardRouter';
import { AttendanceScreen } from '../screens/modules/AttendanceScreen';
import { LeaveScreen } from '../screens/modules/LeaveScreen';
import { MyLeavesAttendanceScreen } from '../screens/modules/MyLeavesAttendanceScreen';
import { TasksScreen } from '../screens/modules/TasksScreen';
import { PayrollScreen } from '../screens/modules/PayrollScreen';
import { SettingsScreen } from '../screens/modules/SettingsScreen';
import { NotificationsScreen } from '../screens/modules/NotificationsScreen';
import { withBottomNav } from '../components/BottomNav';

const Drawer = createDrawerNavigator();

// Wrapped ONCE at module scope. Calling withBottomNav(...) inline in JSX made
// `component` a NEW type on every DrawerNavigator re-render — React Navigation
// then REMOUNTED the whole Home stack (dashboard flicker / "auto refresh" on
// every context churn, e.g. the RM's own user-doc sync loop).
const HomeScreen = withBottomNav(DashboardRouter);
const AttendanceDrawerScreen = withBottomNav(AttendanceScreen);
const LeavesDrawerScreen = withBottomNav(LeaveScreen);
const MyLeavesAttendanceDrawerScreen = withBottomNav(MyLeavesAttendanceScreen);
const TasksDrawerScreen = withBottomNav(TasksScreen);
const PayrollDrawerScreen = withBottomNav(PayrollScreen);
const SettingsDrawerScreen = withBottomNav(SettingsScreen);
const NotificationsDrawerScreen = withBottomNav(NotificationsScreen);

export const DrawerNavigator: React.FC = () => {
  const { colors } = useTheme();
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: colors.sidebarBg, width: 280 },
        drawerActiveTintColor: colors.sidebarActive,
        drawerInactiveTintColor: colors.sidebarText,
        drawerLabelStyle: { fontSize: 14, marginLeft: -10 },
      }}
    >
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="Attendance" component={AttendanceDrawerScreen} />
      <Drawer.Screen name="Leaves" component={LeavesDrawerScreen} />
      {/* headerShown follows screenOptions (false) — the screen renders its own
          ScreenHeader (back + title), keeping the bar uniform with other routes. */}
      <Drawer.Screen name="MyLeavesAttendance" component={MyLeavesAttendanceDrawerScreen} options={{ title: 'My Leaves & Attendance' }} />
      <Drawer.Screen name="Tasks" component={TasksDrawerScreen} />
      <Drawer.Screen name="Payroll" component={PayrollDrawerScreen} />
      <Drawer.Screen name="Settings" component={SettingsDrawerScreen} />
      <Drawer.Screen name="Notifications" component={NotificationsDrawerScreen} />
    </Drawer.Navigator>
  );
};
