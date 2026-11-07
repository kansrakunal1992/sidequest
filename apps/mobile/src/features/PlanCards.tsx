import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ACTIVITY_CATEGORIES } from '@sidequest/shared';
import { formatWhen } from '@/core/invite-ui';
import { activityBadge, callBadge, goingLabel, meetStyleLabel, slotsLeft } from '@/core/plans';
import type { ActivityItem, OpenCallItem, Tone } from '@/core/plans';
import { colors, radius, spacing } from '@/design/theme';
import { Button, Row } from '@/design/ui';

const tone = (t: Tone) => (t === 'good' ? colors.cyan : t === 'wait' ? colors.violet : colors.textMuted);
const Tag = ({ label }: { label: string }) => <View style={st.tag}><Text style={st.tagText}>{label}</Text></View>;

export function OpenCallCard({ c, onOpen, onInterested, onPass }: { c: OpenCallItem; onOpen: () => void; onInterested?: () => void; onPass?: () => void }) {
  const badge = callBadge(c); const left = slotsLeft(c);
  return (
    <Pressable onPress={onOpen} style={st.card} accessibilityRole="button" accessibilityLabel={`${c.title}. ${formatWhen(c.startsAt)}. ${c.areaLabel}. Hosted by ${c.hostName}.`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={st.title} numberOfLines={2}>{c.title}</Text>
        {badge ? <Text style={[st.badge, { color: tone(badge.tone) }]}>{badge.label}</Text> : null}
      </Row>
      <View style={st.meta}><Ionicons name="time" size={14} color={colors.textMuted} /><Text style={st.sub}>{formatWhen(c.startsAt)}</Text></View>
      <View style={st.meta}><Ionicons name="location" size={14} color={colors.textMuted} /><Text style={st.sub}>{c.areaLabel}{c.venue ? ` · ${c.venue}` : ''}{c.distanceKm != null ? ` · ${Math.round(c.distanceKm)} km` : ''}</Text></View>
      <View style={st.meta}><Ionicons name="person" size={14} color={colors.textMuted} /><Text style={st.sub}>{c.isMine ? 'You' : `${c.hostName}, ${c.hostAge}`}{c.hostVerified ? '  ✓' : ''}</Text></View>
      <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <Tag label={c.capacity === 2 ? 'One-to-one' : `Group of ${c.capacity}`} /><Tag label={meetStyleLabel(c.meetStyle)} />
        {c.status === 'open' ? <Tag label={`${left} place${left === 1 ? '' : 's'} left`} /> : null}{c.budgetNote ? <Tag label={c.budgetNote} /> : null}
      </Row>
      {onInterested ? <Row style={{ marginTop: 12 }}><View style={{ flex: 1 }}><Button kind="secondary" label="Pass" onPress={onPass ?? (() => {})} /></View><View style={{ flex: 1 }}><Button label={c.status === 'full' ? 'Join waitlist' : 'Interested'} onPress={onInterested} /></View></Row> : null}
    </Pressable>
  );
}

export function ActivityCard({ a, onOpen }: { a: ActivityItem; onOpen: () => void }) {
  const badge = activityBadge(a); const cat = ACTIVITY_CATEGORIES.find((c) => c.id === a.category);
  return (
    <Pressable onPress={onOpen} style={st.card} accessibilityRole="button" accessibilityLabel={`${a.title}. ${formatWhen(a.startsAt)}. ${a.areaLabel}. ${goingLabel(a)}`}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}><Row><Ionicons name={(cat?.icon ?? 'sparkles') as never} size={16} color={colors.violet} /><Text style={st.cat}>{cat?.label ?? a.category}</Text></Row><Text style={st.title} numberOfLines={2}>{a.title}</Text></View>
        {badge ? <Text style={[st.badge, { color: tone(badge.tone) }]}>{badge.label}</Text> : null}
      </Row>
      <View style={st.meta}><Ionicons name="time" size={14} color={colors.textMuted} /><Text style={st.sub}>{formatWhen(a.startsAt)}</Text></View>
      <View style={st.meta}><Ionicons name="location" size={14} color={colors.textMuted} /><Text style={st.sub}>{a.areaLabel}{a.venue ? ` · ${a.venue}` : ''}{a.distanceKm != null ? ` · ${Math.round(a.distanceKm)} km` : ''}</Text></View>
      <View style={st.meta}><Ionicons name="people" size={14} color={colors.textMuted} /><Text style={st.sub}>{goingLabel(a)}</Text></View>
    </Pressable>
  );
}
const st = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: 12, borderWidth: 1, borderColor: '#2F2750' },
  title: { color: colors.text, fontWeight: '800', fontSize: 17, flex: 1, marginTop: 2 },
  cat: { color: colors.violet, fontWeight: '700', fontSize: 12 },
  badge: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  sub: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  tag: { backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 4 },
  tagText: { color: colors.text, fontSize: 12 },
});
