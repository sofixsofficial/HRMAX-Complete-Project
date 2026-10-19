import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../utils/icons';

interface ScreenHeaderProps {
  /** Dynamic section title, e.g. 'Attendance', 'Leaves', 'Payroll' */
  title: string;
  /** Optional subtitle shown below the title */
  subtitle?: string;
  /** Optional right-aligned actions rendered on the opposite side */
  right?: React.ReactNode;
  /** Override the default back handler (defaults to navigation.pop()) */
  onBack?: () => void;
  /** Hide the back button entirely (rare — e.g. root modal screens) */
  hideBack?: boolean;
}

/**
 * Standardized top navigation header for all secondary/internal screens.
 * Left-aligned back button (← chevron, safe 44pt touch target) followed by
 * the dynamic section title. Uses safe-area insets so it renders correctly
 * under the status-bar / notch on BOTH Android and iOS.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  right,
  onBack,
  hideBack,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrapper,
        {
          backgroundColor: colors.card,
          paddingTop: insets.top + 6,
          borderBottomColor: colors.borderLight,
        },
      ]}
    >
      <View style={styles.container}>
        {!hideBack ? (
          <TouchableOpacity
            onPress={onBack || (() => {})}
            style={[styles.backBtn, { backgroundColor: colors.background }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.titleArea}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
};

/**
 * Convenience helper: standard back handler used by most screens.
 * Can be passed directly as `onBack={defaultGoBack(navigation)}`.
 */
export const defaultGoBack = (navigation: any) => () => {
  try {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else if (navigation?.pop) navigation.pop();
  } catch {
    /* no-op */
  }
};

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 52,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  titleArea: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
});