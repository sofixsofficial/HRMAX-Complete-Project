import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../context/ThemeContext';

/**
 * Month grid for one person's attendance (the mobile app previously only had
 * numeric month totals — no calendar).
 *
 * Every cell is driven by a real attendance record for that day; days with no
 * record are drawn as "no data", never as Present/Absent guesses.
 */

type Rec = { date?: unknown; status?: unknown };

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  Present: { bg: '#10b9811f', fg: '#059669', label: 'Present' },
  Approved: { bg: '#10b9811f', fg: '#059669', label: 'Present' },
  Late: { bg: '#f59e0b22', fg: '#d97706', label: 'Late' },
  Absent: { bg: '#ef444420', fg: '#dc2626', label: 'Absent' },
  'Miss Punch': { bg: '#9333ea20', fg: '#7e22ce', label: 'Miss punch' },
  'On Leave': { bg: '#3b82f620', fg: '#2563eb', label: 'On leave' },
  'Early Checkout': { bg: '#06b6d420', fg: '#0891b2', label: 'Early out' },
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Records store `date` either as an ISO string (backend) or a Date (web). */
const dayKey = (value: unknown): string | null => {
  if (!value) return null;
  const d =
    value instanceof Date
      ? value
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00`)
        : new Date(value as string);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const MonthAttendanceCalendar: React.FC<{ records: Rec[] }> = ({ records }) => {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { cells, monthLabel, counts, hasData } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayKey = dayKey(now);

    const byDay = new Map<string, string>();
    for (const r of records) {
      const k = dayKey(r.date);
      if (k) byDay.set(k, String(r.status ?? ''));
    }

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = first.getDay(); // 0 = Sunday
    const cellsOut: Array<{ day: number | null; key?: string; status?: string; future?: boolean; today?: boolean }> = [];
    for (let i = 0; i < lead; i++) cellsOut.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cellsOut.push({
        day: d,
        key,
        status: byDay.get(key) || undefined,
        future: key > String(todayKey),
        today: key === todayKey,
      });
    }
    while (cellsOut.length % 7 !== 0) cellsOut.push({ day: null });

    const tally: Record<string, number> = {};
    for (const c of cellsOut) if (c.status) tally[c.status] = (tally[c.status] || 0) + 1;

    return {
      cells: cellsOut,
      monthLabel: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      counts: tally,
      hasData: byDay.size > 0,
    };
  }, [records]);

  const legend = ['Present', 'Late', 'Absent', 'On Leave'];

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.headerIcon}>
          <Ionicons name="calendar-outline" size={15} color="#FF6600" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{monthLabel}</Text>
          <Text style={s.subtitle}>
            {hasData ? 'Your attendance by day' : 'No attendance records this month'}
          </Text>
        </View>
      </View>

      <View style={s.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={`${w}-${i}`} style={s.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <View style={s.grid}>
        {cells.map((c, i) => {
          if (c.day === null) return <View key={`pad-${i}`} style={s.cell} />;
          const style = c.status ? STATUS_STYLE[c.status] : undefined;
          const base = s.cellInner;
          const cellStyle = [
            base,
            style && { backgroundColor: style.bg },
            c.today && s.today,
            !style && c.future && s.future,
          ];
          return (
            <View key={c.key} style={s.cell}>
              <View style={cellStyle}>
                <Text style={[s.dayText, style && { color: style.fg, fontWeight: '700' }, c.future && !style && s.futureText]}>
                  {c.day}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={s.legend}>
        {legend.map((key) => {
          const st = STATUS_STYLE[key];
          const n = key === 'Present' ? (counts.Present || 0) + (counts.Approved || 0) : counts[key] || 0;
          return (
            <View key={key} style={s.legendItem}>
              <View style={[s.dot, { backgroundColor: st.fg }]} />
              <Text style={s.legendText}>
                {st.label} · {n}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: c.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: c.textMuted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 2.5 },
  cellInner: {
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderLight,
  },
  today: { borderWidth: 2, borderColor: '#FF6600' },
  future: { backgroundColor: 'transparent', borderColor: c.borderLight },
  futureText: { color: c.textMuted, opacity: 0.55 },
  dayText: { fontSize: 12.5, color: c.text, fontWeight: '600' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5, color: c.textSecondary, fontWeight: '600' },
});
