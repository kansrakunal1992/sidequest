import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PersonCard } from '@/core/mappers';
import { appendCards, canRewind, createDeck, markMatched, needsMore, rewind, swipe } from '@/core/swipe';
import type { Deck, SwipeAction } from '@/core/swipe';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Button, EmptyState, ErrorText, Row } from '@/design/ui';
import { discoverPeople, hasFilters, noFilters, passPerson, sendLike, undoLike, undoPass } from '@/lib/discovery';
import type { Filters } from '@/lib/discovery';
import { useModes } from '@/lib/modes';
import { usePhotoUrls } from '@/lib/photo-urls';
import { ActionBar } from './ActionBar';
import { FilterSheet } from './FilterSheet';
import { MatchModal } from './MatchModal';
import { PersonCardView } from './PersonCardView';
import { SwipeCard } from './SwipeCard';

export function PeopleTab() {
  const { current } = useModes();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [deck, setDeck] = useState<Deck<PersonCard>>(createDeck<PersonCard>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'grid'>('cards');
  const [filterOpen, setFilterOpen] = useState(false);
  const [match, setMatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deckRef = useRef(deck); deckRef.current = deck;
  const fetching = useRef(false);

  const load = useCallback(async (reset: boolean) => {
    if (!current || fetching.current) return;
    fetching.current = true;
    if (reset) setLoading(true);
    try {
      // Swiped people drop out of the server's results, so the next page starts after the cards still waiting in the queue.
      const cards = await discoverPeople(current, filters, reset ? 0 : deckRef.current.queue.length, 20);
      setDeck((prev) => appendCards(reset ? createDeck<PersonCard>() : prev, cards));
      setError(null);
    } catch { setError('We could not load people. Check your connection and try again.'); }
    finally { setLoading(false); fetching.current = false; }
  }, [current, filters]);
  useEffect(() => { void load(true); }, [load]);

  const wants = useMemo(() => (current ? deck.queue.slice(0, 14).map((c) => ({ userId: c.userId, modeId: current })) : []), [deck.queue, current]);
  const photos = usePhotoUrls(wants);

  async function doSwipe(action: SwipeAction) {
    const top = deckRef.current.queue[0];
    if (!top || !current) return;
    setDeck((d) => swipe(d, action));
    try {
      if (action === 'pass') await passPerson(top.userId, current);
      else {
        const r = await sendLike(top.userId, current, action);
        if (r.matched) { setDeck((d) => markMatched(d, top.userId)); setMatch(top.displayName); }
      }
    } catch (e) {
      // "unavailable" means they left or hid in the meantime: keep moving. Anything else: put the card back.
      if ((e as { code?: string }).code !== '42501') { setDeck((d) => rewind(d).deck); setError('That did not go through. Please try again.'); }
    }
    if (needsMore(deckRef.current)) void load(false);
  }

  async function doRewind() {
    const last = deckRef.current.history[deckRef.current.history.length - 1];
    if (!last || !canRewind(deckRef.current) || !current) return;
    setBusy(true);
    try {
      if (last.action === 'pass') await undoPass(last.card.userId, current);
      else if (!(await undoLike(last.card.userId, current))) {
        setDeck((d) => markMatched(d, last.card.userId));
        setError('That turned into a match, so it cannot be undone.');
        return;
      }
      setDeck((d) => rewind(d).deck);
    } catch { setError('Could not rewind. Please try again.'); }
    finally { setBusy(false); }
  }

  const open = (c: PersonCard) => router.push({ pathname: '/person/[id]', params: { id: c.userId, mode: current } } as never);
  const top = deck.queue[0], second = deck.queue[1];

  if (!current) return <EmptyState title="Pick a vibe" body="Turn on a vibe in your Profile to see people." />;
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ justifyContent: 'flex-end', marginBottom: spacing.sm }}>
        <Pressable onPress={() => setView(view === 'cards' ? 'grid' : 'cards')} accessibilityRole="button" accessibilityLabel={view === 'cards' ? 'Show as grid' : 'Show as cards'} hitSlop={10} style={st.iconBtn}>
          <Ionicons name={view === 'cards' ? 'grid' : 'albums'} size={20} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => setFilterOpen(true)} accessibilityRole="button" accessibilityLabel="Filters" hitSlop={10} style={st.iconBtn}>
          <Ionicons name="options" size={20} color={colors.text} />
          {hasFilters(filters) ? <View style={st.dot} /> : null}
        </Pressable>
      </Row>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading ? <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.violet} size="large" /></View>
        : !top ? (
          <View style={{ flex: 1 }}>
            <EmptyState title="You're all caught up" body={hasFilters(filters) ? 'Nobody matches these filters right now. Try widening them.' : 'Check back soon. New people and plans appear all the time.'} />
            <Button kind="secondary" label="Refresh" onPress={() => void load(true)} />
          </View>
        ) : view === 'cards' ? (
          <>
            <View style={{ flex: 1 }}>
              {second ? <View style={[StyleSheet.absoluteFill, { transform: [{ scale: 0.95 }], opacity: 0.6 }]}><PersonCardView card={second} mode={current} photo={photos[second.userId]?.[0]} /></View> : null}
              <SwipeCard key={top.userId} onSwipe={(a) => void doSwipe(a)} onTap={() => open(top)}>
                <PersonCardView card={top} mode={current} photo={photos[top.userId]?.[0]} />
              </SwipeCard>
            </View>
            <ActionBar onRewind={() => void doRewind()} canRewind={canRewind(deck)} busy={busy} onPass={() => void doSwipe('pass')} onLike={() => void doSwipe('like')} onSpark={() => void doSwipe('spark')} />
          </>
        ) : (
          <FlatList data={deck.queue} keyExtractor={(c: PersonCard) => c.userId} numColumns={2} columnWrapperStyle={{ gap: 10 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
            onEndReached={() => void load(false)} onEndReachedThreshold={0.6}
            renderItem={({ item }: { item: PersonCard }) => (
              <Pressable onPress={() => open(item)} style={st.gridItem} accessibilityRole="button" accessibilityLabel={`${item.displayName}, ${item.age}`}>
                {photos[item.userId]?.[0] ? <Image source={{ uri: photos[item.userId]![0] }} style={StyleSheet.absoluteFill} /> : null}
                <View style={st.gridLabel}><Text style={st.gridName}>{item.displayName}, {item.age}</Text>{item.likesYou ? <Ionicons name="heart" size={14} color={colors.pink} /> : null}</View>
              </Pressable>
            )} />
        )}
      <FilterSheet visible={filterOpen} value={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />
      <MatchModal name={match} onClose={() => setMatch(null)} />
    </View>
  );
}
const st = StyleSheet.create({
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  dot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.pink },
  gridItem: { flex: 1, aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  gridLabel: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridName: { color: colors.text, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4 },
});
