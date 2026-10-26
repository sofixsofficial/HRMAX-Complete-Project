import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { getSectionsByRole } from '../navigation/CustomDrawerContent';

/**
 * Role-aware bottom navigation (Home · Attendance · Leave · Reports · More).
 *
 * Items are derived from the SAME section data that builds the drawer, so a
 * role never gets a tab pointing at a screen it does not have (company admin
 * has no Attendance screen, an employee has no Reports, and so on). "More"
 * opens the drawer, which stays the complete navigation.
 */

type TabKey = 'home' | 'attendance' | 'leave' | 'reports' | 'more';

const TAB_META: Record<Exclude<TabKey, 'more'>, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  home: { label: 'Home', icon: 'home-outline' },
  attendance: { label: 'Attendance', icon: 'clipboard-outline' },
  leave: { label: 'Leave', icon: 'umbrella-outline' },
  reports: { label: 'Reports', icon: 'bar-chart-outline' },
};

/** Tabs this role may use, plus the screen the Leave tab should route to. */
interface AvailableTabs {
  tabs: TabKey[];
  leaveScreen: string | null;
}

function useAvailableTabs(): AvailableTabs {
  const { user } = useAuth();
  return useMemo(() => {
    const sections = getSectionsByRole(user?.role);
    const items = sections.flatMap((s) => s.items);
    const hasScreen = (screen: string) => items.some((i) => i.screen === screen && !i.params);
    const hasLabel = (label: string) => items.some((i) => i.label === label);

    // A reporting manager reviews their own time off from
    // MyLeavesAttendance rather than the company-wide Leaves screen - the
    // Leave tab must appear for them too, and route to whichever they have.
    const leaveScreen = hasScreen('Leaves') ? 'Leaves' : hasScreen('MyLeavesAttendance') ? 'MyLeavesAttendance' : null;

    const tabs: TabKey[] = ['home'];
    if (hasScreen('Attendance')) tabs.push('attendance');
    if (leaveScreen) tabs.push('leave');
    if (hasLabel('Reports')) tabs.push('reports');
    tabs.push('more');
    return { tabs, leaveScreen };
  }, [user?.role]);
}

export const BottomNav: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { tabs, leaveScreen } = useAvailableTabs();

  // Active tab = the drawer route, or the nested stack route when Home is open.
  const state = useNavigationState((s) => s) as
    | { index?: number; routes?: Array<{ name: string; state?: { index?: number; routes?: Array<{ name: string }> } }> }
    | undefined;
  const route = state?.routes && state.index !== undefined ? state.routes[state.index] : undefined;
  const nested = route?.state?.routes?.[route.state.index ?? 0]?.name;
  const active = route?.name === 'Home' ? nested ?? 'Home' : route?.name;

  const activeKey: TabKey | null =
    active === 'Home' || active === 'DashboardHome'
      ? 'home'
      : active === 'Attendance'
        ? 'attendance'
        : active === 'Leaves' || active === 'ApplyLeave' || active === 'MyLeavesAttendance'
          ? 'leave'
          : active === 'Reports' || active === 'Analytics'
            ? 'reports'
            : null;

  const onPress = (key: TabKey) => {
    if (key === 'more') {
      navigation.openDrawer();
      return;
    }
    // Each tab jumps to its own root. Home always targets DashboardHome
    // explicitly - a bare navigate('Home') keeps whatever nested screen is
    // already open, so tapping Home while deep in Reports did nothing.
    if (key === 'home') navigation.navigate('Home', { screen: 'DashboardHome' });
    else if (key === 'attendance') navigation.navigate('Attendance');
    else if (key === 'leave' && leaveScreen) navigation.navigate(leaveScreen);
    else if (key === 'reports') navigation.navigate('Home', { screen: 'Reports' });
  };

  const s = styles(colors, insets.bottom);

  return (
    <View style={s.bar}>
      {tabs.map((key) => {
        const isActive = key === 'more' ? false : activeKey === key;
        const meta = key === 'more' ? { label: 'More', icon: 'ellipsis-horizontal' as const } : TAB_META[key];
        const color = isActive ? '#FF6600' : colors.sidebarText;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={meta.label}
            onPress={() => onPress(key)}
            style={({ pressed }) => [s.item, pressed && { opacity: 0.7 }]}
            hitSlop={4}
          >
            <Ionicons name={meta.icon} size={21} color={color} />
            <Text style={[s.label, { color }]} numberOfLines={1}>
              {meta.label}
            </Text>
            <View style={[s.indicator, isActive && s.indicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
};

/**
 * Renders a drawer screen with the bottom bar pinned under it (a real layout
 * sibling, not an overlay — so nothing in the screen is covered).
 */
export const withBottomNav = <P extends object>(Component: React.ComponentType<P>): React.FC<P> => {
  const Wrapped: React.FC<P> = (props) => (
    <View style={{ flex: 1 }}>
      <Component {...props} />
      <BottomNav />
    </View>
  );
  Wrapped.displayName = `WithBottomNav(${Component.displayName || Component.name || 'Screen'})`;
  return Wrapped;
};

const styles = (c: ReturnType<typeof useTheme>['colors'], bottomInset: number) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: c.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingBottom: Math.max(bottomInset, 8),
      paddingTop: 8,
    },
    item: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      minHeight: 46,
    },
    label: { fontSize: 10.5, fontWeight: '600' },
    indicator: {
      width: 18,
      height: 2.5,
      borderRadius: 2,
      backgroundColor: 'transparent',
    },
    indicatorActive: { backgroundColor: '#FF6600' },
  });
