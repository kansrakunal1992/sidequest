import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { createPushTester } from '../src/notifications.ts';
import type { PushMessage, PushResult, PushSender } from '../src/notifications.ts';
import { signHs256, verifyJwt } from '../src/jwt.ts';
import { A, B, T0, setup } from './helpers.ts';

class ScriptedSender implements PushSender {
  calls: { token: string; msg: PushMessage }[] = [];
  results: PushResult[] = [];
  throwNext = false;
  async send(token: string, msg: PushMessage): Promise<PushResult> {
    this.calls.push({ token, msg });
    if (this.throwNext) throw new Error('network down');
    return this.results.shift() ?? 'ok';
  }
}

test('push test: says exactly what is wrong, and never sends from an unconfigured server', async () => {
  const s = setup();
  const sender = new ScriptedSender();

  const off = createPushTester({ store: s.store, sender, configured: false });
  s.store.tokens.push({ userId: A, token: 't1', platform: 'android' });
  assert.deepEqual(await off.test(A), { tokens: 1, sent: 0, error: 'not_configured' });
  assert.equal(sender.calls.length, 0, 'a Noop sender would pretend to succeed, so nothing is sent');

  const on = createPushTester({ store: s.store, sender, configured: true });
  assert.deepEqual(await on.test(B), { tokens: 0, sent: 0, error: 'no_token' });

  const ok = await on.test(A);
  assert.deepEqual(ok, { tokens: 1, sent: 1, error: null });
  assert.equal(sender.calls.length, 1);
});

test('push test: the text is fixed and content-free', async () => {
  const s = setup();
  const sender = new ScriptedSender();
  s.store.tokens.push({ userId: A, token: 't1', platform: 'android' });
  await createPushTester({ store: s.store, sender, configured: true }).test(A);
  const m = sender.calls[0]!.msg;
  assert.equal(m.channel, 'messages');
  assert.deepEqual(m.data, { kind: 'push_test' });
  assert.ok(!/Aanya|Rohan/.test(`${m.title} ${m.body}`));
});

test('push test: an invalid token is removed and reported; failures and exceptions are reported', async () => {
  const s = setup();
  const sender = new ScriptedSender();
  const t = createPushTester({ store: s.store, sender, configured: true });

  s.store.tokens.push({ userId: A, token: 'stale', platform: 'android' });
  sender.results = ['invalid_token'];
  assert.deepEqual(await t.test(A), { tokens: 1, sent: 0, error: 'token_invalid' });
  assert.equal((await s.store.listPushTokens(A)).length, 0, 'the dead token is removed');
  assert.equal((await t.test(A)).error, 'no_token');

  s.store.tokens.push({ userId: A, token: 'x', platform: 'android' });
  sender.results = ['error'];
  assert.equal((await t.test(A)).error, 'send_failed');
  sender.throwNext = true;
  assert.equal((await t.test(A)).error, 'send_failed');
  sender.throwNext = false;

  // two phones: one dead, one fine -> success overall
  s.store.tokens.push({ userId: A, token: 'dead', platform: 'android' });
  sender.results = ['ok', 'invalid_token'];
  const mixed = await t.test(A);
  assert.equal(mixed.error, null); assert.equal(mixed.sent, 1);
});

const SECRET = 's';
let server: Server; let base = ''; let ctx: ReturnType<typeof setup>; let sender: ScriptedSender;
const tok = (sub: string) => signHs256({ sub, aud: 'authenticated', exp: Math.floor(T0.getTime() / 1000) + 86_400 }, SECRET);
const post = (path: string, user: string) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${tok(user)}` } });

before(async () => {
  ctx = setup(); sender = new ScriptedSender();
  ctx.store.tokens.push({ userId: A, token: 'phone', platform: 'android' });
  const handler = createHandler({
    invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, callProvider: null,
    push: createPushTester({ store: ctx.store, sender, configured: true }),
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }),
    ipRatePerMinute: 1000,
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

test('POST /v1/push/test needs sign-in, tests only the caller, and is rate limited', async () => {
  assert.equal((await fetch(base + '/v1/push/test', { method: 'POST' })).status, 401);
  const r = await post('/v1/push/test', A);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { tokens: 1, sent: 1, error: null });
  assert.equal(sender.calls.at(-1)!.token, 'phone');
  assert.deepEqual(await (await post('/v1/push/test', B)).json(), { tokens: 0, sent: 0, error: 'no_token' });
  let last = 200;
  for (let i = 0; i < 8; i++) { last = (await post('/v1/push/test', A)).status; if (last === 429) break; }
  assert.equal(last, 429);
  assert.equal((await post('/v1/push/test', B)).status, 200, 'other people are not affected');
});

test('GET /v1/config reports whether push is configured', async () => {
  const get = async (h: ReturnType<typeof createHandler>) => {
    const s2 = createServer(h); await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/v1/config`, { headers: { authorization: 'Bearer x' } });
    const j = await res.json(); await new Promise<void>((r) => s2.close(() => r())); return j;
  };
  const base2 = { invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, callProvider: null, verifyToken: async () => ({ sub: A }) };
  assert.equal((await get(createHandler({ ...base2, push: createPushTester({ store: ctx.store, sender, configured: true }) }))).push, true);
  assert.equal((await get(createHandler({ ...base2, push: createPushTester({ store: ctx.store, sender, configured: false }) }))).push, false);
  assert.equal((await get(createHandler(base2))).push, false);
});
