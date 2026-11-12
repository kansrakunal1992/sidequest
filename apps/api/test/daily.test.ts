// The Daily call provider, against a fake Daily server (no network). Checks what we ask Daily for, not Daily itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallProviderError, createDailyProvider } from '../src/daily.ts';

const NOW = new Date('2026-12-01T10:00:00Z');
const until = (mins: number) => new Date(NOW.getTime() + mins * 60_000);
interface Hit { path: string; body: any; auth: string | null }
function fakeDaily(o: { roomExists?: boolean; tokenStatus?: number; down?: boolean } = {}) {
  const hits: Hit[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (o.down) throw new Error('connect ECONNREFUSED');
    const path = new URL(url).pathname.replace('/v1', '');
    const body = JSON.parse(String(init?.body));
    hits.push({ path, body, auth: new Headers(init?.headers).get('authorization') });
    if (path === '/rooms') return o.roomExists ? new Response(JSON.stringify({ error: 'invalid-request-error', info: 'a room named x already exists' }), { status: 400 }) : new Response(JSON.stringify({ name: body.name }), { status: 200 });
    if (path.startsWith('/rooms/')) return new Response('{}', { status: 200 });
    if (path === '/meeting-tokens') return o.tokenStatus && o.tokenStatus !== 200 ? new Response('{"error":"nope"}', { status: o.tokenStatus }) : new Response(JSON.stringify({ token: 'daily-jwt-abc' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return { hits, fetchFn };
}
const cfg = { apiKey: 'SECRET-KEY', domain: 'waypoint' };

test('Daily: makes a private two-person room that closes when the call window ends, then a one-room one-person token', async () => {
  const f = fakeDaily(); const p = createDailyProvider(cfg, f.fetchFn);
  const g = await p.createCall({ room: 'invite-1', identity: 'user-a', name: 'Asha', now: NOW, notAfter: until(60), audioOnly: false });
  assert.deepEqual(g, { url: 'https://waypoint.daily.co/invite-1', token: 'daily-jwt-abc' });
  assert.deepEqual(f.hits.map((h) => h.path), ['/rooms', '/meeting-tokens']);
  assert.ok(f.hits.every((h) => h.auth === 'Bearer SECRET-KEY'), 'the key is sent as a bearer header');
  const room = f.hits[0]!.body; assert.equal(room.name, 'invite-1'); assert.equal(room.privacy, 'private');
  assert.equal(room.properties.max_participants, 2); assert.equal(room.properties.eject_at_room_exp, true); assert.equal(room.properties.exp, Math.floor(until(60).getTime() / 1000));
  const t = f.hits[1]!.body.properties;
  assert.equal(t.room_name, 'invite-1'); assert.equal(t.user_id, 'user-a'); assert.equal(t.user_name, 'Asha'); assert.equal(t.is_owner, false);
  assert.equal(t.enable_screenshare, false); assert.equal(t.start_video_off, false); assert.equal(t.eject_at_token_exp, true);
});

test('Daily: a token never lives longer than an hour, and a voice call starts with the camera off', async () => {
  const f = fakeDaily(); const p = createDailyProvider(cfg, f.fetchFn);
  await p.createCall({ room: 'invite-2', identity: 'u', now: NOW, notAfter: until(600), audioOnly: true });
  const t = f.hits.at(-1)!.body.properties;
  assert.equal(t.exp, Math.floor(NOW.getTime() / 1000) + 3600); assert.equal(t.start_video_off, true);
  await p.createCall({ room: 'invite-3', identity: 'u', now: NOW, notAfter: until(20), audioOnly: false });
  assert.equal(f.hits.at(-1)!.body.properties.exp, Math.floor(until(20).getTime() / 1000), 'a short window caps the token earlier');
});

test('Daily: the second person reuses the room; a rescheduled (later) call extends it; an existing room is updated, not failed', async () => {
  const f = fakeDaily(); const p = createDailyProvider(cfg, f.fetchFn);
  await p.createCall({ room: 'invite-4', identity: 'a', now: NOW, notAfter: until(60), audioOnly: false });
  await p.createCall({ room: 'invite-4', identity: 'b', now: NOW, notAfter: until(60), audioOnly: false });
  assert.equal(f.hits.filter((h) => h.path === '/rooms').length, 1, 'the room is made once');
  assert.equal(f.hits.filter((h) => h.path === '/meeting-tokens').length, 2, 'each person gets their own token');
  await p.createCall({ room: 'invite-4', identity: 'a', now: NOW, notAfter: until(180), audioOnly: false });
  assert.ok(f.hits.some((h) => h.path === '/rooms/invite-4'), 'a later window updates the room closing time');
  const g = fakeDaily({ roomExists: true }); const q = createDailyProvider(cfg, g.fetchFn);
  await q.createCall({ room: 'invite-5', identity: 'a', now: NOW, notAfter: until(60), audioOnly: false });
  assert.deepEqual(g.hits.map((h) => h.path), ['/rooms', '/rooms/invite-5', '/meeting-tokens']);
});

test('Daily: failures become one safe error that never contains the key', async () => {
  const bad = fakeDaily({ tokenStatus: 401 });
  await assert.rejects(createDailyProvider(cfg, bad.fetchFn).createCall({ room: 'r', identity: 'a', now: NOW, notAfter: until(60), audioOnly: false }), (e: Error) => e instanceof CallProviderError && /token \(401\)/.test(e.message) && !e.message.includes('SECRET-KEY'));
  const down = fakeDaily({ down: true });
  await assert.rejects(createDailyProvider(cfg, down.fetchFn).createCall({ room: 'r', identity: 'a', now: NOW, notAfter: until(60), audioOnly: false }), (e: Error) => e instanceof CallProviderError && /not reachable/.test(e.message) && !e.message.includes('SECRET-KEY'));
});
