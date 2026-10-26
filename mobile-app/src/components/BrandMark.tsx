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
  /**
   * Stacked sign-in lockup: an orange box with white "HR" on top and the
   * "HR MAX" wordmark underneath, instead of the image logo.
   */
  stacked?: boolean;
}

/**
 * Reusable HR MAX brand lockup: orange rounded logo square (with the "HR"
 * monogram) plus an optional "HR MAX" wordmark to its right. `textOnly`
 * renders just the wordmark; `stacked` draws the monogram as an orange box
 * with white "HR" above the wordmark.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  iconSize = 40,
  showWordmark = true,
  wordmarkColor,
  light = false,
  textOnly = false,
  stacked = false,
}) => {
  const { colors } = useTheme();
  const color = wordmarkColor || (light ? '#ffffff' : colors.text);

  if (stacked) {
    return (
      <View style={styles.stack}>
        <View
          style={[
            styles.stackBox,
            { width: iconSize, height: iconSize, borderRadius: iconSize * 0.22 },
          ]}
        >
          <Text style={[styles.stackBoxText, { fontSize: iconSize * 0.4 }]}>HR</Text>
        </View>
        {showWordmark && (
          <Text style={[styles.wordmark, { color, fontSize: iconSize * 0.42, marginTop: 10, marginLeft: 0 }]}>
            HR MAX
          </Text>
        )}
      </View>
    );
  }

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
  stack: {
    alignItems: 'center',
  },
  stackBox: {
    backgroundColor: '#FF6600',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6600',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 4,
  },
  stackBoxText: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
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