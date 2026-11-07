import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, C, setup, input } from './helpers.ts';

const val = <T>(r: { ok: boolean; value?: T; error?: string }): T => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value as T; };
const fail = (r: { ok: boolean; status?: number; error?: string }, status: number, error: string) => {
  assert.equal(r.ok, false); assert.equal(r.status, status); assert.equal(r.error, error);
};

test('create: pending invite, recipient notified, expiry never later than the start', async () => {
  const { svc, store } = setup();
  const inv = val(await svc.create(A, input()));
  assert.equal(inv.state, 'pending');
  assert.equal(inv.expiresAt.getTime(), inv.startsAt.getTime());
  assert.equal(store.notifications.at(-1)?.kind, 'invite_received');
  assert.equal(store.notifications.at(-1)?.userId, B);
});

test('create: guards (self, time window, restricted sender, unavailable recipient)', async () => {
  const { svc, store, at } = setup();
  fail(await svc.create(A, input({ recipientId: A })), 400, 'cannot_invite_self');
  fail(await svc.create(A, input({ startsAt: at(1) })), 400, 'start_time_out_of_range');
  fail(await svc.create(A, input({ startsAt: at(60 * 24 * 100) })), 400, 'start_time_out_of_range');
  store.users.get(A)!.state = 'suspended';
  fail(await svc.create(A, input()), 403, 'account_restricted');
  store.users.get(A)!.state = 'active';
  store.users.get(B)!.state = 'deleted';
  fail(await svc.create(A, input()), 404, 'unavailable');
});

test('create: blocks, mode mismatch and intro opt-out all look identical to the sender', async () => {
  const { svc, store } = setup();
  store.block(B, A);
  const blocked = await svc.create(A, input());
  store.blocks.clear();
  store.modes.delete(`${B}|serious_dating`);
  const wrongMode = await svc.create(A, input());
  store.modes.add(`${B}|serious_dating`);
  store.users.get(B)!.acceptsIntros = false;
  const optedOut = await svc.create(A, input());
  for (const r of [blocked, wrongMode, optedOut]) fail(r, 404, 'unavailable');
});

test('create: experimentation needs a match first', async () => {
  const { svc, store } = setup();
  store.modes.add(`${A}|experimentation`); store.modes.add(`${B}|experimentation`);
  fail(await svc.create(A, input({ modeId: 'experimentation' })), 403, 'needs_match');
  store.addMatch(A, B, 'experimentation');
  val(await svc.create(A, input({ modeId: 'experimentation' })));
});

test('rate limits: one pending per recipient; ten per day to non-matches', async () => {
  const { svc, store } = setup();
  val(await svc.create(A, input()));
  fail(await svc.create(A, input()), 429, 'pending_exists');
  for (let i = 0; i < 9; i++) {
    const id = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`;
    store.addUser(id);
    val(await svc.create(A, input({ recipientId: id })));
  }
  store.addUser(C);
  fail(await svc.create(A, input({ recipientId: C })), 429, 'non_match_limit');
  store.addMatch(A, C, 'serious_dating');
  val(await svc.create(A, input({ recipientId: C })));
});

test('accept: conversation, both calendars and ICS (no contact details)', async () => {
  const { svc, store } = setup();
  const inv = val(await svc.create(A, input()));
  const acc = val(await svc.act(B, inv.id, 'accept'));
  assert.equal(acc.state, 'accepted');
  assert.ok(acc.conversationId);
  assert.equal(store.calendar.get(`${A}|${inv.id}`)?.title, 'Virtual coffee with Rohan');
  assert.equal(store.calendar.get(`${B}|${inv.id}`)?.title, 'Virtual coffee with Aanya');
  assert.equal(store.notifications.at(-1)?.kind, 'invite_accepted');
  const ics = val(await svc.ics(A, inv.id));
  assert.match(ics, /DTSTART:20261101T120000Z/);
  assert.match(ics, /SUMMARY:Virtual coffee with Rohan/);
  assert.doesNotMatch(ics, /mailto:|ORGANIZER|ATTENDEE/);
  fail(await svc.ics(C, inv.id), 404, 'not_found');
});

test('only the right party can act; outsiders get 404', async () => {
  const { svc } = setup();
  const inv = val(await svc.create(A, input()));
  const s = await svc.act(A, inv.id, 'accept'); assert.equal(s.ok, false); assert.equal((s as any).status, 409);
  fail(await svc.act(C, inv.id, 'accept'), 404, 'not_found');
  fail(await svc.get(C, inv.id), 404, 'not_found');
  const d = val(await svc.act(B, inv.id, 'decline'));
  assert.equal(d.state, 'declined');
  const again = await svc.act(B, inv.id, 'accept'); assert.equal((again as any).status, 409);
});

test('too new: sender cannot push; recipient may say hi later or propose a time', async () => {
  const { svc, store, at } = setup();
  const inv = val(await svc.create(A, input()));
  const tn = val(await svc.act(B, inv.id, 'too_new'));
  assert.equal(tn.state, 'too_new');
  assert.equal(tn.conversationId, null);                       // nothing is opened automatically
  assert.equal(store.notifications.at(-1)?.kind, 'invite_too_new');
  fail(await svc.startLightChat(A, inv.id), 403, 'recipient_only');
  const chat = val(await svc.startLightChat(B, inv.id));
  assert.ok(chat.conversationId);
  assert.equal(store.notifications.at(-1)?.kind, 'light_chat_started');
  const r = val(await svc.requestReschedule(B, inv.id, { startsAt: at(60 * 48), durationMinutes: 30, note: null }));
  assert.equal(r.state, 'reschedule_requested');
  assert.equal(r.proposedBy, 'recipient');
});

test('too new: light chat respects the recipient setting', async () => {
  const { svc, store } = setup();
  store.users.get(B)!.allowLightChat = false;
  const inv = val(await svc.create(A, input()));
  val(await svc.act(B, inv.id, 'too_new'));
  fail(await svc.startLightChat(B, inv.id), 403, 'light_chat_disabled');
});

test('reschedule: proposer cannot self-accept; counter-proposal flips; acceptance updates calendar', async () => {
  const { svc, store, at } = setup();
  const inv = val(await svc.create(A, input()));
  val(await svc.act(B, inv.id, 'accept'));
  const r1 = val(await svc.requestReschedule(B, inv.id, { startsAt: at(60 * 5), durationMinutes: 30, note: 'later?' }));
  assert.equal(r1.state, 'reschedule_requested');
  assert.equal((await svc.acceptReschedule(B, inv.id) as any).status, 409);
  const r2 = val(await svc.requestReschedule(A, inv.id, { startsAt: at(60 * 6), durationMinutes: 30, note: null }));
  assert.equal(r2.proposedBy, 'sender');
  const done = val(await svc.acceptReschedule(B, inv.id));
  assert.equal(done.state, 'rescheduled');
  assert.equal(done.startsAt.getTime(), at(60 * 6).getTime());
  assert.equal(done.durationMinutes, 30);
  assert.equal(store.calendar.get(`${A}|${inv.id}`)?.startsAt.getTime(), at(60 * 6).getTime());
  assert.equal(store.calendar.get(`${A}|${inv.id}`)?.sequence, done.sequence);
  const ics = val(await svc.ics(A, inv.id));
  assert.match(ics, new RegExp(`SEQUENCE:${done.sequence}`));
});

test('cancel confirmed plan: calendar cancelled, ICS says CANCEL, other person told', async () => {
  const { svc, store } = setup();
  const inv = val(await svc.create(A, input()));
  val(await svc.act(B, inv.id, 'accept'));
  const c = val(await svc.act(A, inv.id, 'cancel'));
  assert.equal(c.state, 'cancelled');
  assert.equal(store.calendar.get(`${B}|${inv.id}`)?.status, 'cancelled');
  assert.equal(store.notifications.at(-1)?.kind, 'invite_cancelled');
  assert.equal(store.notifications.at(-1)?.userId, B);
  assert.match(val(await svc.ics(B, inv.id)), /METHOD:CANCEL/);
});

test('complete: only after the start; both get a private safety prompt once', async () => {
  const { svc, store, setTime, at } = setup();
  const inv = val(await svc.create(A, input()));
  val(await svc.act(B, inv.id, 'accept'));
  assert.equal((await svc.act(A, inv.id, 'complete') as any).status, 409);
  setTime(at(60 * 3));
  val(await svc.act(A, inv.id, 'complete'));
  const prompts = store.notifications.filter((n) => n.kind === 'post_meet_prompt');
  assert.deepEqual(prompts.map((p) => p.userId).sort(), [A, B].sort());
  assert.equal(store.calendar.get(`${A}|${inv.id}`)?.status, 'completed');
});

test('call window: only confirmed call formats, within a sensible time range', async () => {
  const { svc, setTime, at } = setup();
  const text = val(await svc.create(A, input({ format: 'text' })));
  val(await svc.act(B, text.id, 'accept'));
  fail(await svc.callWindow(A, text.id), 409, 'not_a_call');
  const call = val(await svc.create(A, input({ format: 'video', recipientId: B, startsAt: at(60 * 4) })));
  fail(await svc.callWindow(A, call.id), 409, 'not_confirmed');
  val(await svc.act(B, call.id, 'accept'));
  fail(await svc.callWindow(A, call.id), 409, 'too_early');
  setTime(at(60 * 4 - 5));
  assert.equal(val(await svc.callWindow(B, call.id)).room, `invite-${call.id}`);
  setTime(at(60 * 4 + 120));
  fail(await svc.callWindow(A, call.id), 409, 'call_ended');
});
