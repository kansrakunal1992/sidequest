#!/usr/bin/env node
// Puts photos for the test profiles into Supabase Storage (bucket "profile-photos"), at the paths the SQL already points to.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed/images.mjs --source placeholder
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed/images.mjs --source ./my-images      (folders: women/ men/ non_binary/, or one flat folder)
//   ... node scripts/seed/images.mjs --purge                                                              (deletes the test profiles' photo files)
// Options: --dir scripts/seed/out   --only DL,MH   --dry-run
// STATUS: the assignment logic and placeholder pictures are tested; the upload itself has not been run against a real Supabase project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeholderPng } from './placeholder.mjs';

export const BUCKET = 'profile-photos';
const EXT_TYPE = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** Reads a folder of pictures into per-gender pools. Subfolders women/ men/ non_binary/ are used when present; a flat folder is shared by everyone. */
export function readPools(dir) {
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => EXT_TYPE[path.extname(f).toLowerCase()]).sort().map((f) => path.join(d, f)) : []);
  const flat = list(dir), women = list(path.join(dir, 'women')), men = list(path.join(dir, 'men')), nb = list(path.join(dir, 'non_binary'));
  const any = [...flat, ...women, ...men, ...nb];
  return { woman: women.length ? women : flat.length ? flat : any, man: men.length ? men : flat.length ? flat : any, non_binary: nb.length ? nb : flat.length ? flat : any };
}
/** One picture for every photo slot. Walks each gender's pool in order and starts again when it runs out (reuse is counted so you can see it). */
export function assignImages(manifest, pools) {
  const next = { woman: 0, man: 0, non_binary: 0 }; const plan = []; let reused = 0;
  const used = { woman: new Set(), man: new Set(), non_binary: new Set() };
  for (const p of manifest) for (const dest of p.photos) {
    const pool = pools[p.gender]; if (!pool.length) throw new Error(`No pictures found for ${p.gender}. Put some in the folder, or use --source placeholder.`);
    const src = pool[next[p.gender]++ % pool.length]; if (used[p.gender].has(src)) reused++; used[p.gender].add(src);
    plan.push({ dest, src, contentType: EXT_TYPE[path.extname(src).toLowerCase()], who: p.name });
  }
  return { plan, reused };
}

async function main() {
  const a = process.argv.slice(2), has = (k) => a.includes(`--${k}`), get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const dir = path.resolve(get('dir', path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')));
  const only = get('only') ? get('only').split(',').map((s) => s.trim().toUpperCase()) : null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).filter((p) => !only || only.includes(p.region));
  if (!manifest.length) { console.error('Nothing to do: manifest is empty. Run generate.mjs first.'); process.exit(1); }
  const source = get('source');
  if (!has('purge') && !source) { console.error('Say where the pictures come from: --source placeholder, or --source <folder>.'); process.exit(1); }
  let plan = [], reused = 0;
  if (source === 'placeholder') plan = manifest.flatMap((p) => p.photos.map((dest) => ({ dest, placeholder: true, contentType: 'image/png', who: p.name })));
  else if (source) ({ plan, reused } = assignImages(manifest, readPools(path.resolve(source))));
  if (has('dry-run')) { console.log(`Would upload ${plan.length} pictures (${reused} reused). First: ${plan[0]?.dest} <- ${plan[0]?.src ?? 'generated placeholder'}`); return; }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (your STAGING project; the key stays on your computer and is never put in the app).'); process.exit(1); }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (has('purge')) {
    let removed = 0;
    for (const p of manifest) {
      const { data } = await sb.storage.from(BUCKET).list(p.id, { limit: 20 });
      const paths = (data ?? []).map((f) => `${p.id}/${f.name}`);
      if (paths.length) { const r = await sb.storage.from(BUCKET).remove(paths); if (r.error) { console.error(`  could not remove ${p.id}: ${r.error.message}`); continue; } removed += paths.length; }
    }
    console.log(`Removed ${removed} photo files. Now run purge.sql to remove the profiles.`); return;
  }
  console.log(`Uploading ${plan.length} pictures to ${url} ...${reused ? ` (${reused} pictures are reused: add more to your folder for more variety)` : ''}`);
  let done = 0, failed = 0; const queue = [...plan];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const it = queue.shift();
      const body = it.placeholder ? placeholderPng(it.dest) : fs.readFileSync(it.src);
      const { error } = await sb.storage.from(BUCKET).upload(it.dest, body, { contentType: it.contentType, upsert: true });
      if (error) { failed++; if (failed <= 3) console.error(`  failed ${it.dest}: ${error.message}`); } else done++;
      if ((done + failed) % 200 === 0) console.log(`  ${done + failed}/${plan.length}`);
    }
  }));
  console.log(`Done. ${done} uploaded, ${failed} failed.`); if (failed) process.exit(3);
}
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
