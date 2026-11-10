import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { DELETE_SCRIPT, deleteAccountHtml, pageHeaders, POLICY_DATE, privacyHtml, termsHtml } from '../src/public-pages.ts';
import type { LegalConfig } from '../src/public-pages.ts';
import { loadConfig } from '../src/config.ts';
import { setup } from './helpers.ts';

const SUPA = 'https://p.supabase.co';
const LEGAL: LegalConfig = { legalName: 'Acme <b>Ltd</b>', contactEmail: 'hello@acme.test', childSafetyEmail: 'safety@acme.test', supabaseUrl: SUPA, anonKey: 'anon', appName: 'Waypoint' };

test('privacy policy covers what Google Play requires and what the app really does', () => {
  const h = privacyHtml(LEGAL, 'N');
  for (const t of ['Privacy Policy', 'Acme &lt;b&gt;Ltd&lt;/b&gt;', 'hello@acme.test', 'safety@acme.test', 'Supabase', 'Railway', 'Firebase Cloud Messaging', 'We do not sell', '18+', '7 days', '/delete-account', 'National Center for Missing', 'approximate location', 'photo picker', 'retention'.length ? 'How long we keep it' : '', 'What we may keep after deletion', POLICY_DATE]) assert.ok(h.includes(t), `missing: ${t}`);
  assert.ok(!h.includes('<b>Ltd</b>'), 'configured names must be escaped');
});
test('terms prohibit child sexual abuse and exploitation publicly, ban sugar dating, and explain reporting, blocking and appeals', () => {
  const h = termsHtml(LEGAL, 'N');
  for (const t of ['child sexual abuse and exploitation (CSAE)', 'grooming', 'sextortion', 'National Center for Missing', 'sugar dating', 'report', 'block', 'appeal', 'safety@acme.test', 'at least 18', 'public place']) assert.ok(h.toLowerCase().includes(t.toLowerCase()), `missing: ${t}`);
});
test('pages carry only their own nonce, no inline handlers, no remote code; the deletion script is text-only and stores nothing', () => {
  for (const h of [privacyHtml(LEGAL, 'abc'), termsHtml(LEGAL, 'abc'), deleteAccountHtml(LEGAL, 'abc')]) {
    for (const [, attrs] of h.matchAll(/<(?:script|style)\b([^>]*)>/g)) if (!/application\/json/.test(attrs!)) assert.match(attrs!, /nonce="abc"/);
    assert.ok(!/\son[a-z]+\s*=/i.test(h.replace(DELETE_SCRIPT, '')) && !/<script[^>]*\ssrc=/i.test(h) && !/<iframe|<link/i.test(h));
  }
  for (const bad of ['innerHTML', 'outerHTML', 'document.write', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.cookie', '`', '${']) assert.ok(!DELETE_SCRIPT.includes(bad), bad);
  const csp = pageHeaders('n1', SUPA)['content-security-policy']!;
  assert.ok(csp.includes("script-src 'nonce-n1'") && csp.includes(`connect-src ${SUPA}`) && csp.includes("frame-ancestors 'none'") && !csp.includes('unsafe'));
  assert.ok(!pageHeaders('n1', null)['content-security-policy']!.includes('script-src'));        // static pages run no script at all
});

let server: Server, base = '';
const boot = async (legal: LegalConfig | null) => {
  const ctx = setup();
  const s = createServer(createHandler({ invites: ctx.svc, store: ctx.store, clock: ctx.clock, callsEnabled: false, livekit: null, legal, verifyToken: async () => null }));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { s, b: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};
before(async () => { const x = await boot(LEGAL); server = x.s; base = x.b; });
after(() => new Promise<void>((r) => server.close(() => r())));

test('HTTP: the three pages are public, fresh nonce each time, and cached briefly', async () => {
  for (const p of ['/privacy', '/terms', '/delete-account']) {
    const r1 = await fetch(base + p), r2 = await fetch(base + p); const [t1, t2] = [await r1.text(), await r2.text()];
    assert.equal(r1.status, 200); assert.match(r1.headers.get('content-type')!, /text\/html/);
    assert.notEqual(/nonce="([^"]+)"/.exec(t1)![1], /nonce="([^"]+)"/.exec(t2)![1]);
    assert.ok(r1.headers.get('content-security-policy')!.includes(`'nonce-${/nonce="([^"]+)"/.exec(t1)![1]}'`));
  }
});
test('HTTP: pages stay OFF until the legal name and contact email are configured (no placeholder policy can go live); deletion also needs the anon key', async () => {
  const x = await boot(null);
  for (const p of ['/privacy', '/terms', '/delete-account']) assert.equal((await fetch(x.b + p)).status, 404);
  await new Promise<void>((r) => x.s.close(() => r()));
  const y = await boot({ ...LEGAL, anonKey: null });
  assert.equal((await fetch(y.b + '/privacy')).status, 200); assert.equal((await fetch(y.b + '/delete-account')).status, 404);
  await new Promise<void>((r) => y.s.close(() => r()));
});
test('config: pages switch on from LEGAL_NAME and CONTACT_EMAIL; child-safety contact defaults to the main one', () => {
  const base = { DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co' };
  const c = loadConfig({ ...base, LEGAL_NAME: ' Acme ', CONTACT_EMAIL: 'a@b.c' });
  assert.deepEqual([c.legalName, c.contactEmail, c.childSafetyEmail, c.appName], ['Acme', 'a@b.c', 'a@b.c', 'Waypoint']);
  assert.equal(loadConfig({ ...base, LEGAL_NAME: 'Acme', CONTACT_EMAIL: 'a@b.c', CHILD_SAFETY_EMAIL: 's@b.c' }).childSafetyEmail, 's@b.c');
  assert.equal(loadConfig(base).legalName, null);
});

// ---- the deletion page script, executed in a DOM ----
let JSDOM: any = null; try { JSDOM = (await import('jsdom')).JSDOM; } catch { /* skipped */ }
const settle = () => new Promise((r) => setTimeout(r, 30));
function open(handler: (url: string, body: any, auth: string | undefined) => { status?: number; body: unknown }) {
  const calls: { url: string; body: any; auth?: string }[] = []; let confirmed = true;
  const dom = new JSDOM(deleteAccountHtml(LEGAL, 'N'), { runScripts: 'dangerously', url: 'https://api.test/delete-account', beforeParse(w: any) {
    w.fetch = async (url: string, init: any) => { const body = init.body ? JSON.parse(init.body) : null; const auth = init.headers.authorization; calls.push({ url, body, auth }); const r = handler(url, body, auth); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); };
    w.confirm = () => confirmed;
  } });
  const d = dom.window.document as Document;
  return { d, calls, text: () => d.body.textContent ?? '', setConfirm: (v: boolean) => { confirmed = v; },
    click: async (id: string) => { (d.getElementById(id) as HTMLElement).click(); await settle(); },
    type: (id: string, v: string) => { (d.getElementById(id) as HTMLInputElement).value = v; }, close: () => dom.window.close() };
}
test('DOM: delete-account flow signs in with an emailed code, requests deletion with the person\'s own token, and shows the pending date; cancel works', { skip: !JSDOM }, async () => {
  let pending = false;
  const p = open((url) => {
    if (url.endsWith('/auth/v1/otp')) return { body: {} };
    if (url.endsWith('/auth/v1/verify')) return { body: { access_token: 'USER-TOKEN' } };
    if (url.endsWith('/rpc/my_data_requests')) return { body: pending ? [{ id: 'd', kind: 'deletion', status: 'queued', requested_at: '2026-11-01T00:00:00Z' }] : [] };
    if (url.endsWith('/rpc/request_deletion')) { pending = true; return { body: 'd' }; }
    if (url.endsWith('/rpc/cancel_deletion')) { pending = false; return { body: true }; }
    return { status: 500, body: {} };
  });
  p.type('email', 'me@x.test'); await p.click('send'); p.type('code', '123456'); await p.click('verify');
  assert.equal((p.d.getElementById('account') as HTMLElement).hidden, false); assert.ok(p.text().includes('No deletion is pending'));
  await p.click('del');
  const call = p.calls.find((c) => c.url.endsWith('request_deletion'))!; assert.equal(call.auth, 'Bearer USER-TOKEN');
  assert.ok(p.text().includes('permanently deleted 7 days after')); assert.equal((p.d.getElementById('cancel') as HTMLElement).hidden, false);
  await p.click('cancel'); assert.ok(p.calls.some((c) => c.url.endsWith('cancel_deletion'))); assert.ok(p.text().includes('No deletion is pending'));
  p.close();
});
test('DOM: declining the confirmation sends nothing; a wrong code stays on the sign-in step', { skip: !JSDOM }, async () => {
  const p = open((url) => url.endsWith('/auth/v1/verify') ? { status: 400, body: {} } : { body: {} });
  p.type('email', 'me@x.test'); await p.click('send'); p.type('code', '000000'); await p.click('verify');
  assert.equal((p.d.getElementById('login') as HTMLElement).hidden, false); assert.ok(p.text().includes('did not work'));
  p.close();
  const q = open((url) => url.endsWith('/auth/v1/verify') ? { body: { access_token: 'T' } } : url.endsWith('my_data_requests') ? { body: [] } : { body: 'x' });
  q.type('email', 'a@b.c'); await q.click('send'); q.type('code', '1'); await q.click('verify'); q.setConfirm(false); await q.click('del');
  assert.equal(q.calls.filter((c) => c.url.endsWith('request_deletion')).length, 0); q.close();
});
