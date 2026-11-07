import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { signHs256, verifyJwt } from '../src/jwt.ts';
import { A, B, C, T0, setup } from './helpers.ts';

const SECRET = 'test-secret';
let server: Server; let base = ''; let ctx: ReturnType<typeof setup>;

const tok = (sub: string, exp = Math.floor(T0.getTime() / 1000) + 86_400) => signHs256({ sub, aud: 'authenticated', exp }, SECRET);
async function call(method: string, path: string, user: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (user) h.authorization = `Bearer ${tok(user)}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const startsAt = (mins: number) => new Date(T0.getTime() + mins * 60_000).toISOString();
const body = (o: object = {}) => ({ recipientId: B, modeId: 'serious_dating', format: 'virtual_coffee', startsAt: startsAt(120), timezone: 'Asia/Kolkata', durationMinutes: 20, note: 'hi', ...o });

before(async () => {
  ctx = setup();
  ctx.store.addUser(C);
  const handler = createHandler({
    invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: true,
    livekit: { url: 'wss://lk.example', apiKey: 'lk', apiSecret: 'lksecret' },
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }),
    userRatePerMinute: 40, ipRatePerMinute: 1000,
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

test('health needs no auth; everything else does', async () => {
  assert.equal((await call('GET', '/healthz', null)).status, 200);
  assert.equal((await call('GET', '/v1/invites', null)).status, 401);
  const bad = await fetch(base + '/v1/invites', { headers: { authorization: 'Bearer nonsense' } });
  assert.equal(bad.status, 401);
  assert.equal((await call('GET', '/nope', A)).status, 404);
});

test('validation: malformed bodies get precise 4xx and nothing is created', async () => {
  assert.equal((await call('POST', '/v1/invites', A, body({ recipientId: 'x' }))).json.error, 'invalid_recipient');
  assert.equal((await call('POST', '/v1/invites', A, body({ modeId: 'nope' }))).json.error, 'invalid_mode');
  assert.equal((await call('POST', '/v1/invites', A, body({ format: 'carrier_pigeon' }))).json.error, 'invalid_format');
  assert.equal((await call('POST', '/v1/invites', A, body({ startsAt: '2026-11-01 12:00' }))).json.error, 'invalid_start_time');
  assert.equal((await call('POST', '/v1/invites', A, body({ timezone: 'Mars/Base' }))).json.error, 'invalid_timezone');
  assert.equal((await call('POST', '/v1/invites', A, body({ durationMinutes: 2 }))).json.error, 'invalid_duration');
  assert.equal((await call('POST', '/v1/invites', A, body({ note: 'x'.repeat(281) }))).json.error, 'invalid_note');
  const badJson = await call('POST', '/v1/invites', A, '{not json');
  assert.deepEqual([badJson.status, badJson.json.error], [400, 'invalid_json']);
  assert.equal((await call('POST', '/v1/invites', A, 'x'.repeat(40_000))).status, 413);
  assert.equal(ctx.store.invites.size, 0);
});

test('full journey over HTTP: invite, reschedule, accept, calendar file, call token, cancel', async () => {
  const created = await call('POST', '/v1/invites', A, body({ format: 'video', startsAt: startsAt(120) }));
  assert.equal(created.status, 201);
  const id = created.json.invite.id as string;
  assert.equal(created.json.invite.state, 'pending');

  assert.equal((await call('GET', `/v1/invites/${id}`, C)).status, 404);                       // outsider
  assert.equal((await call('GET', '/v1/invites?box=incoming', B)).json.invites.length, 1);
  assert.equal((await call('GET', '/v1/invites?box=incoming', A)).json.invites.length, 0);
  assert.equal((await call('GET', '/v1/invites?box=weird', A)).status, 400);

  assert.equal((await call('POST', `/v1/invites/${id}/accept`, A)).status, 409);                // sender cannot accept
  const rs = await call('POST', `/v1/invites/${id}/reschedule`, B, { startsAt: startsAt(300), durationMinutes: 30 });
  assert.equal(rs.json.invite.state, 'reschedule_requested');
  const acc = await call('POST', `/v1/invites/${id}/accept-reschedule`, A);
  assert.equal(acc.json.invite.state, 'rescheduled');
  assert.equal(acc.json.invite.startsAt, startsAt(300));

  const ics = await call('GET', `/v1/invites/${id}/ics`, A);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type')!, /text\/calendar/);
  assert.match(ics.text, /BEGIN:VCALENDAR/);
  assert.match(ics.text, /Video call with Rohan/);

  assert.equal((await call('POST', `/v1/invites/${id}/call-token`, A)).json.error, 'too_early');
  ctx.setTime(new Date(T0.getTime() + 298 * 60_000));
  const ct = await call('POST', `/v1/invites/${id}/call-token`, A);
  assert.equal(ct.status, 200);
  const claims = await verifyJwt(ct.json.token, { hsSecret: 'lksecret', now: ctx.clock() });
  assert.equal(claims.sub, A); assert.equal((claims as any).video.room, `invite-${id}`);
  assert.equal((await call('POST', `/v1/invites/${id}/call-token`, C)).status, 404);

  const cancelled = await call('POST', `/v1/invites/${id}/cancel`, B);
  assert.equal(cancelled.json.invite.state, 'cancelled');
  assert.match((await call('GET', `/v1/invites/${id}/ics`, B)).text, /METHOD:CANCEL/);
  ctx.setTime(T0);
});

test('policy errors keep their meaning; blocked looks like unavailable', async () => {
  ctx.store.addUser('66666666-6666-4666-8666-666666666666');
  ctx.store.block('66666666-6666-4666-8666-666666666666', A);
  const r = await call('POST', '/v1/invites', A, body({ recipientId: '66666666-6666-4666-8666-666666666666' }));
  assert.equal(r.status, 404); assert.equal(r.json.error, 'unavailable');
  const idk = await call('POST', '/v1/invites', A, body({ recipientId: '77777777-7777-4777-8777-777777777777' }));
  assert.deepEqual([idk.status, idk.json.error], [r.status, r.json.error]);
});

test('too-new, light chat and decline over HTTP', async () => {
  const c = await call('POST', '/v1/invites', C, body({ recipientId: A }));
  const id = c.json.invite.id;
  assert.equal((await call('POST', `/v1/invites/${id}/too-new`, A)).json.invite.state, 'too_new');
  assert.equal((await call('POST', `/v1/invites/${id}/light-chat`, C)).status, 403);
  const lc = await call('POST', `/v1/invites/${id}/light-chat`, A);
  assert.equal(lc.status, 200); assert.ok(lc.json.conversationId);
});

test('no content-type needed for empty action bodies; unknown actions 404', async () => {
  assert.equal((await call('POST', '/v1/invites/not-a-uuid/accept', A)).status, 404);
  assert.equal((await call('POST', '/v1/invites/00000000-0000-4000-8000-000000000000/accept', A)).status, 404);
  assert.equal((await call('POST', '/v1/invites/00000000-0000-4000-8000-000000000000/explode', A)).status, 404);
});

test('per-user rate limit returns 429 with Retry-After', async () => {
  let last = { status: 0, headers: new Headers() as Headers };
  for (let i = 0; i < 45; i++) { const r = await call('GET', '/v1/invites', B); last = r; if (r.status === 429) break; }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
  assert.equal((await call('GET', '/v1/invites', A)).status, 200);        // other users unaffected
});

test('calls stay off unless configured', async () => {
  const off = createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, livekit: null,
    verifyToken: async () => ({ sub: A }) });
  const s2 = createServer(off); await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/v1/invites/00000000-0000-4000-8000-000000000000/call-token`,
    { method: 'POST', headers: { authorization: 'Bearer x' } });
  assert.equal(res.status, 501); assert.equal((await res.json()).error, 'calls_not_configured');
  await new Promise<void>((r) => s2.close(() => r()));
});

test('config: lists every problem; calls need the whole LiveKit trio', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL is required[\s\S]*SUPABASE_URL is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co', FEATURE_VIDEO_CALLS: 'true' }), /LIVEKIT_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co', FCM_SERVICE_ACCOUNT_JSON: '{oops' }), /not valid JSON/);
  const c = loadConfig({ DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co/', PORT: '9000' });
  assert.equal(c.supabaseUrl, 'https://a.supabase.co'); assert.equal(c.port, 9000); assert.equal(c.callsEnabled, false);
});
