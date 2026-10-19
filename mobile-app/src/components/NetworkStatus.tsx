import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { Icon } from '../utils/icons';
import NetInfo from '@react-native-community/netinfo';

export const NetworkStatus: React.FC = () => {
  const { colors } = useTheme();
  const [isOffline, setIsOffline] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected && !state.isInternetReachable);
    });
    return () => unsub();
  }, []);

  if (!isOffline) return null;

  return (
    <View style={s.banner}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="wifi-outline" size={12} color="#fff" />
        <Text style={s.text}> No internet connection — some features may be unavailable</Text>
      </View>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  banner: { backgroundColor: c.danger, paddingVertical: 8, paddingHorizontal: 16 },
  text: { color: '#fff', fontSize: 12, textAlign: 'center', fontWeight: '600' },
});
