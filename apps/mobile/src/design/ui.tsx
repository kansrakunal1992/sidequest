import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onAccentFor } from '@sidequest/shared';
import { useTheme } from '@/lib/theme';
import { colors, fontSizes, radius, spacing } from './theme';

// ---------- Screen ----------
export function Screen({ children, scroll = true, padded = true, footer }: { children: ReactNode; scroll?: boolean; padded?: boolean; footer?: ReactNode }) {
  const t = useTheme();
  const body = scroll
    ? <ScrollView contentContainerStyle={[{ flexGrow: 1 }, padded && s.pad]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[{ flex: 1 }, padded && s.pad]}>{children}</View>;
  return (
    <LinearGradient colors={[t.bgTop, t.bg]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.45 }} style={[s.screen, { backgroundColor: t.bg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        {body}
        {footer ? <View style={s.footer}>{footer}</View> : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

// ---------- Text ----------
type Variant = 'display' | 'headline' | 'title' | 'body' | 'caption';
const variants: Record<Variant, TextStyle> = {
  display: { fontSize: fontSizes.display, fontWeight: '800', color: colors.text },
  headline: { fontSize: fontSizes.headline, fontWeight: '800', color: colors.text },
  title: { fontSize: fontSizes.title, fontWeight: '700', color: colors.text },
  body: { fontSize: fontSizes.body, color: colors.text, lineHeight: 22 },
  caption: { fontSize: fontSizes.caption, color: colors.textMuted, lineHeight: 17 },
};
export function AppText({ variant = 'body', muted, style, children, ...rest }:
  { variant?: Variant; muted?: boolean; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; accessibilityRole?: 'header' | 'text' }) {
  return <Text {...rest} style={[variants[variant], muted && { color: colors.textMuted }, style]}>{children}</Text>;
}
export const ErrorText = ({ children }: { children: ReactNode }) => <Text accessibilityLiveRegion="polite" style={s.error}>{children}</Text>;

// ---------- Buttons ----------
export function Button({ label, onPress, kind = 'primary', loading, disabled, icon }:
  { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; disabled?: boolean; icon?: ReactNode }) {
  const t = useTheme();
  const off = disabled || loading;
  const labelColor = kind === 'primary' ? t.onAccent : colors.text;
  const content = loading ? <ActivityIndicator color={labelColor} /> : <View style={s.row}>{icon}<Text style={[s.btnLabel, { color: labelColor }]}>{label}</Text></View>;
  return (
    <Pressable onPress={off ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [{ opacity: off ? 0.45 : pressed ? 0.85 : 1 }]}>
      {kind === 'primary' ? (
        <LinearGradient colors={[t.accent, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>{content}</LinearGradient>
      ) : (
        <View style={[s.btn, kind === 'secondary' ? [s.btnSecondary, { backgroundColor: t.surfaceRaised, borderColor: t.border }] : s.btnGhost]}>{content}</View>
      )}
    </Pressable>
  );
}

// ---------- Chips, pills, cards ----------
export function Chip({ label, selected, onPress, accent }: { label: string; selected?: boolean; onPress?: () => void; accent?: string }) {
  const t = useTheme();
  const fill = accent ?? t.highlight;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      style={[s.chip, { backgroundColor: t.surface, borderColor: t.border }, selected && { backgroundColor: fill, borderColor: fill }]}>
      <Text style={[s.chipLabel, selected && { color: onAccentFor(fill, fill), fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}
export function Pill({ label }: { label: string }) {
  const t = useTheme();
  return <View style={[s.pill, { backgroundColor: t.highlight }]}><Text style={[s.pillLabel, { color: onAccentFor(t.highlight, t.highlight) }]}>{label}</Text></View>;
}
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}
export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.row, style]}>{children}</View>;
export const Wrap = ({ children }: { children: ReactNode }) => <View style={s.wrap}>{children}</View>;
export const Spacer = ({ h = spacing.lg }: { h?: number }) => <View style={{ height: h }} />;

// ---------- Text field ----------
export function TextField({ label, error, hint, style, ...rest }: { label: string; error?: string | null; hint?: string } & TextInputProps & { style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} accessibilityLabel={label} {...rest} style={[s.input, { backgroundColor: t.surface, borderColor: t.border }, error ? { borderColor: colors.coral } : null, style]} />
      {hint && !error ? <Text style={s.hint}>{hint}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

// ---------- Progress and segmented tabs ----------
export function ProgressBar({ step, total }: { step: number; total: number }) {
  const t = useTheme();
  return (
    <View style={[s.progressTrack, { backgroundColor: t.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
      <LinearGradient colors={[t.accent, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, width: `${Math.round((step / total) * 100)}%`, borderRadius: 2 }} />
    </View>
  );
}
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={[s.segment, { backgroundColor: t.surface }]}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: o.id === value }} style={[s.segItem, o.id === value && { backgroundColor: t.surfaceRaised }]}>
          <Text style={[s.segLabel, o.id === value && { color: colors.text, fontWeight: '700' }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.empty}>
      <AppText variant="title" style={{ textAlign: 'center' }}>{title}</AppText>
      <Spacer h={spacing.sm} />
      <AppText muted style={{ textAlign: 'center' }}>{body}</AppText>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { color: colors.coral, fontSize: fontSizes.caption + 1, marginTop: spacing.xs },
  btn: { minHeight: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  btnSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: '#3A3160' },
  btnGhost: { backgroundColor: 'transparent' },
  btnLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#3A3160' },
  chipLabel: { color: colors.textMuted, fontSize: 14 },
  pill: { alignSelf: 'flex-start', backgroundColor: '#3B1F9E', paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  pillLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: '#2F2750' },
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.sm, borderWidth: 1, borderColor: '#3A3160', paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#2A2345', marginBottom: spacing.xl },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.pill },
  segActive: { backgroundColor: colors.surfaceRaised },
  segLabel: { color: colors.textMuted, fontSize: 14 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, marginTop: spacing.xxl },
});
