import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvitePayload, hasOpenPlanWith, inviteHeadline, inviteTitle, isInPerson, placeText, planShareMessage, FORMATS, FORMAT_LABELS, IN_PERSON_DURATIONS } from '../src/core/invite-ui.ts';
import { planNudge } from '../src/core/chat-core.ts';
import { ideasSummary, isFull, mapDateIdeas, toggleIdea, youBothLike } from '../src/core/date-ideas.ts';
import { friendlyError, ApiError } from '../src/core/api-client.ts';
import { describeNotification } from '../src/core/inbox-core.ts';

const now = new Date('2026-11-10T10:00:00Z');
const hrs = (h: number) => new Date(now.getTime() + h * 3_600_000);
const meet = (o: Record<string, unknown> = {}) => ({ recipientId: 'r', modeId: 'friendship', format: 'in_person' as const, startsAt: hrs(5), durationMinutes: 60, note: '', activity: 'chai_coffee', venueName: 'Blue Tokai', areaLabel: 'Khan Market', ...o });

test('meetup payload: needs an activity, a place, an area and an hour of notice', () => {
  const ok = buildInvitePayload(meet({ venueName: '  Blue   Tokai ' }), 'Asia/Kolkata', now) as any;
  assert.equal(ok.ok, true); assert.deepEqual([ok.body.activity, ok.body.venueName, ok.body.areaLabel, ok.body.format], ['chai_coffee', 'Blue Tokai', 'Khan Market', 'in_person']);
  assert.match((buildInvitePayload(meet({ startsAt: hrs(0.5) }), 'UTC', now) as any).error, /an hour/);
  assert.match((buildInvitePayload(meet({ activity: null }), 'UTC', now) as any).error, /what you would like to do/);
  assert.match((buildInvitePayload(meet({ activity: 'skydiving' }), 'UTC', now) as any).error, /what you would like to do/);
  assert.match((buildInvitePayload(meet({ venueName: '' }), 'UTC', now) as any).error, /Name the place/);
  assert.match((buildInvitePayload(meet({ areaLabel: ' ' }), 'UTC', now) as any).error, /neighbourhood/);
  assert.match((buildInvitePayload(meet({ venueName: 'Cafe 9876543210' }), 'UTC', now) as any).error, /phone numbers/);
  assert.match((buildInvitePayload(meet({ note: 'text me wa.me/9198' }), 'UTC', now) as any).error, /phone numbers/);
});
test('other formats never carry place fields, and keep the 10 minute rule', () => {
  const r = buildInvitePayload({ ...meet(), format: 'video', activity: 'walk' } as any, 'UTC', now) as any;
  assert.equal(r.ok, true); for (const k of ['activity', 'venueName', 'areaLabel']) assert.equal(k in r.body, false);
  assert.match((buildInvitePayload({ ...meet(), format: 'video', startsAt: hrs(0.05) } as any, 'UTC', now) as any).error, /10 minutes/);
});
test('formats, durations and labels', () => {
  assert.equal(FORMATS[0], 'in_person'); assert.equal(FORMAT_LABELS.in_person, 'Meet in person');
  assert.ok(IN_PERSON_DURATIONS.every((d) => d >= 60 && d <= 240));
});
test('headline, title and place text', () => {
  const inv = { format: 'in_person' as const, activity: 'walk', venueName: 'Lodhi Garden', areaLabel: 'Lodhi Road' };
  assert.equal(inviteHeadline(inv), 'A walk'); assert.equal(inviteTitle(inv, 'Aman'), 'A walk with Aman'); assert.equal(placeText(inv), 'Lodhi Garden, Lodhi Road'); assert.equal(isInPerson(inv), true);
  const call = { format: 'video' as const, activity: null, venueName: null, areaLabel: null };
  assert.equal(inviteHeadline(call), 'Video call'); assert.equal(inviteTitle(call, 'Aman'), 'Video call with Aman'); assert.equal(placeText(call), null);
});
test('share message: only for meetups, first name only, no contact details', () => {
  const inv: any = { id: 'i', format: 'in_person', activity: 'chai_coffee', venueName: 'Blue Tokai', areaLabel: 'Khan Market', startsAt: '2026-11-14T10:30:00Z', timezone: 'Asia/Kolkata', durationMinutes: 60 };
  const m = planShareMessage(inv, 'Aman Kumar')!;
  assert.match(m, /meeting Aman for chai or coffee at Blue Tokai, Khan Market/); assert.match(m, /4:00/); assert.doesNotMatch(m, /Kumar/);
  assert.equal(planShareMessage({ ...inv, format: 'video' }, 'Aman'), null);
  assert.equal(planShareMessage({ ...inv, venueName: null }, 'Aman'), null);
});
test('open plan detection: only live meetups with that person, and only future ones', () => {
  const v = (o: Record<string, unknown>) => ({ format: 'in_person' as const, state: 'accepted', senderId: 'me', recipientId: 'x', startsAt: hrs(3).toISOString(), ...o });
  assert.equal(hasOpenPlanWith([v({})], 'me', 'x', now), true);
  assert.equal(hasOpenPlanWith([v({ senderId: 'x', recipientId: 'me', state: 'pending' })], 'me', 'x', now), true);
  assert.equal(hasOpenPlanWith([v({ state: 'declined' })], 'me', 'x', now), false);
  assert.equal(hasOpenPlanWith([v({ state: 'completed' })], 'me', 'x', now), false);
  assert.equal(hasOpenPlanWith([v({ startsAt: hrs(-2).toISOString() })], 'me', 'x', now), false);
  assert.equal(hasOpenPlanWith([v({ format: 'video' })], 'me', 'x', now), false);
  assert.equal(hasOpenPlanWith([v({ recipientId: 'y' })], 'me', 'x', now), false);
});

const msg = (from: string, minsAgo: number) => ({ senderId: from, createdAt: new Date(now.getTime() - minsAgo * 60_000) });
const base = { me: 'me', now, hasOpenPlan: false, dismissed: false, eligible: true };
test('plan nudge: appears after a real back and forth', () => {
  const six = [msg('me', 50), msg('x', 45), msg('me', 40), msg('x', 30), msg('me', 20), msg('x', 10)];
  assert.equal(planNudge({ ...base, messages: six })?.reason, 'ready');
  assert.equal(planNudge({ ...base, messages: six.slice(2) })?.reason ?? null, null);           // only four recent, not yet
  assert.equal(planNudge({ ...base, messages: [msg('me', 9), msg('me', 8), msg('me', 7), msg('me', 6), msg('me', 5), msg('me', 4)] }), null);   // one-sided
  assert.equal(planNudge({ ...base, messages: [] }), null);
});
test('plan nudge: quiet chats get a different prompt, and it never nags', () => {
  const quiet = [msg('me', 3000), msg('x', 2990), msg('me', 2980), msg('x', 2970)];                // about two days ago
  assert.equal(planNudge({ ...base, messages: quiet })?.reason, 'quiet');
  assert.equal(planNudge({ ...base, messages: quiet, hasOpenPlan: true }), null);
  assert.equal(planNudge({ ...base, messages: quiet, dismissed: true }), null);
  assert.equal(planNudge({ ...base, messages: quiet, eligible: false }), null);
  const recent = [msg('me', 50), msg('x', 40), msg('me', 30), msg('x', 20)];
  assert.equal(planNudge({ ...base, messages: recent }), null);                                     // four messages, but fresh
});

test('date ideas: unknown values are dropped and the limit holds', () => {
  assert.deepEqual(mapDateIdeas({ ideas: ['walk', 'skydiving', 'movie', 'meal', 'museum'], free_window: 'weekends' }), { ideas: ['walk', 'movie', 'meal'], freeWindow: 'weekends' });
  assert.deepEqual(mapDateIdeas({ ideas: 'walk', free_window: 'midnight' }), { ideas: [], freeWindow: null });
  assert.deepEqual(mapDateIdeas(null), { ideas: [], freeWindow: null });
  let sel: any[] = [];
  for (const id of ['walk', 'movie', 'meal', 'museum']) sel = toggleIdea(sel, id as any);
  assert.deepEqual(sel, ['walk', 'movie', 'meal']); assert.equal(isFull(sel), true);
  assert.deepEqual(toggleIdea(sel, 'movie' as any), ['walk', 'meal']);
});
test('date ideas: summary and shared ideas', () => {
  assert.equal(ideasSummary({ ideas: ['chai_coffee', 'walk'], freeWindow: 'weekends' }), 'Chai or coffee, A walk. Free: weekends');
  assert.equal(ideasSummary({ ideas: [], freeWindow: null }), null);
  assert.deepEqual(youBothLike(['walk', 'movie', 'meal'], ['meal', 'walk', 'bogus']), ['walk', 'meal']);
});
test('errors and the day-before notification read plainly', () => {
  assert.match(friendlyError(new ApiError(400, 'venue_required')), /Name the place/);
  assert.match(friendlyError(new ApiError(400, 'place_contact_details')), /phone numbers/);
  assert.match(friendlyError(new ApiError(403, 'needs_match')), /matched/);
  const e = describeNotification('invite_day_before', { inviteId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(e.title, 'Your plan is coming up'); assert.equal(e.route, '/invite/11111111-1111-4111-8111-111111111111');
});
