import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PhotoService, SupabaseStorageSigner } from '../src/photos.ts';
import type { ImageModerator, ModerationVerdict } from '../src/photos.ts';
import { createHandler } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { A, B, setup } from './helpers.ts';

const PID = '99999999-9999-4999-8999-999999999999';
function photoSetup(mode: 'required' | 'off', moderator: ImageModerator | null, withSigner = true) {
  const s = setup();
  s.store.photos.set(PID, { id: PID, userId: A, storagePath: `${A}/a b.jpg`, status: 'pending' });
  const signer = withSigner ? { signedUrl: async (_b: string, p: string) => `https://signed.example/${p}` } : null;
  const logs: string[] = [];
  const svc = new PhotoService({ store: s.store, moderator, signer, mode, log: (m) => logs.push(m) });
  return { ...s, svc, logs };
}
const verdictMod = (v: ModerationVerdict): ImageModerator => ({ review: async () => v });

test('photos: only the owner can submit; outsiders see not_found', async () => {
  const { svc } = photoSetup('required', verdictMod('approved'));
  const r = await svc.submit(B, PID); assert.equal(r.ok, false); assert.equal((r as any).status, 404);
  const r2 = await svc.submit(A, '00000000-0000-4000-8000-000000000000'); assert.equal((r2 as any).status, 404);
});
test('photos: fail closed without a provider; human queue keeps them pending', async () => {
  const { svc, store } = photoSetup('required', null);
  assert.deepEqual(await svc.submit(A, PID), { ok: true, value: { status: 'pending' } });
  assert.equal(store.photos.get(PID)!.status, 'pending');
});
test('photos: provider verdicts map to statuses; errors and "needs human" stay pending', async () => {
  for (const [v, want] of [['approved', 'approved'], ['rejected', 'rejected'], ['needs_human', 'pending']] as const) {
    const { svc, store } = photoSetup('required', verdictMod(v));
    assert.deepEqual(await svc.submit(A, PID), { ok: true, value: { status: want } });
    assert.equal(store.photos.get(PID)!.status, want);
  }
  const { svc, store, logs } = photoSetup('required', { review: async () => { throw new Error('provider down'); } });
  assert.deepEqual(await svc.submit(A, PID), { ok: true, value: { status: 'pending' } });
  assert.equal(store.photos.get(PID)!.status, 'pending'); assert.ok(logs.some((l) => l.includes('provider down')));
});
test('photos: decisions are not re-run; DEV switch approves loudly', async () => {
  let calls = 0;
  const { svc, store } = photoSetup('required', { review: async () => { calls++; return 'rejected'; } });
  await svc.submit(A, PID); await svc.submit(A, PID);
  assert.equal(calls, 1); assert.equal(store.photos.get(PID)!.status, 'rejected');
  const dev = photoSetup('off', null, false);
  assert.deepEqual(await dev.svc.submit(A, PID), { ok: true, value: { status: 'approved' } });
  assert.ok(dev.logs.some((l) => l.includes('WARNING')));
});
test('storage signer builds a correct, encoded request', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ signedURL: '/object/sign/profile-photos/x?token=T' })); }) as unknown as typeof fetch;
  const url = await new SupabaseStorageSigner('https://p.supabase.co/', 'SERVICE', f).signedUrl('profile-photos', 'u1/a b.jpg', 120);
  assert.equal(seen!.url, 'https://p.supabase.co/storage/v1/object/sign/profile-photos/u1/a%20b.jpg');
  assert.equal(url, 'https://p.supabase.co/storage/v1/object/sign/profile-photos/x?token=T');
  assert.equal(JSON.parse(seen!.init.body as string).expiresIn, 120);
  const bad = (async () => new Response('no', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(new SupabaseStorageSigner('https://p', 'k', bad).signedUrl('b', 'p', 1), /sign_failed_400/);
});

test('HTTP: photo submit and age-verification routes', async () => {
  const { store, svc: invites, clock } = photoSetup('required', null);
  const photos = new PhotoService({ store, moderator: null, signer: null, mode: 'off' });
  const h = createServer(createHandler({ invites, store, clock, callsEnabled: false, callProvider: null, photos, ageVerifier: null,
    verifyToken: async (t) => ({ sub: t === 'a' ? A : B }) }));
  await new Promise<void>((r) => h.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(h.address() as AddressInfo).port}`;
  const post = (path: string, who: string) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${who}` } });
  assert.equal((await post(`/v1/photos/${PID}/submit`, 'b')).status, 404);
  const ok = await post(`/v1/photos/${PID}/submit`, 'a');
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { status: 'approved' });
  const age = await post('/v1/verification/age/start', 'a');
  assert.equal(age.status, 501); assert.equal((await age.json()).error, 'age_verification_not_configured');
  await new Promise<void>((r) => h.close(() => r()));
});
test('config: PHOTO_MODERATION is validated and defaults to required', () => {
  const base = { DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co' };
  assert.equal(loadConfig(base).photoModeration, 'required');
  assert.equal(loadConfig({ ...base, PHOTO_MODERATION: 'off' }).photoModeration, 'off');
  assert.throws(() => loadConfig({ ...base, PHOTO_MODERATION: 'maybe' }), /PHOTO_MODERATION/);
});
