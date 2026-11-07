import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_CALL_TEMPLATES, activityBadge, buildActivityPayload, buildOpenCallPayload, callBadge, canExpressInterest, canJoinActivity, goingLabel, mapActivity,
  mapOpenCall, mapThreadInfo, meetStyleLabel, planErrorMessage, slotsLeft, spotsLeft,
} from '../src/core/plans.ts';
import { ACTIVITY_CATEGORIES } from '@sidequest/shared';

const now = new Date(2026, 10, 1, 10, 0, 0);
const at = (mins: number) => new Date(now.getTime() + mins * 60_000);
const callForm = (o: object = {}) => ({ title: 'Coffee tonight', description: '', startsAt: at(180), area: 'Koregaon Park', venue: '', capacity: 2, budget: '', meetStyle: 'chat_first' as const, ...o });
const call = (o: object = {}) => ({ isMine: false, status: 'open', myStatus: null as string | null, capacity: 2, acceptedCount: 0, ...o });

test('open call rows map cleanly, nulls included', () => {
  const c = mapOpenCall({ id: 'o', host_id: 'h', host_name: 'Aanya', host_age: '26', host_verified: true, title: 'T', starts_at: '2026-11-02T10:00:00Z', area_label: 'Pune', capacity: '4',
    accepted_count: '1', format: 'group', meet_style: 'chat_first', status: 'open', my_status: null, is_mine: false, distance_km: '2.5' });
  assert.deepEqual([c.hostAge, c.capacity, c.acceptedCount, c.distanceKm, c.myStatus, c.venue, c.conversationId], [26, 4, 1, 2.5, null, null, null]);
});
test('places left: the host holds one seat', () => {
  assert.equal(slotsLeft({ capacity: 2, acceptedCount: 0 }), 1);
  assert.equal(slotsLeft({ capacity: 4, acceptedCount: 2 }), 1);
  assert.equal(slotsLeft({ capacity: 2, acceptedCount: 1 }), 0);
  assert.equal(slotsLeft({ capacity: 2, acceptedCount: 9 }), 0);
});
test('who can express interest, and what the card says', () => {
  assert.equal(canExpressInterest(call()), true);
  assert.equal(canExpressInterest(call({ status: 'full' })), true);               // joins the waitlist
  assert.equal(canExpressInterest(call({ isMine: true })), false);
  for (const s of ['interested', 'accepted', 'waitlisted', 'rejected']) assert.equal(canExpressInterest(call({ myStatus: s })), false, s);
  assert.equal(canExpressInterest(call({ myStatus: 'withdrawn' })), true);
  assert.equal(canExpressInterest(call({ status: 'cancelled' })), false);
  assert.deepEqual(callBadge(call({ myStatus: 'accepted' })), { label: "You're in", tone: 'good' });
  assert.equal(callBadge(call({ myStatus: 'rejected' }))!.label, 'Not available');
  assert.doesNotMatch(callBadge(call({ myStatus: 'rejected' }))!.label, /reject|declin|denied/i);
  assert.equal(callBadge(call()), null);
  assert.equal(callBadge(call({ isMine: true, status: 'full' }))!.label, 'Hosting · full');
  assert.equal(callBadge(call({ status: 'cancelled' }))!.label, 'Cancelled');
  assert.equal(meetStyleLabel('direct_meet'), 'Meet directly');
});
test('open call payload: validation mirrors the database', () => {
  const ok = buildOpenCallPayload(callForm({ description: '  Walk and talk  ', venue: ' Cafe X ' }), 'friendship', now, { lat: 18.52, lng: 73.85 });
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.body.description, 'Walk and talk'); assert.equal(ok.body.public_venue_name, 'Cafe X'); assert.equal(ok.body.lat, 18.52); assert.equal(ok.body.mode_id, 'friendship'); assert.equal(ok.body.budget_note, null); }
  const bad = (o: object) => (buildOpenCallPayload(callForm(o), 'friendship', now, null) as { error: string }).error;
  assert.match(bad({ title: ' x ' }), /title/); assert.match(bad({ area: '' }), /area/); assert.match(bad({ startsAt: null }), /day and time/);
  assert.match(bad({ startsAt: at(5) }), /15 minutes/); assert.match(bad({ startsAt: at(61 * 24 * 60) }), /60 days/);
  assert.match(bad({ capacity: 1 }), /2 and 50/); assert.match(bad({ capacity: 51 }), /2 and 50/); assert.match(bad({ capacity: 2.5 }), /2 and 50/);
  assert.match(bad({ description: 'x'.repeat(1001) }), /1000/);
  assert.equal((buildOpenCallPayload(callForm(), 'friendship', now, null) as any).body.lat, null);
  assert.equal(OPEN_CALL_TEMPLATES.every((t) => t.capacity >= 2 && t.title.length >= 2), true);
});

const act = (o: object = {}) => ({ isMine: false, status: 'scheduled', myStatus: null as string | null, capacity: 3 as number | null, going: 1, ...o });
test('activity labels, joining and badges', () => {
  assert.equal(goingLabel({ capacity: 3, going: 1 }), '1 going · 2 spots left');
  assert.equal(goingLabel({ capacity: 3, going: 2 }), '2 going · 1 spot left');
  assert.equal(goingLabel({ capacity: 3, going: 3 }), '3 going · full');
  assert.equal(goingLabel({ capacity: null, going: 5 }), '5 going');
  assert.equal(spotsLeft({ capacity: null, going: 5 }), null); assert.equal(spotsLeft({ capacity: 3, going: 4 }), 0);
  assert.equal(canJoinActivity(act()), true); assert.equal(canJoinActivity(act({ isMine: true })), false);
  assert.equal(canJoinActivity(act({ myStatus: 'accepted' })), false); assert.equal(canJoinActivity(act({ myStatus: 'withdrawn' })), true);
  assert.equal(canJoinActivity(act({ status: 'cancelled' })), false);
  assert.equal(activityBadge(act({ myStatus: 'accepted' }))!.label, "You're going"); assert.equal(activityBadge(act({ isMine: true }))!.label, 'Hosting'); assert.equal(activityBadge(act()), null);
  const m = mapActivity({ id: 'a', host_id: 'h', host_name: 'A', title: 'T', category: 'bowling', starts_at: '2026-11-02T10:00:00Z', area_label: 'Pune', capacity: null, going: '2', is_mine: false, status: 'scheduled' });
  assert.deepEqual([m.capacity, m.going, m.myStatus, m.distanceKm], [null, 2, null, null]);
});
test('activity payload: category, time window, capacity', () => {
  const form = (o: object = {}) => ({ title: 'Bowling night', category: 'bowling', description: '', startsAt: at(24 * 60), area: 'Pune', venue: 'Strike Zone', capacity: 6 as number | null, ...o });
  assert.equal(buildActivityPayload(form(), now, null).ok, true);
  assert.equal((buildActivityPayload(form({ capacity: null }), now, null) as any).body.capacity, null);
  const bad = (o: object) => (buildActivityPayload(form(o), now, null) as { error: string }).error;
  assert.match(bad({ category: null }), /category/); assert.match(bad({ category: 'nightclub' }), /category/); assert.match(bad({ title: '' }), /title/); assert.match(bad({ area: ' ' }), /area/);
  assert.match(bad({ startsAt: at(10) }), /30 minutes/); assert.match(bad({ startsAt: at(121 * 24 * 60) }), /120 days/);
  assert.match(bad({ capacity: 1 }), /2 and 200/); assert.match(bad({ capacity: 201 }), /2 and 200/);
  for (const c of ACTIVITY_CATEGORIES) assert.equal(buildActivityPayload(form({ category: c.id }), now, null).ok, true, c.id);
});
test('thread info for direct and group chats', () => {
  const g = mapThreadInfo({ kind: 'open_call', title: 'Coffee tonight', mode_id: 'friendship', user_id: null, display_name: null, age: null, member_count: 3 });
  assert.deepEqual([g.kind, g.userId, g.memberCount, g.otherLastReadAt, g.sharedInterests], ['open_call', null, 3, null, []]);
  const d = mapThreadInfo({ kind: 'direct', mode_id: 'friendship', user_id: 'u', display_name: 'R', age: '27', shared_interests: ['Food'], other_last_read_at: '2026-11-01T10:00:00Z' });
  assert.deepEqual([d.userId, d.age, d.sharedInterests, d.otherLastReadAt!.toISOString()], ['u', 27, ['Food'], '2026-11-01T10:00:00.000Z']);
});
test('error copy is kind and never explains why someone was unavailable', () => {
  for (const c of ['42501', 'SQ429', 'SQ431', 'SQ432', '22023', undefined]) assert.ok(planErrorMessage(c).length > 10);
  assert.doesNotMatch(planErrorMessage('42501'), /block|reject|declin|hidden/i);
  assert.match(planErrorMessage('SQ432'), /full/);
});
