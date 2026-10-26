import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

/**
 * Orange "brand" home hero — the reference design: greeting + name +
 * designation on the left, live date/time on the right, and a row of stat
 * tiles (icon badge, label, value) underneath.
 *
 * Every number is passed in by the caller from real backend data; this
 * component never invents a figure. The greeting follows the device's local
 * clock (labelled as such by the clock itself), nothing else is inferred.
 */

export type HeroStat = {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const greetFor = (d: Date): string => {
  const h = d.getHours();
  if (h < 12) return 'Good Morning,';
  if (h < 17) return 'Good Afternoon,';
  if (h < 21) return 'Good Evening,';
  return 'Good Night,';
};

export const BrandHomeHero: React.FC<{
  name: string;
  subtitle?: string | null;
  stats?: HeroStat[];
  onPressStat?: (stat: HeroStat) => void;
  onAvatarPress?: () => void;
  onBellPress?: () => void;
  unread?: number;
}> = ({ name, subtitle, stats = [], onPressStat, onAvatarPress, onBellPress, unread = 0 }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleDateString('en-US', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <LinearGradient
      colors={['#1e293b', '#334155', '#475569']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.hero}
    >
      <View style={s.topRow}>
        <Pressable onPress={onAvatarPress} hitSlop={6} style={s.brand}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>HR</Text>
          </View>
          <Text style={s.brandText}>HR MAX</Text>
        </Pressable>
        <View style={s.topRight}>
          <Pressable onPress={onBellPress} hitSlop={8} style={s.bell}>
            <Ionicons name="notifications-outline" size={20} color="#fff" />
            {unread > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={s.headRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.greeting}>{greetFor(now)}</Text>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          {!!subtitle && <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        <View style={s.clockCol}>
          <Text style={s.date}>{date}</Text>
          <Text style={s.time}>{time}</Text>
        </View>
      </View>

      {stats.length > 0 && (
        <View style={s.tiles}>
          {stats.map((st) => {
            const Tile = onPressStat ? Pressable : View;
            return (
              <Tile
                key={st.label}
                {...(onPressStat ? { onPress: () => onPressStat(st), accessibilityRole: 'button' as const } : {})}
                style={[s.tile, onPressStat && s.tilePressable]}
              >
                <Text style={[s.tileValue, { color: st.color }]}>{st.value}</Text>
                <Text style={s.tileLabel} numberOfLines={1}>{st.label}</Text>
              </Tile>
            );
          })}
        </View>
      )}
    </LinearGradient>
  );
};

const s = StyleSheet.create({
  hero: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 13, fontWeight: '900', color: '#F2600C' },
  brandText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },
  topRight: { flexDirection: 'row', alignItems: 'center' },
  bell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F2600C',
  },
  badgeText: { fontSize: 9.5, fontWeight: '800', color: '#F2600C' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14, gap: 10 },
  greeting: { fontSize: 14, color: 'rgba(255,255,255,0.92)', fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '800', color: '#fff', marginTop: 1, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2, fontWeight: '500' },
  clockCol: { alignItems: 'flex-end', paddingTop: 2 },
  date: { fontSize: 13, fontWeight: '700', color: '#fff' },
  time: { fontSize: 12.5, color: 'rgba(255,255,255,0.92)', marginTop: 3 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  tilePressable: {},
  tileValue: { fontSize: 20, fontWeight: '800' },
  tileLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
