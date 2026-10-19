import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../utils/icons';

interface StatCardProps {
  label: string;
  value: number | string;
  color: string;
  icon?: string;
  onClick?: () => void;
  trend?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, color, icon, onClick, trend }) => {
  const { colors } = useTheme();
  const Wrapper = onClick ? TouchableOpacity : View;
  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onClick}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.borderLight,
        borderRadius: 14,
        padding: 14,
        minHeight: 84,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {icon && (
            <View style={{
              width: 42, height: 42,
              backgroundColor: `${color}15`,
              borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon name={icon} size={20} color={color} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{ fontSize: 24, fontWeight: '700', color: colors.text }}
            >
              {value}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}
            >
              {label}
            </Text>
          </View>
        </View>
        <View style={{ flexShrink: 0 }}>
          <Icon name="arrow-up-outline" size={16} color={colors.textTertiary} />
        </View>
      </View>
    </Wrapper>
  );
};
