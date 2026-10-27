import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

/**
 * Home hero — greeting + name + designation on the left, the device's live
 * date/time on the right, and a row of stat tiles underneath.
 *
 * There is deliberately no brand row or bell here: the header already owns the
 * company identity and the notification bell, so the hero stays a pure
 * overview of the day. Every number is passed in by the caller from real
 * backend data; this component never invents a figure. The greeting follows the
 * device's local clock (labelled as such by the clock itself), nothing else is
 * inferred.
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
}> = ({ name, subtitle, stats = [], onPressStat }) => {
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
      colors={['#0b1120', '#152e56']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.hero}
    >
      <View style={s.headRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.greeting}>{greetFor(now)}</Text>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          {!!subtitle && (
            <View style={s.roleChip}>
              <Text style={s.roleChipText} numberOfLines={1}>{subtitle}</Text>
            </View>
          )}
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
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  greeting: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  name: { fontSize: 23, fontWeight: '800', color: '#fff', marginTop: 4, letterSpacing: -0.3 },
  roleChip: {
    alignSelf: 'flex-start',
    marginTop: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    maxWidth: '100%',
  },
  roleChipText: { fontSize: 11.5, color: 'rgba(255,255,255,0.92)', fontWeight: '600' },
  clockCol: { alignItems: 'flex-end', paddingTop: 2 },
  date: { fontSize: 13, fontWeight: '700', color: '#fff' },
  time: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 3 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  tilePressable: {},
  tileValue: { fontSize: 18, fontWeight: '800' },
  tileLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
