import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { LiveClock } from './LiveClock';

interface DashboardHeaderProps {
  name: string;
  roleLabel?: string;
  subtitle?: string;
  stats?: { label: string; value: string | number; color?: string }[];
}

// The time-of-day greeting ("Good morning/afternoon/evening") was removed by
// request for parity with web — the header now shows only name, role, subtitle
// and the live clock.

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ name, roleLabel, subtitle, stats }) => {
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 550, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <LinearGradient colors={['#1e293b', '#334155', '#475569']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <Animated.View style={[styles.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.topRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <View style={styles.tagRow}>
              {roleLabel ? (
                <View style={[styles.tag, { backgroundColor: colors.accentBg }]}>
                  <Text style={[styles.tagText, { color: colors.accent }]} numberOfLines={1}>{roleLabel}</Text>
                </View>
              ) : null}
              {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
          </View>
          <LiveClock />
        </View>

        {stats && stats.length > 0 && (
          <View style={styles.statsRow}>
            {stats.map((st, i) => (
              <View key={i} style={styles.statItem}>
                <Text style={[styles.statValue, { color: st.color || colors.accent }]}>{st.value}</Text>
                <Text style={styles.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingVertical: 22 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  greeting: { fontSize: 13, color: '#cbd5e1', fontWeight: '600', letterSpacing: 0.3 },
  name: { fontSize: 24, fontWeight: '800', color: '#fff', marginTop: 2 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  subtitle: { fontSize: 12, color: '#cbd5e1', flex: 1 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#ffffff14' },
  statItem: { flex: 1 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
});
