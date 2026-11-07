import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PhotoAccess } from '../src/photo-access.ts';
import { createHandler } from '../src/app.ts';
import { A, B, C, setup } from './helpers.ts';

function world() {
  const s = setup();
  s.store.addUser(C);
  let signs = 0; let t = 1_000_000;
  const signer = { signedUrl: async (_b: string, p: string) => { signs++; return `https://signed/${p}?n=${signs}`; } };
  const access = new PhotoAccess(s.store, signer, () => t);
  const photo = (id: string, userId: string, o: object = {}) => s.store.photos.set(id, { id, userId, storagePath: `${userId}/${id}.jpg`, status: 'approved', visibleModes: ['serious_dating'], position: 0, ...o });
  return { ...s, access, photo, signs: () => signs, advance: (ms: number) => { t += ms; } };
}
const item = (userId: string, modeId = 'serious_dating', all = false) => ({ userId, modeId, all });

test('photo access: approved, mode-visible photos only; first photo unless all requested', async () => {
  const w = world();
  w.photo('p1', B, { position: 1 }); w.photo('p0', B, { position: 0 }); w.photo('pend', B, { status: 'pending' });
  w.photo('rej', B, { status: 'rejected' }); w.photo('other-mode', B, { visibleModes: ['hookups'] });
  const [first] = await w.access.urlsFor(A, [item(B)]);
  assert.deepEqual(first!.urls.map((u) => u.split('?')[0]), [`https://signed/${B}/p0.jpg`]);
  const [all] = await w.access.urlsFor(A, [item(B, 'serious_dating', true)]);
  assert.deepEqual(all!.urls.map((u) => u.split('?')[0]), [`https://signed/${B}/p0.jpg`, `https://signed/${B}/p1.jpg`]);
});
test('photo access: explicit per-vibe selection overrides the default', async () => {
  const w = world();
  w.photo('a', B, { position: 0 }); w.photo('b', B, { position: 1 });
  w.store.visiblePhotoIds.set(`${B}|serious_dating`, ['b']);
  const [r] = await w.access.urlsFor(A, [item(B, 'serious_dating', true)]);
  assert.deepEqual(r!.urls.map((u) => u.split('?')[0]), [`https://signed/${B}/b.jpg`]);
});
test('photo access: blocks, vibe mismatch, self and junk input all return nothing', async () => {
  const w = world();
  w.photo('a', B);
  w.store.block(B, A);
  assert.deepEqual((await w.access.urlsFor(A, [item(B)]))[0]!.urls, []);
  w.store.blocks.clear();
  w.store.modes.delete(`${A}|serious_dating`);
  assert.deepEqual((await w.access.urlsFor(A, [item(B)]))[0]!.urls, []);
  w.store.modes.add(`${A}|serious_dating`);
  assert.equal((await w.access.urlsFor(A, [item(B)]))[0]!.urls.length, 1);
  assert.deepEqual((await w.access.urlsFor(A, [item(A), item('nope'), item(B, 'not_a_mode'), item(C)])).map((r) => r.urls.length), [0, 0, 0, 0]);
});
test('photo access: signed URLs are cached until near expiry; signer failure degrades to no image', async () => {
  const w = world();
  w.photo('a', B);
  await w.access.urlsFor(A, [item(B)]); await w.access.urlsFor(A, [item(B)]);
  assert.equal(w.signs(), 1);
  w.advance(9.5 * 60_000);                       // within 60 s of expiry: re-sign
  await w.access.urlsFor(A, [item(B)]);
  assert.equal(w.signs(), 2);
  const broken = new PhotoAccess(w.store, { signedUrl: async () => { throw new Error('storage down'); } });
  assert.deepEqual((await broken.urlsFor(A, [item(B)]))[0]!.urls, []);
});
test('photo access: batch size is capped', async () => {
  const w = world(); w.photo('a', B);
  const res = await w.access.urlsFor(A, Array.from({ length: 50 }, () => item(B)));
  assert.equal(res.length, 30);
});

test('HTTP: /v1/photos/urls validates, authorises and reports when not configured', async () => {
  const w = world(); w.photo('a', B);
  const mk = (photoAccess: PhotoAccess | null) => createServer(createHandler({ invites: w.svc, store: w.store, clock: w.clock, callsEnabled: false, livekit: null,
    photoAccess, verifyToken: async (t) => ({ sub: t === 'a' ? A : B }) }));
  const s1 = mk(w.access); await new Promise<void>((r) => s1.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(s1.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/v1/photos/urls`, { method: 'POST', headers: { authorization: 'Bearer a', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ok = await post({ items: [{ userId: B, modeId: 'serious_dating' }] });
  assert.equal(ok.status, 200);
  const j = await ok.json(); assert.equal(j.results[0].urls.length, 1); assert.equal(j.expiresInSeconds, 600);
  assert.equal((await post({ items: [] })).status, 400);
  assert.equal((await post({ items: 'x' })).status, 400);
  assert.equal((await post({ items: Array.from({ length: 31 }, () => ({ userId: B, modeId: 'serious_dating' })) })).status, 400);
  await new Promise<void>((r) => s1.close(() => r()));
  const s2 = mk(null); await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
  const off = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/v1/photos/urls`, { method: 'POST', headers: { authorization: 'Bearer a', 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ userId: B, modeId: 'serious_dating' }] }) });
  assert.equal(off.status, 501);
  await new Promise<void>((r) => s2.close(() => r()));
});
