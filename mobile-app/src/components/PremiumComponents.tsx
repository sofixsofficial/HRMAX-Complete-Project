import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Animated, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { Icon } from '../utils/icons';

export const PremiumCard: React.FC<{
  children: React.ReactNode;
  style?: any;
  accentColor?: string;
  onPress?: () => void;
}> = ({ children, style, accentColor, onPress }) => {
  const { colors } = useTheme();
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.85}
      style={[{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.borderLight,
        ...Platform.select({ android: { elevation: 2 } }),
      }, accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : {}, style]}>
      {children}
    </Wrapper>
  );
};

export const ShimmerLoader: React.FC<{ height?: number; count?: number; style?: any }> = ({ height = 80, count = 3, style }) => {
  const { colors } = useTheme();
  const animValues = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = animValues.map((val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      )
    );
    animations.forEach((a: Animated.CompositeAnimation) => a.start());
    return () => animations.forEach((a: Animated.CompositeAnimation) => a.stop());
  }, []);

  return (
    <View style={[{ gap: 10 }, style]}>
      {animValues.map((anim: Animated.Value, i: number) => (
        <Animated.View key={i} style={[{
          height, backgroundColor: colors.shimmer, borderRadius: 14,
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
        }]} />
      ))}
    </View>
  );
};

export const HeroBanner: React.FC<{
  greeting: string;
  name: string;
  subtitle?: string;
  stats?: { label: string; value: string | number; color?: string }[];
  illustration?: string;
}> = ({ greeting, name, subtitle, stats }) => {
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <LinearGradient
      colors={['#1e293b', '#334155', '#475569']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={bannerStyles.container}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={bannerStyles.greeting}>{greeting}</Text>
        <Text style={bannerStyles.name}>{name}</Text>
        {subtitle && <Text style={bannerStyles.subtitle}>{subtitle}</Text>}
        {stats && (
          <View style={bannerStyles.statsRow}>
            {stats.map((s, i) => (
              <View key={i} style={bannerStyles.statItem}>
                <Text style={[bannerStyles.statValue, { color: s.color || colors.accent }]}>{s.value}</Text>
                <Text style={bannerStyles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </LinearGradient>
  );
};

const bannerStyles = StyleSheet.create({
  container: { marginHorizontal: 16, borderRadius: 20, padding: 20, marginBottom: 12, ...Platform.select({ android: { elevation: 4 } }) },
  greeting: { color: '#94a3b8', fontSize: 13, fontWeight: '500', letterSpacing: 0.5 },
  name: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 },
  subtitle: { color: '#cbd5e1', fontSize: 13, marginTop: 6, lineHeight: 18 },
  statsRow: { flexDirection: 'row', marginTop: 16, gap: 20 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { color: '#94a3b8', fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
});

export const AnimatedStatCard: React.FC<{
  icon: string; label: string; value: string | number; color: string;
  onPress?: () => void; delay?: number;
}> = ({ icon: iconName, label, value, color, onPress, delay = 0 }) => {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, tension: 40, delay, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 300, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }], flex: 1 }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={[{
          backgroundColor: colors.card, borderRadius: 16, padding: 14, alignItems: 'center',
          borderWidth: 1, borderColor: colors.borderLight,
          ...Platform.select({ android: { elevation: 2 } }),
        }]}>
        <View style={[{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${color}18`, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }]}>
          <Icon name={iconName} size={20} color={color} />
        </View>
        <Text style={[{ fontSize: 20, fontWeight: '700', color: colors.text }]}>{value}</Text>
        <Text style={[{ fontSize: 11, color: colors.textSecondary, marginTop: 2, textAlign: 'center' }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const SegmentControl: React.FC<{
  options: string[]; selected: string; onSelect: (val: string) => void;
}> = ({ options, selected, onSelect }) => {
  const { colors } = useTheme();
  return (
    <View style={[segStyles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={segStyles.scrollContent}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[segStyles.tab, selected === opt && { backgroundColor: colors.accent }]}
            onPress={() => onSelect(opt)}>
            <Text style={[segStyles.text, { color: selected === opt ? '#fff' : colors.textSecondary }]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const segStyles = StyleSheet.create({
  container: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, marginBottom: 12 },
  scrollContent: { flexDirection: 'row', flexGrow: 1 },
  tab: { flex: 1, minWidth: 84, paddingVertical: 10, alignItems: 'center' },
  text: { fontSize: 13, fontWeight: '600' },
});

export const PremiumSearchBar: React.FC<{
  value: string; onChangeText: (t: string) => void; placeholder?: string; style?: any;
}> = ({ value, onChangeText, placeholder = 'Search...', style }) => {
  const { colors } = useTheme();
  return (
    <View style={[searchStyles.container, { backgroundColor: colors.card, borderColor: colors.borderLight }, style]}>
      <Icon name="search-outline" size={18} color={colors.textTertiary} />
      <TextInput
        style={[searchStyles.input, { color: colors.text }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        value={value} onChangeText={onChangeText}
      />
      {value ? (
        <TouchableOpacity onPress={() => onChangeText('')}>
          <Icon name="close-circle-outline" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const searchStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 14, height: 44, borderRadius: 14, borderWidth: 1, marginBottom: 10, gap: 8 },
  input: { flex: 1, fontSize: 14, padding: 0 },
});

export const FloatingActionButton: React.FC<{ icon: string; onPress: () => void; color?: string }> = ({ icon: iconName, onPress, color }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[fabStyles.btn, { backgroundColor: color || colors.accent }]}>
      <Icon name={iconName} size={24} color="#fff" />
    </TouchableOpacity>
  );
};

const fabStyles = StyleSheet.create({
  btn: {
    position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ android: { elevation: 6 } }),
  },
});

export const EmptyStateView: React.FC<{ icon: string; title: string; subtitle?: string }> = ({ icon: iconName, title, subtitle }) => {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${colors.textTertiary}15`, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Icon name={iconName} size={32} color={colors.textTertiary} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 6 }}>{title}</Text>
      {subtitle && <Text style={{ fontSize: 13, color: colors.textTertiary, textAlign: 'center', lineHeight: 18 }}>{subtitle}</Text>}
    </View>
  );
};

export const StatusBadge: React.FC<{ status: string; color: string }> = ({ status, color }) => (
  <View style={[{ backgroundColor: `${color}20`, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' }]}>
    <Text style={[{ color, fontSize: 11, fontWeight: '700' }]}>{status}</Text>
  </View>
);

export const Chip: React.FC<{
  label: string; selected: boolean; onPress: () => void; color?: string;
}> = ({ label, selected, onPress, color }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[{
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, marginRight: 6,
        backgroundColor: selected ? (color || colors.accent) : colors.surface,
        borderWidth: 1, borderColor: selected ? (color || colors.accent) : colors.border,
      }]}>
      <Text style={[{ fontSize: 12, fontWeight: '600', color: selected ? '#fff' : colors.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
};

export const PremiumBottomSheet: React.FC<{
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}> = ({ visible, onClose, title, children }) => {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: visible ? 1 : 0.8, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={[bsStyles.overlay, { backgroundColor: colors.modalOverlay }]}>
      <TouchableOpacity style={bsStyles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[bsStyles.sheet, { backgroundColor: colors.card, opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={[bsStyles.header, { borderBottomColor: colors.borderLight }]}>
          <Text style={[bsStyles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
};

const bsStyles = StyleSheet.create({
  // Centered dialog container (was a bottom-anchored sheet): dark backdrop,
  // exact vertical + horizontal center, capped dialog width.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32, zIndex: 100 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { width: '100%', maxWidth: 480, borderRadius: 24, padding: 20, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '700' },
});

export const PremiumModal: React.FC<{
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}> = ({ visible, onClose, title, children }) => {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: visible ? 1 : 0.8, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={[bsStyles.overlay, { backgroundColor: colors.modalOverlay }]}>
      <Animated.View style={[{ backgroundColor: colors.card, width: '100%', maxWidth: 480, borderRadius: 20, padding: 24, maxHeight: '80%', opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={[bsStyles.header, { borderBottomColor: colors.borderLight, paddingBottom: 12, marginBottom: 16 }]}>
          <Text style={[bsStyles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
};
