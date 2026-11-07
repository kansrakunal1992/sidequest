import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRouletteGroups, parseRouletteKey, rouletteAreaKey, splitRouletteActivity, withRouletteArea, NOTIFICATION_KINDS } from '../src/index.ts';

test('area keys are normalised and cannot contain the key separators', () => {
  assert.equal(rouletteAreaKey('  Soho | London @ '), 'soho london');
  assert.equal(withRouletteArea('dinner', 'Soho'), 'dinner@soho');
  assert.deepEqual(splitRouletteActivity('dinner @ 8@soho'), { activity: 'dinner @ 8', area: 'soho' });
  assert.deepEqual(splitRouletteActivity('dinner'), { activity: 'dinner', area: null });
});

test('group keys round-trip through the real matcher, including odd activity text', () => {
  const mk = (u: string, activity: string, area: string) => ({ userId: u, mode: 'friendship' as const, activity: withRouletteArea(activity, area),
    slot: '2026-11-07T20:00:00.000Z', energy: 'social' as const, groupSize: 2, blockedUserIds: [] });
  const { groups } = assembleRouletteGroups([mk('a', 'dinner | drinks @ 8', 'Soho'), mk('b', 'dinner | drinks @ 8', ' soho ')]);
  assert.equal(groups.length, 1);
  const p = parseRouletteKey(groups[0]!.key)!;
  assert.equal(p.mode, 'friendship'); assert.equal(p.activity, 'dinner | drinks @ 8'); assert.equal(p.area, 'soho');
  assert.equal(p.slot, '2026-11-07T20:00:00.000Z'); assert.equal(p.groupSize, 2);
});

test('people in different areas are never grouped, even for the same activity and time', () => {
  const mk = (u: string, area: string) => ({ userId: u, mode: 'friendship' as const, activity: withRouletteArea('dinner', area),
    slot: '2026-11-07T20:00:00.000Z', energy: 'social' as const, groupSize: 2, blockedUserIds: [] });
  const r = assembleRouletteGroups([mk('a', 'Soho'), mk('b', 'Leeds')]);
  assert.equal(r.groups.length, 0); assert.deepEqual(r.waitlist.sort(), ['a', 'b']);
});

test('key parsing: three-part keys, and rejects junk', () => {
  assert.deepEqual(parseRouletteKey('dating|walk@park|2026-11-07T20:00:00Z'), { mode: 'dating', activity: 'walk', area: 'park', slot: '2026-11-07T20:00:00Z', groupSize: null });
  assert.equal(parseRouletteKey('nope'), null);
  assert.equal(parseRouletteKey('a|b|not-a-date'), null);
  assert.equal(parseRouletteKey('a||2026-11-07T20:00:00Z'), null);
});

test('notification kinds are unique', () => {
  assert.equal(new Set(NOTIFICATION_KINDS).size, NOTIFICATION_KINDS.length);
});
