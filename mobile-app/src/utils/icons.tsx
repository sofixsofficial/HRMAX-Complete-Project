import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  onPress?: () => void;
  style?: any;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, color, onPress, style }) => {
  const { colors } = useTheme();
  const icon = <Ionicons name={name as any} size={size} color={color || colors.textSecondary} />;
  if (onPress) {
    return <TouchableOpacity onPress={onPress} style={[{ padding: 4 }, style]}>{icon}</TouchableOpacity>;
  }
  return icon;
};
