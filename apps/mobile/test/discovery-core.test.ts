import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCards, canRewind, createDeck, markMatched, needsMore, rewind, swipe } from '../src/core/swipe.ts';
import { availabilityLabel, cardReasons, distanceLabel } from '../src/core/reasons.ts';
import { PROMPT_QUESTIONS, cleanPrompts, validateModeText } from '../src/core/prompts.ts';
import { mapCard, mapLike, mapMatch, mapProfile, mapSummary, mapVisitor } from '../src/core/mappers.ts';
import { timeAgo } from '../src/core/time.ts';
import { allowedSegments } from '../src/core/routing.ts';
import { createApiClient } from '../src/core/api-client.ts';

const c = (id: string) => ({ userId: id });

// ---------- swipe deck ----------
test('deck: de-duplicates against queue and history, preserves order', () => {
  let d = createDeck([c('a'), c('b'), c('a')]);
  assert.deepEqual(d.queue.map((x) => x.userId), ['a', 'b']);
  d = swipe(d, 'pass');
  d = appendCards(d, [c('a'), c('b'), c('z')]);                         // a was swiped, b is queued
  assert.deepEqual(d.queue.map((x) => x.userId), ['b', 'z']);
});
test('deck: swiping moves the top card to history; empty deck is a no-op', () => {
  let d = createDeck([c('a')]);
  d = swipe(d, 'like'); assert.equal(d.queue.length, 0); assert.equal(d.history[0]!.action, 'like');
  assert.equal(swipe(d, 'pass'), d);
});
test('deck: rewind restores the card at the front and reports what to undo', () => {
  let d = createDeck([c('a'), c('b'), c('c')]);
  d = swipe(d, 'pass'); d = swipe(d, 'spark');
  const r = rewind(d);
  assert.deepEqual(r.undo, { userId: 'b', action: 'spark' });
  assert.deepEqual(r.deck.queue.map((x) => x.userId), ['b', 'c']);
  assert.equal(r.deck.history.length, 1);
});
test('deck: a match cannot be rewound; rewinding nothing is safe', () => {
  let d = createDeck([c('a'), c('b')]);
  assert.equal(canRewind(d), false); assert.equal(rewind(d).undo, null);
  d = swipe(d, 'like', true);
  assert.equal(canRewind(d), false); assert.equal(rewind(d).deck, d);
  d = swipe(d, 'pass');
  assert.equal(canRewind(d), true);
});
test('deck: asks for more cards when running low', () => {
  assert.equal(needsMore(createDeck(Array.from({ length: 6 }, (_, i) => c(`u${i}`)))), false);
  assert.equal(needsMore(createDeck(Array.from({ length: 5 }, (_, i) => c(`u${i}`)))), true);
});

// ---------- reasons ----------
test('reasons: human language, likes-you first, no scores', () => {
  const r = cardReasons({ sharedInterests: ['Food', 'Trekking', 'Music', 'Chess'], distanceKm: 3.4, availability: 'available_tonight', likesYou: true, modeLabel: 'Friendship' });
  assert.deepEqual(r, ['Likes you. Like them back to match', 'You both enjoy Food, Trekking, Music', "You're both open to Friendship", 'Available tonight', '3 km away']);
  assert.ok(!r.some((x) => /\d+\s*%|score|match(ed)? with/i.test(x)));
  const lean = cardReasons({ sharedInterests: [], distanceKm: null, availability: 'taking_a_break', likesYou: false, modeLabel: 'Dating' });
  assert.deepEqual(lean, ["You're both open to Dating"]);
  assert.equal(distanceLabel(0.4), 'Less than 1 km away'); assert.equal(availabilityLabel('virtual_coffee'), 'Up for a virtual coffee'); assert.equal(availabilityLabel('x'), null);
});

// ---------- prompts ----------
test('prompts: limits, duplicates, unknown questions, blank answers', () => {
  const q0 = PROMPT_QUESTIONS[0], q1 = PROMPT_QUESTIONS[1];
  assert.deepEqual(validateModeText({ headline: 'hi', bio: 'x', prompts: [{ q: q0, a: 'a' }, { q: q1, a: 'b' }] }), []);
  assert.ok(validateModeText({ headline: 'x'.repeat(121), bio: '', prompts: [] })[0]!.includes('headline'));
  assert.ok(validateModeText({ headline: '', bio: 'x'.repeat(601), prompts: [] })[0]!.includes('intro'));
  assert.ok(validateModeText({ headline: '', bio: '', prompts: PROMPT_QUESTIONS.slice(0, 4).map((q) => ({ q, a: 'a' })) }).some((m) => m.includes('at most 3')));
  assert.ok(validateModeText({ headline: '', bio: '', prompts: [{ q: q0, a: 'a' }, { q: q0, a: 'b' }] }).some((m) => m.includes('once')));
  assert.ok(validateModeText({ headline: '', bio: '', prompts: [{ q: 'Made up?', a: 'a' }] }).includes('Unknown prompt.'));
  assert.ok(validateModeText({ headline: '', bio: '', prompts: [{ q: q0, a: '  ' }] }).some((m) => m.includes('answer')));
  assert.ok(validateModeText({ headline: '', bio: '', prompts: [{ q: q0, a: 'x'.repeat(201) }] }).some((m) => m.includes('200')));
  assert.deepEqual(cleanPrompts([{ q: q0, a: '  hi  ' }, { q: q1, a: '   ' }]), [{ q: q0, a: 'hi' }]);
});

// ---------- mappers ----------
test('mappers: database rows become app types, tolerating nulls and bad shapes', () => {
  const card = mapCard({ user_id: 'u', display_name: 'Rohan', age: '27', headline: null, area: 'Koregaon Park', distance_km: '2.5', availability: 'open_to_chat', shared_interests: ['Food'], verified: true, likes_you: false });
  assert.deepEqual([card.age, card.distanceKm, card.headline, card.sharedInterests, card.verified], [27, 2.5, null, ['Food'], true]);
  assert.equal(mapCard({ user_id: 'u', display_name: 'x', age: 20, availability: 'a', distance_km: null, shared_interests: null }).distanceKm, null);
  assert.equal(mapLike({ user_id: 'u', display_name: 'x', age: 3, kind: 'spark', liked_at: '2026-11-01T10:00:00Z', i_liked_back: true }).likedAt.toISOString(), '2026-11-01T10:00:00.000Z');
  const v = mapVisitor({ user_id: 'u', display_name: 'x', age: 3, last_visit_at: '2026-11-01T10:00:00Z', visits: '3', looked_at_photos: true });
  assert.deepEqual([v.visits, v.lookedAtPhotos, v.lookedAtPrompts, v.theyLikedYou], [3, true, false, false]);
  assert.equal(mapMatch({ match_id: 'm', user_id: 'u', display_name: 'x', age: 3, matched_at: '2026-11-01T10:00:00Z' }).conversationId, null);
  assert.deepEqual(mapSummary(null), { likes: 0, matches: 0, visitors: 0 });
  assert.deepEqual(mapSummary({ likes: '4', matches: 2, visitors: 9 }), { likes: 4, matches: 2, visitors: 9 });
  const p = mapProfile({ user_id: 'u', display_name: 'x', age: 30, prompts: [{ q: 'q', a: 'a' }, { q: 1 }, null], interests: 'oops' });
  assert.deepEqual(p.prompts, [{ q: 'q', a: 'a' }]); assert.deepEqual(p.interests, []);
});

// ---------- time and routing ----------
test('timeAgo', () => {
  const now = new Date('2026-11-10T12:00:00Z'); const ago = (s: number) => new Date(now.getTime() - s * 1000);
  assert.deepEqual([10, 300, 3 * 3600, 2 * 86400, 14 * 86400].map((s) => timeAgo(ago(s), now)), ['just now', '5m ago', '3h ago', '2d ago', '2w ago']);
  assert.equal(timeAgo(ago(60 * 86400), now), '2026-09-11');
  assert.equal(timeAgo(new Date(now.getTime() + 5000), now), 'just now');
});
test('routing: detail screens are allowed for signed-in people, but never for signed-out ones', () => {
  assert.ok(allowedSegments('/(tabs)/discover').includes('person'));
  assert.ok(allowedSegments('/(tabs)/discover').includes('likes'));
  assert.deepEqual(allowedSegments('/(auth)/welcome'), ['(auth)']);
  assert.ok(!allowedSegments('/(onboarding)/age').includes('person'));
});

// ---------- API client: photo urls ----------
test('api client: photoUrls posts the batch', async () => {
  let body: any = null;
  const api = createApiClient({ baseUrl: 'https://a', getToken: async () => 't', fetchFn: (async (_u: string, i: RequestInit) => { body = JSON.parse(i.body as string); return new Response(JSON.stringify({ results: [{ userId: 'u', modeId: 'm', urls: ['x'] }], expiresInSeconds: 600 })); }) as unknown as typeof fetch });
  const r = await api.photoUrls([{ userId: 'u', modeId: 'm', all: true }]);
  assert.equal(r.results[0]!.urls[0], 'x'); assert.deepEqual(body.items, [{ userId: 'u', modeId: 'm', all: true }]);
});

test('deck: a like that later proves mutual is locked against rewind', () => {
  let d = createDeck([c('a'), c('b')]);
  d = swipe(d, 'like'); assert.equal(canRewind(d), true);
  d = markMatched(d, 'a'); assert.equal(canRewind(d), false);
  assert.equal(markMatched(d, 'nobody').history.length, 1);
});
