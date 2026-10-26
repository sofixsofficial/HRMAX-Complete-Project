import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface BrandMarkProps {
  iconSize?: number;
  showWordmark?: boolean;
  wordmarkColor?: string;
  light?: boolean;
  /** Render only the "HR MAX" text (no logo image) - used on sign-in. */
  textOnly?: boolean;
}

/**
 * Reusable HR MAX brand lockup: orange rounded logo square (with the "HR"
 * monogram) plus an optional "HR MAX" wordmark to its right. `textOnly`
 * renders just the wordmark for screens that show the name as plain text.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  iconSize = 40,
  showWordmark = true,
  wordmarkColor,
  light = false,
  textOnly = false,
}) => {
  const { colors } = useTheme();
  const color = wordmarkColor || (light ? '#ffffff' : colors.text);

  if (textOnly) {
    return (
      <View style={styles.row}>
        <Text style={[styles.wordmark, { color, fontSize: iconSize * 0.42, fontWeight: '800' }]}>
          HR MAX
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Image
        source={require('../../assets/icon.png')}
        style={[styles.icon, { width: iconSize, height: iconSize, borderRadius: iconSize * 0.24 }]}
        resizeMode="cover"
      />
      {showWordmark && (
        <Text style={[styles.wordmark, { color, fontSize: iconSize * 0.5 }]}>HR MAX</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    backgroundColor: '#FF6600',
  },
  wordmark: {
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 10,
  },
});