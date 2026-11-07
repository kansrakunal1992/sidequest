import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { adminHeaders, adminPageHtml, newNonce, safeJson } from '../src/admin-page.ts';
import { ADMIN_SCRIPT } from '../src/admin-script.ts';
import { AdminPhotoAccess } from '../src/admin-photos.ts';
import { signHs256, verifyJwt } from '../src/jwt.ts';
import { FakeAdmin } from './fake-admin.ts';
import { A, B, C, T0, setup } from './helpers.ts';

const SUPA = 'https://p.supabase.co';
const page = (nonce = 'N0NCE') => adminPageHtml({ nonce, supabaseUrl: SUPA, anonKey: 'anon-key' });

test('script rules: nothing from the server can ever be interpreted as markup or code, and nothing is stored', () => {
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'setTimeout("', 'srcdoc', 'javascript:']) {
    assert.ok(!ADMIN_SCRIPT.includes(bad), `script contains ${bad}`);
  }
  assert.ok(!ADMIN_SCRIPT.includes('`') && !ADMIN_SCRIPT.includes('${'), 'script must stay a plain String.raw block');
});

test('page: every script and style carries the nonce, no inline handlers, no remote code', () => {
  const html = page('abc123');
  const tags = [...html.matchAll(/<(script|style)\b([^>]*)>/g)];
  assert.equal(tags.length, 3);
  for (const [, , attrs] of tags) if (!/type="application\/json"/.test(attrs!)) assert.match(attrs!, /nonce="abc123"/);
  assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(ADMIN_SCRIPT, '')), 'inline event handler found');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html) && !/<link/i.test(html) && !/<iframe/i.test(html));
  assert.match(html, /noindex/);
});

test('page: configuration is embedded safely (nothing can close the script block)', () => {
  const hostile = '</script><script>alert(1)</script>\u2028';
  const out = safeJson({ supabaseUrl: hostile, anonKey: '<!--' });
  assert.ok(!out.includes('<') && !out.includes('>') && !out.includes('\u2028'));
  assert.equal(JSON.parse(out).supabaseUrl, hostile);
});

test('headers: CSP allows only this page\'s nonce, this server and Supabase; cannot be framed; new nonce each time', () => {
  const a = newNonce(), b = newNonce(); assert.notEqual(a, b); assert.ok(a.length >= 20);
  const h = adminHeaders(a, SUPA);
  const csp = h['content-security-policy']!;
  assert.ok(csp.includes(`script-src 'nonce-${a}'`) && csp.includes(`style-src 'nonce-${a}'`));
  assert.ok(csp.startsWith("default-src 'none'") && csp.includes("frame-ancestors 'none'") && csp.includes("base-uri 'none'") && csp.includes("form-action 'none'"));
  assert.ok(csp.includes(`connect-src 'self' ${SUPA}`) && !csp.includes('unsafe-inline') && !csp.includes('unsafe-eval') && !csp.includes('*'));
  assert.equal(h['cache-control'], 'no-store'); assert.equal(h['x-frame-options'], 'DENY'); assert.equal(h['referrer-policy'], 'no-referrer');
});

// ---------------------------------------------------------------- HTTP: /admin and the photo link route
const SECRET = 'test-secret'; let server: Server, base = '', ctx: ReturnType<typeof setup>; const signer = new FakeAdmin();
const tok = (sub: string) => signHs256({ sub, aud: 'authenticated', exp: Math.floor(T0.getTime() / 1000) + 86_400 }, SECRET);
const PHOTO_P = '55555555-5555-4555-8555-555555555501', PHOTO_A = '55555555-5555-4555-8555-555555555502', PHOTO_R = '55555555-5555-4555-8555-555555555503';
before(async () => {
  ctx = setup();
  ctx.store.moderators.add(B);
  ctx.store.photos.set(PHOTO_P, { id: PHOTO_P, userId: A, storagePath: `${A}/p.jpg`, status: 'pending' });
  ctx.store.photos.set(PHOTO_A, { id: PHOTO_A, userId: A, storagePath: `${A}/a.jpg`, status: 'approved' });
  ctx.store.photos.set(PHOTO_R, { id: PHOTO_R, userId: A, storagePath: `${A}/r.jpg`, status: 'approved' }); ctx.store.reportedPhotoIds.add(PHOTO_R);
  server = createServer(createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, livekit: null, ipRatePerMinute: 1000,
    admin: { supabaseUrl: SUPA, anonKey: 'anon-key' }, adminPhotos: new AdminPhotoAccess(ctx.store, signer),
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));
const post = async (path: string, user: string | null, body: unknown) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tok(user)}` } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
};

test('GET /admin serves the page with a fresh nonce each time and needs no sign-in (the data calls do)', async () => {
  const r1 = await fetch(base + '/admin'), r2 = await fetch(base + '/admin');
  const [h1, h2] = [await r1.text(), await r2.text()];
  assert.equal(r1.status, 200);
  const n1 = /nonce="([^"]+)"/.exec(h1)![1], n2 = /nonce="([^"]+)"/.exec(h2)![1];
  assert.notEqual(n1, n2);
  assert.ok(r1.headers.get('content-security-policy')!.includes(`'nonce-${n1}'`));
});

test('POST /v1/admin/photo-url: only moderators, only pending or reported photos, same "not found" for every failure', async () => {
  assert.equal((await post('/v1/admin/photo-url', null, { photoId: PHOTO_P })).status, 401);
  assert.deepEqual(await post('/v1/admin/photo-url', C, { photoId: PHOTO_P }), { status: 404, json: { error: 'not_found' } });     // not a moderator
  const ok = await post('/v1/admin/photo-url', B, { photoId: PHOTO_P });
  assert.equal(ok.status, 200); assert.match(ok.json.url, /object\/sign\/profile-photos\/.+p\.jpg\?.*ttl=120/);
  assert.equal((await post('/v1/admin/photo-url', B, { photoId: PHOTO_R })).status, 200);                                            // reported
  assert.equal((await post('/v1/admin/photo-url', B, { photoId: PHOTO_A })).status, 404);                                            // approved and not reported
  assert.equal((await post('/v1/admin/photo-url', B, { photoId: 'nope' })).status, 404);
  assert.equal((await post('/v1/admin/photo-url', B, {})).status, 404);
});

test('without the anon key the page and the route are off', async () => {
  const h = createServer(createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, livekit: null,
    verifyToken: (t) => verifyJwt(t, { hsSecret: SECRET, now: ctx.clock(), audience: 'authenticated' }) }));
  await new Promise<void>((r) => h.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${(h.address() as AddressInfo).port}`;
  assert.equal((await fetch(b + '/admin')).status, 404);
  assert.equal((await fetch(b + '/v1/admin/photo-url', { method: 'POST', headers: { authorization: `Bearer ${tok(B)}` }, body: '{}' })).status, 404);
  await new Promise<void>((r) => h.close(() => r()));
});

// ---------------------------------------------------------------- the real page script, run in a DOM
let JSDOM: any = null;
try { JSDOM = (await import('jsdom')).JSDOM; } catch { /* jsdom not installed: the DOM tests are skipped */ }
const skipDom = !JSDOM;
const settle = () => new Promise((r) => setTimeout(r, 30));
type Call = { url: string; method: string; headers: Record<string, string>; body: any };

function openPage(handlers: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const dom = new JSDOM(page(), { runScripts: 'dangerously', url: 'https://api.example.com/admin', pretendToBeVisual: true, beforeParse(w: any) {
    w.fetch = async (url: string, init: any) => {
      const c: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null }; calls.push(c);
      const r = handlers(c); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    };
    w.confirm = () => true;
  } });
  const w = dom.window, d = w.document;
  const click = async (sel: string) => { (d.querySelector(sel) as HTMLElement).click(); await settle(); };
  const type = (sel: string, v: string) => { (d.querySelector(sel) as HTMLInputElement).value = v; };
  return { w, d, calls, click, type, text: () => d.body.textContent as string };
}
const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const REPORT = { report_id: 'r1', created_at: T0.toISOString(), reason: HOSTILE, content_type: 'message', reported_user_id: 'u9', reported_name: HOSTILE, reported_state: 'active', reporters_7d: 2, total_reports: 3, prior_actions: 1, status: 'open' };
const CTX = { report: { id: 'r1', reason: HOSTILE, details: HOSTILE, content_type: 'message', status: 'open', created_at: T0.toISOString() }, reported: { id: 'u9', name: HOSTILE, state: 'active', joined: T0.toISOString(), age: 31 },
  history: [{ action: 'warn', notes: HOSTILE, at: T0.toISOString(), until: null }], other_reports: [{ reason: HOSTILE, content_type: 'photo', status: 'open', at: T0.toISOString() }],
  content: { messages: [{ who: 'other', text: 'hello', at: T0.toISOString(), is_reported: false }, { who: 'reported', text: HOSTILE, media: null, at: T0.toISOString(), is_reported: true }] } };
const fakeServer = (c: Call) => {
  if (c.url.endsWith('/auth/v1/otp')) return { body: {} };
  if (c.url.endsWith('/auth/v1/verify')) return { body: { access_token: 'MOD-TOKEN' } };
  if (c.url.endsWith('/rpc/mod_queue')) return { body: [REPORT] };
  if (c.url.endsWith('/rpc/mod_report_context')) return { body: CTX };
  if (c.url.endsWith('/rpc/mod_take_action')) return { body: 'aid' };
  if (c.url.endsWith('/rpc/mod_appeals_queue')) return { body: [{ appeal_id: 'ap1', created_at: T0.toISOString(), user_id: 'u9', user_name: HOSTILE, user_state: 'suspended', message: HOSTILE, last_action: 'suspend', last_action_notes: HOSTILE }] };
  if (c.url.endsWith('/rpc/mod_resolve_appeal')) return { body: null };
  if (c.url.endsWith('/rpc/mod_photo_queue')) return { body: [{ photo_id: 'ph1', created_at: T0.toISOString(), visible_modes: ['friendship'] }] };
  if (c.url.endsWith('/rpc/mod_review_photo')) return { body: null };
  if (c.url === '/v1/admin/photo-url') return { body: { url: SUPA + '/storage/v1/object/sign/profile-photos/x.jpg?token=t' } };
  return { status: 500, body: {} };
};
async function signedIn(h = fakeServer) {
  const p = openPage(h);
  p.type('#email', 'mod@example.com'); await p.click('#send');
  p.type('#code', '123456'); await p.click('#verify');
  return p;
}

test('DOM: sign-in uses the one-time code flow; the token is kept in memory only and sent as the moderator\'s own bearer token', { skip: skipDom }, async () => {
  const p = await signedIn();
  assert.equal(p.calls[0]!.url, `${SUPA}/auth/v1/otp`); assert.deepEqual(p.calls[0]!.body, { email: 'mod@example.com', create_user: false });
  assert.equal(p.calls[1]!.url, `${SUPA}/auth/v1/verify`); assert.deepEqual(p.calls[1]!.body, { type: 'email', email: 'mod@example.com', token: '123456' });
  const q = p.calls.find((c) => c.url.endsWith('/rpc/mod_queue'))!;
  assert.equal(q.headers.authorization, 'Bearer MOD-TOKEN'); assert.equal(q.headers.apikey, 'anon-key'); assert.deepEqual(q.body, { p_status: 'open', p_limit: 50 });
  assert.equal(p.w.localStorage.length, 0); assert.equal(p.w.sessionStorage.length, 0); assert.equal(p.d.cookie, '');
  assert.equal((p.d.getElementById('app') as HTMLElement).hidden, false); assert.equal((p.d.getElementById('login') as HTMLElement).hidden, true);
});

test('DOM: hostile text in reports, names, messages and appeals is shown as plain text and never runs or becomes elements', { skip: skipDom }, async () => {
  const p = await signedIn();
  assert.ok((p.d.getElementById('list') as HTMLElement).textContent!.includes('<img src=x onerror='));          // the queue
  await p.click('.item');
  const detail = (p.d.getElementById('detail') as HTMLElement).textContent!;
  assert.ok(detail.includes('Conversation around the reported message') && detail.includes('<img src=x onerror='));   // detail pane really rendered, as literal text
  assert.ok(detail.includes('<script>window.__pwned=1</script>'));
  await p.click('[data-tab="appeals"]');
  assert.ok((p.d.getElementById('list') as HTMLElement).textContent!.includes('<img src=x onerror='));          // appeals
  assert.equal(p.d.querySelectorAll('img').length, 0); assert.equal(p.d.querySelectorAll('script').length, 2);   // only the page's own two scripts
  assert.equal(p.d.querySelectorAll('[onerror]').length, 0); assert.equal((p.w as any).__pwned, undefined);
});

test('DOM: deciding a report sends the moderator\'s decision with the person and a reason; a missing reason is refused client-side', { skip: skipDom }, async () => {
  const p = await signedIn();
  await p.click('.item');
  (p.d.getElementById('act') as HTMLSelectElement).value = 'suspend'; p.type('#days', '3');
  await p.click('#detail .primary');
  assert.ok(p.text().includes('short reason'));
  assert.equal(p.calls.filter((c) => c.url.endsWith('mod_take_action')).length, 0);
  p.type('#notes', 'Repeated harassment after a warning');
  await p.click('#detail .primary');
  const a = p.calls.find((c) => c.url.endsWith('mod_take_action'))!;
  assert.deepEqual(a.body, { p_report: 'r1', p_target: 'u9', p_action: 'suspend', p_notes: 'Repeated harassment after a warning', p_days: 3 });
  assert.ok(p.text().includes('Done: suspend'));
});

test('DOM: appeals can be overturned or upheld with the moderator\'s token', { skip: skipDom }, async () => {
  const p = await signedIn();
  await p.click('[data-tab="appeals"]');
  const buttons = [...p.d.querySelectorAll('#list button')] as HTMLElement[];
  assert.deepEqual(buttons.map((b) => b.textContent), ['Overturn', 'Uphold']);
  buttons[0]!.click(); await settle();
  assert.deepEqual(p.calls.find((c) => c.url.endsWith('mod_resolve_appeal'))!.body, { p_appeal: 'ap1', p_overturn: true });
});

test('DOM: photos load only on request, only from Supabase links; rejecting needs a reason', { skip: skipDom }, async () => {
  const p = await signedIn();
  await p.click('[data-tab="photos"]');
  assert.equal(p.d.querySelectorAll('img').length, 0);                                             // not loaded automatically
  const [show, approve, reject] = [...p.d.querySelectorAll('#list button')] as HTMLElement[];
  show!.click(); await settle();
  const link = p.calls.find((c) => c.url === '/v1/admin/photo-url')!;
  assert.equal(link.headers.authorization, 'Bearer MOD-TOKEN'); assert.deepEqual(link.body, { photoId: 'ph1' });
  assert.equal(p.d.querySelector('img')!.getAttribute('src'), SUPA + '/storage/v1/object/sign/profile-photos/x.jpg?token=t');
  reject!.click(); await settle();
  assert.equal(p.calls.filter((c) => c.url.endsWith('mod_review_photo')).length, 0);
  (p.d.getElementById('why-ph1') as HTMLInputElement).value = 'Shows another person'; reject!.click(); await settle();
  assert.deepEqual(p.calls.find((c) => c.url.endsWith('mod_review_photo'))!.body, { p_photo: 'ph1', p_approve: false, p_notes: 'Shows another person' });
  void approve;
});

test('DOM: a photo link that is not on the Supabase host is refused', { skip: skipDom }, async () => {
  const p = await signedIn((c) => c.url === '/v1/admin/photo-url' ? { body: { url: 'https://evil.example/x.jpg' } } : fakeServer(c));
  await p.click('[data-tab="photos"]');
  ([...p.d.querySelectorAll('#list button')][0] as HTMLElement).click(); await settle();
  assert.equal(p.d.querySelectorAll('img').length, 0); assert.ok(p.text().includes('Unexpected photo link'));
});

test('DOM: not being a moderator, or an expired session, says so plainly and an expired session signs out', { skip: skipDom }, async () => {
  const p1 = await signedIn((c) => c.url.endsWith('mod_queue') ? { status: 403, body: { code: '42501' } } : fakeServer(c));
  assert.ok(p1.text().includes('not a moderator'));
  const p2 = await signedIn((c) => c.url.endsWith('mod_queue') ? { status: 401, body: {} } : fakeServer(c));
  assert.equal((p2.d.getElementById('login') as HTMLElement).hidden, false); assert.equal((p2.d.getElementById('app') as HTMLElement).hidden, true);
  p2.type('#email', 'x@y.z');
  const p3 = await signedIn((c) => c.url.endsWith('/auth/v1/verify') ? { status: 400, body: { code: 'bad' } } : fakeServer(c));
  assert.equal((p3.d.getElementById('app') as HTMLElement).hidden, true);
});
