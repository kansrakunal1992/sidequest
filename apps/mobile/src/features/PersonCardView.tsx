import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import { meetActivityLabel } from '@sidequest/shared';
import type { DateIdeas } from '@/core/date-ideas';
import { cardReasons } from '@/core/reasons';
import type { PersonCard } from '@/core/mappers';
import { MODES, colors, radius, spacing } from '@/design/theme';
import type { ModeId } from '@sidequest/shared';

/** Full-bleed card in the style of the reference: photo, name and age, verified tick, headline, and plain-language reasons. */
export function PersonCardView({ card, mode, photo, ideas }: { card: PersonCard; mode: ModeId; photo?: string; ideas?: DateIdeas | null }) {
  const upFor = ideas?.ideas.length ? ideas.ideas.map(meetActivityLabel).join(', ') : null;
  const reasons = cardReasons({ sharedInterests: card.sharedInterests, distanceKm: card.distanceKm, availability: card.availability, likesYou: card.likesYou, modeLabel: MODES[mode].label });
  return (
    <View style={st.card} accessible accessibilityLabel={`${card.displayName}, ${card.age}. ${reasons.join('. ')}${upFor ? `. Up for: ${upFor}` : ''}`}>
      {photo ? <Image source={{ uri: photo }} style={st.img} resizeMode="cover" /> : <View style={[st.img, { backgroundColor: colors.surfaceRaised }]} />}
      <LinearGradient colors={['transparent', 'rgba(16,13,32,0.95)']} style={st.shade} />
      <View style={st.info}>
        <View style={st.nameRow}>
          <Text style={st.name}>{card.displayName}, {card.age}</Text>
          {card.verified ? <Ionicons name="checkmark-circle" size={20} color={colors.cyan} /> : null}
        </View>
        {card.headline ? <Text style={st.headline} numberOfLines={2}>{card.headline}</Text> : null}
        <View style={st.reasons}>
          {reasons.slice(0, 3).map((r) => <View key={r} style={[st.reason, r.startsWith('Likes you') && { backgroundColor: colors.pink }]}><Text style={st.reasonText}>{r}</Text></View>)}
        </View>
        {upFor ? <View style={st.ideas}><Ionicons name="bulb-outline" size={14} color={colors.text} /><Text style={st.ideasText} numberOfLines={1}>Up for: {upFor}</Text></View> : null}
      </View>
    </View>
  );
}
const st = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  img: { ...StyleSheet.absoluteFillObject },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  info: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: 26, fontWeight: '800' },
  headline: { color: colors.text, fontSize: 15, marginTop: 4 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  reason: { backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  reasonText: { color: colors.text, fontSize: 12 },
  ideas: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  ideasText: { color: colors.text, fontSize: 13, flexShrink: 1 },
});
