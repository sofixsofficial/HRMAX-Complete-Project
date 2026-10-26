import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import { safeStore } from '../../utils/safeStorage';

/** Set once the user has seen the intro — the auth stack then starts at Login. */
export const ONBOARDING_KEY = 'hrmax_onboarding_done';

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  points: string[];
};

const SLIDES: Slide[] = [
  {
    key: 'workday',
    icon: 'person-outline',
    title: 'Your Workday, Simplified',
    body: 'Everything about you at work, in one place.',
    points: [
      'Employee profile, company and department details',
      'Your team and reporting manager',
      'Role-based access — you only ever see what you are allowed to',
    ],
  },
  {
    key: 'attendance',
    icon: 'time-outline',
    title: 'Attendance Made Smarter',
    body: 'Check in and out with confidence.',
    points: [
      'Check-in / check-out confirmed by the server, never the device clock',
      'Attendance history, working hours and late tracking',
      'Office location check when your company requires it',
    ],
  },
  {
    key: 'everything',
    icon: 'apps-outline',
    title: 'Everything in One Place',
    body: 'Leave, approvals, notifications and reports.',
    points: [
      'Apply for leave and follow every approval step',
      'Announcements, tasks and notifications',
      'Reports and payslips on the go',
    ],
  },
];

export const OnboardingScreen: React.FC<{ navigation: { replace: (name: string) => void } }> = ({
  navigation,
}) => {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const s = styles(colors, width);

  const finish = async () => {
    await safeStore.setItem(ONBOARDING_KEY, '1');
    navigation.replace('Login');
  };

  useEffect(() => {
    // Back gesture / web pop should never strand the user on the intro.
    return () => {
      safeStore.setItem(ONBOARDING_KEY, '1').catch(() => {});
    };
  }, []);

  const next = () => {
    if (index >= SLIDES.length - 1) {
      void finish();
      return;
    }
    const target = index + 1;
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
    setIndex(target);
  };

  return (
    <View style={s.root}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        ref={scrollRef}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i !== index) setIndex(i);
        }}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.key} style={s.slide}>
            <LinearGradient
              colors={['#FFF1E5', '#FFFFFF']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={s.artWrap}
            >
              <View style={s.artCircle}>
                <Ionicons name={slide.icon} size={54} color="#FFFFFF" />
              </View>
              <View style={s.artBadge}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#FF6600" />
                <Text style={s.artBadgeText}>HR MAX by Sofixs</Text>
              </View>
            </LinearGradient>

            <Text style={s.title}>{slide.title}</Text>
            <Text style={s.body}>{slide.body}</Text>
            <View style={s.points}>
              {slide.points.map((p) => (
                <View key={p} style={s.pointRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#FF6600" />
                  <Text style={s.pointText}>{p}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={s.footer}>
        <View style={s.dots}>
          {SLIDES.map((slide, i) => (
            <View key={slide.key} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>

        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip introduction"
            onPress={finish}
            style={({ pressed }) => [s.skip, pressed && s.pressed]}
            hitSlop={8}
          >
            <Text style={s.skipText}>Skip</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={index === SLIDES.length - 1 ? 'Get started' : 'Next'}
            onPress={next}
            style={({ pressed }) => [s.primary, pressed && s.pressed]}
          >
            <Text style={s.primaryText}>{index === SLIDES.length - 1 ? 'Get Started' : 'Next'}</Text>
            <Ionicons
              name={index === SLIDES.length - 1 ? 'arrow-forward' : 'chevron-forward'}
              size={18}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = (c: ReturnType<typeof useTheme>['colors'], width: number) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    slide: { width, paddingHorizontal: 28, paddingTop: 12 },
    artWrap: {
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
      marginBottom: 28,
      overflow: 'hidden',
    },
    artCircle: {
      width: 118,
      height: 118,
      borderRadius: 59,
      backgroundColor: '#FF6600',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#FF6600',
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    artBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 22,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: '#FFE0C7',
    },
    artBadgeText: { fontSize: 12, fontWeight: '700', color: '#FF6600' },
    title: { fontSize: 25, fontWeight: '800', color: c.text, letterSpacing: -0.4, marginBottom: 8 },
    body: { fontSize: 15, color: c.textSecondary, lineHeight: 22, marginBottom: 20 },
    points: { gap: 12 },
    pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    pointText: { flex: 1, fontSize: 14, color: c.text, lineHeight: 20 },
    footer: { paddingHorizontal: 24, paddingTop: 8 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.border || '#E5E7EB',
    },
    dotActive: { backgroundColor: '#FF6600', width: 22 },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    skip: { paddingVertical: 14, paddingHorizontal: 14 },
    skipText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#FF6600',
      paddingVertical: 15,
      paddingHorizontal: 26,
      borderRadius: 14,
    },
    primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    pressed: { opacity: 0.75 },
  });
