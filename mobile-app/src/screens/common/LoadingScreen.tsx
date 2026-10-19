import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { BrandMark } from '../../components/BrandMark';

export const LoadingScreen: React.FC = () => {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.container}>
      <BrandMark iconSize={72} wordmarkColor="#FF6600" />
      <ActivityIndicator size="large" color="#FF6600" style={s.spinner} />
      <Text style={s.loadingText}>Loading...</Text>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: {
    marginBottom: 12,
  },
  loadingText: {
    color: c.textSecondary,
    fontSize: 14,
  },
});
