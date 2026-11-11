import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DATE_IDEA_LIMIT, FIRST_MEET_TIPS, FREE_WINDOWS, MEET_ACTIVITIES, NOTIFICATION_KINDS, buildPlanShareText, freeWindowLabel, hasContactDetails,
  isFreeWindow, isMeetActivity, meetActivityLabel, meetTitle, sharedDateIdeas, validateMeetPlace,
} from '../src/index.ts';

const sql = readFileSync(new URL('../../../supabase/migrations/0018_lets_meet.sql', import.meta.url), 'utf8');

test('activity ids match the database function exactly', () => {
  const m = /v_ok text\[\] := array\[([^\]]+)\]/.exec(sql);
  assert.ok(m, 'activity list not found in set_date_ideas');
  const inSql = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
  assert.deepEqual(inSql, MEET_ACTIVITIES.map((a) => a.id).sort());
});
test('free windows and the idea limit match the database', () => {
  const m = /free_window in \(([^)]+)\)/.exec(sql);
  assert.ok(m);
  assert.deepEqual([...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort(), FREE_WINDOWS.map((w) => w.id).sort());
  assert.match(sql, new RegExp(`cardinality\\(ideas\\) <= ${DATE_IDEA_LIMIT}`));
  assert.match(sql, new RegExp(`cardinality\\(v_ideas\\) > ${DATE_IDEA_LIMIT}`));
});
test('activity table is well formed', () => {
  assert.equal(new Set(MEET_ACTIVITIES.map((a) => a.id)).size, MEET_ACTIVITIES.length);
  for (const a of MEET_ACTIVITIES) { assert.ok(a.label.length > 2 && a.minutes >= 30 && a.minutes <= 240, a.id); assert.ok(a.id.length >= 2 && a.id.length <= 30); }
  assert.equal(isMeetActivity('walk'), true); assert.equal(isMeetActivity('skydiving'), false); assert.equal(isMeetActivity(7), false);
  assert.equal(meetActivityLabel('chai_coffee'), 'Chai or coffee'); assert.equal(meetActivityLabel(null), 'Meet up');
  assert.equal(isFreeWindow('weekends'), true); assert.equal(isFreeWindow('now'), false); assert.equal(freeWindowLabel('flexible'), 'Flexible'); assert.equal(freeWindowLabel(null), null);
});
test('contact details are spotted, ordinary places are not', () => {
  for (const bad of ['call 98765 43210', 'me@x.com', 'https://x.y', 'www.cafe.in', 'insta @aman', '+91-98765-43210', 'wa.me/919876543210', 'cafe.in']) assert.equal(hasContactDetails(bad), true, bad);
  for (const good of ['Blue Tokai', 'Khan Market', 'Sector 29, Gurgaon', 'Cafe 91 Springboard', 'Terminal 3 food court', 'Hauz Khas Village']) assert.equal(hasContactDetails(good), false, good);
});
test('a plan needs a place and an area', () => {
  assert.deepEqual(validateMeetPlace('  Blue   Tokai ', ' Khan Market'), { ok: true, venueName: 'Blue Tokai', areaLabel: 'Khan Market' });
  assert.deepEqual(validateMeetPlace('', 'Khan Market'), { ok: false, error: 'venue_required' });
  assert.deepEqual(validateMeetPlace('Cafe', ' '), { ok: false, error: 'area_required' });
  assert.deepEqual(validateMeetPlace(undefined, undefined), { ok: false, error: 'venue_required' });
  assert.deepEqual(validateMeetPlace('x'.repeat(81), 'Delhi'), { ok: false, error: 'place_too_long' });
  assert.deepEqual(validateMeetPlace('Cafe, call 9876543210', 'Delhi'), { ok: false, error: 'place_contact_details' });
  assert.deepEqual(validateMeetPlace('Cafe', 'me@x.com'), { ok: false, error: 'place_contact_details' });
});
test('shared ideas keep my order', () => {
  assert.deepEqual(sharedDateIdeas(['walk', 'movie', 'meal'], ['meal', 'walk']), ['walk', 'meal']);
  assert.deepEqual(sharedDateIdeas([], ['walk']), []);
  assert.deepEqual(sharedDateIdeas(['walk'], []), []);
});
test('titles and the plan note carry no contact details and only a first name', () => {
  assert.equal(meetTitle('walk', 'Aman'), 'A walk with Aman');
  const t = buildPlanShareText({ name: 'Aman Kumar', activityId: 'chai_coffee', venueName: 'Blue Tokai', areaLabel: 'Khan Market', whenText: 'Sat, 14 Nov, 4:00 pm', durationMinutes: 60 });
  assert.match(t, /meeting Aman for chai or coffee at Blue Tokai, Khan Market on Sat, 14 Nov, 4:00 pm/);
  assert.doesNotMatch(t, /Kumar/); assert.equal(hasContactDetails(t.replace(/\d{1,2}:\d{2}/, '')), false);
  assert.match(buildPlanShareText({ name: '  ', activityId: 'x', venueName: 'V', areaLabel: 'A', whenText: 'w', durationMinutes: 30 }), /meeting someone for meet up/);
});
test('tips are short and the new reminder kind exists once', () => {
  assert.equal(FIRST_MEET_TIPS.length, 3); for (const t of FIRST_MEET_TIPS) assert.ok(t.length < 90);
  assert.equal(NOTIFICATION_KINDS.filter((k) => k === 'invite_day_before').length, 1);
});
