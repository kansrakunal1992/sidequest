import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DiditProvider, MAX_PER_DAY, ProviderError, SelfieVerification, interpretDecision, verifyDiditSignature } from '../src/selfie-verification.ts';
import type { VerificationProvider } from '../src/selfie-verification.ts';
import { NoopPushSender, createNotifier } from '../src/notifications.ts';
import { loadConfig } from '../src/config.ts';
import { privacyHtml } from '../src/public-pages.ts';
import { A, B, T0, setup } from './helpers.ts';

const SECRET = 'whsec_test_secret';
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((a, k) => { a[k] = canon((v as any)[k]); return a; }, {}) : v;
const sign = (payload: object, secret = SECRET) => createHmac('sha256', secret).update(JSON.stringify(canon(payload)), 'utf8').digest('hex');
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));

// ------------------------------------------------------------------------------------------------ signature
test('webhook signature: the right secret and a fresh timestamp pass; everything else fails', () => {
  const payload = { event_id: 'e1', status: 'Approved', decision: { face_matches: [{ score: 96.1 }, { score: 100.0 }] }, text: 'naïve ✓' };
  const raw = JSON.stringify(payload), now = T0.getTime();
  assert.equal(verifyDiditSignature(raw, sign(payload), ts(T0), SECRET, now), true);
  // the provider sorts keys and shortens whole floats, so reordered keys and 100.0 vs 100 still verify
  assert.equal(verifyDiditSignature('{"text":"naïve ✓","status":"Approved","event_id":"e1","decision":{"face_matches":[{"score":96.1},{"score":100.0}]}}', sign(payload), ts(T0), SECRET, now), true);
  assert.equal(verifyDiditSignature(raw, sign(payload, 'other'), ts(T0), SECRET, now), false);
  assert.equal(verifyDiditSignature(raw.replace('Approved', 'Declined'), sign(payload), ts(T0), SECRET, now), false, 'a changed body fails');
  assert.equal(verifyDiditSignature(raw, sign(payload), ts(new Date(T0.getTime() - 301_000)), SECRET, now), false, 'stale');
  assert.equal(verifyDiditSignature(raw, sign(payload), ts(new Date(T0.getTime() + 301_000)), SECRET, now), false, 'from the future');
  for (const [sig, t] of [[undefined, ts(T0)], [sign(payload), undefined], ['', ts(T0)], [sign(payload), 'abc']] as const) assert.equal(verifyDiditSignature(raw, sig, t, SECRET, now), false);
  assert.equal(verifyDiditSignature('not json', sign(payload), ts(T0), SECRET, now), false);
  assert.equal(verifyDiditSignature(raw, sign(payload), ts(T0), '', now), false, 'no secret configured never verifies');
});

// ------------------------------------------------------------------------------------------------ the verdict
const ok = { status: 'Approved', decision: { liveness_checks: [{ status: 'Approved', score: 95 }], face_matches: [{ status: 'Approved', score: 96.1 }] } };
test('verdict: approved only when liveness AND face match are present and approved and the score clears our floor', () => {
  assert.deepEqual(interpretDecision(ok, 85), { outcome: 'approved' });
  assert.deepEqual(interpretDecision({ ...ok, decision: { ...ok.decision, face_matches: [{ status: 'Approved', score: 0.96 }] } }, 85), { outcome: 'approved' }, 'a 0 to 1 score is understood');
  assert.deepEqual(interpretDecision({ ...ok, decision: { ...ok.decision, face_matches: [{ status: 'Approved', score: 80 }] } }, 85), { outcome: 'rejected', reason: 'low_match' });
  assert.deepEqual(interpretDecision({ status: 'Approved', decision: { face_matches: ok.decision.face_matches } }, 85), { outcome: 'rejected', reason: 'liveness_failed' }, 'no liveness result is not a pass');
  assert.deepEqual(interpretDecision({ status: 'Approved', decision: { liveness_checks: ok.decision.liveness_checks } }, 85), { outcome: 'rejected', reason: 'face_mismatch' }, 'no match result is not a pass');
  assert.deepEqual(interpretDecision({ status: 'Approved' }, 85), { outcome: 'rejected', reason: 'liveness_failed' });
});
test('verdict: declined, in review, abandoned and still-running sessions', () => {
  assert.deepEqual(interpretDecision({ status: 'Declined', decision: { liveness_checks: [{ status: 'Declined' }] } }, 85), { outcome: 'rejected', reason: 'liveness_failed' });
  assert.deepEqual(interpretDecision({ status: 'Declined', decision: { liveness_checks: [{ status: 'Approved' }], face_matches: [{ status: 'Declined' }] } }, 85), { outcome: 'rejected', reason: 'face_mismatch' });
  assert.deepEqual(interpretDecision({ status: 'Declined' }, 85), { outcome: 'rejected', reason: 'try_again' });
  assert.deepEqual(interpretDecision({ status: 'In Review' }, 85), { outcome: 'rejected', reason: 'try_again' }, 'never left waiting for a person');
  assert.deepEqual(interpretDecision({ status: 'Abandoned' }, 85), { outcome: 'expired', reason: 'not_finished' });
  for (const s of ['Not Started', 'In Progress', 'Resubmitted', 'Awaiting User', undefined]) assert.deepEqual(interpretDecision({ status: s }, 85), { outcome: 'ignore' }, String(s));
});

// ------------------------------------------------------------------------------------------------ provider client
test('Didit client: sends the key and portrait, reads the session, and tells credit problems from photo problems', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown) => async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };
  const p = (f: typeof fetch) => new DiditProvider({ apiKey: 'k', workflowId: 'wf' }, f);
  const s = await p(reply(201, { session_id: 'S1', url: 'https://verify.didit.me/session/x' }) as any).createSession({ userId: A, portraitBase64: 'QUJD', callbackUrl: 'app://back' });
  assert.deepEqual(s, { sessionId: 'S1', url: 'https://verify.didit.me/session/x' });
  assert.equal(calls[0]!.url, 'https://verification.didit.me/v3/session/');
  assert.equal((calls[0]!.init.headers as any)['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { workflow_id: 'wf', vendor_data: A, callback: 'app://back', portrait_image: 'QUJD' });
  const kind = async (f: any) => p(f).createSession({ userId: A, portraitBase64: 'x', callbackUrl: 'c' }).then(() => 'ok', (e: ProviderError) => e.kind);
  assert.equal(await kind(reply(400, { portrait_image: 'No face found' })), 'bad_input');
  assert.equal(await kind(reply(400, { detail: 'Insufficient credits' })), 'unavailable', 'out of credit is not the person\'s fault');
  assert.equal(await kind(reply(401, {})), 'unavailable');
  assert.equal(await kind(async () => { throw new Error('net'); }), 'unavailable');
  await p(reply(200, {}) as any).deleteSession('S 1');
  assert.equal(calls.at(-1)!.url, 'https://verification.didit.me/v3/session/S%201/delete/'); assert.equal(calls.at(-1)!.init.method, 'DELETE');
});

// ------------------------------------------------------------------------------------------------ the whole flow
class FakeProvider implements VerificationProvider {
  created: { userId: string; portraitBase64: string; callbackUrl: string }[] = []; deleted: string[] = [];
  next: 'ok' | 'bad' | 'down' = 'ok'; n = 0;
  async createSession(i: { userId: string; portraitBase64: string; callbackUrl: string }) {
    this.created.push(i);
    if (this.next === 'bad') throw new ProviderError('bad_input', 'no face');
    if (this.next === 'down') throw new ProviderError('unavailable', 'status_503');
    return { sessionId: `sess-${++this.n}`, url: `https://verify.test/${this.n}` };
  }
  async deleteSession(id: string) { this.deleted.push(id); }
}
function flow(over: { photos?: boolean; cap?: number; fetchOk?: boolean } = {}) {
  const s = setup(); const provider = new FakeProvider(); const sender = new NoopPushSender();
  if (over.photos !== false) s.store.photos.set('p1', { id: 'p1', userId: A, storagePath: `${A}/1.jpg`, status: 'approved', position: 0 });
  const fetched: string[] = [];
  const fetchFn = (async (url: any) => { fetched.push(String(url)); return over.fetchOk === false ? new Response('', { status: 404 }) : new Response(Buffer.from('JPEGDATA'), { status: 200 }); }) as typeof fetch;
  const notifier = createNotifier({ store: s.store, sender, clock: s.clock });
  const svc = new SelfieVerification({ store: s.store, provider, signer: { signedUrl: async (b, p) => `https://signed.test/${b}/${p}` }, notifier, clock: s.clock, webhookSecret: SECRET,
    minScore: 85, returnUrl: 'sidequest://safety/verify', monthlyCap: over.cap ?? 90, fetchFn });
  const hook = (payload: object, at = s.clock()) => svc.handleWebhook(JSON.stringify(payload), { signature: sign(payload), timestamp: ts(at) });
  return { ...s, provider, svc, hook, fetched, sender };
}
const decision = (sessionId: string, status = 'Approved', extra: object = {}) => ({ webhook_type: 'status.updated', event_id: `e-${sessionId}-${status}`, session_id: sessionId, status, vendor_data: A,
  decision: status === 'Approved' ? ok.decision : { liveness_checks: [{ status: 'Approved' }], face_matches: [{ status: 'Declined', score: 40 }] }, ...extra });

test('flow: consent, start, approval sets the badge once, tells the person, and asks the provider to delete the session', async () => {
  const f = flow();
  assert.deepEqual(await f.svc.start(A, false), { ok: false, status: 400, error: 'consent_required' });
  const started = await f.svc.start(A, true);
  assert.deepEqual(started, { ok: true, value: { url: 'https://verify.test/1' } });
  assert.equal(f.provider.created[0]!.callbackUrl, 'sidequest://safety/verify');
  assert.equal(f.provider.created[0]!.portraitBase64, Buffer.from('JPEGDATA').toString('base64'));
  assert.match(f.fetched[0]!, /profile-photos/);
  assert.equal(await f.store.isVerified(A), false, 'starting never verifies');

  const out = await f.hook(decision('sess-1'));
  assert.equal(out.status, 200); await out.after!();
  assert.equal(await f.store.isVerified(A), true);
  assert.deepEqual(f.provider.deleted, ['sess-1']);
  assert.equal([...f.store.notifications].filter((n: any) => n.kind === 'verification_result').length, 1);

  const again = await f.hook(decision('sess-1')); await again.after!();       // provider retries the webhook
  assert.equal([...f.store.notifications].filter((n: any) => n.kind === 'verification_result').length, 1, 'no second notification');
  assert.deepEqual(await f.svc.start(A, true), { ok: false, status: 409, error: 'already_verified' });
});

test('flow: a mismatch does not verify, records a reason, and the person can try again', async () => {
  const f = flow();
  await f.svc.start(A, true);
  const out = await f.hook(decision('sess-1', 'Declined')); await out.after!();
  assert.equal(await f.store.isVerified(A), false);
  assert.deepEqual(f.store.verifications.map((v: any) => [v.status, v.reason]), [['rejected', 'face_mismatch']]);
  assert.equal((await f.svc.start(A, true)).ok, true, 'a new attempt is allowed after a decision');
});

test('flow: webhooks that are unsigned, stale, unknown, for another person, still running or malformed change nothing', async () => {
  const f = flow(); await f.svc.start(A, true);
  const p = decision('sess-1');
  assert.equal((await f.svc.handleWebhook(JSON.stringify(p), { signature: 'bad', timestamp: ts(f.clock()) })).status, 401);
  assert.equal((await f.svc.handleWebhook(JSON.stringify(p), { signature: sign(p), timestamp: ts(new Date(f.clock().getTime() - 3600_000)) })).status, 401);
  assert.equal((await f.hook(decision('sess-unknown'))).body && (await f.hook(decision('sess-unknown'))).status, 200);
  assert.deepEqual((await f.hook({ ...decision('sess-1'), vendor_data: B })).body, { ok: true, ignored: true }, 'someone else\'s id');
  assert.deepEqual((await f.hook({ ...decision('sess-1', 'Approved'), status: 'In Progress' })).body, { ok: true, ignored: true });
  assert.deepEqual((await f.hook({ webhook_type: 'data.updated', session_id: 'sess-1' })).body, { ok: true, ignored: true });
  assert.equal((await f.svc.handleWebhook('{oops', { signature: 'x', timestamp: ts(f.clock()) })).status, 401);
  assert.equal(await f.store.isVerified(A), false);
});

test('start: needs an active account, an approved photo, and respects the limits', async () => {
  const none = flow({ photos: false });
  assert.deepEqual(await none.svc.start(A, true), { ok: false, status: 422, error: 'no_approved_photo' });
  assert.equal(none.provider.created.length, 0);

  const busy = flow();
  assert.equal((await busy.svc.start(A, true)).ok, true);
  assert.equal(busy.provider.created.length, 1);
  const reopen = await busy.svc.start(A, true);                                  // an unfinished session is reopened, not duplicated
  assert.equal(reopen.ok, true); assert.equal(busy.store.verifications.length, 1);

  const lim = flow();
  for (let i = 0; i < MAX_PER_DAY; i++) { const r = await lim.svc.start(A, true); assert.equal(r.ok, true, `try ${i + 1}`); await (await lim.hook(decision(`sess-${i + 1}`, 'Declined'))).after!(); }
  assert.deepEqual(await lim.svc.start(A, true), { ok: false, status: 429, error: 'too_many_attempts' });
  lim.setTime(new Date(T0.getTime() + 25 * 3600_000));
  assert.equal((await lim.svc.start(A, true)).ok, true, 'the day window slides');
});

test('start: the monthly cap pauses everyone before the free allowance is exhausted', async () => {
  const f = flow({ cap: 1 });
  f.store.addUser('77777777-7777-4777-8777-777777777777', { displayName: 'Zed' });
  f.store.photos.set('p9', { id: 'p9', userId: '77777777-7777-4777-8777-777777777777', storagePath: 'z/1.jpg', status: 'approved', position: 0 });
  assert.equal((await f.svc.start('77777777-7777-4777-8777-777777777777', true)).ok, true);
  assert.deepEqual(await f.svc.start(A, true), { ok: false, status: 503, error: 'verification_paused' });
});

test('start: provider trouble is reported plainly and does not burn the person\'s tries', async () => {
  const down = flow(); down.provider.next = 'down';
  assert.deepEqual(await down.svc.start(A, true), { ok: false, status: 502, error: 'provider_unavailable' });
  assert.equal(await down.store.countVerificationAttempts(new Date(0), A), 0, 'never reached the provider, so it does not count');
  down.provider.next = 'ok'; assert.equal((await down.svc.start(A, true)).ok, true, 'and they can try again at once');

  const bad = flow(); bad.provider.next = 'bad';
  assert.deepEqual(await bad.svc.start(A, true), { ok: false, status: 422, error: 'photo_not_usable' });
  const gone = flow({ fetchOk: false });
  assert.deepEqual((await gone.svc.start(A, true)).ok, false);
  assert.equal(gone.provider.created.length, 0, 'a photo that cannot be read is never sent');
});

// ------------------------------------------------------------------------------------------------ config and privacy page
test('config: the three DIDIT values go together; thresholds are checked; off by default', () => {
  const base = { DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co' };
  assert.equal(loadConfig(base).didit, null);
  assert.throws(() => loadConfig({ ...base, DIDIT_API_KEY: 'k' }), /must all be set together \(missing: DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET\)/);
  assert.throws(() => loadConfig({ ...base, VERIFY_MIN_MATCH_SCORE: '20' }), /VERIFY_MIN_MATCH_SCORE/);
  assert.throws(() => loadConfig({ ...base, VERIFY_MONTHLY_CAP: '0' }), /VERIFY_MONTHLY_CAP/);
  assert.throws(() => loadConfig({ ...base, DIDIT_BASE_URL: 'http://x' }), /DIDIT_BASE_URL/);
  const c = loadConfig({ ...base, DIDIT_API_KEY: ' k ', DIDIT_WORKFLOW_ID: 'w', DIDIT_WEBHOOK_SECRET: 's' }).didit!;
  assert.deepEqual([c.apiKey, c.minScore, c.monthlyCap, c.returnUrl], ['k', 85, 90, 'sidequest://safety/verify']);
});
test('privacy policy mentions photo verification only when it is switched on', () => {
  const cfg = { legalName: 'Q', contactEmail: 'a@b.co', childSafetyEmail: 'a@b.co', supabaseUrl: 'https://a.supabase.co', anonKey: null, appName: 'Waypoint' };
  assert.ok(!/Photo verification/.test(privacyHtml(cfg, 'n')));
  const on = privacyHtml({ ...cfg, verificationProvider: 'Didit' }, 'n');
  assert.ok(/Photo verification \(optional\)/.test(on) && /Didit/.test(on) && /do not receive or keep your selfie/.test(on));
});

// ------------------------------------------------------------------------------------------------ over HTTP
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { signHs256, verifyJwt } from '../src/jwt.ts';

async function serve(selfie: SelfieVerification | null, ctx: ReturnType<typeof setup>) {
  const handler = createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, callProvider: null, selfie,
    verifyToken: (t) => verifyJwt(t, { hsSecret: 's', now: ctx.clock(), audience: 'authenticated' }), ipRatePerMinute: 1000 });
  const server = createServer(handler); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const bearer = (sub: string) => ({ authorization: `Bearer ${signHs256({ sub, aud: 'authenticated', exp: Math.floor(T0.getTime() / 1000) + 86_400 }, 's')}`, 'content-type': 'application/json' });

test('HTTP: start needs sign-in and consent, is 501 when not configured; the webhook is 404 when not configured', async () => {
  const off = flow(); const o = await serve(null, off);
  assert.equal((await fetch(o.base + '/v1/verification/selfie/start', { method: 'POST', headers: bearer(A), body: '{"consent":true}' })).status, 501);
  assert.equal((await fetch(o.base + '/v1/hooks/didit', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await (await fetch(o.base + '/v1/config', { headers: bearer(A) })).json() as any).verification, false);
  await o.close();

  const on = flow(); const s = await serve(on.svc, on);
  assert.equal((await fetch(s.base + '/v1/verification/selfie/start', { method: 'POST', body: '{"consent":true}' })).status, 401);
  assert.equal((await fetch(s.base + '/v1/verification/selfie/start', { method: 'POST', headers: bearer(A), body: '{}' })).status, 400, 'no consent, no check');
  const r = await fetch(s.base + '/v1/verification/selfie/start', { method: 'POST', headers: bearer(A), body: '{"consent":true}' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { url: 'https://verify.test/1' });
  assert.equal((await (await fetch(s.base + '/v1/config', { headers: bearer(A) })).json() as any).verification, true);

  const p = decision('sess-1');
  const bad = await fetch(s.base + '/v1/hooks/didit', { method: 'POST', headers: { 'x-signature-v2': 'nope', 'x-timestamp': ts(on.clock()) }, body: JSON.stringify(p) });
  assert.equal(bad.status, 401);
  const good = await fetch(s.base + '/v1/hooks/didit', { method: 'POST', headers: { 'x-signature-v2': sign(p), 'x-timestamp': ts(on.clock()) }, body: JSON.stringify(p) });
  assert.equal(good.status, 200);
  assert.equal(await on.store.isVerified(A), true);
  await s.close();
});
