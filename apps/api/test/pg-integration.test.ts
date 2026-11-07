// Runs PgStore (and the worker jobs) against a REAL Postgres that has migrations 0001-0011 applied.
// Skipped unless PG_TEST_URL is set, so the normal suite needs no database:
//   PG_TEST_URL=postgres://postgres:pw@127.0.0.1:5432/sq node --test test/pg-integration.test.ts
// Everything happens inside one transaction that is rolled back at the end. Uses the `pg` package (dev dependency of the API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { PgStore } from '../src/pg-store.ts';
import { escalateCheckins, expireInvites, expireOpenCalls, liftSuspensions, processDeletions, processExports, promptCheckins, purgeExpiredExports, runRoulette, sendReminders } from '../src/jobs.ts';
import { FakeAdmin } from './fake-admin.ts';

const URL_ = process.env.PG_TEST_URL;
const skip = !URL_;
let client: any; let store: PgStore;
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [U1, U2, U3, U4, U5] = [id(1), id(2), id(3), id(4), id(5)];
const q = (text: string, values?: unknown[]) => client.query(text, values);
/** Each test runs in a savepoint so one failure cannot poison the others. */
const it = (name: string, fn: () => Promise<void>) => test(name, { skip }, async () => {
  await q('savepoint t');
  try { await fn(); } catch (e) { await q('rollback to savepoint t'); throw e; }
});
const NOW = new Date(Date.now());
const at = (mins: number) => new Date(NOW.getTime() + mins * 60_000);

before(async () => {
  if (skip) return;
  const pg = await import('pg');
  client = new pg.Client({ connectionString: URL_ }); await client.connect();
  await q('begin');
  store = new PgStore(client);
  for (const [i, u] of [U1, U2, U3, U4, U5].entries()) {
    await q('insert into auth.users (id, email) values ($1, $2)', [u, `it${i}@test.local`]);
    await q("insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete) values ($1, $2, date '1992-02-02', 'f', 'Pune', true)", [u, `Person ${i + 1}`]);
    await q("insert into user_active_modes (user_id, mode_id) values ($1, 'friendship')", [u]);
  }
});
after(async () => { if (client) { await q('rollback'); await client.end(); } });

it('invites, matches, blocks, conversations, calendar, notifications, prefs and tokens', async () => {
  const inv = await store.insertInvite({ senderId: U1, recipientId: U2, modeId: 'friendship', format: 'virtual_coffee', state: 'pending', proposedBy: null,
    startsAt: at(120), timezone: 'Asia/Kolkata', durationMinutes: 20, note: 'Coffee?', sequence: 0, expiresAt: at(60), conversationId: null });
  assert.equal((await store.getInvite(inv.id))!.note, 'Coffee?');
  assert.equal(await store.countPending(U1, U2), 1);
  assert.deepEqual(await store.countSentSince(U1, at(-60)), { total: 1, toNonMatches: 1 });
  await q("insert into matches (user_a, user_b, mode_id) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), 'friendship')", [U1, U2]);
  assert.equal(await store.isMatched(U2, U1, 'friendship'), true);
  assert.deepEqual(await store.countSentSince(U1, at(-60)), { total: 1, toNonMatches: 0 });
  assert.equal((await store.listInvitesFor(U2, 'incoming', 10)).length, 1);
  const p = await store.insertProposal({ inviteId: inv.id, proposedBy: U2, startsAt: at(180), durationMinutes: 30, note: null });
  assert.equal((await store.latestProposal(inv.id))!.id, p.id);
  inv.state = 'accepted'; inv.sequence = 1; await store.saveInvite(inv);
  assert.equal((await store.getInvite(inv.id))!.state, 'accepted');

  assert.equal(await store.isBlocked(U1, U3), false);
  await q('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U3, U1]);
  assert.equal(await store.isBlocked(U1, U3), true);
  assert.equal((await store.getUserFlags(U1))!.displayName, 'Person 1');
  assert.equal(await store.getUserFlags(id(99)), null);
  assert.equal(await store.isActiveInMode(U1, 'friendship'), true);
  assert.equal(await store.isActiveInMode(U1, 'serious_dating'), false);

  const c1 = await store.ensureConversation(U1, U2, 'friendship'); const c2 = await store.ensureConversation(U2, U1, 'friendship');
  assert.equal(c1, c2);
  assert.deepEqual((await store.conversationMemberIds(c1)).sort(), [U1, U2]);

  await store.upsertCalendar({ userId: U1, sourceType: 'invite', sourceId: inv.id, title: 'Coffee', startsAt: at(120), endsAt: at(140), status: 'confirmed', sequence: 1 });
  await store.upsertCalendar({ userId: U1, sourceType: 'invite', sourceId: inv.id, title: 'Coffee 2', startsAt: at(120), endsAt: at(140), status: 'confirmed', sequence: 2 });
  await store.setCalendarStatus(inv.id, 'cancelled', 3);
  const cal = await q('select title, status, sequence from calendar_entries where source_id = $1', [inv.id]);
  assert.deepEqual(cal.rows, [{ title: 'Coffee 2', status: 'cancelled', sequence: 3 }]);

  assert.equal(await store.addNotification({ userId: U1, kind: 'invite_received', payload: { inviteId: inv.id }, dedupeKey: 'k1' }), true);
  assert.equal(await store.addNotification({ userId: U1, kind: 'invite_received', payload: { inviteId: inv.id }, dedupeKey: 'k1' }), false);
  assert.equal(await store.addNotification({ userId: U1, kind: 'invite_received', payload: {} }), true);
  assert.deepEqual(await store.getPrefs(U1, 'invite_received'), { push: true, quietStart: null, quietEnd: null });
  await q("insert into notification_preferences (user_id, kind, push, quiet_start, quiet_end) values ($1, '*', false, '22:00', '07:30')", [U1]);
  assert.deepEqual(await store.getPrefs(U1, 'invite_received'), { push: false, quietStart: '22:00', quietEnd: '07:30' });
  await q("insert into push_tokens (user_id, token, platform) values ($1, 'tok-1', 'android')", [U1]);
  assert.deepEqual(await store.listPushTokens(U1), [{ token: 'tok-1', platform: 'android' }]);
  await store.removePushToken('tok-1'); assert.deepEqual(await store.listPushTokens(U1), []);
});

it('jobs on real rows: invite expiry, reminders, open-call expiry', async () => {
  const sender = new NoopPushSender();
  const deps = { store, notifier: createNotifier({ store, sender, clock: () => NOW }), clock: () => NOW };
  const old = await store.insertInvite({ senderId: U4, recipientId: U5, modeId: 'friendship', format: 'text', state: 'pending', proposedBy: null,
    startsAt: at(600), timezone: 'UTC', durationMinutes: 20, note: null, sequence: 0, expiresAt: at(-5), conversationId: null });
  assert.equal(await expireInvites(deps), 1);
  assert.equal((await store.getInvite(old.id))!.state, 'expired');
  const soon = await store.insertInvite({ senderId: U4, recipientId: U2, modeId: 'friendship', format: 'text', state: 'accepted', proposedBy: null,
    startsAt: at(50), timezone: 'UTC', durationMinutes: 20, note: null, sequence: 1, expiresAt: at(50), conversationId: null });
  assert.equal(await sendReminders(deps), 2);
  assert.equal(await sendReminders(deps), 2);
  assert.equal((await q("select count(*)::int n from notifications where kind = 'invite_reminder' and payload->>'inviteId' = $1", [soon.id])).rows[0].n, 2);
  assert.equal(await expireOpenCalls(deps), 0);
});

it('roulette: the real matcher + form_roulette_group seat a table, keep areas apart, and a refused table notifies nobody', async () => {
  const slot = at(60 * 24 * 2); const deps = { store, notifier: createNotifier({ store, sender: new NoopPushSender(), clock: () => NOW }), clock: () => NOW };
  const sign = (u: string, area: string) => q("insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label) values ($1, 'friendship', 'dinner @ 8 | late', $2, 'social', 2, $3)", [u, slot, area]);
  await sign(U1, 'Soho'); await sign(U2, ' soho '); await sign(U4, 'Leeds');
  await q('delete from blocks');
  const cands = await store.rouletteCandidates(NOW);
  assert.equal(cands.length, 3); assert.ok(cands.some((c) => c.activity === 'dinner @ 8 | late@soho'));
  const r = await runRoulette(deps);
  assert.deepEqual(r, { groups: 1, waitlisted: 1, refused: 0 });
  const g = await q("select g.activity, g.mode_id, count(m.user_id)::int n from roulette_groups g join roulette_group_members m on m.group_id = g.id group by 1, 2");
  assert.deepEqual(g.rows, [{ activity: 'dinner @ 8 | late', mode_id: 'friendship', n: 2 }]);        // stored without the area
  assert.deepEqual((await q("select user_id from roulette_group_members order by 1")).rows.map((x: any) => x.user_id), [U1, U2]);
  const notes = (await q("select user_id, payload from notifications where kind = 'roulette_group_ready'")).rows;
  assert.equal(notes.length, 2); assert.ok(notes.every((n: any) => n.payload.activity === 'dinner @ 8 | late'));
  assert.equal((await q("select status from roulette_signups where user_id = $1", [U4])).rows[0].status, 'waitlisted');
  // a suspended person is no longer a candidate
  await q("update profiles set state = 'suspended' where id = $1", [U4]);
  assert.equal((await store.rouletteCandidates(NOW)).some((c) => c.userId === U4), false);
  // refusal: a stale group request gets `false`, and the real SQL function was the one that said so
  const s = (await q("select id from roulette_signups where user_id = $1", [U1])).rows[0].id;
  assert.equal(await store.createRouletteGroup([U1, U2], [s, s], `friendship|dinner@soho|${slot.toISOString()}|2`), false);
  await assert.rejects(store.createRouletteGroup([U1], [s], 'garbage'), /bad roulette key/);
  await q("update profiles set state = 'active' where id = $1", [U4]);
});

it('check-ins on real rows: prompt, escalate to the trusted contact after 30 minutes, answer-in-time is never reported', async () => {
  const deps = { store, notifier: createNotifier({ store, sender: new NoopPushSender(), clock: () => NOW }), clock: () => NOW };
  const ev = (await q("insert into events (host_id, title, kind, category, starts_at, status) values ($1, 'Walk', 'activity', 'outdoors', $2, 'scheduled') returning id", [U1, at(-5)])).rows[0].id;
  await q("insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status) values ($1, 'event', $2, 'Walk', $3, $4, 'confirmed')", [U1, ev, at(-5), at(55)]);
  const tc = (await q("insert into trusted_contacts (user_id, label, contact_user_id) values ($1, 'Sis', $2) returning id", [U1, U2])).rows[0].id;
  const mk = async (when: Date, source = ev) => (await q("insert into meeting_checkins (user_id, source_type, source_id, trusted_contact_id, check_in_at) values ($1, 'event', $2, $3, $4) returning id", [U1, source, tc, when])).rows[0].id;
  const c1 = await mk(at(-1));
  assert.deepEqual(await promptCheckins(deps), { prompted: 1, cancelled: 0, stale: 0 });
  assert.equal((await q('select status from meeting_checkins where id = $1', [c1])).rows[0].status, 'prompted');
  assert.equal((await q("select count(*)::int n from notifications where kind = 'checkin_prompt' and user_id = $1", [U1])).rows[0].n, 1);
  // 29 minutes later: too early. 31 minutes later: escalated to U2 only.
  const later = (m: number) => ({ ...deps, clock: () => at(m) });
  assert.equal((await escalateCheckins(later(29))).escalated, 0);
  assert.deepEqual(await escalateCheckins(later(31)), { escalated: 1, noContact: 0 });
  const miss = (await q("select user_id, payload from notifications where kind = 'checkin_missed'")).rows;
  assert.equal(miss.length, 1); assert.equal(miss[0].user_id, U2); assert.equal(miss[0].payload.name, 'Person 1');
  assert.equal((await escalateCheckins(later(40))).escalated, 0);
  // a check-in for a cancelled plan is closed, not prompted
  const ev2 = (await q("insert into events (host_id, title, kind, category, starts_at, status) values ($1, 'Hike', 'activity', 'outdoors', $2, 'cancelled') returning id", [U1, at(-5)])).rows[0].id;
  await q("insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status) values ($1, 'event', $2, 'Hike', $3, $4, 'cancelled')", [U1, ev2, at(-5), at(55)]);
  const c2 = await mk(at(-1), ev2);
  assert.deepEqual(await promptCheckins(deps), { prompted: 0, cancelled: 1, stale: 0 });
  assert.equal((await q('select status from meeting_checkins where id = $1', [c2])).rows[0].status, 'cancelled');
});

it('suspensions: an expired suspension is lifted, a running one and a later ban are not', async () => {
  const deps = { store, notifier: createNotifier({ store, sender: new NoopPushSender(), clock: () => NOW }), clock: () => NOW };
  const mod = (await q("insert into auth.users (id, email) values ($1, 'mod@test.local') returning id", [id(50)])).rows[0].id;
  for (const [u, until] of [[U3, "now() - interval '1 hour'"], [U4, "now() + interval '2 days'"], [U5, "now() - interval '1 hour'"]] as const) {
    await q("update profiles set state = 'suspended' where id = $1", [u]);
    await q(`insert into moderation_actions (moderator_id, target_user_id, action, until) values ($1, $2, 'suspend', ${until})`, [mod, u]);
  }
  await q("insert into moderation_actions (moderator_id, target_user_id, action) values ($1, $2, 'ban')", [mod, U5]);   // U5 was banned after
  await q("update profiles set state = 'banned' where id = $1", [U5]);
  assert.equal(await liftSuspensions(deps), 1);
  const st = (await q('select id, state from profiles where id = any($1::uuid[])', [[U3, U4, U5]])).rows.reduce((a: any, r: any) => ({ ...a, [r.id]: r.state }), {});
  assert.deepEqual(st, { [U3]: 'active', [U4]: 'suspended', [U5]: 'banned' });
});

it('data requests: export builds the real export, deletion waits 7 days, claims are exclusive, cancelled never runs', async () => {
  const admin = new FakeAdmin();
  const mkDeps = (t: Date) => ({ store, notifier: createNotifier({ store, sender: new NoopPushSender(), clock: () => t }), clock: () => t, admin });
  const ex = (await q("insert into data_requests (user_id, kind, requested_at) values ($1, 'export', $2) returning id", [U2, at(-1)])).rows[0].id;
  assert.deepEqual(await processExports(mkDeps(NOW)), { done: 1, failed: 0 });
  const file = admin.files.get(`exports/${U2}/${ex}.json`)!;
  const body = JSON.parse(file);
  assert.equal(body.profile.display_name, 'Person 2'); assert.ok(!('friend_code' in body.profile)); assert.ok(!('approx_location' in body.profile));
  assert.ok(Array.isArray(body.invitations) && body.invitations.length >= 1);
  const rec = await store.getDataRequest(ex);
  assert.deepEqual([rec!.status, rec!.resultPath, rec!.kind], ['done', `${U2}/${ex}.json`, 'export']);
  assert.equal((await q("select count(*)::int n from notifications where kind = 'export_ready' and user_id = $1", [U2])).rows[0].n, 1);
  // exclusive claims
  const dq = (await q("insert into data_requests (user_id, kind, requested_at) values ($1, 'deletion', $2) returning id", [U3, at(-60 * 24 * 8)])).rows[0].id;
  const claim = () => store.claimDataRequest({ kind: 'deletion', requestedBefore: at(-60 * 24 * 7), retryBefore: at(-5), staleBefore: at(-30), now: NOW, maxAttempts: 5 });
  const first = await claim(); assert.equal(first!.id, dq); assert.equal(first!.attempts, 1);
  assert.equal(await claim(), null);                                         // already processing
  // fresh deletion (not yet 7 days) and a cancelled one are left alone
  await q("insert into data_requests (user_id, kind, requested_at) values ($1, 'deletion', $2)", [U4, at(-60 * 24 * 6)]);
  await q("insert into data_requests (user_id, kind, requested_at, status) values ($1, 'deletion', $2, 'cancelled')", [U5, at(-60 * 24 * 30)]);
  admin.authUsers.add(U3);
  await store.failDataRequest(dq, 'boom', 5);                                // back to queued, with the retry delay
  assert.equal(await claim(), null);
  const d = await processDeletions(mkDeps(at(10)));                           // 10 minutes later the retry delay has passed
  assert.deepEqual(d, { done: 1, failed: 0 });
  assert.ok(admin.calls.includes(`deleteUser ${U3}`)); assert.ok(!admin.calls.includes(`deleteUser ${U4}`) && !admin.calls.includes(`deleteUser ${U5}`));
  // purge old export files
  assert.equal(await purgeExpiredExports(mkDeps(at(60 * 24 * 8))), 1);
  assert.equal((await store.getDataRequest(ex))!.resultPath, null); assert.equal(admin.files.size, 0);
});

it('photos and chat media queries', async () => {
  await q("insert into profile_photos (user_id, storage_path, moderation_status, visible_modes, position) values ($1, 'p/a.jpg', 'approved', array['friendship'], 0), ($1, 'p/b.jpg', 'pending', array['friendship'], 1)", [U1]);
  const paths = await store.visiblePhotoPaths(U2, U1, 'friendship');
  assert.deepEqual(paths, ['p/a.jpg']);                                       // pending photos never visible
  await q('delete from blocks'); await q('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U2, U1]);
  assert.deepEqual(await store.visiblePhotoPaths(U2, U1, 'friendship'), []);
  const photo = (await q("select id from profile_photos where storage_path = 'p/b.jpg'")).rows[0].id;
  assert.equal((await store.getPhoto(photo))!.status, 'pending');
  await store.setPhotoStatus(photo, 'rejected'); assert.equal((await store.getPhoto(photo))!.status, 'rejected');
  const conv = await store.ensureConversation(U1, U2, 'friendship');
  const m = (await q("insert into messages (conversation_id, sender_id, media_path, media_kind) values ($1, $2, 'chat/x.jpg', 'image') returning id", [conv, U1])).rows[0].id;
  const media = await store.getMessageMedia(m);
  assert.deepEqual([media!.mediaKind, media!.senderId, media!.deleted, media!.memberIds.sort()], ['image', U1, false, [U1, U2]]);
  assert.equal(await store.getMessageMedia(id(98)), null);
});

it('moderator helpers: is_moderator and which photos a moderator may look at', async () => {
  const MOD = id(60);
  await q("insert into auth.users (id, email) values ($1, 'mod2@test.local')", [MOD]);
  await q("insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete) values ($1, 'Mod', date '1990-01-01', 'f', 'Pune', true)", [MOD]);
  await q("insert into user_roles (user_id, role) values ($1, 'moderator') on conflict (user_id) do update set role = 'moderator'", [MOD]);
  assert.equal(await store.isModerator(MOD), true); assert.equal(await store.isModerator(U1), false);
  const mk = async (path: string, status: string) => (await q("insert into profile_photos (user_id, storage_path, moderation_status, visible_modes, position) values ($1, $2, $3, array['friendship'], 9) returning id", [U2, path, status])).rows[0].id;
  const pending = await mk('x/pending.jpg', 'pending'), approved = await mk('x/approved.jpg', 'approved'), reported = await mk('x/reported.jpg', 'approved');
  await q("insert into reports (reporter_id, reported_user_id, content_type, content_id, reason) values ($1, $2, 'photo', $3, 'explicit')", [U1, U2, reported]);
  assert.equal(await store.photoForReview(pending), 'x/pending.jpg');
  assert.equal(await store.photoForReview(reported), 'x/reported.jpg');
  assert.equal(await store.photoForReview(approved), null);
  assert.equal(await store.photoForReview(id(99)), null);
});
