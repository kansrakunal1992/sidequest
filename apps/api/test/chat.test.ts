import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChatMediaAccess, handleMessageCreated } from '../src/chat.ts';
import { createHandler } from '../src/app.ts';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { A, B, C, setup } from './helpers.ts';

const MID = '88888888-8888-4888-8888-888888888888';
const CONV = '77777777-7777-4777-8777-777777777777';
function world(o: { revealedBy?: string[]; deleted?: boolean } = {}) {
  const s = setup(); s.store.addUser(C);
  s.store.messages.set(MID, { id: MID, conversationId: CONV, senderId: A, mediaPath: `${A}/${CONV}/x.jpg`, mediaKind: 'image', revealedBy: o.revealedBy ?? [], deleted: o.deleted ?? false, memberIds: [A, B] });
  const signer = { signedUrl: async (bucket: string, p: string) => `https://signed/${bucket}/${p}` };
  return { ...s, media: new ChatMediaAccess(s.store, signer), signer };
}

test('chat media: sender always sees their own; recipient only after revealing', async () => {
  const w = world();
  const own = await w.media.urlFor(A, MID); assert.equal(own.ok, true);
  assert.equal((own as any).value.url, `https://signed/chat-media/${A}/${CONV}/x.jpg`);
  const before = await w.media.urlFor(B, MID); assert.equal((before as any).status, 403); assert.equal((before as any).error, 'not_revealed');
  w.store.messages.get(MID)!.revealedBy = [B];
  assert.equal((await w.media.urlFor(B, MID)).ok, true);
});
test('chat media: outsiders, blocked people, deleted messages and junk ids all look like "not found"', async () => {
  const w = world({ revealedBy: [B] });
  assert.equal((await w.media.urlFor(C, MID) as any).status, 404);
  w.store.block(A, B);
  assert.equal((await w.media.urlFor(B, MID) as any).status, 404);
  const d = world({ revealedBy: [B], deleted: true });
  assert.equal((await d.media.urlFor(B, MID) as any).status, 404);
  assert.equal((await w.media.urlFor(B, 'nope') as any).status, 404);
  const text = world(); text.store.messages.get(MID)!.mediaKind = null;
  assert.equal((await text.media.urlFor(A, MID) as any).status, 404);
});
test('chat media: storage failure is reported, not leaked', async () => {
  const w = world({ revealedBy: [B] });
  const bad = new ChatMediaAccess(w.store, { signedUrl: async () => { throw new Error('boom'); } });
  assert.equal((await bad.urlFor(B, MID) as any).status, 502);
});

test('message webhook: notifies the other person once a minute, content-free, never a blocker', async () => {
  const w = world();
  w.store.tokens.push({ userId: B, token: 'tok', platform: 'android' });
  const sender = new NoopPushSender();
  const deps = { store: w.store, notifier: createNotifier({ store: w.store, sender, clock: w.clock }), clock: w.clock };
  const rec = { id: MID, conversation_id: CONV, sender_id: A };
  assert.equal(await handleMessageCreated(deps, rec), 1);
  await handleMessageCreated(deps, rec); await handleMessageCreated(deps, rec);
  assert.equal(w.store.notifications.filter((n) => n.kind === 'message_received').length, 1);   // coalesced
  assert.equal(sender.sent.length, 1);
  assert.deepEqual(sender.sent[0]!.msg.data, { kind: 'message_received', conversationId: CONV });
  assert.doesNotMatch(JSON.stringify(sender.sent[0]!.msg), /Rohan|Aanya|hello/);
  w.setTime(new Date(w.clock().getTime() + 61_000));
  await handleMessageCreated(deps, rec);
  assert.equal(sender.sent.length, 2);                                                           // next minute, next push
  w.store.block(B, A);
  const before = w.store.notifications.length; await handleMessageCreated(deps, { ...rec, id: 'x' });
  assert.equal(w.store.notifications.length, before);                                            // B blocked A: no push to B
  assert.equal(await handleMessageCreated(deps, { id: 'x', conversation_id: 'bad', sender_id: A }), 0);
});

test('HTTP: webhook needs its secret; chat-media route and config route behave', async () => {
  const w = world({ revealedBy: [B] });
  const notifier = createNotifier({ store: w.store, sender: new NoopPushSender(), clock: w.clock });
  const server = createServer(createHandler({ invites: w.svc, store: w.store, clock: w.clock, callsEnabled: false, livekit: null, chatMedia: w.media, notifier,
    webhookSecret: 'a-long-enough-secret', verifyToken: async (t) => ({ sub: t === 'b' ? B : A }) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hook = (secret: string | null, body: unknown) => fetch(`${base}/v1/hooks/message-created`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(body) });
  const payload = { type: 'INSERT', record: { id: MID, conversation_id: CONV, sender_id: A } };
  assert.equal((await hook(null, payload)).status, 401);
  assert.equal((await hook('wrong-secret-value!', payload)).status, 401);
  assert.equal((await hook('a-long-enough-secret', { type: 'UPDATE', record: {} })).status, 200);
  const ok = await hook('a-long-enough-secret', payload); assert.equal(ok.status, 200); assert.equal((await ok.json()).notified, 1);
  const post = (path: string, who: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const url = await post('/v1/chat-media/url', 'b', { messageId: MID }); assert.equal(url.status, 200); assert.equal((await url.json()).expiresInSeconds, 300);
  assert.equal((await post('/v1/chat-media/url', 'b', { messageId: 'x' })).status, 404);
  const cfg = await fetch(`${base}/v1/config`, { headers: { authorization: 'Bearer a' } });
  assert.deepEqual(await cfg.json(), { calls: false, photos: false, chatImages: true, exports: false, push: false, verification: false });
  await new Promise<void>((r) => server.close(() => r()));
  const off = createServer(createHandler({ invites: w.svc, store: w.store, clock: w.clock, callsEnabled: false, livekit: null, verifyToken: async () => ({ sub: A }) }));
  await new Promise<void>((r) => off.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${(off.address() as AddressInfo).port}/v1/hooks/message-created`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': '' }, body: '{}' });
  assert.equal(res.status, 401);                                                                  // disabled without a configured secret
  await new Promise<void>((r) => off.close(() => r()));
});

import { handleNotificationCreated } from '../src/chat.ts';
test('database-written notifications are pushed once, content-free, and only when marked as db-origin', async () => {
  const w = world(); w.store.tokens.push({ userId: B, token: 'tok', platform: 'android' });
  const sender = new NoopPushSender();
  const notifier = createNotifier({ store: w.store, sender, clock: w.clock });
  const rec = { user_id: B, kind: 'open_call_interest', payload: { openCallId: 'oc-1', secret: 'x', note: 'private' }, origin: 'db' };
  assert.equal(await handleNotificationCreated({ notifier }, rec), true);
  assert.equal(sender.sent.length, 1);
  assert.deepEqual(sender.sent[0]!.msg.data, { kind: 'open_call_interest', openCallId: 'oc-1' });
  assert.equal(sender.sent[0]!.msg.channel, 'open_calls');
  assert.equal(w.store.notifications.length, 0);                                                   // push only: the row already exists
  assert.equal(await handleNotificationCreated({ notifier }, { ...rec, origin: 'api' }), false);   // API rows were pushed at creation
  assert.equal(await handleNotificationCreated({ notifier }, { ...rec, kind: 'made_up' }), true);  // unknown kinds are ignored quietly
  assert.equal(sender.sent.length, 1);
  assert.equal(await handleNotificationCreated({ notifier }, { ...rec, user_id: 'nope' }), false);
});
test('HTTP: notification webhook shares the secret check', async () => {
  const w = world(); w.store.tokens.push({ userId: B, token: 'tok', platform: 'android' });
  const sender = new NoopPushSender();
  const server = createServer(createHandler({ invites: w.svc, store: w.store, clock: w.clock, callsEnabled: false, livekit: null, notifier: createNotifier({ store: w.store, sender, clock: w.clock }),
    webhookSecret: 'a-long-enough-secret', verifyToken: async () => ({ sub: A }) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/hooks/notification-created`;
  const body = JSON.stringify({ type: 'INSERT', record: { user_id: B, kind: 'activity_update', payload: { eventId: 'e1' }, origin: 'db' } });
  assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  const ok = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'a-long-enough-secret' }, body });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true, pushed: true });
  assert.equal(sender.sent.length, 1);
  await new Promise<void>((r) => server.close(() => r()));
});
