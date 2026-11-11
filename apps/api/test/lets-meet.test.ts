import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { sendReminders } from '../src/jobs.ts';
import { inviteDto } from '../src/app.ts';
import { parseCreateInvite } from '../src/validate.ts';
import { A, B, C, setup, input, T0 } from './helpers.ts';

const plan = (o: Record<string, unknown> = {}) => input({ modeId: 'friendship', format: 'in_person', activity: 'chai_coffee', venueName: 'Blue Tokai', areaLabel: 'Khan Market', durationMinutes: 60, note: null, ...o } as any);
const fail = (r: any, status: number, code: string) => { assert.equal(r.ok, false); assert.equal(r.status, status); assert.equal(r.error, code); };

function meetSetup() {
  const s = setup();
  s.store.addUser(A, { displayName: 'Aanya' }, ['friendship']);
  s.store.addUser(B, { displayName: 'Rohan' }, ['friendship']);
  s.store.addUser(C, { displayName: 'Chirag' }, ['friendship']);
  const sender = new NoopPushSender();
  const notifier = createNotifier({ store: s.store, sender, clock: s.clock });
  return { ...s, deps: { store: s.store, notifier, clock: s.clock } };
}
const body = (o: Record<string, unknown> = {}) => ({ recipientId: B, modeId: 'friendship', format: 'in_person', startsAt: '2026-11-03T12:00:00Z', timezone: 'Asia/Kolkata', durationMinutes: 60,
  activity: 'chai_coffee', venueName: 'Blue Tokai', areaLabel: 'Khan Market', ...o });

test('parse: an in-person plan needs a known activity, a place and an area', () => {
  const ok = parseCreateInvite(body()) as any;
  assert.equal(ok.ok, true); assert.equal(ok.value.activity, 'chai_coffee'); assert.equal(ok.value.venueName, 'Blue Tokai'); assert.equal(ok.value.areaLabel, 'Khan Market');
  fail({ ...parseCreateInvite(body({ activity: 'skydiving' })) }, 400, 'invalid_activity');
  fail({ ...parseCreateInvite(body({ activity: undefined })) }, 400, 'invalid_activity');
  fail({ ...parseCreateInvite(body({ venueName: '' })) }, 400, 'venue_required');
  fail({ ...parseCreateInvite(body({ areaLabel: undefined })) }, 400, 'area_required');
  fail({ ...parseCreateInvite(body({ venueName: 'Cafe, ring 9876543210' })) }, 400, 'place_contact_details');
  fail({ ...parseCreateInvite(body({ note: 'chat on https://x.y' })) }, 400, 'invalid_note');
  fail({ ...parseCreateInvite(body({ note: 'call 98765 43210' })) }, 400, 'invalid_note');
  assert.equal((parseCreateInvite(body({ note: 'Gate 7, see you at 5' })) as any).ok, true);
  assert.equal((parseCreateInvite(body({ venueName: '  Blue   Tokai ' })) as any).value.venueName, 'Blue Tokai');
});
test('parse: other formats ignore plan fields', () => {
  const r = parseCreateInvite(body({ format: 'video', activity: 'walk', venueName: 'Park', areaLabel: 'Delhi' })) as any;
  assert.equal(r.ok, true); assert.deepEqual([r.value.activity, r.value.venueName, r.value.areaLabel], [null, null, null]);
});
test('create: in-person needs a match, at least an hour of notice, and stores the place', async () => {
  const { svc, store, at } = meetSetup();
  fail(await svc.create(A, plan({ startsAt: at(180) })), 403, 'needs_match');
  store.addMatch(A, B, 'friendship');
  fail(await svc.create(A, plan({ startsAt: at(30) })), 400, 'start_time_out_of_range');
  const r = await svc.create(A, plan({ startsAt: at(180) })) as any;
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.format, r.value.activity, r.value.venueName, r.value.areaLabel], ['in_person', 'chai_coffee', 'Blue Tokai', 'Khan Market']);
  const dto = inviteDto(r.value); assert.deepEqual([dto.activity, dto.venueName, dto.areaLabel], ['chai_coffee', 'Blue Tokai', 'Khan Market']);
});
test('create: a video call still works without a match in a friendship vibe and carries no place', async () => {
  const { svc } = meetSetup();
  const r = await svc.create(A, input({ modeId: 'friendship', format: 'video' })) as any;
  assert.equal(r.ok, true); assert.equal(r.value.venueName, null);
});
test('accepting an in-person plan names the calendar entry after the activity; the .ics has the place', async () => {
  const { svc, store, at } = meetSetup();
  store.addMatch(A, B, 'friendship');
  const inv = await svc.create(A, plan({ startsAt: at(180) })) as any;
  await svc.act(B, inv.value.id, 'accept');
  const titles = [...store.calendar.values()].map((e: any) => e.title).sort();
  assert.deepEqual(titles, ['Chai or coffee with Aanya', 'Chai or coffee with Rohan']);
  const ics = await svc.ics(B, inv.value.id) as any;
  assert.match(ics.value, /SUMMARY:Chai or coffee with Aanya/); assert.match(ics.value, /LOCATION:Blue Tokai\\, Khan Market/);
});
test('day-before reminder: in-person only, once, and skipped for plans made at short notice', async () => {
  const { svc, deps, store, setTime, at } = meetSetup();
  store.addMatch(A, B, 'friendship');
  const inv = await svc.create(A, plan({ startsAt: at(60 * 30) })) as any;      // 30 h ahead
  await svc.act(B, inv.value.id, 'accept');
  const kinds = () => store.notifications.map((n) => n.kind).filter((k) => k.startsWith('invite_') && k !== 'invite_received' && k !== 'invite_accepted');
  setTime(at(60 * 3));                                                           // 27 h away: too early
  assert.equal(await sendReminders(deps), 0);
  setTime(at(60 * 8));                                                           // 22 h away
  assert.equal(await sendReminders(deps), 2); await sendReminders(deps);
  assert.deepEqual(kinds(), ['invite_day_before', 'invite_day_before']);
  setTime(at(60 * 29));                                                          // 1 h away -> normal reminder
  await sendReminders(deps);
  assert.equal(kinds().filter((k) => k === 'invite_reminder').length, 2);

  // a plan confirmed only 3 hours ahead does not get a "tomorrow" message
  const short = await svc.create(A, plan({ startsAt: at(60 * 29 + 180), recipientId: B })) as any;
  await svc.act(B, short.value.id, 'accept'); store.notifications.length = 0;
  setTime(at(60 * 29 + 5));
  await sendReminders(deps);
  assert.equal(store.notifications.filter((n) => n.kind === 'invite_day_before').length, 0);
});
test('day-before reminder never applies to a call', async () => {
  const { svc, deps, store, setTime, at } = meetSetup();
  const inv = await svc.create(A, input({ modeId: 'friendship', format: 'video', startsAt: at(60 * 30) })) as any;
  await svc.act(B, inv.value.id, 'accept');
  setTime(at(60 * 12)); assert.equal(await sendReminders(deps), 0);
  assert.equal(store.notifications.some((n) => n.kind === 'invite_day_before'), false);
});
