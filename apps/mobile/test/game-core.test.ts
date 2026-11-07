import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_KINDS, GAME_ROUNDS, pickRounds } from '@sidequest/shared';
import { answerText, answerValid, buildAnswer, gameView, isGameKind, partnerProgress } from '../src/core/game-core.ts';
import type { GameResponseRow, GameSessionRow } from '../src/core/db-types.ts';

const ME = 'me', THEM = 'them', SID = '99999999-9999-4999-8999-999999999999';
const session = (o: Partial<GameSessionRow> = {}): GameSessionRow => ({ id: SID, kind: 'would_you_rather', state: 'active', created_by: THEM, conversation_id: 'c', ...o });
const players = (meAccepted: boolean) => [{ user_id: ME, accepted: meAccepted }, { user_id: THEM, accepted: true }];
const resp = (user_id: string, round: number, answer: unknown): GameResponseRow => ({ user_id, round, answer });

test('game phases follow the session and who has accepted', () => {
  assert.equal(gameView(session({ state: 'invited' }), players(false), [], ME).phase, 'respond');
  assert.equal(gameView(session({ state: 'invited', created_by: ME }), players(true), [], ME).phase, 'waiting_accept');
  assert.equal(gameView(session({ state: 'declined' }), players(false), [], ME).phase, 'declined');
  assert.equal(gameView(session(), players(true), [], ME).phase, 'play');
  assert.equal(gameView(session({ state: 'finished' }), players(true), [], ME).phase, 'finished');
  assert.equal(gameView(session({ kind: 'mystery' }), players(true), [], ME).phase, 'unknown');
});
test('the current round is the first one I have not answered, and after five I wait for them', () => {
  const rs = [0, 1].map((r) => resp(ME, r, { text: 'x' }));
  assert.equal(gameView(session({ kind: 'rapid_fire' }), players(true), rs, ME).round, 2);
  const all = Array.from({ length: GAME_ROUNDS }, (_, r) => resp(ME, r, { text: 'x' }));
  const v = gameView(session({ kind: 'rapid_fire' }), players(true), all, ME); assert.deepEqual([v.phase, v.round], ['waiting_partner', GAME_ROUNDS]);
});
test('answers appear only for rounds I answered; their answer shows only once they have answered too (the database enforces the same)', () => {
  const rounds = pickRounds('would_you_rather', SID);
  const rs = [resp(ME, 0, { choice: 1 }), resp(THEM, 0, { choice: 1 }), resp(ME, 1, { choice: 0 })];
  const v = gameView(session(), players(true), rs, ME);
  assert.equal(v.revealed.length, 2);
  assert.deepEqual([v.revealed[0]!.mine, v.revealed[0]!.theirs], [rounds[0]!.choices![1], rounds[0]!.choices![1]]);
  assert.equal(v.revealed[1]!.theirs, null);
  assert.deepEqual([v.matches, v.compared], [1, 1]);
});
test('compatibility counts matches only over rounds both answered', () => {
  const rounds = pickRounds('compatibility', SID);
  const rs = [resp(ME, 0, { choice: 0 }), resp(THEM, 0, { choice: 1 }), resp(ME, 1, { choice: 0 }), resp(THEM, 1, { choice: 0 }), resp(ME, 2, { choice: 0 })];
  const v = gameView(session({ kind: 'compatibility' }), players(true), rs, ME);
  assert.deepEqual([v.matches, v.compared], [1, 2]); assert.ok(rounds.length === GAME_ROUNDS);
  assert.equal(gameView(session({ kind: 'rapid_fire' }), players(true), [], ME).matches, null);       // free-text games have no score
});
test('answer building and validation: pick-one rounds need a valid choice, text rounds need some text, text is trimmed and capped', () => {
  const pick = { prompt: 'q', choices: ['a', 'b'] }, text = { prompt: 'q' };
  assert.deepEqual(buildAnswer(pick, { choice: 1 }), { choice: 1 }); assert.deepEqual(buildAnswer(text, { text: '  hi  ' }), { text: 'hi' });
  assert.equal(((buildAnswer(text, { text: 'x'.repeat(500) }) as { text: string }).text).length, 200);
  assert.ok(answerValid(pick, { choice: 0 })); assert.ok(!answerValid(pick, { choice: 2 })); assert.ok(!answerValid(pick, {})); assert.ok(!answerValid(pick, { choice: 0.5 }));
  assert.ok(answerValid(text, { text: 'a' })); assert.ok(!answerValid(text, { text: '   ' }));
  assert.ok(JSON.stringify(buildAnswer(text, { text: 'x'.repeat(500) })).length < 600);          // the database caps an answer at 600 characters
  assert.equal(answerText('plain', pick), 'plain'); assert.equal(answerText({ choice: 1 }, pick), 'b'); assert.equal(answerText({ choice: 9 }, pick), ''); assert.equal(answerText(null, pick), '');
});
test('every game kind in the shared list is recognised, and unknown ones are not', () => {
  for (const k of GAME_KINDS) assert.ok(isGameKind(k)); assert.ok(!isGameKind('poker'));
  assert.equal(partnerProgress([resp(ME, 0, 1), resp(THEM, 0, 1), resp(THEM, 1, 1)], ME), 2);
});
