// In-app calls: the pure rules. The join window must agree with the server (callWindow in apps/api/src/invite-service.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callWindowFor, clock, endedText, isAudioOnly, isCallFormat, joinLabel, joinState, secondsUntil, tilesFromParticipants } from '../src/core/call-core.ts';

const T = new Date('2026-12-01T14:00:00Z');
const inv = (o: object = {}) => ({ format: 'video', state: 'accepted', startsAt: T.toISOString(), durationMinutes: 20, ...o });
const at = (mins: number) => new Date(T.getTime() + mins * 60_000);

test('the join window opens 10 minutes before the start and closes 30 minutes after the planned end', () => {
  const w = callWindowFor(T.toISOString(), 20);
  assert.equal(w.from.getTime(), at(-10).getTime()); assert.equal(w.until.getTime(), at(50).getTime());
  assert.equal(joinState(inv(), at(-11), true)?.kind, 'soon');
  assert.equal(joinState(inv(), at(-10), true)?.kind, 'open');
  assert.equal(joinState(inv(), at(50), true)?.kind, 'open');
  assert.equal(joinState(inv(), at(51), true)?.kind, 'ended');
  const soon = joinState(inv(), at(-60), true); assert.ok(soon?.kind === 'soon' && soon.opensAt.getTime() === at(-10).getTime());
});

test('who gets a join button: only confirmed call invitations, and only when calls are switched on', () => {
  assert.equal(joinState(inv({ format: 'text' }), T, true), null);
  assert.equal(joinState(inv({ format: 'in_person' }), T, true), null);
  assert.equal(joinState(inv({ state: 'pending' }), T, true)?.kind, 'not_confirmed');
  assert.equal(joinState(inv({ state: 'declined' }), T, true)?.kind, 'not_confirmed');
  assert.equal(joinState(inv({ state: 'rescheduled' }), T, true)?.kind, 'open');
  assert.equal(joinState(inv(), T, false)?.kind, 'off');
  for (const f of ['voice', 'video', 'virtual_coffee']) assert.ok(isCallFormat(f));
  assert.ok(!isCallFormat('intro_chat'));
});

test('voice calls start without a camera; video and virtual coffee start with one', () => {
  assert.equal(isAudioOnly('voice'), true); assert.equal(isAudioOnly('video'), false); assert.equal(isAudioOnly('virtual_coffee'), false);
  assert.equal(joinLabel('voice'), 'Join voice call'); assert.equal(joinLabel('virtual_coffee'), 'Join virtual coffee'); assert.equal(joinLabel('video'), 'Join video call');
});

test('clock and countdown read naturally and never go negative', () => {
  assert.equal(clock(0), '0:00'); assert.equal(clock(65), '1:05'); assert.equal(clock(600), '10:00'); assert.equal(clock(3700), '1:01:40'); assert.equal(clock(-5), '0:00');
  assert.equal(secondsUntil(at(1), T), 60); assert.equal(secondsUntil(at(-1), T), 0);
});

test('reading Daily: you are "local", the other person is the first participant who is not; tracks only count when playable', () => {
  const vt = { id: 'v' }, at_ = { id: 'a' };
  const t = tilesFromParticipants({
    me: { local: true, user_name: 'Asha', tracks: { audio: { state: 'off', persistentTrack: at_ }, video: { state: 'playable', persistentTrack: vt } } },
    them: { local: false, user_name: 'Rohan', tracks: { audio: { state: 'playable', persistentTrack: at_ }, video: { state: 'off', persistentTrack: vt } } },
  });
  assert.equal(t.local?.name, 'Asha'); assert.equal(t.local?.videoOn, true); assert.equal(t.local?.audioOn, false);
  assert.equal(t.remote?.name, 'Rohan'); assert.equal(t.remote?.videoOn, false); assert.equal(t.remote?.videoTrack, null, 'a switched-off camera shows no frozen picture'); assert.equal(t.remote?.audioOn, true);
  assert.deepEqual(tilesFromParticipants({}), { local: null, remote: null });
  assert.equal(tilesFromParticipants({ me: { local: true } }).remote, null, 'alone in the room: nobody to show yet');
});

test('end-of-call wording', () => {
  assert.match(endedText('left', 'Rohan'), /You left the call with Rohan/);
  assert.match(endedText('window_over', 'Rohan'), /call window has ended/);
  assert.match(endedText('dropped', 'Rohan'), /connection was lost/);
});
