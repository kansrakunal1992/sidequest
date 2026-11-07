import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdminClient } from '../src/supabase-admin.ts';
import { loadConfig } from '../src/config.ts';
import { A, B } from './helpers.ts';

type Req = { method: string; url: string; headers: Record<string, string>; body: any };
/** A tiny fake of the Supabase Storage/Auth REST API. Request shapes were checked against the published storage-js and auth-js sources. */
function fakeSupabase(tree: Record<string, { id: string | null }[]>, status: Record<string, number> = {}) {
  const reqs: Req[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' && headers['content-type']?.includes('json') ? JSON.parse(init.body) : init.body;
    reqs.push({ method: init.method ?? 'GET', url, headers, body });
    const u = new URL(url);
    const forced = status[`${init.method} ${u.pathname}`]; if (forced) return new Response('{}', { status: forced });
    if (u.pathname.startsWith('/storage/v1/object/list/')) {
      const prefix = (body as any).prefix as string; const all = (tree[prefix] ?? []) as any[];
      return Response.json(all.slice((body as any).offset, (body as any).offset + (body as any).limit));
    }
    return Response.json({});
  }) as unknown as typeof fetch;
  return { reqs, fetchFn };
}
const entries = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}.jpg`, id: `id${i}` }));

test('upload: POST to the object path with upsert and the service key', async () => {
  const f = fakeSupabase({});
  await new SupabaseAdminClient('https://p.supabase.co/', 'svc', f.fetchFn).uploadJson('exports', `${A}/r 1.json`, '{"a":1}');
  const r = f.reqs[0]!;
  assert.equal(r.method, 'POST'); assert.equal(r.url, `https://p.supabase.co/storage/v1/object/exports/${A}/r%201.json`);
  assert.equal(r.headers['x-upsert'], 'true'); assert.equal(r.headers.authorization, 'Bearer svc'); assert.equal(r.headers.apikey, 'svc'); assert.equal(r.body.a, 1);
});

test('upload failure throws (so the job retries)', async () => {
  const f = fakeSupabase({}, { [`POST /storage/v1/object/exports/${A}/x.json`]: 500 });
  await assert.rejects(new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn).uploadJson('exports', `${A}/x.json`, '{}'), /upload_failed_500/);
});

test('removing a user folder walks sub-folders and pages of 100, and deletes in batches', async () => {
  const f = fakeSupabase({ [A]: [...entries(100, 'p'), ...entries(5, 'q'), { name: 'conv1', id: null }], [`${A}/conv1`]: entries(3, 'm') });
  const n = await new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn).removeUserFolder('chat-media', A);
  assert.equal(n, 108);
  const lists = f.reqs.filter((r) => r.url.includes('/object/list/chat-media'));
  assert.deepEqual(lists.map((r) => [r.body.prefix, r.body.offset]), [[A, 0], [A, 100], [`${A}/conv1`, 0]]);
  const dels = f.reqs.filter((r) => r.method === 'DELETE');
  assert.deepEqual(dels.map((r) => r.body.prefixes.length), [100, 8]); assert.ok(dels.every((r) => r.url === 'https://p.supabase.co/storage/v1/object/chat-media'));
  assert.ok(dels.flatMap((r) => r.body.prefixes).every((p: string) => p.startsWith(`${A}/`)));
});

test('removing a folder refuses anything that is not a user id (an empty prefix would list the whole bucket)', async () => {
  const f = fakeSupabase({});
  const c = new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn);
  for (const bad of ['', '/', '..', 'abc', `${A}/../${B}`]) await assert.rejects(c.removeUserFolder('exports', bad));
  assert.equal(f.reqs.length, 0);
});

test('an empty folder deletes nothing and makes no delete call', async () => {
  const f = fakeSupabase({});
  assert.equal(await new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn).removeUserFolder('voice-intros', A), 0);
  assert.equal(f.reqs.filter((r) => r.method === 'DELETE').length, 0);
});

test('deleting the login account: hard delete via the Auth admin API; already gone is success; other failures throw', async () => {
  const f = fakeSupabase({});
  await new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn).deleteAuthUser(A);
  assert.equal(f.reqs[0]!.method, 'DELETE'); assert.equal(f.reqs[0]!.url, `https://p.supabase.co/auth/v1/admin/users/${A}`); assert.equal(f.reqs[0]!.body.should_soft_delete, false);
  const gone = fakeSupabase({}, { [`DELETE /auth/v1/admin/users/${A}`]: 404 });
  await new SupabaseAdminClient('https://p.supabase.co', 'svc', gone.fetchFn).deleteAuthUser(A);
  const bad = fakeSupabase({}, { [`DELETE /auth/v1/admin/users/${A}`]: 500 });
  await assert.rejects(new SupabaseAdminClient('https://p.supabase.co', 'svc', bad.fetchFn).deleteAuthUser(A), /delete_user_failed_500/);
  await assert.rejects(new SupabaseAdminClient('https://p.supabase.co', 'svc', f.fetchFn).deleteAuthUser('not-a-uuid'));
});

test('the worker will not start without the service role key; the API still can', () => {
  const base = { DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co' };
  assert.throws(() => loadConfig(base, 'worker'), /SUPABASE_SERVICE_ROLE_KEY is required for the worker/);
  assert.equal(loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: 'k' }, 'worker').serviceRoleKey, 'k');
  assert.equal(loadConfig(base).serviceRoleKey, null);
});
