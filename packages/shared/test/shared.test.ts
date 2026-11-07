import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn, isAdult, canStartContact, mutuallyEligible, explainCompatibility,
  transitionInvite, lightweightChatAllowed, generateIcs, foldLine, evaluateInviteRate,
  visibleVisitors, coupleDiscoverable, wingCan, assembleRouletteGroups, MODES, MODE_IDS,
} from '../src/index.ts';
import type { Person, ModePresence, InviteContext, InviteState, RouletteSignup } from '../src/index.ts';

// ---------- age ----------
test('age gate: exact 18th birthday boundary', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  assert.equal(isAdult('2008-10-31', now), true);
  assert.equal(isAdult('2008-11-01', now), false);
  assert.equal(ageOn('2000-01-01', now), 26);
});
test('age gate: leap-day birthday is conservative in non-leap years', () => {
  assert.equal(isAdult('2008-02-29', new Date('2026-02-28T00:00:00Z')), false);
  assert.equal(isAdult('2008-02-29', new Date('2026-03-01T00:00:00Z')), true);
  assert.equal(isAdult('2008-02-29', new Date('2028-02-29T00:00:00Z')), true);
});
test('age gate: invalid input is never adult', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  for (const bad of ['', 'abc', '2008-02-30', '2030-01-01', '31-10-2000']) assert.equal(isAdult(bad, now), false);
});

// ---------- contact rules ----------
const base = { mode: 'serious_dating', kind: 'free_chat', matched: false, blocked: false,
  senderActiveInMode: true, recipientActiveInMode: true, recipientAcceptsIntros: true } as const;
test('six modes configured, friendship/adventures are non-romantic', () => {
  assert.equal(MODE_IDS.length, 6);
  assert.equal(MODES.friendship.contact.romanticAllowed, false);
  assert.equal(MODES.adventures.contact.romanticAllowed, false);
});
test('free chat needs a match except in adventures', () => {
  assert.deepEqual(canStartContact(base), { allowed: false, reason: 'needs_match' });
  assert.equal(canStartContact({ ...base, matched: true }).allowed, true);
  assert.equal(canStartContact({ ...base, mode: 'adventures' }).allowed, true);
});
test('intro invites: recipient control and experimentation needs mutual interest', () => {
  assert.equal(canStartContact({ ...base, kind: 'intro_invite' }).allowed, true);
  assert.equal(canStartContact({ ...base, kind: 'intro_invite', recipientAcceptsIntros: false }).allowed, false);
  assert.deepEqual(canStartContact({ ...base, mode: 'experimentation', kind: 'intro_invite' }),
    { allowed: false, reason: 'needs_match' });
});
test('blocks and mode mismatch always win, with a generic reason', () => {
  assert.deepEqual(canStartContact({ ...base, kind: 'activity_join', blocked: true }), { allowed: false, reason: 'unavailable' });
  assert.deepEqual(canStartContact({ ...base, kind: 'activity_join', recipientActiveInMode: false }), { allowed: false, reason: 'not_in_mode' });
});

// ---------- eligibility ----------
const presence = (o: Partial<ModePresence> = {}): ModePresence => ({
  active: true, paused: false, discoverable: true, availability: 'open_to_chat',
  seekingGenders: [], ageMin: 21, ageMax: 40, maxDistanceKm: 25, ...o });
const person = (id: string, o: Partial<Person> = {}): Person => ({
  userId: id, age: 28, gender: 'f', interests: ['Food', 'Trekking'],
  modes: { serious_dating: presence() }, ...o });

test('eligibility: needs same mode live on both sides', () => {
  const a = person('a'), b = person('b');
  assert.equal(mutuallyEligible(a, b, 'serious_dating', 3).eligible, true);
  assert.equal(mutuallyEligible(a, b, 'hookups', 3).eligible, false);
  const paused = person('c', { modes: { serious_dating: presence({ paused: true }) } });
  assert.equal(mutuallyEligible(a, paused, 'serious_dating', 3).eligible, false);
  const hidden = person('d', { modes: { serious_dating: presence({ discoverable: false }) } });
  assert.equal(mutuallyEligible(a, hidden, 'serious_dating', 3).eligible, false);
});
test('eligibility: preferences must hold in both directions', () => {
  const a = person('a', { modes: { serious_dating: presence({ seekingGenders: ['m'] }) } });
  const b = person('b', { gender: 'm' });
  assert.equal(mutuallyEligible(a, b, 'serious_dating', 3).eligible, true);
  const c = person('c', { gender: 'm', modes: { serious_dating: presence({ seekingGenders: ['m'] }) } });
  assert.deepEqual(mutuallyEligible(a, c, 'serious_dating', 3), { eligible: false, reason: 'gender_preference' });
  assert.deepEqual(mutuallyEligible(a, person('e', { age: 50, gender: 'm' }), 'serious_dating', 3), { eligible: false, reason: 'age_preference' });
  assert.deepEqual(mutuallyEligible(a, b, 'serious_dating', 40), { eligible: false, reason: 'distance' });
  const away = person('f', { modes: { serious_dating: presence({ availability: 'taking_a_break' }) } });
  assert.equal(mutuallyEligible(a, away, 'serious_dating', 3).eligible, false);
});
test('explanations are human language', () => {
  const r = explainCompatibility(person('a'), person('b'), 'serious_dating', 0.4);
  assert.ok(r.reasons.includes('You both enjoy Food, Trekking'));
  assert.ok(r.reasons.includes('Very close by'));
});

// ---------- invite state machine ----------
const ctx = (state: InviteState, proposedBy: 'sender' | 'recipient' | null = null, nowOffsetMin = -60): InviteContext => ({
  state, proposedBy, startsAt: new Date('2026-11-01T10:00:00Z'),
  now: new Date(new Date('2026-11-01T10:00:00Z').getTime() + nowOffsetMin * 60_000) });

test('invite: recipient options from pending', () => {
  assert.deepEqual(transitionInvite(ctx('pending'), 'accept', 'recipient'), { ok: true, state: 'accepted', proposedBy: null });
  assert.equal((transitionInvite(ctx('pending'), 'decline', 'recipient') as any).state, 'declined');
  assert.equal((transitionInvite(ctx('pending'), 'mark_too_new', 'recipient') as any).state, 'too_new');
  const r = transitionInvite(ctx('pending'), 'request_reschedule', 'recipient');
  assert.deepEqual(r, { ok: true, state: 'reschedule_requested', proposedBy: 'recipient' });
});
test('invite: sender cannot accept, decline or mark too-new their own invite', () => {
  for (const e of ['accept', 'decline', 'mark_too_new'] as const) {
    assert.equal(transitionInvite(ctx('pending'), e, 'sender').ok, false);
  }
  assert.equal(transitionInvite(ctx('pending'), 'cancel', 'sender').ok, true);
  assert.equal(transitionInvite(ctx('pending'), 'cancel', 'recipient').ok, false);
});
test('reschedule: only the other party responds; counter-proposal flips proposer', () => {
  const c = ctx('reschedule_requested', 'recipient');
  assert.equal(transitionInvite(c, 'accept_reschedule', 'recipient').ok, false);
  assert.equal((transitionInvite(c, 'accept_reschedule', 'sender') as any).state, 'rescheduled');
  assert.deepEqual(transitionInvite(c, 'request_reschedule', 'sender'), { ok: true, state: 'reschedule_requested', proposedBy: 'sender' });
  assert.equal(transitionInvite(c, 'cancel', 'recipient').ok, true);
});
test('too new: sender cannot push; recipient can return later with a proposal', () => {
  const c = ctx('too_new');
  assert.equal(transitionInvite(c, 'accept', 'sender').ok, false);
  assert.equal(transitionInvite(c, 'request_reschedule', 'sender').ok, false);
  assert.deepEqual(transitionInvite(c, 'request_reschedule', 'recipient'), { ok: true, state: 'reschedule_requested', proposedBy: 'recipient' });
  assert.equal(transitionInvite(c, 'expire', 'system').ok, false);
  assert.equal(lightweightChatAllowed('too_new', true), true);
  assert.equal(lightweightChatAllowed('too_new', false), false);
  assert.equal(lightweightChatAllowed('pending', true), false);
});
test('confirmed meetings: either can cancel or reschedule; complete only after start', () => {
  for (const s of ['accepted', 'rescheduled'] as const) {
    assert.equal(transitionInvite(ctx(s), 'cancel', 'sender').ok, true);
    assert.equal(transitionInvite(ctx(s), 'cancel', 'recipient').ok, true);
    assert.equal(transitionInvite(ctx(s), 'complete', 'sender').ok, false); // before start
    assert.equal(transitionInvite(ctx(s, null, 30), 'complete', 'recipient').ok, true);
  }
});
test('terminal states are final; only the system expires pending ones', () => {
  for (const s of ['declined', 'cancelled', 'completed', 'expired'] as const) {
    assert.equal(transitionInvite(ctx(s), 'accept', 'recipient').ok, false);
  }
  assert.equal((transitionInvite(ctx('pending'), 'expire', 'system') as any).state, 'expired');
  assert.equal(transitionInvite(ctx('pending'), 'expire', 'recipient').ok, false);
  assert.equal(transitionInvite(ctx('accepted'), 'expire', 'system').ok, false);
});

// ---------- ICS ----------
test('ics: valid structure, UTC times, escaping, folding, no contact details', () => {
  const ics = generateIcs({ uid: 'inv-1@sidequest', title: 'Virtual coffee; hi, there', description: 'Line1\nLine2',
    startsAt: new Date('2026-11-01T14:30:00Z'), durationMinutes: 20, sequence: 2, now: new Date('2026-10-31T00:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART:20261101T143000Z\r\n'));
  assert.ok(ics.includes('DTEND:20261101T145000Z\r\n'));
  assert.ok(ics.includes('SUMMARY:Virtual coffee\\; hi\\, there\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Line1\\nLine2\r\n'));
  assert.ok(ics.includes('SEQUENCE:2\r\n'));
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.ok(!/ORGANIZER|ATTENDEE|mailto:/i.test(ics));
});
test('ics: cancellation and folding', () => {
  const c = generateIcs({ uid: 'x', title: 'T', startsAt: new Date('2026-11-01T14:30:00Z'), durationMinutes: 30, status: 'CANCELLED' });
  assert.ok(c.includes('METHOD:CANCEL') && c.includes('STATUS:CANCELLED') && !c.includes('VALARM'));
  const long = foldLine('DESCRIPTION:' + 'é'.repeat(100));
  const enc = new TextEncoder();
  for (const l of long.split('\r\n')) assert.ok(enc.encode(l).length <= 75);
  assert.equal(long.replace(/\r\n /g, ''), 'DESCRIPTION:' + 'é'.repeat(100));
  assert.throws(() => generateIcs({ uid: 'x', title: 'T', startsAt: new Date('nope'), durationMinutes: 5 }));
});

// ---------- rate limits ----------
test('invite rate limits', () => {
  const ok = { sentLast24h: 0, sentToNonMatchesLast24h: 0, pendingToRecipient: 0, isMatch: false };
  assert.equal(evaluateInviteRate(ok).allowed, true);
  assert.deepEqual(evaluateInviteRate({ ...ok, pendingToRecipient: 1 }), { allowed: false, reason: 'pending_exists' });
  assert.deepEqual(evaluateInviteRate({ ...ok, sentToNonMatchesLast24h: 10 }), { allowed: false, reason: 'non_match_limit' });
  assert.equal(evaluateInviteRate({ ...ok, sentToNonMatchesLast24h: 10, isMatch: true }).allowed, true);
  assert.deepEqual(evaluateInviteRate({ ...ok, sentLast24h: 30, isMatch: true }), { allowed: false, reason: 'daily_limit' });
});

// ---------- privacy ----------
test('visitors: incognito hidden, modes separated, latest visit wins', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 9, 31, 12, m));
  const v = [
    { viewerId: 'x', visitedId: 'me', mode: 'serious_dating', at: t(1), incognito: false },
    { viewerId: 'x', visitedId: 'me', mode: 'serious_dating', at: t(5), incognito: false },
    { viewerId: 'y', visitedId: 'me', mode: 'serious_dating', at: t(3), incognito: true },
    { viewerId: 'z', visitedId: 'me', mode: 'hookups', at: t(4), incognito: false },
    { viewerId: 'w', visitedId: 'someone-else', mode: 'serious_dating', at: t(4), incognito: false },
  ] as const;
  const out = visibleVisitors([...v], 'me', 'serious_dating');
  assert.deepEqual(out.map((o) => o.viewerId), ['x']);
  assert.deepEqual(out[0]!.at, t(5));
});
test('couples: both partners must consent to everything; withdrawal or pause removes discovery', () => {
  const full = { linkAccounts: true, sharedProfile: true, coupleDiscovery: true, withdrawn: false };
  const link = { a: full, b: full, paused: false, unlinked: false };
  assert.equal(coupleDiscoverable(link), true);
  assert.equal(coupleDiscoverable({ ...link, b: { ...full, coupleDiscovery: false } }), false);
  assert.equal(coupleDiscoverable({ ...link, a: { ...full, withdrawn: true } }), false);
  assert.equal(coupleDiscoverable({ ...link, paused: true }), false);
  assert.equal(coupleDiscoverable({ ...link, unlinked: true }), false);
});
test('wingperson: scoped, revocable, never chats', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const g = { permissions: ['suggest_openers', 'shortlist'] as const, revokedAt: null, expiresAt: null };
  const grant = { ...g, permissions: [...g.permissions] };
  assert.equal(wingCan(grant, 'suggest_openers', now), true);
  assert.equal(wingCan(grant, 'co_host_open_call', now), false);
  assert.equal(wingCan(grant, 'read_chats', now), false);
  const all = { permissions: ['suggest_openers' as const], revokedAt: null, expiresAt: null };
  assert.equal(wingCan(all, 'send_message_as_owner', now), false);
  assert.equal(wingCan({ ...grant, revokedAt: new Date('2026-10-30T00:00:00Z') }, 'shortlist', now), false);
  assert.equal(wingCan({ ...grant, expiresAt: new Date('2026-10-30T00:00:00Z') }, 'shortlist', now), false);
});

// ---------- roulette ----------
const sig = (userId: string, o: Partial<RouletteSignup> = {}): RouletteSignup => ({
  userId, mode: 'friendship', activity: 'dinner', slot: 'sat-8pm', energy: 'social', groupSize: 4, blockedUserIds: [], ...o });
test('roulette: forms full groups, waitlists leftovers, separates different buckets', () => {
  const r = assembleRouletteGroups([sig('1'), sig('2'), sig('3'), sig('4'), sig('5'), sig('6', { activity: 'bowling' })]);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0]!.memberIds, ['1', '2', '3', '4']);
  assert.deepEqual(r.waitlist.sort(), ['5', '6']);
});
test('roulette: never seats blocked pairs together (either direction)', () => {
  const r = assembleRouletteGroups([sig('1', { blockedUserIds: ['2'] }), sig('2'), sig('3'), sig('4'), sig('5', { blockedUserIds: ['1'] }), sig('6')]);
  for (const g of r.groups) {
    assert.ok(!(g.memberIds.includes('1') && g.memberIds.includes('2')));
    assert.ok(!(g.memberIds.includes('1') && g.memberIds.includes('5')));
  }
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0]!.memberIds.length, 4);
});
test('roulette: duplicate signups are ignored', () => {
  const r = assembleRouletteGroups([sig('1', { groupSize: 2 }), sig('1', { groupSize: 2 }), sig('2', { groupSize: 2 })]);
  assert.deepEqual(r.groups[0]!.memberIds, ['1', '2']);
});
