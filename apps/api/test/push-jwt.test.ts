import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, createPublicKey, createSign } from 'node:crypto';
import { MemoryStore } from '../src/memory-store.ts';
import { NoopPushSender, createNotifier, inQuietHours, renderNotification } from '../src/notifications.ts';
import type { PushSender } from '../src/notifications.ts';
import { FcmSender } from '../src/push-fcm.ts';
import { b64url, createJwksProvider, signHs256, verifyJwt } from '../src/jwt.ts';
import { MODES } from '@sidequest/shared';
import type { NotificationKind } from '../src/types.ts';
import { A } from './helpers.ts';

const now = new Date('2026-11-01T10:00:00Z');

// ---------- quiet hours ----------
test('quiet hours: same-day, overnight wrap, time zones, disabled', () => {
  const t = new Date('2026-11-01T18:30:00Z'); // 00:00 next day in Kolkata (UTC+5:30)
  assert.equal(inQuietHours(t, 'Asia/Kolkata', '22:00', '07:00'), true);
  assert.equal(inQuietHours(t, 'UTC', '22:00', '07:00'), false);
  assert.equal(inQuietHours(new Date('2026-11-01T13:00:00Z'), 'UTC', '12:00', '14:00'), true);
  assert.equal(inQuietHours(new Date('2026-11-01T14:00:00Z'), 'UTC', '12:00', '14:00'), false);
  assert.equal(inQuietHours(t, 'UTC', null, null), false);
  assert.equal(inQuietHours(t, 'Not/AZone', '22:00', '07:00'), false);
});

// ---------- copy privacy ----------
test('push copy never reveals names, modes or intent on the lock screen', () => {
  const banned = [...Object.values(MODES).flatMap((m) => [m.label.toLowerCase(), m.id]), 'hookup', 'dating', 'date', 'flirt'];
  const kinds: NotificationKind[] = ['invite_received', 'invite_accepted', 'invite_declined', 'invite_too_new', 'invite_reschedule_requested',
    'invite_rescheduled', 'invite_cancelled', 'invite_expired', 'invite_reminder', 'light_chat_started', 'post_meet_prompt', 'roulette_group_ready', 'open_call_expired', 'message_received', 'open_call_interest', 'open_call_accepted', 'open_call_update', 'activity_update'];
  for (const k of kinds) {
    const c = renderNotification(k);
    const text = `${c.title} ${c.body}`.toLowerCase();
    for (const b of banned) assert.ok(!new RegExp(`\\b${b}\\b`).test(text), `${k} contains "${b}"`);
  }
});

// ---------- notifier ----------
function notifierSetup(sender: PushSender = new NoopPushSender()) {
  const store = new MemoryStore();
  store.addUser(A, { timezone: 'UTC' });
  store.tokens.push({ userId: A, token: 'tok1', platform: 'android' });
  return { store, sender, notifier: createNotifier({ store, sender, clock: () => now }) };
}
test('notifier: stores in-app notification and pushes with ids only', async () => {
  const sender = new NoopPushSender();
  const { store, notifier } = notifierSetup(sender);
  await notifier.send({ userId: A, kind: 'invite_received', payload: { inviteId: 'abc', secret: 'nope' } });
  assert.equal(store.notifications.length, 1);
  assert.equal(sender.sent.length, 1);
  assert.deepEqual(sender.sent[0]!.msg.data, { kind: 'invite_received', inviteId: 'abc' });
  assert.equal(sender.sent[0]!.msg.channel, 'invites');
});
test('notifier: dedupe, push opt-out and quiet hours still store the in-app item', async () => {
  const sender = new NoopPushSender();
  const { store, notifier } = notifierSetup(sender);
  await notifier.send({ userId: A, kind: 'invite_reminder', payload: { inviteId: 'x' }, dedupeKey: 'k' });
  await notifier.send({ userId: A, kind: 'invite_reminder', payload: { inviteId: 'x' }, dedupeKey: 'k' });
  assert.equal(store.notifications.length, 1); assert.equal(sender.sent.length, 1);
  store.prefs.set(`${A}|*`, { push: false, quietStart: null, quietEnd: null });
  await notifier.send({ userId: A, kind: 'invite_received', payload: {} });
  assert.equal(store.notifications.length, 2); assert.equal(sender.sent.length, 1);
  store.prefs.set(`${A}|*`, { push: true, quietStart: '09:00', quietEnd: '11:00' }); // now = 10:00 UTC
  await notifier.send({ userId: A, kind: 'invite_received', payload: {} });
  assert.equal(store.notifications.length, 3); assert.equal(sender.sent.length, 1);
});
test('notifier: removes dead tokens and never throws', async () => {
  const dead: PushSender = { send: async () => 'invalid_token' };
  const { store, notifier } = notifierSetup(dead);
  await notifier.send({ userId: A, kind: 'invite_received', payload: {} });
  assert.equal(store.tokens.length, 0);
  const boom: PushSender = { send: async () => { throw new Error('network'); } };
  const s2 = notifierSetup(boom);
  await assert.doesNotReject(s2.notifier.send({ userId: A, kind: 'invite_received', payload: {} }));
});

// ---------- FCM sender (fake network) ----------
test('FCM: signs a valid RS256 assertion, caches the token, maps errors', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { project_id: 'proj', client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const calls: { url: string; init: RequestInit }[] = [];
  let sendStatus = 200;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200 });
    return new Response(sendStatus === 200 ? '{}' : sendStatus === 404 ? JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }) : 'internal', { status: sendStatus });
  }) as unknown as typeof fetch;
  const fcm = new FcmSender(sa, fakeFetch, () => now.getTime());
  const msg = { title: 'T', body: 'B', data: { kind: 'invite_received' }, channel: 'invites' };
  assert.equal(await fcm.send('device-token', msg, 'android'), 'ok');

  const assertion = new URLSearchParams(calls[0]!.init.body as string).get('assertion')!;
  const [h, p, s] = assertion.split('.') as [string, string, string];
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.iss, sa.client_email); assert.match(claims.scope, /firebase\.messaging/);

  const body = JSON.parse(calls[1]!.init.body as string);
  assert.equal(calls[1]!.url, 'https://fcm.googleapis.com/v1/projects/proj/messages:send');
  assert.equal(body.message.token, 'device-token');
  assert.equal(body.message.android.notification.channel_id, 'invites');
  assert.equal((calls[1]!.init.headers as any).authorization, 'Bearer AT');

  await fcm.send('t2', msg, 'android');
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);   // token cached
  sendStatus = 404;
  assert.equal(await fcm.send('gone', msg, 'android'), 'invalid_token');
  sendStatus = 500;
  assert.equal(await fcm.send('t3', msg, 'android'), 'error');
});

// ---------- JWT ----------
const claimsFor = (o: Record<string, unknown> = {}) => ({ sub: A, aud: 'authenticated', exp: Math.floor(now.getTime() / 1000) + 600, ...o });

test('JWT HS256: valid, tampered, expired, wrong audience, wrong secret', async () => {
  const opts = { hsSecret: 's3cret', now, audience: 'authenticated' };
  assert.equal((await verifyJwt(signHs256(claimsFor(), 's3cret'), opts)).sub, A);
  const good = signHs256(claimsFor(), 's3cret');
  const [h, , s] = good.split('.') as [string, string, string];
  const tampered = `${h}.${b64url(JSON.stringify(claimsFor({ sub: 'someone-else' })))}.${s}`;
  await assert.rejects(verifyJwt(tampered, opts), /bad_signature/);
  await assert.rejects(verifyJwt(signHs256(claimsFor({ exp: Math.floor(now.getTime() / 1000) - 600 }), 's3cret'), opts), /expired/);
  await assert.rejects(verifyJwt(signHs256(claimsFor({ aud: 'anon' }), 's3cret'), opts), /bad_audience/);
  await assert.rejects(verifyJwt(signHs256(claimsFor(), 'other'), opts), /bad_signature/);
  await assert.rejects(verifyJwt(signHs256(claimsFor({ sub: '' }), 's3cret'), opts), /no_subject/);
});
test('JWT: "none", algorithm confusion and malformed tokens are rejected', async () => {
  const none = `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(claimsFor()))}.`;
  await assert.rejects(verifyJwt(none, { hsSecret: 'x', now }), /alg_not_allowed/);
  await assert.rejects(verifyJwt('a.b', { hsSecret: 'x', now }), /malformed/);
  await assert.rejects(verifyJwt(signHs256(claimsFor(), 'x'), { now }), /alg_not_allowed/);          // HS256 without a secret configured
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();               // attacker signs HS256 using the public key as the secret
  await assert.rejects(verifyJwt(signHs256(claimsFor(), pem), { getJwks: async () => [publicKey.export({ format: 'jwk' }) as any], now }), /alg_not_allowed/);
});
test('JWT ES256 and RS256 via JWKS, with key id selection', async () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = async () => [
    { ...(ec.publicKey.export({ format: 'jwk' }) as object), kid: 'ec1' },
    { ...(rsa.publicKey.export({ format: 'jwk' }) as object), kid: 'rsa1' },
  ] as any;
  const mk = (alg: 'ES256' | 'RS256', kid: string, priv: any, payload: object) => {
    const h = b64url(JSON.stringify({ alg, typ: 'JWT', kid })), p = b64url(JSON.stringify(payload));
    const sig = alg === 'ES256'
      ? createSign('SHA256').update(`${h}.${p}`).sign({ key: priv, dsaEncoding: 'ieee-p1363' })
      : createSign('RSA-SHA256').update(`${h}.${p}`).sign(priv);
    return `${h}.${p}.${b64url(sig)}`;
  };
  assert.equal((await verifyJwt(mk('ES256', 'ec1', ec.privateKey, claimsFor()), { getJwks: jwks, now })).sub, A);
  assert.equal((await verifyJwt(mk('RS256', 'rsa1', rsa.privateKey, claimsFor()), { getJwks: jwks, now })).sub, A);
  await assert.rejects(verifyJwt(mk('ES256', 'rsa1', ec.privateKey, claimsFor()), { getJwks: jwks, now }), /unknown_key/);
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(verifyJwt(mk('ES256', 'ec1', other.privateKey, claimsFor()), { getJwks: jwks, now }), /bad_signature/);
});
test('JWKS provider caches within its ttl', async () => {
  let hits = 0; let t = 0;
  const f = (async () => { hits++; return new Response(JSON.stringify({ keys: [{ kty: 'EC', kid: 'k' }] })); }) as unknown as typeof fetch;
  const get = createJwksProvider('https://x/jwks', f, 1000, () => t);
  await get(); await get(); assert.equal(hits, 1);
  t = 2000; await get(); assert.equal(hits, 2);
});

