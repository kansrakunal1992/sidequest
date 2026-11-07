import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { SwipeAction } from '@/core/swipe';
import { colors } from '@/design/theme';

const { width: W } = Dimensions.get('window');
const SIDE = W * 0.28, UP = 120;

/** Drag right to like, left to pass, up to send a Spark. A tap opens the profile. Buttons do the same without gestures. */
export function SwipeCard({ children, onSwipe, onTap }: { children: ReactNode; onSwipe: (a: SwipeAction) => void; onTap: () => void }) {
  const pos = useRef(new Animated.ValueXY()).current;
  const handlers = useRef({ onSwipe, onTap });
  handlers.current = { onSwipe, onTap };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_e: unknown, g: { dx: number; dy: number }) => {
      const moved = Math.abs(g.dx) + Math.abs(g.dy);
      if (moved < 8) { Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(); handlers.current.onTap(); return; }
      const action: SwipeAction | null = g.dy < -UP && Math.abs(g.dx) < SIDE ? 'spark' : g.dx > SIDE ? 'like' : g.dx < -SIDE ? 'pass' : null;
      if (!action) { Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(); return; }
      const to = action === 'spark' ? { x: 0, y: -900 } : { x: action === 'like' ? W * 1.4 : -W * 1.4, y: g.dy };
      Animated.timing(pos, { toValue: to, duration: 180, useNativeDriver: false }).start(() => handlers.current.onSwipe(action));
    },
  })).current;

  const rotate = pos.x.interpolate({ inputRange: [-W, 0, W], outputRange: ['-12deg', '0deg', '12deg'] });
  const likeOpacity = pos.x.interpolate({ inputRange: [0, SIDE], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = pos.x.interpolate({ inputRange: [-SIDE, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <Animated.View {...pan.panHandlers} style={[StyleSheet.absoluteFill, { transform: [...pos.getTranslateTransform(), { rotate }] }]}>
      {children}
      <Animated.View pointerEvents="none" style={[st.stamp, { left: 20, borderColor: colors.cyan, opacity: likeOpacity }]}><Text style={[st.stampText, { color: colors.cyan }]}>LIKE</Text></Animated.View>
      <Animated.View pointerEvents="none" style={[st.stamp, { right: 20, borderColor: colors.coral, opacity: passOpacity }]}><Text style={[st.stampText, { color: colors.coral }]}>PASS</Text></Animated.View>
    </Animated.View>
  );
}
const st = StyleSheet.create({
  stamp: { position: 'absolute', top: 36, borderWidth: 3, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, transform: [{ rotate: '-8deg' }] },
  stampText: { fontSize: 24, fontWeight: '900', letterSpacing: 2 },
});
