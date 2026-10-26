import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Text, Pressable, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
/**
 * Minimum time the branded splash stays visible. The session can restore
 * faster than the first frame paints (especially on web), which left the
 * splash never actually shown - this floor guarantees it is seen.
 */
export const SPLASH_MIN_MS = 1000;
const appStartAt = Date.now();

export const useSplashReady = (): boolean => {
  const [ready, setReady] = useState(() => Date.now() - appStartAt >= SPLASH_MIN_MS);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), Math.max(50, appStartAt + SPLASH_MIN_MS - Date.now()));
    return () => clearTimeout(t);
  }, [ready]);
  return ready;
};

export const LoadingScreen: React.FC = () => {
  const { colors } = useTheme();
  const { isLoading, refreshUser } = useAuth();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Splash-style entrance: the lockup eases in, then a bar sweeps across
  // while the session restores (loops, so it reads as "working", not stuck).
  const enter = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(220),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enter, sweep]);

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
  const barWidth = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, 168] });

  return (
    <LinearGradient
      colors={['#111827', '#1F2937']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={s.container}
    >
      <View style={s.accent} />

      <Animated.View
        style={{
          alignItems: 'center',
          opacity: enter,
          transform: [{
            translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
          }],
        }}
      >
        <BrandMark iconSize={72} wordmarkColor="#FFFFFF" />
        <Text style={s.tagline}>Smarter People. Better Work.</Text>
      </Animated.View>

      {!slow ? (
        <View style={s.progressWrap} accessibilityRole="progressbar" accessibilityLabel="Starting the app">
          <View style={s.progressTrack}>
            <Animated.View style={[s.progressFill, { width: barWidth }]} />
          </View>
          <Text style={s.loadingText}>Restoring your session…</Text>
        </View>
      ) : (
        <View style={s.slowBox}>
          <Ionicons name="cloud-offline-outline" size={26} color="#9CA3AF" />
          <Text style={s.slowTitle}>Still connecting</Text>
          <Text style={s.slowBody}>
            We could not finish starting up. Check your connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry starting the app"
            disabled={retrying}
            onPress={retry}
            style={({ pressed }) => [s.retry, pressed && { opacity: 0.85 }, retrying && { opacity: 0.6 }]}
          >
            <Text style={s.retryText}>{retrying ? 'Retrying…' : 'Try again'}</Text>
          </Pressable>
        </View>
      )}

      <View style={s.footer}>
        <Text style={s.footerText}>HR MAX{version ? ` · v${version}` : ''}</Text>
        <Text style={s.footerText}>Powered by Sofixs</Text>
      </View>
      {Platform.OS === 'web' ? null : null}
    </LinearGradient>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
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
    color: '#D1D5DB',
    letterSpacing: 0.2,
  },
  progressWrap: {
    marginTop: 38,
    alignItems: 'center',
    gap: 12,
  },
  progressTrack: {
    width: 168,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FF6600',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 13.5,
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
    color: '#F9FAFB',
    marginTop: 4,
  },
  slowBody: {
    fontSize: 13.5,
    color: '#9CA3AF',
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
    color: '#6B7280',
  },
});
