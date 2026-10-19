import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

export interface PermissionMatrixColumn {
  key: string;
  label: string;
  desc?: string;
}

interface PermissionMatrixProps {
  columns: PermissionMatrixColumn[];
  modules: { module: string; actions: string[] }[];
  permissions: string[];
  onToggle: (key: string) => void;
  onToggleModule: (module: string, actions: string[]) => void;
  getActionKey?: (module: string, columnKey: string) => string | null;
  accentColor?: string;
}

const MODULE_COL_WIDTH = 150;
const ACTION_COL_WIDTH = 92;
const CELL_PAD_V = 12;
const CELL_PAD_H = 8;

export const PermissionMatrix: React.FC<PermissionMatrixProps> = ({
  columns,
  modules,
  permissions,
  onToggle,
  onToggleModule,
  getActionKey,
  accentColor = '#FF6600',
}) => {
  const resolveKey = (module: string, columnKey: string): string | null => {
    if (getActionKey) return getActionKey(module, columnKey);
    const group = modules.find(x => x.module === module);
    if (!group) return null;
    return group.actions.includes(columnKey) ? columnKey : null;
  };

  const matrixWidth = MODULE_COL_WIDTH + columns.length * ACTION_COL_WIDTH;

  return (
    <View style={[styles.card, { borderColor: '#e5e7eb' }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: matrixWidth }}>
          <View style={styles.headerRow}>
            <View style={[styles.moduleCell, styles.headerCell]}>
              <Text style={styles.headerModuleText}>Module</Text>
            </View>
            {columns.map(col => (
              <View key={col.key} style={[styles.actionCell, styles.headerCell]}>
                <Text style={styles.headerLabel} numberOfLines={1}>{col.label}</Text>
                {col.desc ? (
                  <Text style={styles.headerDesc} numberOfLines={2}>{col.desc}</Text>
                ) : null}
              </View>
            ))}
          </View>

          {modules.map((group, rowIndex) => {
            const modulePerms = group.actions.map(a => `${group.module.toLowerCase().replace(/\s+/g, '_')}.${a}`);
            const checkedCount = modulePerms.filter(p => permissions.includes(p)).length;
            const allChecked = checkedCount === modulePerms.length;

            return (
              <View
                key={group.module}
                style={[
                  styles.moduleRow,
                  rowIndex % 2 === 1 && !allChecked && styles.rowZebra,
                  allChecked && styles.rowAllChecked,
                ]}
              >
                <TouchableOpacity
                  style={styles.moduleCell}
                  onPress={() => onToggleModule(group.module, group.actions)}
                  activeOpacity={0.6}
                >
                  <View style={styles.moduleNameRow}>
                    <View style={[styles.moduleDot, { backgroundColor: allChecked ? '#10b981' : '#d1d5db' }]} />
                    <Text style={styles.moduleName} numberOfLines={1}>{group.module}</Text>
                  </View>
                  <View style={[styles.countChip, allChecked ? styles.countChipFull : checkedCount > 0 ? styles.countChipPartial : styles.countChipNone]}>
                    <Text style={[styles.countText, allChecked ? styles.countTextFull : checkedCount > 0 ? styles.countTextPartial : styles.countTextNone]}>
                      {checkedCount}/{modulePerms.length}
                    </Text>
                  </View>
                </TouchableOpacity>

                {columns.map(col => {
                  const key = resolveKey(group.module, col.key);
                  if (!key) {
                    return (
                      <View key={col.key} style={styles.actionCell}>
                        <Text style={styles.naText}>—</Text>
                      </View>
                    );
                  }
                  const has = permissions.includes(key);
                  return (
                    <View key={col.key} style={styles.actionCell}>
                      <TouchableOpacity
                        onPress={() => onToggle(key)}
                        activeOpacity={0.7}
                        style={[
                          styles.checkBox,
                          { borderColor: has ? accentColor : '#d1d5db' },
                          has && { backgroundColor: accentColor },
                        ]}
                      >
                        {has && <Text style={styles.checkMark}>✓</Text>}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
  },
  headerCell: {
    justifyContent: 'center',
  },
  headerModuleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4b5563',
    textAlign: 'center',
  },
  headerDesc: {
    fontSize: 9,
    color: '#9ca3af',
    lineHeight: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  moduleCell: {
    width: MODULE_COL_WIDTH,
    paddingVertical: CELL_PAD_V,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  actionCell: {
    width: ACTION_COL_WIDTH,
    paddingVertical: CELL_PAD_V,
    paddingHorizontal: CELL_PAD_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#f3f4f6',
  },
  moduleRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    minHeight: 52,
  },
  rowZebra: {
    backgroundColor: '#fafbfc',
  },
  rowAllChecked: {
    backgroundColor: '#f0fdf4',
  },
  moduleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moduleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  moduleName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  countChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 10,
  },
  countChipNone: {
    backgroundColor: '#f3f4f6',
  },
  countChipPartial: {
    backgroundColor: '#fef3c7',
  },
  countChipFull: {
    backgroundColor: '#dcfce7',
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  countTextNone: {
    color: '#9ca3af',
  },
  countTextPartial: {
    color: '#b45309',
  },
  countTextFull: {
    color: '#15803d',
  },
  naText: {
    fontSize: 12,
    lineHeight: 30,
    color: '#d1d5db',
  },
  checkBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 16,
  },
});