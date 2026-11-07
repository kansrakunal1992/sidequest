import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/design/theme';

const B = ({ icon, color, size = 28, big, onPress, label, disabled }: { icon: string; color: string; size?: number; big?: boolean; onPress: () => void; label: string; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
    style={[st.btn, big && st.big, { borderColor: color, opacity: disabled ? 0.35 : 1 }]}>
    <Ionicons name={icon as never} size={size} color={color} />
  </Pressable>
);

/** The four actions from the reference: rewind, pass, like, spark. All free and unlimited. */
export function ActionBar({ onRewind, onPass, onLike, onSpark, canRewind, busy }: { onRewind?: () => void; onPass: () => void; onLike: () => void; onSpark: () => void; canRewind?: boolean; busy?: boolean }) {
  return (
    <View style={st.row}>
      {onRewind ? <B icon="refresh" color={colors.textMuted} size={22} onPress={onRewind} label="Rewind" disabled={!canRewind || busy} /> : null}
      <B icon="close" color={colors.coral} big onPress={onPass} label="Pass" disabled={busy} />
      <B icon="heart" color={colors.text} big onPress={onLike} label="Like" disabled={busy} />
      <B icon="flash" color={colors.violet} size={24} onPress={onSpark} label="Spark" disabled={busy} />
    </View>
  );
}
const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, paddingVertical: 12 },
  btn: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  big: { width: 64, height: 64, borderRadius: 32 },
});
