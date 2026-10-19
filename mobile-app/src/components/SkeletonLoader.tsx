import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

const SkeletonBlock: React.FC<{ width?: number | string; height?: number; borderRadius?: number; style?: any }> = ({
  width = '100%', height = 20, borderRadius = 8, style,
}) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View style={[{ width: width as any, height, borderRadius, backgroundColor: colors.shimmer, opacity }, style]} />
  );
};

export const SkeletonRow: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <View style={styles.row}>
    {Array.from({ length: count }, (_, i) => (
      <View key={i} style={styles.rowItem}>
        <SkeletonBlock width="100%" height={70} borderRadius={12} />
      </View>
    ))}
  </View>
);

export const SkeletonModuleCard: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={[styles.moduleCard, { backgroundColor: colors.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <SkeletonBlock width={44} height={44} borderRadius={12} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBlock width="50%" height={16} />
          <SkeletonBlock width="70%" height={12} />
        </View>
      </View>
    </View>
  );
};

export const DashboardSkeleton: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ padding: 20, gap: 8 }}>
        <SkeletonBlock width="40%" height={14} />
        <SkeletonBlock width="55%" height={24} />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} width="100%" height={50} borderRadius={10} />)}
      </View>
      <View style={{ height: 20 }} />
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <SkeletonRow count={4} />
      </View>
      <View style={{ padding: 20, gap: 12 }}>
        {[0, 1, 2, 3, 4].map((i) => <SkeletonModuleCard key={i} />)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderRadius: 12, padding: 16, borderLeftWidth: 4 },
  row: { flexDirection: 'row', gap: 12 },
  rowItem: { flex: 1 },
  moduleCard: { borderRadius: 12, padding: 16 },
});
