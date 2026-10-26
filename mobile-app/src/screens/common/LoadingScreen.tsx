import React, { useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { BrandMark } from '../../components/BrandMark';

/**
 * Branded start-up screen shown while the session is restored.
 *
 * It must never become a permanent spinner: after 8 s it switches to an honest
 * "couldn't finish starting up" state with a Retry (re-fetches the session)
 * rather than pretending progress is still being made.
 */
export const LoadingScreen: React.FC = () => {
  const { colors } = useTheme();
  const { isLoading, refreshUser } = useAuth();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshUser();
    } catch {
      /* refreshUser reports its own errors — stay on this screen */
    } finally {
      setRetrying(false);
    }
  };

  const version = Constants.expoConfig?.version ?? '';

  return (
    <View style={s.container}>
      <View style={s.accent} />
      <BrandMark iconSize={72} wordmarkColor="#FF6600" />
      <Text style={s.tagline}>Smarter People. Better Work.</Text>

      {!slow ? (
        <>
          <ActivityIndicator size="large" color="#FF6600" style={s.spinner} />
          <Text style={s.loadingText}>Restoring your session…</Text>
        </>
      ) : (
        <View style={s.slowBox}>
          <Ionicons name="cloud-offline-outline" size={26} color={colors.textSecondary} />
          <Text style={s.slowTitle}>Still connecting</Text>
          <Text style={s.slowBody}>
            We could not finish starting up. Check your connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry starting the app"
            disabled={retrying}
            onPress={retry}
            style={({ pressed }) => [s.retry, pressed && { opacity: 0.8 }, retrying && { opacity: 0.6 }]}
          >
            {retrying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={s.retryText}>Try again</Text>
            )}
          </Pressable>
        </View>
      )}

      <View style={s.footer}>
        <Text style={s.footerText}>HR MAX{version ? ` · v${version}` : ''}</Text>
        <Text style={s.footerText}>Powered by Sofixs</Text>
      </View>
      {Platform.OS === 'web' ? null : null}
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: '#FF6600',
  },
  tagline: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '600',
    color: c.textSecondary,
    letterSpacing: 0.2,
  },
  spinner: {
    marginTop: 34,
    marginBottom: 12,
  },
  loadingText: {
    color: c.textSecondary,
    fontSize: 14,
  },
  slowBox: {
    marginTop: 30,
    alignItems: 'center',
    gap: 8,
    maxWidth: 320,
  },
  slowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginTop: 4,
  },
  slowBody: {
    fontSize: 13.5,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retry: {
    marginTop: 14,
    backgroundColor: '#FF6600',
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 12,
    minWidth: 150,
    alignItems: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 34,
    alignItems: 'center',
    gap: 3,
  },
  footerText: {
    fontSize: 12,
    color: c.textSecondary,
  },
});
