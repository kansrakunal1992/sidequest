import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_KINDS, GAME_ROUNDS, NOTIFICATION_KINDS, pickRounds } from '../src/index.ts';

test('games: same session gives both players the same five distinct questions', () => {
  for (const kind of GAME_KINDS) {
    const a = pickRounds(kind, 'session-1'), b = pickRounds(kind, 'session-1');
    assert.deepEqual(a, b); assert.equal(a.length, GAME_ROUNDS);
    assert.equal(new Set(a.map((r) => r.prompt + (r.choices ?? []).join())).size, GAME_ROUNDS, kind);
    for (const r of a) { assert.ok(r.prompt.length > 3); if (r.choices) assert.ok(r.choices.length >= 2 && r.choices.length <= 3); }
  }
  assert.notDeepEqual(pickRounds('rapid_fire', 'session-1'), pickRounds('rapid_fire', 'session-2'));
});
test('database rounds line up with the app (0-4)', () => { assert.equal(GAME_ROUNDS, 5); });
test('notification kinds are unique and complete enough', () => {
  assert.equal(new Set(NOTIFICATION_KINDS).size, NOTIFICATION_KINDS.length);
  for (const k of ['invite_received', 'message_received', 'checkin_missed', 'moderation_notice', 'double_date_request']) assert.ok((NOTIFICATION_KINDS as readonly string[]).includes(k));
});
