import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { CHECKIN_ESCALATE_AFTER_MIN, CHECKIN_STALE_AFTER_HOURS, escalateCheckins, liftSuspensions, promptCheckins, runRoulette } from '../src/jobs.ts';
import { A, B, C, T0, setup } from './helpers.ts';

function jobSetup() {
  const s = setup();
  s.store.addUser(C, { displayName: 'Chitra' });
  const sender = new NoopPushSender();
  const notifier = createNotifier({ store: s.store, sender, clock: s.clock });
  const logs: string[] = [];
  return { ...s, sender, logs, deps: { store: s.store, notifier, clock: s.clock, log: (m: string) => logs.push(m) } };
}
const addCheckin = (store: any, o: Record<string, unknown> = {}) => {
  const c = { id: `c${store.checkins.length + 1}`, userId: A, status: 'scheduled', checkInAt: T0, promptedAt: null, planActive: true, contactUserId: C, ...o };
  store.checkins.push(c); return c;
};

test('check-in: prompts once when due, never before, and reruns are safe', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const c = addCheckin(store, { checkInAt: at(60) });
  assert.deepEqual(await promptCheckins(deps), { prompted: 0, cancelled: 0, stale: 0 });      // not yet
  setTime(at(61));
  assert.deepEqual(await promptCheckins(deps), { prompted: 1, cancelled: 0, stale: 0 });
  assert.equal(c.status, 'prompted');
  assert.equal((await promptCheckins(deps)).prompted, 0);                                      // already prompted
  const n = store.notifications.filter((x) => x.kind === 'checkin_prompt');
  assert.equal(n.length, 1); assert.equal(n[0]!.userId, A);
});

test('check-in: a cancelled plan, a deleted account or a very late worker means no prompt', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const gone = addCheckin(store, { planActive: false });
  store.addUser('44444444-4444-4444-8444-44444444444d', { state: 'deleted' });
  const deleted = addCheckin(store, { userId: '44444444-4444-4444-8444-44444444444d' });
  const late = addCheckin(store, { checkInAt: at(-60 * CHECKIN_STALE_AFTER_HOURS - 5) });
  setTime(at(0));
  assert.deepEqual(await promptCheckins(deps), { prompted: 0, cancelled: 2, stale: 1 });
  assert.deepEqual([gone.status, deleted.status, late.status], ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(store.notifications.length, 0);
});

test('check-in: escalates to the trusted contact only after 30 unanswered minutes, once, with a name-free push', async () => {
  const { deps, store, setTime, at, sender } = jobSetup();
  store.tokens.push({ userId: C, token: 'tok-C', platform: 'android' });
  const c = addCheckin(store);
  setTime(at(1)); await promptCheckins(deps);
  setTime(at(1 + CHECKIN_ESCALATE_AFTER_MIN - 1));
  assert.deepEqual(await escalateCheckins(deps), { escalated: 0, noContact: 0 });             // 29 minutes: too early
  setTime(at(1 + CHECKIN_ESCALATE_AFTER_MIN));
  assert.deepEqual(await escalateCheckins(deps), { escalated: 1, noContact: 0 });
  assert.equal(c.status, 'missed');
  assert.equal((await escalateCheckins(deps)).escalated, 0);                                   // exactly once
  const n = store.notifications.filter((x) => x.kind === 'checkin_missed');
  assert.equal(n.length, 1); assert.equal(n[0]!.userId, C);
  assert.equal(n[0]!.payload.name, store.users.get(A)!.displayName);                          // the name stays inside the app...
  const pushed = sender.sent.at(-1)!.msg;
  assert.ok(!JSON.stringify(pushed).includes(store.users.get(A)!.displayName));              // ...and never reaches the lock screen
  assert.deepEqual(Object.keys(pushed.data).sort(), ['checkinId', 'kind']);
  assert.equal(pushed.channel, 'safety');
});

test('check-in: someone who answers is never escalated', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const c = addCheckin(store);
  setTime(at(1)); await promptCheckins(deps);
  c.status = 'confirmed_safe';                                                                // they tapped "I'm safe"
  setTime(at(120));
  assert.equal((await escalateCheckins(deps)).escalated, 0);
  assert.equal(store.notifications.filter((x) => x.kind === 'checkin_missed').length, 0);
});

test('check-in: the claim is atomic, so a person who answers during the run is not reported', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const c = addCheckin(store);
  setTime(at(1)); await promptCheckins(deps);
  const real = store.unansweredCheckins.bind(store);
  store.unansweredCheckins = async (...a: Parameters<typeof real>) => { const r = await real(...a); c.status = 'confirmed_safe'; return r; };   // answer lands after the read
  setTime(at(60));
  assert.equal((await escalateCheckins(deps)).escalated, 0);
  assert.equal(store.notifications.filter((x) => x.kind === 'checkin_missed').length, 0);
});

test('check-in: if the alert cannot be saved the check-in is retried, keeping the original clock', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const c = addCheckin(store);
  setTime(at(1)); await promptCheckins(deps);
  const prompted = c.promptedAt;
  const real = store.addNotification.bind(store);
  store.addNotification = async () => { throw new Error('db down'); };
  setTime(at(40));
  assert.equal((await escalateCheckins(deps)).escalated, 0);
  assert.equal(c.status, 'prompted'); assert.equal(c.promptedAt, prompted);                    // put back, 30-minute clock not reset
  store.addNotification = real;
  assert.equal((await escalateCheckins(deps)).escalated, 1);
  assert.equal(c.status, 'missed');
});

test('check-in: a missed check-in with no trusted contact left is closed and logged, nobody is messaged', async () => {
  const { deps, store, setTime, at, logs } = jobSetup();
  const c = addCheckin(store, { contactUserId: null });
  setTime(at(1)); await promptCheckins(deps);
  setTime(at(60));
  assert.deepEqual(await escalateCheckins(deps), { escalated: 0, noContact: 1 });
  assert.equal(c.status, 'missed'); assert.ok(logs.some((l) => l.includes('trusted contact is gone')));
});

test('check-in prompt failure (cannot store) is retried on the next run', async () => {
  const { deps, store, setTime, at } = jobSetup();
  const c = addCheckin(store);
  const real = store.addNotification.bind(store);
  store.addNotification = async () => { throw new Error('db down'); };
  setTime(at(1));
  assert.equal((await promptCheckins(deps)).prompted, 0); assert.equal(c.status, 'scheduled');
  store.addNotification = real;
  assert.equal((await promptCheckins(deps)).prompted, 1); assert.equal(c.status, 'prompted');
});

test('suspensions: the job asks the store to lift expired ones', async () => {
  const { deps, store } = jobSetup();
  store.suspensionsToLift = 2;
  assert.equal(await liftSuspensions(deps), 2); assert.equal(store.liftedSuspensions, 2);
  assert.equal(await liftSuspensions(deps), 0);
});

// ---- Social Roulette -------------------------------------------------------------------------------------------
const seat = (n: number, area: string, o: Record<string, unknown> = {}) => ({ signupId: `s${n}`, userId: `u${n}`, mode: 'friendship' as const, activity: `dinner@${area}`,
  slot: '2026-11-07T20:00:00.000Z', energy: 'social' as const, groupSize: 2, blockedUserIds: [] as string[], status: 'waiting', ...o });

test('roulette: the area never appears in the notification, and people in other areas are not seated together', async () => {
  const { deps, store } = jobSetup();
  store.roulette = [seat(1, 'soho'), seat(2, 'soho'), seat(3, 'leeds')];
  const r = await runRoulette(deps);
  assert.deepEqual(r, { groups: 1, waitlisted: 1, refused: 0 });
  assert.deepEqual(store.rouletteGroups[0]!.memberIds.sort(), ['u1', 'u2']);
  const n = store.notifications.filter((x) => x.kind === 'roulette_group_ready');
  assert.equal(n.length, 2); assert.ok(n.every((x) => x.payload.activity === 'dinner' && x.payload.slot === '2026-11-07T20:00:00.000Z'));
  assert.equal(store.roulette.find((x) => x.userId === 'u3')!.status, 'waitlisted');
});

test('roulette: when the database refuses a table nobody is told and everyone is considered again next run', async () => {
  const { deps, store } = jobSetup();
  store.roulette = [seat(1, 'soho'), seat(2, 'soho')];
  store.refuseRouletteGroups = true;
  assert.deepEqual(await runRoulette(deps), { groups: 0, waitlisted: 0, refused: 1 });
  assert.equal(store.notifications.length, 0); assert.ok(store.roulette.every((x) => x.status === 'waiting'));
  store.refuseRouletteGroups = false;
  assert.equal((await runRoulette(deps)).groups, 1);
  assert.equal(store.notifications.length, 2);
});

test('roulette: a signup cancelled between reading and forming is refused (mirrors form_roulette_group)', async () => {
  const { deps, store } = jobSetup();
  store.roulette = [seat(1, 'soho'), seat(2, 'soho')];
  const real = store.rouletteCandidates.bind(store);
  store.rouletteCandidates = async (n: Date) => { const c = await real(n); store.roulette[1]!.status = 'cancelled'; return c; };
  assert.equal((await runRoulette(deps)).refused, 1);
  assert.equal(store.rouletteGroups.length, 0);
});
