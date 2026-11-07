import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCancelRoulette, circleAction, doubleDateStatus, isFullTeam, joinOutcomeMessage, rouletteStatus, toggleWingPermission, validateCircle, validateCircleEvent, validateDoubleDate, validateRoulette, wingPermissionList, WING_PERMISSION_INFO } from '../src/core/social-core.ts';
import { friendlyError } from '../src/core/errors.ts';
import type { CircleRow, DoubleDateRow, RouletteRow } from '../src/core/db-types.ts';

const NOW = new Date('2026-11-06T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const goodRoulette = { modeId: 'friendship', activity: ' Dinner ', area: ' Soho ', slotStart: at(30), groupSize: 4, energy: 'social' as const };

test('roulette form: a good form becomes exactly the payload the database function reads', () => {
  const r = validateRoulette(goodRoulette, NOW);
  assert.ok(r.ok); if (r.ok) assert.deepEqual(r.value, { mode_id: 'friendship', activity: 'Dinner', area_label: 'Soho', slot_start: at(30).toISOString(), group_size: 4, energy: 'social' });
});
test('roulette form: every limit the database enforces is caught first, with a plain message', () => {
  const errs = (o: object) => { const r = validateRoulette({ ...goodRoulette, ...o }, NOW); return r.ok ? {} : r.errors; };
  assert.ok(errs({ slotStart: at(2.9) }).slotStart); assert.equal(errs({ slotStart: at(3.1) }).slotStart, undefined);
  assert.ok(errs({ slotStart: at(14 * 24 + 1) }).slotStart); assert.equal(errs({ slotStart: at(14 * 24 - 1) }).slotStart, undefined);
  assert.ok(errs({ groupSize: 1 }).groupSize); assert.ok(errs({ groupSize: 9 }).groupSize); assert.ok(errs({ groupSize: 2.5 }).groupSize);
  assert.ok(errs({ activity: 'a' }).activity); assert.ok(errs({ activity: 'x'.repeat(41) }).activity); assert.ok(errs({ area: ' a ' }).area);
  assert.ok(errs({ modeId: null }).modeId); assert.ok(errs({ energy: null }).energy); assert.ok(errs({ slotStart: null }).slotStart);
  assert.equal(Object.keys(errs({ modeId: null, activity: '', area: '', slotStart: null, groupSize: 0, energy: null })).length, 6);
});
const roulette = (o: Partial<RouletteRow>): RouletteRow => ({ signup_id: 's', mode_id: 'friendship', activity: 'dinner', slot_start: at(30).toISOString(), group_size: 4, area_label: 'Soho', status: 'waiting', group_id: null, venue: null, conversation_id: null, is_host: null, members: null, ...o });
test('roulette status text is honest about waiting, waitlist and a ready table', () => {
  assert.equal(rouletteStatus(roulette({})).tone, 'wait'); assert.match(rouletteStatus(roulette({ status: 'waitlisted' })).text, /more people/);
  assert.deepEqual(rouletteStatus(roulette({ status: 'grouped', group_id: 'g', venue: 'The Pub' })), { text: 'Table ready at The Pub', tone: 'good' });
  assert.match(rouletteStatus(roulette({ status: 'grouped', group_id: 'g' })).text, /Pick a place/);
  assert.equal(rouletteStatus(roulette({ status: 'cancelled' })).tone, 'done');
  assert.deepEqual(['waiting', 'waitlisted', 'grouped', 'cancelled'].map((status) => canCancelRoulette(roulette({ status }))), [true, true, true, false]);
});

const circle = (o: Partial<CircleRow>): CircleRow => ({ id: 'c', name: 'Hikers', description: null, visibility: 'public', category: null, member_count: 3, my_role: null, my_status: null, owner_name: 'Sam', conversation_id: null, ...o });
test('circle actions: join, ask, wait, open, manage, and never offer what the database would refuse', () => {
  assert.deepEqual(circleAction(circle({})), { kind: 'join', label: 'Join' });
  assert.deepEqual(circleAction(circle({ visibility: 'request_to_join' })), { kind: 'request', label: 'Ask to join' });
  assert.equal(circleAction(circle({ my_status: 'requested' })).kind, 'pending');
  assert.equal(circleAction(circle({ my_status: 'active', my_role: 'member' })).label, 'Open circle');
  assert.equal(circleAction(circle({ my_status: 'active', my_role: 'owner' })).label, 'Manage circle');
  assert.equal(circleAction(circle({ visibility: 'private' })).kind, 'none'); assert.equal(circleAction(circle({ my_status: 'removed' })).kind, 'none');
  assert.match(joinOutcomeMessage('active'), /You are in/); assert.match(joinOutcomeMessage('requested'), /Request sent/);
});
test('circle form: name length, description length, and private circles are refused (there is no way to invite into one yet)', () => {
  const f = { name: ' Hikers ', description: ' ', visibility: 'public' as const, category: 'walking' };
  const ok = validateCircle(f); assert.ok(ok.ok); if (ok.ok) assert.equal(ok.value.name, 'Hikers');
  assert.ok(!validateCircle({ ...f, name: 'a' }).ok); assert.ok(!validateCircle({ ...f, name: 'x'.repeat(81) }).ok); assert.ok(!validateCircle({ ...f, description: 'x'.repeat(601) }).ok);
  const priv = validateCircle({ ...f, visibility: 'private' }); assert.ok(!priv.ok); if (!priv.ok) assert.match(priv.errors.visibility!, /not available/);
});
test('circle event form mirrors post_circle_event', () => {
  const f = { title: 'Sunday walk', area: 'Hampstead', venue: '', startsAt: at(48), capacity: '', description: '' };
  const ok = validateCircleEvent(f, NOW); assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.value.capacity, null); assert.equal(ok.value.public_venue_name, null); assert.equal(ok.value.title, 'Sunday walk'); }
  assert.ok(!validateCircleEvent({ ...f, startsAt: new Date(NOW.getTime() + 20 * 60_000) }, NOW).ok); assert.ok(!validateCircleEvent({ ...f, startsAt: at(121 * 24) }, NOW).ok);
  assert.ok(!validateCircleEvent({ ...f, capacity: '1' }, NOW).ok); assert.ok(!validateCircleEvent({ ...f, capacity: 'many' }, NOW).ok); assert.ok(validateCircleEvent({ ...f, capacity: '12' }, NOW).ok);
  assert.ok(!validateCircleEvent({ ...f, title: '', area: '' }, NOW).ok);
});

test('double date form: needs a full pair, 2 hours to 60 days ahead, and passes the arguments the function wants', () => {
  const pair = { members: [{ status: 'accepted' }, { status: 'accepted' }] }, half = { members: [{ status: 'accepted' }, { status: 'invited' }] };
  const f = { teamId: 't', modeId: 'friendship', startsAt: at(72), venue: ' The Pub ' };
  const ok = validateDoubleDate(f, pair, NOW); assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.value, { p_team: 't', p_mode: 'friendship', p_starts: at(72).toISOString(), p_venue: 'The Pub' });
  const h = validateDoubleDate(f, half, NOW); assert.ok(!h.ok); if (!h.ok) assert.match(h.errors.teamId!, /needs a pair/);
  assert.ok(!validateDoubleDate({ ...f, startsAt: at(1) }, pair, NOW).ok); assert.ok(!validateDoubleDate({ ...f, startsAt: at(61 * 24) }, pair, NOW).ok);
  assert.ok(!validateDoubleDate({ ...f, teamId: null }, null, NOW).ok); assert.ok(!validateDoubleDate({ ...f, venue: 'x'.repeat(81) }, pair, NOW).ok);
  assert.equal(isFullTeam(pair.members), true); assert.equal(isFullTeam(half.members), false);
  const dd = (state: string, is_mine = false): DoubleDateRow => ({ id: 'd', state, starts_at: '', venue: null, team_a_names: [], team_b_names: null, team_a_kind: 'friends', is_mine, my_team: null, can_request: false });
  assert.equal(doubleDateStatus(dd('looking', true)), 'Waiting for another pair'); assert.equal(doubleDateStatus(dd('looking')), 'Looking for another pair');
  assert.equal(doubleDateStatus(dd('scheduled')), 'Confirmed'); assert.equal(doubleDateStatus(dd('cancelled')), 'Cancelled');
});

test('wingperson permissions: every permission has plain wording, toggling works, and chats are never among them', () => {
  for (const p of wingPermissionList()) { assert.ok(WING_PERMISSION_INFO[p].label && WING_PERMISSION_INFO[p].hint); }
  assert.ok(!wingPermissionList().some((p) => /chat|message/.test(p)));
  assert.deepEqual(toggleWingPermission([], 'shortlist'), ['shortlist']); assert.deepEqual(toggleWingPermission(['shortlist', 'suggest_openers'], 'shortlist'), ['suggest_openers']);
  assert.match(WING_PERMISSION_INFO.view_shared_profile.hint, /Never my chats/);
});

test('friendly errors: limits and plain server messages are shown, everything else stays generic', () => {
  assert.match(friendlyError({ code: 'SQ431' }), /limit/); assert.match(friendlyError({ code: 'SQ429' }), /Slow down/);
  assert.equal(friendlyError({ code: '22023', message: 'you already signed up for this' }), 'You already signed up for this.');
  assert.equal(friendlyError({ code: '42501', message: 'unavailable' }), 'That is not available.');
  assert.equal(friendlyError({ code: 'XX000', message: 'relation "secret_table" does not exist' }), 'Something went wrong. Please try again.');
  assert.ok(!friendlyError({ code: '22023', message: 'x'.repeat(300) }).includes('xxxx'));
  assert.match(friendlyError(new TypeError('Network request failed')), /connection/);
});
