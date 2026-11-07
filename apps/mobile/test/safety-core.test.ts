import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinOptions, checkinsNeedingAnswer, countdown, DELETION_GRACE_DAYS, deletionDate, formatFriendCode, isFriendCode, normalizeFriendCode, pendingDeletion, restrictedView, splitContacts, summarizeData, upcomingCheckins, validateAppeal, validateContactLabel, CHECKIN_STATUS_TEXT } from '../src/core/safety-core.ts';
import type { CheckinRow, DataRequestRow, TrustedContactRow } from '../src/core/db-types.ts';

const NOW = new Date('2026-11-06T10:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const req = (o: Partial<DataRequestRow>): DataRequestRow => ({ id: 'r', kind: 'export', status: 'queued', requested_at: NOW.toISOString(), completed_at: null, ready: false, ...o });

test('friend codes: tolerant of spaces, dashes and case; exactly 8 letters or digits', () => {
  assert.equal(normalizeFriendCode(' ab12-cd34 '), 'AB12CD34'); assert.ok(isFriendCode('ab12 cd34')); assert.ok(!isFriendCode('AB12CD3')); assert.ok(!isFriendCode('AB12CD345')); assert.ok(!isFriendCode(''));
  assert.equal(formatFriendCode('ab12cd34'), 'AB12 CD34');
});

test('restricted screen: suspended and banned people can appeal; pending deletion can be cancelled with a date; nobody gets a wrong option', () => {
  const s = restrictedView('suspended', []); assert.deepEqual([s.kind, s.canAppeal, s.canCancelDeletion], ['suspended', true, false]);
  const b = restrictedView('banned', []); assert.deepEqual([b.kind, b.canAppeal, b.canCancelDeletion], ['banned', true, false]);
  const d = restrictedView('deleted', [req({ kind: 'deletion', status: 'queued', requested_at: NOW.toISOString() })]);
  assert.deepEqual([d.kind, d.canAppeal, d.canCancelDeletion], ['deletion_pending', false, true]); assert.equal(d.deletesAt!.getTime(), day(DELETION_GRACE_DAYS).getTime());
  const c = restrictedView('deleted', [req({ kind: 'deletion', status: 'done' })]); assert.deepEqual([c.kind, c.canCancelDeletion, c.deletesAt], ['closed', false, null]);
  const c2 = restrictedView('deleted', []); assert.equal(c2.kind, 'closed');
  assert.ok(!/ban(ned)?\b/i.test(s.headline + s.body), 'a suspension must not call itself a ban');
});
test('pending deletion picks the newest queued request and ignores cancelled or done ones', () => {
  const rows = [req({ id: 'a', kind: 'deletion', status: 'cancelled', requested_at: day(-1).toISOString() }), req({ id: 'b', kind: 'deletion', requested_at: day(-3).toISOString() }), req({ id: 'c', kind: 'deletion', requested_at: day(-2).toISOString() }), req({ id: 'd', kind: 'export' })];
  assert.equal(pendingDeletion(rows)!.id, 'c'); assert.equal(pendingDeletion([]), null);
});
test('appeal text: 10 to 1000 characters after trimming, with kind messages', () => {
  assert.ok(!validateAppeal('too short').ok); assert.ok(validateAppeal('  this is a fair length  ').ok); assert.ok(!validateAppeal('x'.repeat(1001)).ok); assert.ok(validateAppeal('x'.repeat(1000)).ok);
  const r = validateAppeal('  hello there friend  '); if (r.ok) assert.equal(r.value, 'hello there friend');
});
test('countdown wording', () => {
  assert.equal(countdown(day(3), NOW), '3 days'); assert.equal(countdown(new Date(NOW.getTime() + 3 * 86_400_000 + 5 * 3_600_000), NOW), '3 days 5h');
  assert.equal(countdown(new Date(NOW.getTime() + 5 * 3_600_000), NOW), '5 hours'); assert.equal(countdown(new Date(NOW.getTime() + 600_000), NOW), '1 hour'); assert.equal(countdown(day(-1), NOW), 'any moment now');
  assert.equal(deletionDate(NOW.toISOString()).getTime(), day(7).getTime());
});

test('data summary: preparing, ready, expired, failed, and a pending deletion with its date', () => {
  assert.equal(summarizeData([], NOW).exportState, 'none');
  assert.equal(summarizeData([req({ status: 'processing' })], NOW).exportState, 'preparing');
  assert.equal(summarizeData([req({ status: 'done', ready: true, completed_at: day(-1).toISOString() })], NOW).exportState, 'ready');
  assert.equal(summarizeData([req({ status: 'done', ready: true, completed_at: day(-8).toISOString() })], NOW).exportState, 'expired');
  assert.equal(summarizeData([req({ status: 'done', ready: false, completed_at: day(-1).toISOString() })], NOW).exportState, 'expired');   // file was removed
  assert.equal(summarizeData([req({ status: 'failed' })], NOW).exportState, 'failed');
  const newest = summarizeData([req({ id: 'old', status: 'failed', requested_at: day(-5).toISOString() }), req({ id: 'new', status: 'queued', requested_at: day(-1).toISOString() })], NOW); assert.equal(newest.exportRequest!.id, 'new'); assert.equal(newest.exportState, 'preparing');
  const s = summarizeData([req({ kind: 'deletion', requested_at: day(-2).toISOString() })], NOW); assert.equal(s.deletesAt!.getTime(), day(5).getTime());
});

test('trusted contacts are split into the people I chose and the people who chose me; labels are validated', () => {
  const rows: TrustedContactRow[] = [{ id: '1', label: 'Sis', contact_name: 'Ana', direction: 'mine' }, { id: '2', label: 'x', contact_name: 'Bo', direction: 'for_me' }];
  const s = splitContacts(rows); assert.deepEqual([s.mine.length, s.forMe.length], [1, 1]);
  assert.ok(!validateContactLabel('  ').ok); assert.ok(!validateContactLabel('x'.repeat(41)).ok); assert.deepEqual(validateContactLabel(' Sis '), { ok: true, value: 'Sis' });
});
test('check-in times: only ahead of now and within 30 days, in order, and an end-based option when the plan has an end', () => {
  const start = new Date(NOW.getTime() + 2 * 3_600_000);
  const o = checkinOptions(start, new Date(start.getTime() + 90 * 60_000), NOW);
  assert.deepEqual(o.map((x) => x.label), ['1 hour after it starts', '2 hours after it starts', '30 minutes after it ends', '3 hours after it starts', '6 hours after it starts']);
  assert.ok(o.every((x, i) => i === 0 || x.at >= o[i - 1]!.at));
  assert.deepEqual(checkinOptions(new Date(NOW.getTime() - 5 * 3_600_000), null, NOW).map((x) => x.label), ['6 hours after it starts']);       // earlier options already passed
  assert.deepEqual(checkinOptions(day(40), null, NOW), []);
});
test('check-ins that need an answer include missed ones (the person can still say they are fine)', () => {
  const mk = (status: string): CheckinRow => ({ id: status, source_type: 'invite', source_id: 's', check_in_at: '', status, contact_label: null });
  const rows = ['scheduled', 'prompted', 'missed', 'confirmed_safe', 'needs_help', 'cancelled'].map(mk);
  assert.deepEqual(checkinsNeedingAnswer(rows).map((r) => r.status), ['prompted', 'missed']); assert.deepEqual(upcomingCheckins(rows).map((r) => r.status), ['scheduled']);
  for (const r of rows) assert.ok(CHECKIN_STATUS_TEXT[r.status]);
});

import { readFileSync } from 'node:fs';
test('the numbers the app shows match the worker and the database (7-day deletion, 7-day export, 30-minute escalation text)', () => {
  const jobs = readFileSync(new URL('../../api/src/jobs.ts', import.meta.url), 'utf8');
  assert.equal(Number(/DELETION_GRACE_DAYS = (\d+)/.exec(jobs)![1]), DELETION_GRACE_DAYS);
  assert.equal(Number(/EXPORT_LINK_DAYS = (\d+)/.exec(jobs)![1]), 7);
  assert.equal(Number(/CHECKIN_ESCALATE_AFTER_MIN = (\d+)/.exec(jobs)![1]), 30);
  const sql = readFileSync(new URL('../../../supabase/migrations/0010_safety_privacy.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("at + interval '7 days'"));
});
