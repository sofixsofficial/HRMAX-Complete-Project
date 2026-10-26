import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

const FALLBACK_COLORS = ['#FF6600', '#3b82f6', '#22c55e', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6'];

const colorFor = (i: number, explicit?: string) => explicit || FALLBACK_COLORS[i % FALLBACK_COLORS.length];

/**
 * Vertical bar chart drawn with plain Views.
 *
 * Deliberately dependency-free (no chart library) so it renders identically on
 * iOS, Android and web and never adds bundle weight for one graphic.
 */
export const BarChart: React.FC<{
  title: string;
  data: ChartDatum[];
  emptyText?: string;
}> = ({ title, data, emptyText = 'No data yet' }) => {
  const { colors } = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderLight }]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {total === 0 ? (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>{emptyText}</Text>
      ) : (
        <View
          style={styles.bars}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
        >
          {data.map((d, i) => {
            const pct = d.value === 0 ? 0 : Math.max(4, (d.value / max) * 100);
            return (
              <View key={d.label} style={styles.barCol}>
                <Text style={[styles.barValue, { color: colors.textSecondary }]} numberOfLines={1}>
                  {d.value}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[styles.barFill, { height: `${pct}%`, backgroundColor: colorFor(i, d.color) }]}
                  />
                </View>
                <Text style={[styles.barLabel, { color: colors.textTertiary }]} numberOfLines={1}>
                  {d.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

/**
 * Horizontal segmented bar (share of a whole) plus a legend - used where the
 * categories are a split of one total, such as attendance status.
 */
export const SplitBar: React.FC<{
  title: string;
  data: ChartDatum[];
  emptyText?: string;
}> = ({ title, data, emptyText = 'No data yet' }) => {
  const { colors } = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderLight }]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {total === 0 ? (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>{emptyText}</Text>
      ) : (
        <>
          <View
            style={styles.segmentRow}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
          >
            {data.map((d, i) =>
              d.value === 0 ? null : (
                <View
                  key={d.label}
                  style={{
                    width: `${(d.value / total) * 100}%`,
                    backgroundColor: colorFor(i, d.color),
                    height: 14,
                  }}
                />
              )
            )}
          </View>
          <View style={styles.legend}>
            {data.map((d, i) => (
              <View key={d.label} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: colorFor(i, d.color) }]} />
                <Text style={[styles.legendText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {d.label} {d.value}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  empty: {
    fontSize: 12.5,
    paddingVertical: 10,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 150,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    maxWidth: 64,
  },
  barValue: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  barTrack: {
    width: '62%',
    flex: 1,
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    borderRadius: 5,
    minHeight: 3,
  },
  barLabel: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  segmentRow: {
    flexDirection: 'row',
    width: '100%',
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11.5,
  },
});
