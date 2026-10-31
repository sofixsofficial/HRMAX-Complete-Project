import React from 'react';
import { Dimensions } from 'react-native';
import Svg, { Rect, Circle, Path, Line, G, Ellipse } from 'react-native-svg';

/**
 * Onboarding illustrations, taken verbatim from the approved design source
 * (App.js): a man presenting an employee profile on a laptop (one) and a
 * woman giving a thumbs up next to a phone with an approval check (two).
 */

const { width: W } = Dimensions.get('window');
const ORANGE = '#F97316';
const NAVY = '#1E2F5C';
const SKIN = '#F6B98B';

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <G x={x} y={y}>
      <Path d="M20 30 C4 28 0 10 8 0 C20 6 24 18 20 30Z" fill="#2E8B63" />
      <Path d="M22 30 C26 14 36 6 46 8 C46 22 36 30 22 30Z" fill="#3FA373" />
      <Path d="M18 28 C14 14 18 4 24 -8 C32 4 30 20 24 30Z" fill="#2E7D5B" />
      <Path d="M10 28 H36 L33 52 H13 Z" fill="#2B3A67" />
    </G>
  );
}

export function IllustrationOne() {
  return (
    <Svg width={W * 0.88} height={W * 0.88 * 0.82} viewBox="0 0 330 270">
      <Line x1="5" y1="252" x2="325" y2="252" stroke="#EDE7E1" strokeWidth="2" />
      <Plant x={6} y={200} />
      {/* bubbles */}
      <Circle cx="48" cy="112" r="32" fill="#FDEBDD" />
      <Rect x="34" y="100" width="28" height="24" rx="4" fill={ORANGE} />
      <Rect x="34" y="100" width="28" height="7" rx="3" fill="#EA580C" />
      {[40, 49, 58].map((cx) => [111, 118].map((cy) => <Rect key={cx + '' + cy} x={cx - 3} y={cy} width="5" height="4" rx="1" fill="#fff" />))}
      <Circle cx="140" cy="62" r="40" fill="#FDEBDD" />
      <Circle cx="140" cy="52" r="8" fill={ORANGE} />
      <Circle cx="122" cy="58" r="6" fill={ORANGE} />
      <Circle cx="158" cy="58" r="6" fill={ORANGE} />
      <Path d="M126 76 Q140 56 154 76 Z" fill={ORANGE} />
      <Path d="M110 76 Q116 64 124 68 L124 76Z M170 76 Q164 64 156 68 L156 76Z" fill={ORANGE} />
      <Circle cx="262" cy="74" r="24" fill="#FDEBDD" />
      <Circle cx="262" cy="74" r="12" stroke={ORANGE} strokeWidth="3" fill="none" />
      <Path d="M262 67 V74 L267 77" stroke={ORANGE} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* laptop */}
      <Rect x="55" y="130" width="170" height="108" rx="7" fill="#2B4A8B" />
      <Rect x="62" y="137" width="156" height="94" rx="3" fill="#DCEBFF" />
      <Circle cx="98" cy="170" r="22" fill="#BBD4F5" />
      <Circle cx="98" cy="164" r="8" fill="#1F2A44" />
      <Path d="M82 184 Q98 164 114 184 Z" fill="#1F2A44" />
      {[[135, 156, 70], [135, 168, 55], [135, 180, 70], [80, 204, 50], [135, 204, 70], [80, 216, 90]].map(([x, y, w], i) => (
        <Rect key={i} x={x} y={y} width={w} height="6" rx="3" fill="#8FB4EA" />
      ))}
      <Rect x="40" y="238" width="200" height="12" rx="6" fill="#2B4A8B" />
      {/* man */}
      <Rect x="238" y="200" width="56" height="52" fill="#1B2A55" />
      <Rect x="228" y="118" width="74" height="95" rx="18" fill={NAVY} />
      <Path d="M255 120 L273 120 L266 178 Z" fill="#fff" />
      <Path d="M262 124 L268 124 L270 170 L264 178 L260 170 Z" fill={ORANGE} />
      <Line x1="236" y1="138" x2="204" y2="152" stroke={NAVY} strokeWidth="13" strokeLinecap="round" />
      <Circle cx="199" cy="153" r="8" fill={SKIN} />
      <G rotation="-18" origin="290, 190"><Rect x="272" y="170" width="38" height="44" rx="4" fill="#16244A" /></G>
      <Circle cx="286" cy="206" r="8" fill={SKIN} />
      <Rect x="256" y="104" width="14" height="16" fill={SKIN} />
      <Circle cx="264" cy="88" r="22" fill={SKIN} />
      <Path d="M242 86 Q244 62 266 64 Q286 66 286 84 Q276 74 262 76 Q250 76 242 86Z" fill="#1F2A44" />
      <Circle cx="257" cy="90" r="2" fill="#1F2A44" />
      <Circle cx="272" cy="90" r="2" fill="#1F2A44" />
      <Path d="M258 99 Q265 104 272 99" stroke="#B4533A" strokeWidth="2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function IllustrationTwo() {
  return (
    <Svg width={W * 0.88} height={W * 0.88 * 0.85} viewBox="0 0 330 280">
      <Line x1="5" y1="262" x2="325" y2="262" stroke="#EDE7E1" strokeWidth="2" />
      <Plant x={4} y={208} />
      {/* sparks */}
      <Line x1="30" y1="78" x2="44" y2="86" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
      <Line x1="52" y1="56" x2="60" y2="68" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
      <Line x1="86" y1="48" x2="84" y2="62" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
      {/* phone */}
      <Rect x="40" y="84" width="140" height="176" rx="20" fill="#fff" stroke="#1F3A6B" strokeWidth="8" />
      <Rect x="86" y="92" width="48" height="6" rx="3" fill="#D6E4F7" />
      <Circle cx="110" cy="150" r="34" fill={ORANGE} />
      <Path d="M94 150 L106 162 L128 138" stroke="#fff" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="64" y="202" width="92" height="7" rx="3.5" fill="#C9DDF7" />
      <Rect x="64" y="218" width="92" height="7" rx="3.5" fill="#C9DDF7" />
      <Rect x="64" y="234" width="50" height="7" rx="3.5" fill="#C9DDF7" />
      {/* woman */}
      <Path d="M212 96 C206 50 288 40 296 100 C302 140 306 170 294 190 L218 190 C210 160 214 130 212 96Z" fill="#3A2318" />
      <Rect x="214" y="150" width="86" height="112" rx="22" fill={ORANGE} />
      <Path d="M240 150 L258 190 L276 150 Z" fill="#fff" />
      <Rect x="248" y="130" width="20" height="24" fill={SKIN} />
      <Circle cx="257" cy="108" r="26" fill={SKIN} />
      <Path d="M231 108 Q232 78 258 80 Q284 80 284 108 Q276 92 258 94 Q240 94 231 108Z" fill="#3A2318" />
      <Circle cx="248" cy="112" r="2.2" fill="#2A1A12" />
      <Circle cx="266" cy="112" r="2.2" fill="#2A1A12" />
      <Path d="M250 123 Q257 129 265 123" stroke="#B4533A" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* thumbs up */}
      <Line x1="222" y1="176" x2="196" y2="184" stroke={ORANGE} strokeWidth="14" strokeLinecap="round" />
      <Rect x="180" y="168" width="22" height="26" rx="8" fill={SKIN} />
      <Rect x="184" y="150" width="9" height="22" rx="4.5" fill={SKIN} />
      {/* clipboard */}
      <G rotation="8" origin="270, 230"><Rect x="244" y="196" width="62" height="66" rx="6" fill="#16244A" />
      <Rect x="262" y="190" width="26" height="10" rx="3" fill="#2B4A8B" /></G>
      <Ellipse cx="248" cy="226" rx="9" ry="8" fill={SKIN} />
    </Svg>
  );
}
