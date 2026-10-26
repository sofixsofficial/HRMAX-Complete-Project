import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

/**
 * Auto-playing artwork inside the onboarding circles - a GIF-like loop so the
 * intro feels like a short video instead of a static icon:
 *  - workday:   the HR MAX wordmark in white with a breathing glow
 *  - attendance: a clock whose hands sweep round (server-checked time)
 *  - everything: app tiles that light up one after another
 *
 * Pure Animated (no external asset, no network) so it also works offline and
 * never mislabels a static picture as a video.
 */

const ease = Easing.inOut(Easing.ease);

const useLoop = (deps: unknown[]) => {
  const anims = useRef<Animated.CompositeAnimation[]>([]).current;
  const register = (a: Animated.CompositeAnimation) => { anims.push(a); return a; };
  const stopAll = () => { anims.forEach((a) => a.stop()); anims.length = 0; };
  useEffect(() => {
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { register, start: () => anims.forEach((a) => a.start()), stopAll };
};

export const OnboardingArt: React.FC<{ slideKey: string }> = ({ slideKey }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const t0 = useRef(new Animated.Value(0)).current;
  const t1 = useRef(new Animated.Value(0)).current;
  const t2 = useRef(new Animated.Value(0)).current;
  const t3 = useRef(new Animated.Value(0)).current;

  const { register, start } = useLoop([slideKey]);

  useEffect(() => {
    // Breathing glow shared by every slide.
    register(Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2200, easing: ease, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 2200, easing: ease, useNativeDriver: true }),
    ])));

    if (slideKey === 'attendance') {
      // Second hand sweeping a full turn, hour hand creeping - a ticking clock.
      register(Animated.loop(Animated.timing(sweep, {
        toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true,
      })));
    }

    if (slideKey === 'everything') {
      // Tiles light up in turn, like an app montage.
      const tiles = [t0, t1, t2, t3];
      const seq = Animated.sequence(tiles.flatMap((tile, i) => [
        Animated.delay(i === 0 ? 0 : 260),
        Animated.timing(tile, { toValue: 1, duration: 320, easing: ease, useNativeDriver: true }),
        Animated.timing(tile, { toValue: 0, duration: 320, easing: ease, useNativeDriver: true }),
      ]));
      register(Animated.loop(Animated.sequence([seq, Animated.delay(500)])));
    }

    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey]);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] });
  const minuteRotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const hourRotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '30deg'] });
  const tileScale = (v: Animated.Value) => v.interpolate({
    inputRange: [0, 1], outputRange: [0.86, 1.12],
  });

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        slideKey === 'attendance' ? 'Animated clock illustration'
          : slideKey === 'everything' ? 'Animated app tiles illustration'
            : 'HR MAX animated logo'
      }
    >
      {/* Breathing glow behind the content */}
      <Animated.View
        pointerEvents="none"
        style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
      />

      {slideKey === 'workday' && (
        <>
          <Text style={styles.wordmark} numberOfLines={1}>HR MAX</Text>
          <Text style={styles.wordmarkSub}>by Sofixs</Text>
        </>
      )}

      {slideKey === 'attendance' && (
        <View style={styles.clock}>
          <Animated.View style={[styles.hand, styles.handMinute, { transform: [{ rotate: minuteRotate }] }]} />
          <Animated.View style={[styles.hand, styles.handHour, { transform: [{ rotate: hourRotate }] }]} />
          <View style={styles.clockPin} />
        </View>
      )}

      {slideKey === 'everything' && (
        <View style={styles.grid}>
          {[t0, t1, t2, t3].map((v, i) => (
            <Animated.View
              key={i}
              style={[styles.tile, { transform: [{ scale: tileScale(v) }], opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }]}
            >
              <View style={styles.tileBar} />
              <View style={[styles.tileBar, { width: i % 2 === 0 ? 14 : 20 }]} />
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', width: 118, height: 118 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 59, backgroundColor: '#ffffff' },
  wordmark: { color: '#ffffff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  wordmarkSub: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '600', marginTop: 2 },
  clock: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  hand: { position: 'absolute', bottom: 37, width: 3, borderRadius: 2, backgroundColor: '#ffffff' },
  handMinute: { height: 28 },
  handHour: { height: 20, width: 4 },
  clockPin: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffffff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 76, justifyContent: 'space-between' },
  tile: { width: 36, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileBar: { width: 18, height: 4, borderRadius: 2, backgroundColor: '#FF6600', marginTop: 3 },
});
