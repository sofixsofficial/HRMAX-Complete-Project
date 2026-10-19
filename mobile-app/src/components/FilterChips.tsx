import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface FilterChipOption {
  label: string;
  value: string;
}

interface FilterChipsProps {
  options: FilterChipOption[];
  selected: string;
  onSelect: (value: string) => void;
  allLabel?: string;
  hideAll?: boolean;
  style?: StyleProp<ViewStyle>;
  maxLabelWidth?: number;
}

export const FilterChips: React.FC<FilterChipsProps> = ({
  options,
  selected,
  onSelect,
  allLabel = 'All',
  hideAll = false,
  style,
  maxLabelWidth = 160,
}) => {
  const { colors, isDark } = useTheme();

  const chips: FilterChipOption[] = hideAll
    ? options
    : [{ label: allLabel, value: '' }, ...options];

  const handleSelect = (value: string) => {
    onSelect(value === selected ? '' : value);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.container, style]}
      contentContainerStyle={styles.content}
    >
      {chips.map((chip) => {
        const active = selected === chip.value;
        return (
          <TouchableOpacity
            key={chip.value || chip.label}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.accent : isDark ? '#1F2937' : '#F3F4F6',
                borderColor: active ? colors.accent : 'transparent',
              },
            ]}
            activeOpacity={0.7}
            onPress={() => handleSelect(chip.value)}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.chipText,
                {
                  color: active ? '#FFFFFF' : isDark ? '#E5E7EB' : '#1F2937',
                  fontWeight: active ? '700' : '600',
                },
                maxLabelWidth ? { maxWidth: maxLabelWidth } : null,
              ]}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
    height: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
  },
});
