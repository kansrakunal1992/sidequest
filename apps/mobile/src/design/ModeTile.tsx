import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { onAccentFor, themeFor } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';
import { MODES, colors, radius, spacing } from './theme';

/** The tinted tile from "What's your vibe?". Selected tiles glow in the mode's accent colour. */
export function ModeTile({ mode, icon, selected, onPress }: { mode: ModeId; icon: string; selected: boolean; onPress: () => void }) {
  const m = MODES[mode];
  const t = themeFor(mode);   // the tile previews the look the vibe will have once it is chosen
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${m.label}. ${m.tagline}`}
      style={[st.tile, { backgroundColor: t.surfaceRaised, borderColor: selected ? t.highlight : t.border }]}>
      <View style={st.iconWrap}><Ionicons name={icon as never} size={30} color={t.highlight} /></View>
      <Text style={st.label}>{m.label}</Text>
      <Text style={st.tag}>{m.tagline}</Text>
      {selected ? <View style={[st.tick, { backgroundColor: t.highlight }]}><Ionicons name="checkmark" size={14} color={onAccentFor(t.highlight, t.highlight)} /></View> : null}
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
