import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ModeId } from '@sidequest/shared';
import { MODES, colors, radius, spacing } from './theme';

/** The tinted tile from "What's your vibe?". Selected tiles glow in the mode's accent colour. */
export function ModeTile({ mode, icon, selected, onPress }: { mode: ModeId; icon: string; selected: boolean; onPress: () => void }) {
  const m = MODES[mode];
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${m.label}. ${m.tagline}`}
      style={[st.tile, { backgroundColor: m.tint, borderColor: selected ? m.accent : 'transparent' }]}>
      <View style={st.iconWrap}><Ionicons name={icon as never} size={30} color={m.accent} /></View>
      <Text style={st.label}>{m.label}</Text>
      <Text style={st.tag}>{m.tagline}</Text>
      {selected ? <View style={[st.tick, { backgroundColor: m.accent }]}><Ionicons name="checkmark" size={14} color="#100D20" /></View> : null}
    </Pressable>
  );
}
const st = StyleSheet.create({
  tile: { width: '48%', minHeight: 132, borderRadius: radius.md, padding: spacing.lg, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { marginBottom: spacing.sm },
  label: { color: colors.text, fontWeight: '800', fontSize: 16 },
  tag: { color: colors.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
  tick: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
