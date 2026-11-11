import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, availableActions, buildInvitePayload, formatWhen, myParty, otherId, parseLocalDateTime, quickSlots, stateSummary } from '../src/core/invite-ui.ts';
import { chatErrorMessage, conversationStarters, mergeMessages, previewText, receiptLabel, sendGate } from '../src/core/chat-core.ts';
import type { ChatMessage } from '../src/core/chat-core.ts';
import { dayLabel, splitCalendar } from '../src/core/calendar-core.ts';
import type { CalendarItem } from '../src/core/calendar-core.ts';
import { mapCalendar, mapConversation, mapConversationInfo, mapMessage } from '../src/core/mappers.ts';
import { friendlyError, ApiError } from '../src/core/api-client.ts';
import { transitionInvite, INVITE_STATES } from '@sidequest/shared';

const ME = 'me', YOU = 'you';
const now = new Date(2026, 10, 1, 10, 0, 0);        // local time, so the tests do not depend on the machine's time zone
const inv = (o: Partial<Parameters<typeof availableActions>[0]> = {}) => ({ id: 'i', senderId: YOU, recipientId: ME, modeId: 'friendship', format: 'text' as const, state: 'pending', proposedBy: null,
  startsAt: new Date(now.getTime() + 3 * 3600_000).toISOString(), timezone: 'UTC', durationMinutes: 20, note: null, expiresAt: '', conversationId: null, createdAt: '', ...o });

// ---------- actions come from the real state machine ----------
test('recipient of a pending invite sees exactly the four spec options, in order', () => {
  assert.deepEqual(availableActions(inv(), ME, now), ['accept', 'reschedule', 'decline', 'too_new']);
});
test('sender of a pending invite can only cancel', () => {
  assert.deepEqual(availableActions(inv({ senderId: ME, recipientId: YOU }), ME, now), ['cancel']);
});
test('too new: recipient can say hello later or propose a time; sender can only cancel', () => {
  assert.deepEqual(availableActions(inv({ state: 'too_new' }), ME, now), ['reschedule', 'decline', 'light_chat']);
  assert.deepEqual(availableActions(inv({ state: 'too_new', senderId: ME, recipientId: YOU }), ME, now), ['cancel']);
});
test('reschedule: only the other party can accept; both can cancel', () => {
  const proposedByThem = inv({ state: 'reschedule_requested', proposedBy: 'sender' });          // YOU proposed, I am recipient
  assert.deepEqual(availableActions(proposedByThem, ME, now), ['accept_reschedule', 'reschedule', 'decline', 'cancel']);
  const proposedByMe = inv({ state: 'reschedule_requested', proposedBy: 'recipient' });
  assert.deepEqual(availableActions(proposedByMe, ME, now), ['cancel']);
});
test('confirmed plans: reschedule and cancel; complete only after the start', () => {
  assert.deepEqual(availableActions(inv({ state: 'accepted' }), ME, now), ['reschedule', 'cancel']);
  const later = new Date(now.getTime() + 4 * 3600_000);
  assert.deepEqual(availableActions(inv({ state: 'accepted' }), ME, later), ['reschedule', 'complete', 'cancel']);
});
test('finished invites and outsiders get no actions', () => {
  for (const s of ['declined', 'cancelled', 'completed', 'expired']) assert.deepEqual(availableActions(inv({ state: s }), ME, now), []);
  assert.deepEqual(availableActions(inv(), 'stranger', now), []);
});
test('the app never offers an action the server rule would refuse (every state, both roles)', () => {
  const map = { accept: 'accept', accept_reschedule: 'accept_reschedule', reschedule: 'request_reschedule', decline: 'decline', too_new: 'mark_too_new', complete: 'complete', cancel: 'cancel' } as const;
  for (const state of INVITE_STATES) for (const proposedBy of [null, 'sender', 'recipient'] as const) for (const me of [ME, YOU]) {
    const i = inv({ state, proposedBy });
    for (const a of availableActions(i, me, new Date(now.getTime() + 5 * 3600_000))) {
      if (a === 'light_chat') continue;
      const r = transitionInvite({ state: state as never, proposedBy, startsAt: new Date(i.startsAt), now: new Date(now.getTime() + 5 * 3600_000) }, map[a], myParty(i, me)!);
      assert.equal(r.ok, true, `${state}/${proposedBy}/${me}/${a}`);
    }
  }
});
test('state wording is gentle and role-aware', () => {
  assert.equal(stateSummary(inv({ state: 'declined', senderId: ME, recipientId: YOU }), ME).label, 'Not this time');
  assert.equal(stateSummary(inv({ state: 'too_new', senderId: ME, recipientId: YOU }), ME).label, 'They would like to take it slowly');
  assert.equal(stateSummary(inv(), ME).label, 'Waiting for you');
  assert.equal(stateSummary(inv({ state: 'reschedule_requested', proposedBy: 'sender' }), YOU).label, 'You suggested a new time');
  for (const s of INVITE_STATES) assert.doesNotMatch(stateSummary(inv({ state: s, senderId: ME, recipientId: YOU }), ME).label, /reject|denied|refus|ignored|ghost/i);
  assert.equal(otherId(inv(), ME), YOU);
});

// ---------- scheduling input ----------
test('local date and time parsing rejects impossible values', () => {
  const d = parseLocalDateTime('7', '11', '2026', '19', '30')!;
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 7, 19, 30]);
  for (const bad of [['31', '2', '2026', '10', '0'], ['1', '13', '2026', '10', '0'], ['1', '1', '2026', '24', '0'], ['1', '1', '2026', '10', '60'], ['a', '1', '2026', '1', '1'], ['1', '1', '1999', '1', '1']] as const) {
    assert.equal(parseLocalDateTime(...bad), null, bad.join('/'));
  }
});
test('quick slots are in the future and sensible', () => {
  for (const base of [new Date(2026, 10, 1, 10, 0), new Date(2026, 10, 1, 21, 30), new Date(2026, 10, 6, 12, 0), new Date(2026, 10, 7, 12, 0)]) {
    const slots = quickSlots(base);
    assert.ok(slots.length >= 3);
    for (const s of slots) assert.ok(s.date.getTime() - base.getTime() >= 30 * 60_000, `${s.label} from ${base.toISOString()}`);
    assert.equal(slots.filter((s) => s.label === 'Tonight').length, base.getHours() < 19 ? 1 : 0);
  }
  assert.equal(quickSlots(new Date(2026, 10, 1, 10, 0))[0]!.date.getHours(), 20);
  assert.equal(quickSlots(new Date(2026, 10, 1, 10, 0)).find((s) => s.label === 'This Saturday')!.date.getDay(), 6);
});
test('invite payload: validation and shape', () => {
  const ok = buildInvitePayload({ recipientId: 'r', modeId: 'friendship', format: 'virtual_coffee', startsAt: new Date(now.getTime() + 3600_000), durationMinutes: 20, note: '  Coffee?  ' }, 'Asia/Kolkata', now);
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.body.note, 'Coffee?'); assert.equal(ok.body.timezone, 'Asia/Kolkata'); assert.equal(new Date(ok.body.startsAt).getTime(), now.getTime() + 3600_000); }
  const base = { recipientId: 'r', modeId: 'friendship', format: 'text' as const, startsAt: new Date(now.getTime() + 3600_000), durationMinutes: 20, note: '' };
  assert.deepEqual(buildInvitePayload({ ...base, startsAt: null }, 'UTC', now), { ok: false, error: 'Pick a day and time.' });
  assert.match((buildInvitePayload({ ...base, startsAt: new Date(now.getTime() + 60_000) }, 'UTC', now) as any).error, /10 minutes/);
  assert.match((buildInvitePayload({ ...base, startsAt: new Date(now.getTime() + 100 * 86_400_000) }, 'UTC', now) as any).error, /90 days/);
  assert.match((buildInvitePayload({ ...base, note: 'x'.repeat(281) }, 'UTC', now) as any).error, /280/);
  assert.equal('note' in (buildInvitePayload(base, 'UTC', now) as any).body, false);
  assert.equal(FORMATS.length, 6);   // includes "in_person"
});
test('formatWhen renders in the requested time zone', () => {
  const s = formatWhen('2026-11-01T14:30:00Z', 'UTC');
  assert.match(s, /Nov/); assert.match(s, /2:30/);
  assert.match(formatWhen('2026-11-01T14:30:00Z', 'Asia/Kolkata'), /8:00/);
});

// ---------- chat ----------
const msg = (id: string, t: number, sender = ME): ChatMessage => ({ id, conversationId: 'c', senderId: sender, body: id, mediaKind: null, revealedBy: [], createdAt: new Date(t) });
test('messages merge without duplicates and stay in order', () => {
  const merged = mergeMessages([msg('a', 1), msg('c', 3)], [msg('b', 2), msg('c', 3), msg('a', 1)]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(mergeMessages([{ ...msg('x', 1), revealedBy: [] }], [{ ...msg('x', 1), revealedBy: [ME] }])[0]!.revealedBy.length, 1);   // updates replace
});
test('starters come from shared interests, fall back to friendly generics, and are only suggestions', () => {
  assert.deepEqual(conversationStarters(['Trekking', 'Music']).slice(0, 2), ["What's the best trek or trail you've done?", "What are you listening to on repeat right now?"]);
  assert.equal(conversationStarters([]).length, 3);
  assert.equal(conversationStarters(['Unknown hobby']).length, 3);
  assert.equal(new Set(conversationStarters(['Food', 'food', 'FOOD'])).size, 3);
  for (const q of conversationStarters(['Food', 'Coffee', 'Music', 'Movies'])) assert.ok(q.endsWith('?'));
});
test('read receipts and previews', () => {
  const mine = msg('m', 100);
  assert.equal(receiptLabel(mine, new Date(150)), 'Seen'); assert.equal(receiptLabel(mine, new Date(50)), 'Sent');
  assert.equal(receiptLabel(mine, null), 'Sent'); assert.equal(receiptLabel(undefined, new Date(1)), null);
  assert.equal(previewText(null), 'Say hi');
  assert.equal(previewText({ body: 'hello\nthere', mediaKind: null, fromMe: true }), 'You: hello there');
  assert.equal(previewText({ body: null, mediaKind: 'image', fromMe: false }), 'Photo');
});
test('chat error copy explains the first-contact limit kindly', () => {
  assert.match(chatErrorMessage('SQ430'), /time to reply/); assert.match(chatErrorMessage('SQ429'), /fast/);
  assert.match(chatErrorMessage(undefined), /did not send/);
  assert.match(friendlyError(new ApiError(403, 'not_revealed')), /Tap to view/);
});

// ---------- calendar ----------
const item = (id: string, start: Date, mins = 20, status: CalendarItem['status'] = 'confirmed'): CalendarItem => ({ id, sourceType: 'invite', sourceId: id, title: id, startsAt: start, endsAt: new Date(start.getTime() + mins * 60_000), status });
test('calendar groups upcoming plans by day and separates the past', () => {
  const r = splitCalendar([
    item('past', new Date(2026, 10, 1, 8, 0)), item('t2', new Date(2026, 10, 1, 20, 0)), item('t1', new Date(2026, 10, 1, 12, 0)),
    item('tm', new Date(2026, 10, 2, 19, 0)), item('later', new Date(2026, 10, 9, 11, 0), 20, 'cancelled'), item('now', new Date(2026, 10, 1, 9, 50), 20),
  ], now);
  assert.deepEqual(r.upcoming.map((s) => s.label.slice(0, 5)), ['Today', 'Tomor', 'Mon, ']);
  assert.deepEqual(r.upcoming[0]!.items.map((i) => i.id), ['now', 't1', 't2']);           // a plan still in progress stays upcoming
  assert.deepEqual(r.past.map((i) => i.id), ['past']);
  assert.equal(r.upcoming[2]!.items[0]!.status, 'cancelled');                               // cancelled plans stay visible
  assert.equal(dayLabel(new Date(2026, 10, 1, 23, 59), now), 'Today');
});

// ---------- mappers ----------
test('chat and calendar mappers', () => {
  const c = mapConversation({ conversation_id: 'c', user_id: 'u', display_name: 'Rohan', age: '27', last_at: '2026-11-01T10:00:00Z', unread: '2', last_from_me: false });
  assert.deepEqual([c.unread, c.age, c.lastBody], [2, 27, null]);
  const i = mapConversationInfo({ user_id: 'u', display_name: 'R', age: 27, mode_id: 'friendship', shared_interests: ['Food'], other_last_read_at: null, my_last_read_at: '2026-11-01T10:00:00Z' });
  assert.deepEqual([i.otherLastReadAt, i.sharedInterests], [null, ['Food']]);
  assert.equal(mapMessage({ id: 'm', conversation_id: 'c', sender_id: 's', body: 'hi', media_revealed_by: null, created_at: '2026-11-01T10:00:00Z' }).revealedBy.length, 0);
  assert.equal(mapCalendar({ id: 'x', source_type: 'invite', source_id: 'i', title: 'T', starts_at: '2026-11-01T10:00:00Z', ends_at: '2026-11-01T10:20:00Z', status: 'confirmed' }).endsAt.toISOString(), '2026-11-01T10:20:00.000Z');
});

test('first-contact gate matches the database rule', () => {
  const mine = (n: number) => Array.from({ length: n }, (_, i) => msg(`m${i}`, i));
  assert.deepEqual(sendGate([], ME), { allowed: true, hint: null });
  assert.equal(sendGate(mine(2), ME).allowed, true); assert.match(sendGate(mine(2), ME).hint!, /One more/);
  assert.equal(sendGate(mine(3), ME).allowed, false);
  assert.equal(sendGate([...mine(5), msg('theirs', 9, YOU)], ME).allowed, true);       // one reply lifts it
  assert.equal(sendGate([msg('t', 1, YOU), msg('t2', 2, YOU), msg('t3', 3, YOU), msg('t4', 4, YOU)], ME).allowed, true);   // they wrote first
});
