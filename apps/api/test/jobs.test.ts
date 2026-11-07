import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { expireInvites, expireOpenCalls, runRoulette, sendReminders } from '../src/jobs.ts';
import { A, B, setup, input } from './helpers.ts';

function jobSetup() {
  const s = setup();
  const sender = new NoopPushSender();
  const notifier = createNotifier({ store: s.store, sender, clock: s.clock });
  return { ...s, sender, deps: { store: s.store, notifier, clock: s.clock } };
}

test('expiry: unanswered invites expire once and the sender is told', async () => {
  const { svc, deps, setTime, at, store } = jobSetup();
  const inv = (await svc.create(A, input())) as any;
  assert.equal(await expireInvites(deps), 0);                // not yet
  setTime(at(60 * 3));
  assert.equal(await expireInvites(deps), 1);
  assert.equal((await store.getInvite(inv.value.id))!.state, 'expired');
  assert.equal(await expireInvites(deps), 0);                // idempotent
  assert.equal(store.notifications.filter((n) => n.kind === 'invite_expired').length, 1);
  assert.equal(store.notifications.at(-1)?.userId, A);
});

test('expiry never touches confirmed plans or too-new replies', async () => {
  const { svc, deps, setTime, at, store } = jobSetup();
  const a = (await svc.create(A, input())) as any;
  await svc.act(B, a.value.id, 'accept');
  store.addUser('55555555-5555-4555-8555-555555555555');
  const b = (await svc.create(A, input({ recipientId: '55555555-5555-4555-8555-555555555555' }))) as any;
  await svc.act('55555555-5555-4555-8555-555555555555', b.value.id, 'too_new');
  setTime(at(60 * 24 * 10));
  assert.equal(await expireInvites(deps), 0);
  assert.equal((await store.getInvite(a.value.id))!.state, 'accepted');
  assert.equal((await store.getInvite(b.value.id))!.state, 'too_new');
});

test('reminders: one per window per person, tightest window wins, reruns are safe', async () => {
  const { svc, deps, setTime, at, store, sender } = jobSetup();
  store.tokens.push({ userId: A, token: 't', platform: 'android' });
  const inv = (await svc.create(A, input({ startsAt: at(180) }))) as any;
  await svc.act(B, inv.value.id, 'accept');
  setTime(at(100));
  assert.equal(await sendReminders(deps), 0);                // 80 min away: outside the 60 min window
  setTime(at(125));                                            // 55 min away
  assert.equal(await sendReminders(deps), 2);
  assert.equal(await sendReminders(deps), 2);                  // attempted again, but deduped
  assert.equal(store.notifications.filter((n) => n.kind === 'invite_reminder').length, 2);
  setTime(at(170));                                            // 10 min away -> the 15 min window
  await sendReminders(deps);
  assert.equal(store.notifications.filter((n) => n.kind === 'invite_reminder').length, 4);
  assert.equal(sender.sent.length, 2);                         // A has a token; B has none
});

test('reminders follow a reschedule (new sequence = new dedupe key)', async () => {
  const { svc, deps, setTime, at, store } = jobSetup();
  const inv = (await svc.create(A, input({ startsAt: at(180) }))) as any;
  await svc.act(B, inv.value.id, 'accept');
  setTime(at(125)); await sendReminders(deps);
  await svc.requestReschedule(B, inv.value.id, { startsAt: at(240), durationMinutes: 20, note: null });
  await svc.acceptReschedule(A, inv.value.id);
  setTime(at(190));                                            // 50 min before the new time
  await sendReminders(deps);
  assert.equal(store.notifications.filter((n) => n.kind === 'invite_reminder').length, 4);
});

test('open calls expiry delegates to the store', async () => {
  const { deps, store } = jobSetup();
  store.openCallsToExpire = 3;
  assert.equal(await expireOpenCalls(deps), 3);
});

test('roulette: groups form, blocks are respected, leftovers are waitlisted and notified once', async () => {
  const { deps, store } = jobSetup();
  const mk = (n: number, blocked: string[] = []) => ({ signupId: `s${n}`, userId: `u${n}`, mode: 'friendship' as const, activity: 'dinner', slot: '2026-11-07T20:00:00Z',
    energy: 'social' as const, groupSize: 4, blockedUserIds: blocked, status: 'waiting' });
  store.roulette = [mk(1, ['u2']), mk(2), mk(3), mk(4), mk(5), mk(6)];
  const r = await runRoulette(deps);
  assert.equal(r.groups, 1);
  assert.equal(store.rouletteGroups[0]!.memberIds.length, 4);
  assert.ok(!(store.rouletteGroups[0]!.memberIds.includes('u1') && store.rouletteGroups[0]!.memberIds.includes('u2')));
  assert.equal(store.notifications.filter((n) => n.kind === 'roulette_group_ready').length, 4);
  assert.equal(store.roulette.filter((x) => x.status === 'grouped').length, 4);
  assert.equal(store.roulette.filter((x) => x.status === 'waitlisted').length, 2);
  const again = await runRoulette(deps);                       // the two waitlisted cannot form a table of 4
  assert.equal(again.groups, 0);
  assert.equal(store.notifications.filter((n) => n.kind === 'roulette_group_ready').length, 4);
});
