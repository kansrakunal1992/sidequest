import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, STEPS, buildSavePayload, canAdvance, firstInvalidStep, initialOnboarding, nameProblem, nextStep, onboardingReducer, prevStep, validateStep,
} from '../src/core/onboarding.ts';
import type { OnboardingState } from '../src/core/onboarding.ts';
import { decideRoute } from '../src/core/routing.ts';
import { createChunkedStorage } from '../src/core/chunked-storage.ts';
import type { KV } from '../src/core/chunked-storage.ts';
import { ApiError, createApiClient, friendlyError } from '../src/core/api-client.ts';
import { ENERGY_LABELS, MODE_TILES } from '../src/core/modes-ui.ts';
import { MODE_IDS, MODES } from '@sidequest/shared';

const now = new Date('2026-11-01T10:00:00Z');
const reduce = (s: OnboardingState, ...a: Parameters<typeof onboardingReducer>[1][]) => a.reduce(onboardingReducer, s);
const complete = (): OnboardingState => reduce(initialOnboarding,
  { type: 'set', patch: { dob: '1996-04-12', displayName: 'Aanya', gender: 'woman', city: 'Pune', lat: 18.5204, lng: 73.8567, energy: 'chill', bio: 'Food and trails' } },
  { type: 'toggleMode', mode: 'friendship' }, { type: 'toggleMode', mode: 'adventures' },
  { type: 'toggleInterest', interest: 'Food' }, { type: 'toggleInterest', interest: 'Trekking' }, { type: 'toggleInterest', interest: 'Music' },
  { type: 'addPhotos', uris: ['file:///a.jpg'] });

// ---------- onboarding ----------
test('age step: strict 18+, exact birthday, junk dates', () => {
  const at = (dob: string) => validateStep('age', { ...initialOnboarding, dob }, now);
  assert.equal(at('2008-11-01').length, 0);              // turned 18 today
  assert.match(at('2008-11-02')[0]!, /18 or over/);
  assert.match(at('2015-01-01')[0]!, /18 or over/);
  assert.equal(at('1996-04-12').length, 0);
  for (const bad of ['', '12/04/1996', '1996-02-30', '2030-01-01']) assert.ok(at(bad).length > 0, bad);
  assert.match(at('1900-01-01')[0]!, /does not look right/);
});
test('names cannot carry contact details', () => {
  assert.equal(nameProblem('Aanya'), null);
  for (const bad of ['call 98765 43210', 'me@mail.com', 'https://x', 'a', 'x'.repeat(41), 'insta www.me']) assert.ok(nameProblem(bad), bad);
});
test('modes toggle; interests are de-duplicated, trimmed, capped', () => {
  let s = reduce(initialOnboarding, { type: 'toggleMode', mode: 'hookups' }, { type: 'toggleMode', mode: 'friendship' }, { type: 'toggleMode', mode: 'hookups' });
  assert.deepEqual(s.modes, ['friendship']);
  s = reduce(initialOnboarding, { type: 'toggleInterest', interest: '  food ' }, { type: 'toggleInterest', interest: 'FOOD' });
  assert.deepEqual(s.interests, []);                      // second tap un-selects, case-insensitively
  s = reduce(initialOnboarding, ...Array.from({ length: 15 }, (_, i) => ({ type: 'toggleInterest', interest: `i${i}` }) as const));
  assert.equal(s.interests.length, LIMITS.interestsMax);
  assert.equal(reduce(initialOnboarding, { type: 'toggleInterest', interest: '   ' }).interests.length, 0);
});
test('photos: unique, capped, removable', () => {
  let s = reduce(initialOnboarding, { type: 'addPhotos', uris: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.equal(s.photos.length, LIMITS.photosMax);
  s = reduce(s, { type: 'removePhoto', index: 0 }); assert.equal(s.photos.length, LIMITS.photosMax - 1); assert.equal(s.photos[0]!.uri, 'b');
});
test('step gating, order and first invalid step', () => {
  assert.equal(firstInvalidStep(initialOnboarding, now), 'age');
  assert.equal(firstInvalidStep(complete(), now), null);
  assert.equal(canAdvance('energy', initialOnboarding, now), true);          // optional step
  assert.ok(validateStep('vibe', initialOnboarding, now).length > 0);
  assert.ok(validateStep('interests', reduce(complete(), { type: 'set', patch: { bio: 'x'.repeat(601) } }), now).length > 0);
  assert.ok(validateStep('preferences', reduce(complete(), { type: 'set', patch: { ageMin: 17 } }), now).length > 0);
  assert.ok(validateStep('preferences', reduce(complete(), { type: 'set', patch: { ageMin: 40, ageMax: 30 } }), now).length > 0);
  assert.ok(validateStep('preferences', reduce(complete(), { type: 'set', patch: { maxDistanceKm: 0 } }), now).length > 0);
  assert.equal(nextStep('age'), 'basics'); assert.equal(prevStep('age'), null); assert.equal(nextStep(STEPS[STEPS.length - 1]!), null);
});
test('save payload matches the database function contract', () => {
  const s = reduce(complete(), { type: 'toggleSeeking', gender: 'woman' }, { type: 'set', patch: { incognito: true, discoverable: false, ageMin: 25, ageMax: 40, maxDistanceKm: 10 } });
  const p = buildSavePayload(s, 'Asia/Kolkata', now);
  assert.equal(p.date_of_birth, '1996-04-12'); assert.equal(p.display_name, 'Aanya'); assert.equal(p.timezone, 'Asia/Kolkata');
  assert.equal(p.incognito, true); assert.equal(p.bio, 'Food and trails'); assert.equal(p.neighborhood, null);
  assert.deepEqual(p.lifestyle, { energy_tonight: 'chill', energy_set_at: now.toISOString() });
  assert.equal(p.modes.length, 2);
  assert.deepEqual(p.modes[0], { mode_id: 'friendship', discoverable: false, appear_in_visitor_lists: true, seeking_genders: ['woman'], age_min: 25, age_max: 40, max_distance_km: 10 });
  assert.throws(() => buildSavePayload(initialOnboarding, 'UTC', now), /incomplete at step "age"/);
  assert.throws(() => buildSavePayload({ ...complete(), dob: '2015-01-01' }, 'UTC', now), /incomplete/);
  assert.deepEqual(buildSavePayload({ ...complete(), energy: null }, 'UTC', now).lifestyle, {});
});

// ---------- routing ----------
test('routing: every state lands somewhere sensible', () => {
  const r = decideRoute;
  assert.equal(r({ sessionLoaded: false, signedIn: false, profile: undefined }), 'loading');
  assert.equal(r({ sessionLoaded: true, signedIn: false, profile: undefined }), '/(auth)/welcome');
  assert.equal(r({ sessionLoaded: true, signedIn: true, profile: undefined }), 'loading');
  assert.equal(r({ sessionLoaded: true, signedIn: true, profile: null }), '/(onboarding)/age');
  assert.equal(r({ sessionLoaded: true, signedIn: true, profile: { onboardingComplete: false, state: 'active' } }), '/(onboarding)/age');
  assert.equal(r({ sessionLoaded: true, signedIn: true, profile: { onboardingComplete: true, state: 'active' } }), '/(tabs)/discover');
  for (const state of ['suspended', 'banned', 'deleted']) assert.equal(r({ sessionLoaded: true, signedIn: true, profile: { onboardingComplete: true, state } }), '/account-restricted');
});

// ---------- chunked secure storage ----------
function fakeKv(): KV & { data: Map<string, string>; maxLen: number } {
  const data = new Map<string, string>(); const o = { data, maxLen: 0,
    async getItem(k: string) { return data.get(k) ?? null; },
    async setItem(k: string, v: string) { if (v.length > 2048) throw new Error('value too large'); o.maxLen = Math.max(o.maxLen, v.length); data.set(k, v); },
    async removeItem(k: string) { data.delete(k); } };
  return o;
}
test('chunked storage: large values round-trip within the per-value limit', async () => {
  const kv = fakeKv(); const s = createChunkedStorage(kv);
  const big = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r'.repeat(900), user: { id: 'u', note: 'é'.repeat(500) } });
  await s.setItem('sb-auth-token', big);
  assert.equal(await s.getItem('sb-auth-token'), big);
  assert.ok(kv.maxLen <= 1800);
  assert.equal(await s.getItem('missing'), null);
});
test('chunked storage: overwrite cleans old chunks; remove clears everything; damage reads as no session', async () => {
  const kv = fakeKv(); const s = createChunkedStorage(kv, 10);
  await s.setItem('k', 'x'.repeat(95)); const first = kv.data.size;
  await s.setItem('k', 'short'); assert.ok(kv.data.size < first); assert.equal(await s.getItem('k'), 'short');
  await s.setItem('k', 'y'.repeat(50)); kv.data.delete('k.2');
  assert.equal(await s.getItem('k'), null);
  await s.removeItem('k'); assert.equal(kv.data.size, 0);
  kv.data.set('k.n', 'garbage'); assert.equal(await s.getItem('k'), null);
});

// ---------- API client ----------
const fakeFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => (async (u: string, i: RequestInit) => handler(u, i)) as unknown as typeof fetch;
test('api client: sends bearer token and JSON, unwraps responses', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const api = createApiClient({ baseUrl: 'https://api.example/', getToken: async () => 'TOKEN',
    fetchFn: fakeFetch((url, init) => { seen = { url, init }; return new Response(JSON.stringify({ invite: { id: 'i1', state: 'pending' } }), { status: 201 }); }) });
  const inv = await api.createInvite({ recipientId: 'r', modeId: 'friendship', format: 'text', startsAt: '2026-11-02T10:00:00Z', timezone: 'UTC', durationMinutes: 15 });
  assert.equal(inv.id, 'i1');
  assert.equal(seen!.url, 'https://api.example/v1/invites');
  assert.equal((seen!.init.headers as any).authorization, 'Bearer TOKEN');
  assert.equal(JSON.parse(seen!.init.body as string).modeId, 'friendship');
  await api.tooNew('i1'); assert.equal(seen!.url, 'https://api.example/v1/invites/i1/too-new');
});
test('api client: typed errors, offline handling, no token', async () => {
  const mk = (f: typeof fetch, token: string | null = 'T') => createApiClient({ baseUrl: 'https://a', getToken: async () => token, fetchFn: f });
  await assert.rejects(mk(fakeFetch(() => new Response(JSON.stringify({ error: 'needs_match' }), { status: 403 }))).getInvite('x'),
    (e: any) => e instanceof ApiError && e.status === 403 && e.code === 'needs_match');
  await assert.rejects(mk(fakeFetch(() => new Response('<html>', { status: 502 }))).getInvite('x'), (e: any) => e.code === 'request_failed');
  await assert.rejects(mk((async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch).getInvite('x'), (e: any) => e.code === 'network_error' && e.status === 0);
  await assert.rejects(mk(fakeFetch(() => new Response('{}')), null).getInvite('x'), (e: any) => e.status === 401);
  assert.equal(await mk(fakeFetch(() => new Response('BEGIN:VCALENDAR', { status: 200 }))).downloadIcs('x'), 'BEGIN:VCALENDAR');
});
test('friendly errors never blame the person and never reveal blocks', () => {
  assert.match(friendlyError(new ApiError(404, 'unavailable')), /not available/);
  assert.match(friendlyError(new ApiError(0, 'network_error')), /connection/);
  assert.match(friendlyError(new Error('boom')), /Something went wrong/);
  for (const m of ['unavailable', 'needs_match', 'pending_exists', 'non_match_limit']) assert.doesNotMatch(friendlyError(new ApiError(400, m)), /block|reject|ban|spam/i);
});

// ---------- brand tiles ----------
test('mode tiles cover every mode exactly once, in the brand order', () => {
  assert.deepEqual([...MODE_TILES.map((t) => t.id)].sort(), [...MODE_IDS].sort());
  assert.deepEqual(MODE_TILES.map((t) => MODES[t.id].label), ['Dating', 'Hookups', 'Friendship', 'Adventures', 'Post-Marital', 'Experiment']);
  assert.equal(Object.keys(ENERGY_LABELS).length, 4);
});
