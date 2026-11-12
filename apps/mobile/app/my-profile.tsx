import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ModeId } from '@sidequest/shared';
import { availabilityLabel } from '@/core/reasons';
import { photosAsOthersSee, shownBio } from '@/core/self-profile';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Row, Spacer, Wrap } from '@/design/ui';
import { loadOwnProfile } from '@/lib/own-profile';
import type { OwnProfileData } from '@/lib/own-profile';
import { useModes } from '@/lib/modes';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const W = Dimensions.get('window').width;

/** "How others see you": the same layout a viewer gets, built from your own data (the server never shows you yourself).
 *  Photos that others cannot see yet are still shown to you, clearly marked, so you know exactly what is live. */
export default function MyProfile() {
  const th = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { active, current } = useModes();
  const uid = session?.user.id ?? '';
  const [mode, setMode] = useState<ModeId | null>(current);
  const [data, setData] = useState<OwnProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(() => {
    if (!uid) return;
    loadOwnProfile(uid, mode).then((d) => { setData(d); setError(null); }).catch(() => setError('Could not load your profile. Please try again.'));
  }, [uid, mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));   // coming back from Edit profile shows the change straight away

  const vibes = active.filter((a) => !a.paused);
  if (error && !data) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center' }}><AppText style={{ textAlign: 'center' }}>{error}</AppText><Spacer /><Button kind="secondary" label="Go back" onPress={() => router.back()} /></SafeAreaView>;
  if (!data) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={th.highlight} size="large" /></View>;

  const views = photosAsOthersSee(data.photos, mode, data.visiblePhotoIds);
  const live = views.filter((v) => v.liveToOthers).length;
  const bio = shownBio(data.modeBio, data.baseBio);
  const m = mode ? MODES[mode] : null;
  const avail = data.availability ? availabilityLabel(data.availability as never) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={{ width: W, height: W * 1.25, backgroundColor: colors.surface }}>
          {views.length ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e: { nativeEvent: { contentOffset: { x: number } } }) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}>
              {views.map((v, i) => (
                <View key={v.photo.id} style={{ width: W, height: W * 1.25 }}>
                  {v.photo.url ? <Image source={{ uri: v.photo.url }} style={{ width: W, height: W * 1.25, opacity: v.liveToOthers ? 1 : 0.45 }} accessibilityLabel={`Your photo ${i + 1}`} /> : null}
                  {v.note ? <View style={st.note}><Ionicons name="eye-off-outline" size={14} color="#fff" /><Text style={st.noteText}>{v.note}</Text></View> : null}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
              <Ionicons name="image-outline" size={40} color={colors.textMuted} /><Spacer h={8} />
              <AppText style={{ textAlign: 'center' }}>You have no photos yet. Others will see a blank card.</AppText><Spacer />
              <Button label="Add photos" onPress={() => router.push('/edit-profile' as never)} />
            </View>
          )}
          {views.length > 1 ? <View style={st.dots}>{views.map((v, i) => <View key={v.photo.id} style={[st.pip, i === page && { backgroundColor: colors.text }]} />)}</View> : null}
        </View>

        <View style={{ padding: spacing.xl }}>
          <Card style={{ marginBottom: spacing.lg }}>
            <Row><Ionicons name="eye-outline" size={18} color={th.highlight} /><AppText variant="caption" style={{ flex: 1 }}>This is how you look to people who find you in {m?.label ?? 'a vibe'}. {views.length ? `${live} of ${views.length} photo${views.length > 1 ? 's are' : ' is'} visible to others.` : ''}</AppText></Row>
          </Card>

          <Row><AppText variant="headline">{data.displayName}{data.age !== null ? `, ${data.age}` : ''}</AppText>{data.verified ? <Ionicons name="checkmark-circle" size={22} color={colors.cyan} accessibilityLabel="Photo verified" /> : null}</Row>
          {!data.verified ? (
            <Pressable onPress={() => router.push('/safety/verify' as never)} accessibilityRole="button" accessibilityLabel="Get your free Photo verified badge" style={st.verifyCta}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.cyan} />
              <Text style={{ color: colors.text, flex: 1, fontWeight: '600' }}>Get your free verified badge</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Row style={{ marginTop: 8 }}>
            {m ? <View style={[st.modePill, { backgroundColor: m.tint }]}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{m.label}</Text></View> : null}
            {data.area ? <AppText muted variant="caption">{data.area}</AppText> : null}
            {avail ? <AppText muted variant="caption">· {avail}</AppText> : null}
          </Row>

          {data.headline ? <><Spacer h={12} /><AppText variant="title">{data.headline}</AppText></> : null}
          {bio ? <><Spacer h={8} /><AppText>{bio}</AppText></> : null}
          {!data.headline && !bio ? <><Spacer h={12} /><AppText muted>You have not written anything for this vibe yet. People can only see your name, photos and interests.</AppText></> : null}
          {data.prompts.map((pr) => <Card key={pr.q} style={{ marginTop: spacing.md }}><AppText variant="caption">{pr.q}</AppText><Spacer h={4} /><AppText variant="title">{pr.a}</AppText></Card>)}
          {data.interests.length ? <><Spacer /><Wrap>{data.interests.map((i) => <Chip key={i} label={i} />)}</Wrap></> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['top']} style={st.topBar} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={st.round}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
        {vibes.length > 1 ? <View style={st.vibes}>{vibes.map((a) => <Chip key={a.modeId} label={MODES[a.modeId].label} selected={mode === a.modeId} accent={MODES[a.modeId].accent} onPress={() => { setMode(a.modeId); setPage(0); }} />)}</View> : <View />}
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={st.bottom}>
        <View style={{ padding: spacing.lg }}><Button label="Edit profile" onPress={() => router.push('/edit-profile' as never)} /></View>
      </SafeAreaView>
    </View>
  );
}
const st = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  vibes: { flexDirection: 'row', gap: 6, marginTop: 8, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(16,13,32,0.92)' },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  pip: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  note: { position: 'absolute', left: 12, bottom: 36, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  noteText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  modePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill ?? 999 },
  verifyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 12, borderRadius: radius.md ?? 12, backgroundColor: colors.surface },
});
