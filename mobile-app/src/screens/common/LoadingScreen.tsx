import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Path } from 'react-native-svg';
import { useAuth } from '../../context/AuthContext';

/**
 * Branded start-up screen shown while the session is restored — the orange
 * HR MAX splash from the approved design source (App.js): glowing logo,
 * wordmark, tagline, spinner, city skyline and "Powered By Sofixs".
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

const { width: W } = Dimensions.get('window');

function Spinner() {
  const spin = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={44} height={44} viewBox="0 0 44 44">
        <Path d="M22 4 A18 18 0 1 0 40 22" stroke="#fff" strokeOpacity={0.85} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

function City() {
  const b = (x: number, w: number, h: number, o: number) => (
    <Rect key={x} x={x} y={150 - h} width={w} height={h} fill="#C2410C" opacity={o} />
  );
  return (
    <Svg width={W} height={170} viewBox="0 0 400 170" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      {[b(5, 28, 60, 0.35), b(38, 30, 95, 0.45), b(75, 42, 120, 0.5), b(122, 26, 80, 0.4),
        b(155, 30, 70, 0.35), b(215, 28, 85, 0.4), b(250, 34, 110, 0.45), b(295, 30, 75, 0.4),
        b(332, 28, 100, 0.45), b(365, 32, 65, 0.35)]}
      <Path d="M0 135 Q100 105 200 130 T400 120 L400 170 L0 170 Z" fill="#EA580C" opacity={0.75} />
      <Path d="M0 150 Q120 125 230 148 T400 140 L400 170 L0 170 Z" fill="#F97316" opacity={0.6} />
    </Svg>
  );
}

export const LoadingScreen: React.FC = () => {
  const { isLoading, refreshUser } = useAuth();
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

  return (
    <LinearGradient colors={['#FF7A1A', '#FF6A0D', '#F25A05']} style={s.splash}>
      <View style={s.splashCenter}>
        <View style={s.logoGlow}>
          <View style={s.logoBox}>
            <Text style={s.logoHR}>HR</Text>
          </View>
        </View>
        <Text style={s.brand}>HRMAX</Text>
        <Text style={s.tagline}>Smart HR. Stronger Team.</Text>
      </View>

      {!slow ? (
        <View style={s.loader} accessibilityRole="progressbar" accessibilityLabel="Starting the app">
          <Spinner />
          <Text style={s.loadingTxt}>Loading...</Text>
        </View>
      ) : (
        <View style={s.slowBox}>
          <Ionicons name="cloud-offline-outline" size={26} color="#fff" />
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

      <View style={s.cityWrap} pointerEvents="none">
        <City />
      </View>
      <Text style={s.poweredSplash}>Powered By Sofixs</Text>
    </LinearGradient>
  );
};

const s = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center' },
  splashCenter: { marginTop: '42%', alignItems: 'center' },
  logoGlow: {
    borderRadius: 40,
    shadowColor: '#FFE2C2',
    shadowOpacity: 0.9,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
    backgroundColor: 'transparent',
  },
  logoBox: {
    width: 118,
    height: 118,
    borderRadius: 32,
    backgroundColor: '#FF6A0D',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  logoHR: { color: '#fff', fontSize: 62, fontWeight: '900', letterSpacing: -2 },
  brand: { color: '#fff', fontSize: 64, fontWeight: '800', marginTop: 18, letterSpacing: -1 },
  tagline: { color: '#fff', fontSize: 16.5, marginTop: 2, fontWeight: '400' },
  loader: { position: 'absolute', bottom: '27%', alignItems: 'center' },
  loadingTxt: { color: '#fff', fontSize: 15, marginTop: 6 },
  slowBox: { position: 'absolute', bottom: '22%', alignItems: 'center', maxWidth: 320, gap: 6 },
  slowTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginTop: 4 },
  slowBody: { fontSize: 13.5, color: 'rgba(255,255,255,0.92)', textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: 12,
    backgroundColor: '#fff',
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 12,
    minWidth: 150,
    alignItems: 'center',
  },
  retryText: { color: '#E85D00', fontSize: 15, fontWeight: '700' },
  cityWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 170 },
  poweredSplash: {
    position: 'absolute',
    bottom: 18,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
});
