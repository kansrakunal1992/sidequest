import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/design/theme';
import { AppText, Card } from '@/design/ui';

export function NavRow({ icon, title, hint, onPress, badge }: { icon: keyof typeof Ionicons.glyphMap; title: string; hint: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${hint}`} style={{ marginBottom: 10 }}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name={icon} size={22} color={colors.violet} />
        <View style={{ flex: 1 }}><AppText variant="title">{title}</AppText><AppText muted variant="caption">{hint}</AppText></View>
        {badge ? <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}><AppText variant="caption" style={{ color: '#fff' }}>{badge}</AppText></View> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Card>
    </Pressable>
  );
}
export function ToggleRow({ title, hint, value, onChange, disabled }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactNode {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
      <View style={{ flex: 1, paddingRight: 12 }}><AppText variant="title">{title}</AppText><AppText muted variant="caption">{hint}</AppText></View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.primary, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel={title} />
    </View>
  );
}
