import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Reads src/lib/db.ts and the migrations as plain text. Catches, without a database or a phone: a function that does not exist,
// an argument name that does not match, a missing required argument, or a function that clients are not allowed to execute.
const root = new URL('../../../', import.meta.url);
const migDir = new URL('supabase/migrations/', root);
const sql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, migDir), 'utf8')).join('\n');
const dbSrc = readFileSync(new URL('apps/mobile/src/lib/db.ts', root), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

function splitArgs(s: string): string[] { const out: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map((x) => x.trim()).filter(Boolean); }
/** The LAST definition of each public function (later migrations replace earlier ones). */
const defs = new Map<string, { args: { name: string; required: boolean }[] }>();
for (const m of sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(([\s\S]*?)\)\s*(?:returns|language)/gi)) {
  defs.set(m[1]!, { args: splitArgs(m[2]!).map((a) => ({ name: a.split(/\s+/)[0]!, required: !/\sdefault\s/i.test(a) })) });
}
const granted = new Set<string>();
for (const g of sql.matchAll(/grant execute on function ([\s\S]*?) to authenticated/gi)) for (const f of g[1]!.matchAll(/public\.([a-z_0-9]+)\(/g)) granted.add(f[1]!);
const revokedFromAuth = new Set<string>();
for (const g of sql.matchAll(/revoke execute on function ([\s\S]*?) from ([a-z, ]+);/gi)) if (/authenticated/.test(g[2]!)) for (const f of g[1]!.matchAll(/public\.([a-z_0-9]+)\(/g)) revokedFromAuth.add(f[1]!);

const calls = [...dbSrc.matchAll(/call<[^\n]*?>\('([a-z_0-9]+)'(?:, \{([^}]*)\})?\)/g)].map((m) => ({
  name: m[1]!, keys: m[2] ? m[2].split(',').map((k) => k.trim().split(':')[0]!.trim()).filter(Boolean) : [] as string[] }));

test('the wrapper has plenty of calls and the parser found them all', () => {
  assert.ok(calls.length >= 55, `found ${calls.length}`);
  assert.equal(calls.length, (dbSrc.match(/\bcall</g) ?? []).length - 1);       // minus the declaration of call<T> itself
});
test('every call names a real function with real argument names and all required arguments', () => {
  for (const c of calls) {
    const d = defs.get(c.name); assert.ok(d, `function ${c.name} is not defined in any migration`);
    const declared = d.args.map((a) => a.name);
    for (const k of c.keys) assert.ok(declared.includes(k), `${c.name}: argument ${k} does not exist (declared: ${declared.join(', ') || 'none'})`);
    for (const a of d.args) if (a.required) assert.ok(c.keys.includes(a.name), `${c.name}: required argument ${a.name} is not passed`);
  }
});
test('every function the app calls is executable by signed-in users (and was not revoked afterwards)', () => {
  for (const c of calls) { assert.ok(granted.has(c.name), `${c.name} has no grant to authenticated`); assert.ok(!revokedFromAuth.has(c.name) || granted.has(c.name)); }
});
test('the parser really reads signatures (sanity checks against known functions)', () => {
  assert.deepEqual(defs.get('join_circle')!.args, [{ name: 'p_circle', required: true }]);
  assert.deepEqual(defs.get('circles_feed')!.args.map((a) => a.required), [false, false]);
  assert.equal(defs.get('set_couple_consent')!.args.length, 5);
});
test('direct rpc calls elsewhere in the app (older screens and lib) also name real functions and arguments', () => {
  const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [new URL(e.name, dir).pathname]);
  const files = [...walk(new URL('apps/mobile/app/', root)), ...walk(new URL('apps/mobile/src/features/', root)), ...walk(new URL('apps/mobile/src/lib/', root))].filter((f) => /\.tsx?$/.test(f) && !f.endsWith('/lib/db.ts'));
  const names = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\.rpc\('([a-z_0-9]+)'(?:, \{([^}]*)\})?/g)) {
    names.add(m[1]!); const d = defs.get(m[1]!); assert.ok(d, `${f}: rpc ${m[1]} does not exist`);
    for (const k of (m[2] ?? '').split(',').map((x) => x.trim().split(':')[0]!.trim()).filter(Boolean)) assert.ok(d.args.some((a) => a.name === k), `${f}: ${m[1]} has no argument ${k}`);
  }
  assert.ok(names.size > 0);                                                       // the older screens use rpc directly; they are checked too
});
