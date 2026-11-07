import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ModeId } from '@sidequest/shared';
import type { FullProfile } from '@/core/mappers';
import { availabilityLabel } from '@/core/reasons';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Row, Spacer, Wrap } from '@/design/ui';
import { ActionBar } from '@/features/ActionBar';
import { MatchModal } from '@/features/MatchModal';
import { SafetyMenu } from '@/features/SafetyMenu';
import { ensureMatchConversation } from '@/lib/chat';
import { myMatches, passPerson, recordInteraction, sendLike, viewProfile } from '@/lib/discovery';
import { useModes } from '@/lib/modes';
import { usePhotoUrls } from '@/lib/photo-urls';
import { useSession } from '@/lib/session';

const W = Dimensions.get('window').width;

export default function PersonScreen() {
  const { id, mode: modeParam } = useLocalSearchParams<{ id: string; mode?: string }>();
  const { current } = useModes();
  const { session } = useSession();
  const router = useRouter();
  const mode = ((modeParam as ModeId | undefined) ?? current) as ModeId | null;
  const [p, setP] = useState<FullProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [match, setMatch] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const seenPhotos = useRef(new Set<number>());
  const photos = usePhotoUrls(id && mode ? [{ userId: id, modeId: mode }] : [], true)[id ?? ''] ?? [];

  useEffect(() => {
    if (!id || !mode) return;
    viewProfile(id, mode).then(setP).catch(() => setError('This profile is not available.'));
  }, [id, mode]);

  useEffect(() => { if (id && mode) myMatches(mode).then((ms) => setMatchId(ms.find((x) => x.userId === id)?.matchId ?? null)).catch(() => {}); }, [id, mode]);

  if (!id || !mode) return null;
  if (error) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center' }}><AppText style={{ textAlign: 'center' }}>{error}</AppText><Spacer /><Button kind="secondary" label="Go back" onPress={() => router.back()} /></SafeAreaView>;
  if (!p) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.violet} size="large" /></View>;

  const m = MODES[mode];
  async function act(a: 'pass' | 'like' | 'spark') {
    try {
      if (a === 'pass') { await passPerson(id!, mode!); router.back(); return; }
      const r = await sendLike(id!, mode!, a);
      if (r.matched) setMatch(p!.displayName); else router.back();
    } catch { setError('That did not go through. Please try again.'); }
  }
  function onScroll(x: number) {
    const i = Math.round(x / W); setPage(i);
    if (i > 0 && !seenPhotos.current.has(i)) { seenPhotos.current.add(i); void recordInteraction(id!, mode!, 'photo_tap', `photo-${i}`); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={{ width: W, height: W * 1.25, backgroundColor: colors.surface }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e: { nativeEvent: { contentOffset: { x: number } } }) => onScroll(e.nativeEvent.contentOffset.x)}>
            {photos.length ? photos.map((u, i) => <Image key={u} source={{ uri: u }} style={{ width: W, height: W * 1.25 }} accessibilityLabel={`${p.displayName} photo ${i + 1}`} />) : <View style={{ width: W, height: W * 1.25 }} />}
          </ScrollView>
          {photos.length > 1 ? <View style={st.dots}>{photos.map((u, i) => <View key={u} style={[st.pip, i === page && { backgroundColor: colors.text }]} />)}</View> : null}
        </View>
        <View style={{ padding: spacing.xl }}>
          <Row><AppText variant="headline">{p.displayName}, {p.age}</AppText>{p.verified ? <Ionicons name="checkmark-circle" size={22} color={colors.cyan} /> : null}</Row>
          <Row style={{ marginTop: 6 }}>
            <View style={[st.modePill, { backgroundColor: m.tint }]}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{m.label}</Text></View>
            {p.area ? <AppText muted variant="caption">{p.area}</AppText> : null}
            {availabilityLabel(p.availability) ? <AppText muted variant="caption">· {availabilityLabel(p.availability)}</AppText> : null}
          </Row>
          {p.headline ? <><Spacer h={12} /><AppText variant="title">{p.headline}</AppText></> : null}
          {p.bio ? <><Spacer h={8} /><AppText>{p.bio}</AppText></> : null}
          {p.prompts.map((pr, i) => (
            <Pressable key={pr.q} onPress={() => void recordInteraction(id, mode, 'prompt_tap', `prompt-${i}`)} accessibilityRole="button">
              <Card style={{ marginTop: spacing.md }}><AppText variant="caption">{pr.q}</AppText><Spacer h={4} /><AppText variant="title">{pr.a}</AppText></Card>
            </Pressable>
          ))}
          {p.interests.length ? <><Spacer /><Wrap>{p.interests.map((i) => <Chip key={i} label={i} />)}</Wrap></> : null}
          <Spacer h={20} />
          {matchId ? <><Button label="Message" onPress={async () => { try { const c = await ensureMatchConversation(matchId); router.push(`/chat/${c}` as never); } catch { setError('Could not open the chat.'); } }} /><Spacer h={10} /></> : null}
          <Button kind="secondary" label="Send an invitation" onPress={() => router.push({ pathname: '/invite/new', params: { to: id, mode, name: p.displayName } } as never)} />
          <Spacer h={24} />
          <Button kind="ghost" label="Report or block" onPress={() => setMenu(true)} />
        </View>
      </ScrollView>
      <SafeAreaView edges={['top']} style={st.topBar} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={st.round}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
        <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="More" style={st.round}><Ionicons name="ellipsis-horizontal" size={22} color="#fff" /></Pressable>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={st.bottom}><ActionBar onPass={() => void act('pass')} onLike={() => void act('like')} onSpark={() => void act('spark')} /></SafeAreaView>
      {error ? <View style={{ position: 'absolute', bottom: 100, left: 0, right: 0, alignItems: 'center' }}><ErrorText>{error}</ErrorText></View> : null}
      {session ? <SafetyMenu visible={menu} me={session.user.id} other={id} name={p.displayName} onClose={() => setMenu(false)} onBlocked={() => router.back()} /> : null}
      <MatchModal name={match} onClose={() => { setMatch(null); router.back(); }} />
    </View>
  );
}
const st = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(16,13,32,0.92)' },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  pip: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  modePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
});
