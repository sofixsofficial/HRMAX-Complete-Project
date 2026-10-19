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

const Drawer = createDrawerNavigator();

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
      <Drawer.Screen name="Home" component={DashboardRouter} />
      <Drawer.Screen name="Attendance" component={AttendanceScreen} />
      <Drawer.Screen name="Leaves" component={LeaveScreen} />
      {/* headerShown follows screenOptions (false) — the screen renders its own
          ScreenHeader (back + title), keeping the bar uniform with other routes. */}
      <Drawer.Screen name="MyLeavesAttendance" component={MyLeavesAttendanceScreen} options={{ title: 'My Leaves & Attendance' }} />
      <Drawer.Screen name="Tasks" component={TasksScreen} />
      <Drawer.Screen name="Payroll" component={PayrollScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
      <Drawer.Screen name="Notifications" component={NotificationsScreen} />
    </Drawer.Navigator>
  );
};
