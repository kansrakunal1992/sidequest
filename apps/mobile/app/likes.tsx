import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LikeItem, MatchItem, VisitorItem } from '@/core/mappers';
import { timeAgo } from '@/core/time';
import { MODES, colors, gradients, radius, spacing } from '@/design/theme';
import { AppText, Card, EmptyState, ErrorText, Row, Segmented, Spacer } from '@/design/ui';
import { MatchModal } from '@/features/MatchModal';
import { ensureMatchConversation } from '@/lib/chat';
import { likesReceived, myMatches, sendLike, visitorsList } from '@/lib/discovery';
import { useModes } from '@/lib/modes';
import { usePhotoUrls } from '@/lib/photo-urls';
import { useTheme } from '@/lib/theme';

type Tab = 'likes' | 'matches' | 'visitors';

function Avatar({ uri, size = 56 }: { uri?: string; size?: number }) {
  return uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceRaised }} />;
}

/** Free and unblurred, always. A like and a visit are different things and are listed separately. */
export default function LikesScreen() {
  const th = useTheme();
  const router = useRouter();
  const { current } = useModes();
  const [tab, setTab] = useState<Tab>('likes');
  const [likes, setLikes] = useState<LikeItem[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [visitors, setVisitors] = useState<VisitorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<string | null>(null);
  const now = new Date();

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const [l, m, v] = await Promise.all([likesReceived(current), myMatches(current), visitorsList(current)]);
      setLikes(l); setMatches(m); setVisitors(v); setError(null);
    } catch { setError('We could not load this. Pull down to try again.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [current]);
  useEffect(() => { void load(); }, [load]);

  const ids = useMemo(() => [...likes, ...matches, ...visitors].map((x) => x.userId), [likes, matches, visitors]);
  const photos = usePhotoUrls(useMemo(() => (current ? [...new Set(ids)].map((userId) => ({ userId, modeId: current })) : []), [ids, current]));
  const open = (userId: string) => router.push({ pathname: '/person/[id]', params: { id: userId, mode: current } } as never);

  async function likeBack(item: LikeItem) {
    if (!current) return;
    try { const r = await sendLike(item.userId, current, 'like'); if (r.matched) setMatch(item.displayName); await load(); }
    catch { setError('That did not go through. Please try again.'); }
  }

  const modeLabel = current ? MODES[current].label : '';
  const latest = likes[0];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.sm }}>
        <Row>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
          <AppText variant="title" accessibilityRole="header">Your Likes &amp; Matches</AppText>
        </Row>
        <AppText muted variant="caption" style={{ marginTop: 4 }}>Showing {modeLabel}. Each vibe has its own likes, matches and visitors.</AppText>
        <Spacer h={spacing.md} />
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ id: 'likes', label: `Likes (${likes.length})` }, { id: 'matches', label: `Matches (${matches.length})` }, { id: 'visitors', label: `Visitors (${visitors.length})` }]} />
      </View>
      {loading ? <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={th.highlight} size="large" /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={th.highlight} />}>
          {error ? <ErrorText>{error}</ErrorText> : null}

          {tab === 'likes' && (likes.length === 0 ? <EmptyState title="No likes yet" body="When someone likes you in this vibe, they appear here straight away. Nothing is hidden or locked." /> : (
            <>
              {latest ? (
                <LinearGradient colors={[th.accent, th.accent2]} style={st.banner}>
                  <Ionicons name="heart" size={24} color="#fff" />
                  <View style={{ flex: 1 }}><Text style={st.bannerTitle}>{likes.length === 1 ? 'Someone liked you!' : `${likes.length} people liked you`}</Text><Text style={st.bannerSub}>{timeAgo(latest.likedAt, now)}</Text></View>
                </LinearGradient>
              ) : null}
              <Spacer />
              {likes.map((l) => (
                <Pressable key={l.userId} onPress={() => open(l.userId)} style={st.row} accessibilityRole="button" accessibilityLabel={`${l.displayName}, ${l.age}. ${l.kind === 'spark' ? 'Sent a spark' : 'Liked you'}`}>
                  <Avatar uri={photos[l.userId]?.[0]} />
                  <View style={{ flex: 1 }}>
                    <Row><Text style={st.name}>{l.displayName}, {l.age}</Text>{l.verified ? <Ionicons name="checkmark-circle" size={16} color={colors.cyan} /> : null}{l.kind === 'spark' ? <Ionicons name="flash" size={16} color={th.highlight} /> : null}</Row>
                    <Text style={st.sub}>{l.kind === 'spark' ? 'Sent you a spark' : 'Liked you'} · {timeAgo(l.likedAt, now)}</Text>
                  </View>
                  {l.matched ? <Text style={st.tag}>Matched</Text> : l.iLikedBack ? <Text style={st.tag}>Liked back</Text>
                    : <Pressable onPress={() => void likeBack(l)} accessibilityRole="button" accessibilityLabel={`Like ${l.displayName} back`} style={st.likeBack}><Ionicons name="heart" size={18} color="#fff" /></Pressable>}
                </Pressable>
              ))}
            </>
          ))}

          {tab === 'matches' && (matches.length === 0 ? <EmptyState title="No matches yet" body="You match when you like each other. Keep exploring, and say hi through a friendly invitation." /> : matches.map((m) => (
            <Pressable key={m.matchId} onPress={() => open(m.userId)} style={st.row} accessibilityRole="button" accessibilityLabel={`${m.displayName}, ${m.age}. Matched ${timeAgo(m.matchedAt, now)}`}>
              <Avatar uri={photos[m.userId]?.[0]} />
              <View style={{ flex: 1 }}>
                <Row><Text style={st.name}>{m.displayName}, {m.age}</Text>{m.verified ? <Ionicons name="checkmark-circle" size={16} color={colors.cyan} /> : null}</Row>
                <Text style={st.sub}>Matched {timeAgo(m.matchedAt, now)}</Text>
              </View>
              <Pressable onPress={async () => { try { router.push(`/chat/${await ensureMatchConversation(m.matchId)}` as never); } catch { setError('Could not open the chat.'); } }}
                accessibilityRole="button" accessibilityLabel={`Message ${m.displayName}`} style={st.likeBack}><Ionicons name="chatbubble" size={18} color="#fff" /></Pressable>
            </Pressable>
          )))}

          {tab === 'visitors' && (
            <>
              <Card><AppText variant="caption">A visit is not a like. People appear here when they look at your profile. Anyone browsing incognito is never listed, and you can browse incognito too, free, from your Profile.</AppText></Card>
              <Spacer />
              {visitors.length === 0 ? <EmptyState title="No visitors yet" body="People who view your profile in this vibe will show up here." /> : visitors.map((v) => (
                <Pressable key={v.userId} onPress={() => open(v.userId)} style={st.row} accessibilityRole="button" accessibilityLabel={`${v.displayName}, ${v.age}. Visited ${timeAgo(v.lastVisitAt, now)}`}>
                  <Avatar uri={photos[v.userId]?.[0]} />
                  <View style={{ flex: 1 }}>
                    <Row><Text style={st.name}>{v.displayName}, {v.age}</Text>{v.verified ? <Ionicons name="checkmark-circle" size={16} color={colors.cyan} /> : null}</Row>
                    <Text style={st.sub}>Viewed your profile · {timeAgo(v.lastVisitAt, now)}{v.visits > 1 ? ` · ${v.visits} visits` : ''}</Text>
                    {(v.lookedAtPhotos || v.lookedAtPrompts) ? <Text style={st.sub}>{[v.lookedAtPhotos && 'Looked at your photos', v.lookedAtPrompts && 'Read your prompts'].filter(Boolean).join(' · ')}</Text> : null}
                  </View>
                  {v.theyLikedYou ? <Ionicons name="heart" size={18} color={colors.pink} accessibilityLabel="They liked you" /> : null}
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}
      <MatchModal name={match} onClose={() => setMatch(null)} />
    </SafeAreaView>
  );
}
const st = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },
  bannerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  name: { color: colors.text, fontWeight: '700', fontSize: 16 },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  tag: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  likeBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
});
