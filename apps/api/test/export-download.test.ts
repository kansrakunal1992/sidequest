import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { ExportAccess } from '../src/data-requests.ts';
import { signHs256, verifyJwt } from '../src/jwt.ts';
import { FakeAdmin } from './fake-admin.ts';
import { A, B, T0, setup } from './helpers.ts';

const SECRET = 'test-secret';
let server: Server, base = '', ctx: ReturnType<typeof setup>; const admin = new FakeAdmin();
const tok = (sub: string) => signHs256({ sub, aud: 'authenticated', exp: Math.floor(T0.getTime() / 1000) + 86_400 }, SECRET);
const get = async (path: string, user: string | null) => {
  const res = await fetch(base + path, { headers: user ? { authorization: `Bearer ${tok(user)}` } : {} });
  return { status: res.status, json: await res.json().catch(() => null) as any };
};
const reqRow = (o: Record<string, unknown>) => { const r = { id: `55555555-5555-4555-8555-5555555555${String(ctx.store.dataRequests.length + 10)}`, userId: A, kind: 'export', status: 'done', requestedAt: T0, claimedAt: null, attempts: 1, resultPath: null, completedAt: T0, lastError: null, ...o }; ctx.store.dataRequests.push(r as never); return r; };

before(async () => {
  ctx = setup();
  server = createServer(createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, callProvider: null, exports: new ExportAccess(ctx.store, admin),
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }), ipRatePerMinute: 1000 }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

test('download: the owner of a finished export gets a short-lived link to the exports bucket', async () => {
  const r = reqRow({ resultPath: `${A}/file.json` });
  const res = await get(`/v1/data-requests/${r.id}/download`, A);
  assert.equal(res.status, 200); assert.equal(res.json.expiresInSeconds, 300);
  assert.match(res.json.url, /\/object\/sign\/exports\/.+\/file\.json\?/);
  assert.ok(admin.calls.includes(`sign exports/${A}/file.json`));
});

test('download: needs a login; someone else\'s request, a deletion request and a bad id all look like not found', async () => {
  const mine = reqRow({ resultPath: `${A}/f2.json` });
  assert.equal((await get(`/v1/data-requests/${mine.id}/download`, null)).status, 401);
  assert.deepEqual(await get(`/v1/data-requests/${mine.id}/download`, B), { status: 404, json: { error: 'not_found' } });
  const del = reqRow({ kind: 'deletion', resultPath: null });
  assert.equal((await get(`/v1/data-requests/${del.id}/download`, A)).status, 404);
  assert.equal((await get('/v1/data-requests/not-a-uuid/download', A)).status, 404);
  assert.equal((await get('/v1/data-requests/55555555-5555-4555-8555-555555555599/download', A)).status, 404);
});

test('download: a request that is not finished says "not ready"; a path outside the person\'s folder is never signed', async () => {
  const queued = reqRow({ status: 'queued', resultPath: null, completedAt: null });
  assert.deepEqual(await get(`/v1/data-requests/${queued.id}/download`, A), { status: 409, json: { error: 'not_ready' } });
  const expired = reqRow({ status: 'done', resultPath: null });                                 // file purged after 7 days
  assert.equal((await get(`/v1/data-requests/${expired.id}/download`, A)).status, 409);
  const before = admin.calls.length;
  const forged = reqRow({ resultPath: `${B}/someone-elses.json` });                              // the database also forbids this; the API refuses regardless
  assert.equal((await get(`/v1/data-requests/${forged.id}/download`, A)).status, 404);
  assert.equal(admin.calls.length, before);
});

test('download: not configured means 501, and the config endpoint says whether exports exist', async () => {
  const h = createServer(createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, callProvider: null,
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }) }));
  await new Promise<void>((r) => h.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(h.address() as AddressInfo).port}`;
  const res = await fetch(`${b}/v1/data-requests/55555555-5555-4555-8555-555555555599/download`, { headers: { authorization: `Bearer ${tok(A)}` } });
  assert.equal(res.status, 501);
  assert.equal(((await (await fetch(`${b}/v1/config`, { headers: { authorization: `Bearer ${tok(A)}` } })).json()) as any).exports, false);
  assert.equal((await get('/v1/config', A)).json.exports, true);
  await new Promise<void>((r) => h.close(() => r()));
});
