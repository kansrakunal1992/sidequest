#!/usr/bin/env node
// Runs the generated SQL files against a database.   DATABASE_URL="postgres://..." node scripts/seed/apply.mjs [--dir scripts/seed/out] [--only DL,MH] [--yes] [--allow-real-users]
// SAFETY: this adds fake people. It refuses to run on a database that already has real accounts unless you say --allow-real-users.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { SEED_DOMAIN } from './generate.mjs';

const a = process.argv.slice(2), has = (k) => a.includes(`--${k}`), get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const dir = path.resolve(get('dir', path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')));
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL to your STAGING database connection string (Supabase: Project Settings, Database, Connection string).'); process.exit(1); }
const only = get('only') ? get('only').split(',').map((s) => s.trim().toUpperCase()) : null;
const files = fs.readdirSync(dir).filter((f) => /^\d\d_[A-Z]+\.sql$/.test(f) && (!only || only.includes(f.slice(3, -4)))).sort();
if (!files.length) { console.error(`No region files in ${dir}. Run: node scripts/seed/generate.mjs`); process.exit(1); }

const { default: pg } = await import('pg');
const ssl = /sslmode=disable|localhost|%2F|host=\//.test(url) ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url, ssl }); await client.connect();
try {
  const host = (url.match(/@([^/:?]+)/)?.[1] ?? '(unknown)').replace(/%2F/gi, '/');   // just for display
  const real = +(await client.query(`select count(*)::int n from auth.users where email is distinct from null and email not like $1`, [`%@${SEED_DOMAIN}`])).rows[0].n;
  const seeded = +(await client.query(`select count(*)::int n from auth.users where email like $1`, [`%@${SEED_DOMAIN}`])).rows[0].n;
  console.log(`Database host: ${host}\nReal accounts: ${real}   Test profiles already there: ${seeded}\nWill apply ${files.length} region file(s).`);
  if (real > 20 && !has('allow-real-users')) {
    console.error(`\nSTOP. This database has ${real} real accounts. Fake profiles that real people can like and message are misleading, and they pollute your data.\nUse a separate staging project. (If you are certain, add --allow-real-users.)`);
    process.exit(2);
  }
  if (!has('yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`Type "seed" to add test profiles to ${host}: `); rl.close();
    if (ans.trim() !== 'seed') { console.log('Cancelled.'); process.exit(0); }
  }
  for (const f of files) {
    const t = Date.now();
    try { await client.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log(`  ok  ${f}  (${Date.now() - t} ms)`); }
    catch (e) { try { await client.query('rollback'); } catch { /* none open */ } console.error(`  FAILED ${f}: ${e.message}`); process.exit(3); }
  }
  const n = +(await client.query(`select count(*)::int n from auth.users where email like $1`, [`%@${SEED_DOMAIN}`])).rows[0].n;
  console.log(`Done. ${n} test profiles in the database. Next: node scripts/seed/images.mjs to add photos.`);
} finally { await client.end(); }
