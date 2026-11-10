import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** Waypoint: a map pin in the brand gradient. Pure vector, scales to any size. (Same shape as assets/icon.png.) */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Waypoint logo">
      <Defs>
        <LinearGradient id="wp" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#713BF2" />
          <Stop offset="0.6" stopColor="#A855F7" />
          <Stop offset="1" stopColor="#EF4BA8" />
        </LinearGradient>
      </Defs>
      <Path d="M50 92 C50 92 22 64 22 40 A28 28 0 0 1 78 40 C78 64 50 92 50 92 Z M50 29 A11 11 0 1 0 50 51 A11 11 0 1 0 50 29 Z" fill="url(#wp)" fillRule="evenodd" />
    </Svg>
  );
}
