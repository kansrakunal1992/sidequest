import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** Four-point sparkle in the brand gradient. Pure vector, scales to any size. */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="SideQuest logo">
      <Defs>
        <LinearGradient id="sq" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#713BF2" />
          <Stop offset="0.6" stopColor="#A855F7" />
          <Stop offset="1" stopColor="#EF4BA8" />
        </LinearGradient>
      </Defs>
      <Path d="M50 4 C54 32 68 46 96 50 C68 54 54 68 50 96 C46 68 32 54 4 50 C32 46 46 32 50 4 Z" fill="url(#sq)" />
    </Svg>
  );
}
