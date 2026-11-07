import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTIFICATION_KINDS, MODES } from '@sidequest/shared';
import { createNotifier, hasPushCopy, NoopPushSender, PUSH_CHANNELS, renderNotification, URGENT_KINDS } from '../src/notifications.ts';
import { A, setup } from './helpers.ts';

test('every notification kind has push copy (the compiler enforces it; this proves it at runtime too)', () => {
  for (const k of NOTIFICATION_KINDS) {
    const c = renderNotification(k);
    assert.ok(c && c.title.length > 3 && c.body.length > 10, `copy for ${k}`);
    assert.ok(hasPushCopy(k));
  }
  assert.equal(hasPushCopy('kind_from_a_newer_database'), false);
});

test('push copy is content-free: no placeholders, no names, no vibe or intent words', () => {
  const banned = [...Object.values(MODES).flatMap((m) => [m.label.toLowerCase(), m.id.toLowerCase()]), 'dating', 'hookup', 'hook-up', 'flirt', 'romantic', 'couple', 'sex', 'crush', 'single'];
  for (const k of NOTIFICATION_KINDS) {
    const c = renderNotification(k); const text = `${c.title} ${c.body}`.toLowerCase();
    assert.ok(!/[{}$<>]|%s/.test(text), `${k} has a placeholder`);
    for (const w of banned) assert.ok(!new RegExp(`\\b${w}\\b`).test(text), `${k} mentions "${w}"`);
  }
});

test('every channel used is one the app actually creates (apps/mobile/src/lib/push.ts)', () => {
  const src = readFileSync(new URL('../../mobile/src/lib/push.ts', import.meta.url), 'utf8');
  const appChannels = [...src.matchAll(/id: '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...PUSH_CHANNELS].sort(), appChannels);
  for (const k of NOTIFICATION_KINDS) assert.ok((PUSH_CHANNELS as readonly string[]).includes(renderNotification(k).channel), k);
});

test('safety alerts ignore quiet hours; everything else respects them', async () => {
  const s = setup();
  const sender = new NoopPushSender();
  s.store.tokens.push({ userId: A, token: 't', platform: 'android' });
  s.store.prefs.set(`${A}|*`, { push: true, quietStart: '00:00', quietEnd: '23:59' });         // all day is quiet
  const notifier = createNotifier({ store: s.store, sender, clock: s.clock });
  await notifier.send({ userId: A, kind: 'message_received', payload: { conversationId: 'x' }, dedupeKey: 'm' });
  assert.equal(sender.sent.length, 0);
  for (const k of URGENT_KINDS) await notifier.send({ userId: A, kind: k, payload: { checkinId: 'c' }, dedupeKey: k });
  assert.equal(sender.sent.length, URGENT_KINDS.size);
  assert.deepEqual([...URGENT_KINDS].sort(), ['checkin_help', 'checkin_missed', 'checkin_prompt', 'checkin_safe']);
});

test('send reports what happened: stored, duplicate, or failed', async () => {
  const s = setup();
  const notifier = createNotifier({ store: s.store, sender: new NoopPushSender(), clock: s.clock });
  const n = { userId: A, kind: 'invite_received' as const, payload: {}, dedupeKey: 'd' };
  assert.equal(await notifier.send(n), 'stored');
  assert.equal(await notifier.send(n), 'duplicate');
  s.store.addNotification = async () => { throw new Error('down'); };
  assert.equal(await notifier.send({ ...n, dedupeKey: 'e' }), 'failed');
});
