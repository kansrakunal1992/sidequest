import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MODE_TILES } from '@/core/modes-ui';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { AppText, Spacer } from '@/design/ui';
import { useModes } from '@/lib/modes';

/** "Choose or switch anytime": a bottom sheet to change which vibe the app is showing. */
export function ModeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { active, current, setCurrent } = useModes();
  const usable = MODE_TILES.filter((t) => active.some((a) => a.modeId === t.id && !a.paused));
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <AppText variant="title">Your vibe</AppText>
        <AppText muted variant="caption">Switch any time. Each vibe has its own people, plans and privacy.</AppText>
        <Spacer h={spacing.md} />
        {usable.length === 0 ? <AppText muted>All your vibes are paused. Turn one on from your Profile.</AppText> : null}
        {usable.map((t) => {
          const m = MODES[t.id]; const on = current === t.id;
          return (
            <Pressable key={t.id} onPress={() => { setCurrent(t.id); onClose(); }} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[st.row, on && { borderColor: m.accent }]}>
              <Ionicons name={t.icon as never} size={22} color={m.accent} />
              <View style={{ flex: 1 }}><Text style={st.label}>{m.label}</Text><Text style={st.tag}>{m.tagline}</Text></View>
              {on ? <Ionicons name="checkmark-circle" size={22} color={m.accent} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', marginTop: spacing.sm },
  label: { color: colors.text, fontWeight: '700', fontSize: 16 },
  tag: { color: colors.textMuted, fontSize: 12 },
});
