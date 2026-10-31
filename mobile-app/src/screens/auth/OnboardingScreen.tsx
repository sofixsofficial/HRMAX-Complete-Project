import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { safeStore } from '../../utils/safeStorage';
import { IllustrationOne, IllustrationTwo } from '../../components/OnboardingArt';

/** Set once the user has seen the intro — the auth stack then starts at Login. */
export const ONBOARDING_KEY = 'hrmax_onboarding_done';

const { width: W } = Dimensions.get('window');
const ORANGE = '#F97316';
const TOTAL_DOTS = 3;

type Slide = {
  id: string;
  t1: string;
  t2: string;
  accentLine: number | 'hr';
  sub: string;
  Art: React.FC;
};

const SLIDES: Slide[] = [
  {
    id: '1',
    t1: 'Manage Your',
    t2: 'Workforce Easily',
    accentLine: 2,
    sub: 'Handle attendance, leave,\nand more with HRMAX.',
    Art: IllustrationOne,
  },
  {
    id: '2',
    t1: 'Boost Productivity',
    t2: 'with HRMAX',
    accentLine: 'hr',
    sub: 'A complete HR solution for\nyour business growth.',
    Art: IllustrationTwo,
  },
];

function Title({ item }: { item: Slide }) {
  if (item.accentLine === 2) {
    return (
      <>
        <Text style={s.title}>{item.t1}</Text>
        <Text style={[s.title, s.accent]}>{item.t2}</Text>
      </>
    );
  }
  return (
    <>
      <Text style={s.title}>{item.t1}</Text>
      <Text style={s.title}>
        with <Text style={s.accent}>HRMAX</Text>
      </Text>
    </>
  );
}

export const OnboardingScreen: React.FC<{ navigation: { replace: (name: string) => void } }> = ({
  navigation,
}) => {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const last = index === SLIDES.length - 1;

  const finish = async () => {
    try {
      await safeStore.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* storage failure must never trap the user on the intro */
    }
    navigation.replace('Login');
  };

  const next = () => {
    if (last) {
      void finish();
      return;
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={s.onb}>
        <View style={s.blob} />
        <View style={s.blob2} />
        <TouchableOpacity style={s.skip} onPress={finish} activeOpacity={0.7}>
          <Text style={s.skipTxt}>Skip</Text>
        </TouchableOpacity>

        <FlatList
          ref={listRef}
          data={SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(i) => i.id}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / W))}
          onScrollToIndexFailed={() => {
            /* list has no virtualization concerns at this size */
          }}
          renderItem={({ item }) => (
            <View style={{ width: W }}>
              <View style={s.art}>
                <item.Art />
              </View>
              <View style={s.textBox}>
                <Title item={item} />
                <Text style={s.sub}>{item.sub}</Text>
              </View>
            </View>
          )}
          style={{ flexGrow: 0 }}
        />

        <View style={s.dots}>
          {Array.from({ length: TOTAL_DOTS }).map((_, i) => (
            <View key={i} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={s.btn} onPress={next} activeOpacity={0.85}>
          <Text style={s.btnTxt}>{last ? 'Get Started' : 'Next'}</Text>
          <Feather name="arrow-right" size={20} color="#fff" style={{ marginLeft: 8 }} />
        </TouchableOpacity>

        <Text style={s.poweredOnb}>Powered By Sofixs</Text>
      </View>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  onb: { flex: 1, backgroundColor: '#fff' },
  blob: {
    position: 'absolute',
    top: -W * 0.35,
    right: -W * 0.25,
    width: W * 1.0,
    height: W * 0.85,
    borderRadius: W * 0.5,
    backgroundColor: '#FEF1E6',
  },
  blob2: {
    position: 'absolute',
    top: W * 0.78,
    left: -W * 0.2,
    width: W * 1.4,
    height: W * 0.45,
    borderRadius: W * 0.35,
    backgroundColor: '#FFF6EE',
  },
  skip: {
    alignSelf: 'flex-end',
    marginRight: 22,
    marginTop: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  skipTxt: { color: '#4B5563', fontSize: 15, fontWeight: '500' },
  art: { alignItems: 'center', justifyContent: 'center', marginTop: 4, height: W * 0.78 },
  textBox: { alignItems: 'center', marginTop: 26, paddingHorizontal: 24 },
  title: { fontSize: 34, fontWeight: '700', color: '#1F2937', textAlign: 'center', lineHeight: 42 },
  accent: { color: ORANGE },
  sub: { fontSize: 17, color: '#4B5563', textAlign: 'center', marginTop: 14, lineHeight: 26 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginTop: 34 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E5E7EB', marginHorizontal: 6 },
  dotActive: { backgroundColor: ORANGE },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    marginHorizontal: 24,
    height: 62,
    borderRadius: 31,
    marginTop: 24,
    shadowColor: ORANGE,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnTxt: { color: '#fff', fontSize: 19, fontWeight: '600' },
  poweredOnb: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    color: '#9CA3AF',
    fontSize: 11,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
});
