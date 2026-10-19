import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../utils/icons';

export interface DetailColumn {
  key: string;
  label: string;
}

interface Props {
  visible: boolean;
  title: string;
  columns: DetailColumn[];
  rows: Record<string, any>[];
  onClose: () => void;
  searchPlaceholder?: string;
}

export function CardDetailModal({ visible, title, columns, rows, onClose, searchPlaceholder }: Props) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(q))
    );
  }, [rows, columns, search]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <TextInput
            placeholder={searchPlaceholder || 'Search...'}
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {filtered.length} of {rows.length} records
          </Text>

          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textTertiary }]}>
                {rows.length === 0 ? 'No records found.' : 'No matches for your search.'}
              </Text>
            ) : (
              filtered.map((row, idx) => (
                <View key={String(row.id ?? idx)} style={[styles.rowCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.primary, { color: colors.text }]} numberOfLines={2}>
                    {String(row[columns[0]?.key] ?? '—')}
                  </Text>
                  {columns.slice(1).map((col) => (
                    <View key={col.key} style={styles.line}>
                      <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>{col.label}</Text>
                      <Text style={[styles.lineValue, { color: colors.text }]} numberOfLines={2}>
                        {String(row[col.key] ?? '—')}
                      </Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  search: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  count: {
    fontSize: 12,
    marginBottom: 8,
  },
  list: {
    flexGrow: 0,
  },
  rowCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  primary: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  lineLabel: {
    fontSize: 12,
    marginRight: 8,
  },
  lineValue: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
