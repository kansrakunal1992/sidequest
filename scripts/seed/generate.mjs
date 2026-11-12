#!/usr/bin/env node
// Generates test profiles for a STAGING database. Deterministic: the same options give the same people.
//   node scripts/seed/generate.mjs [--per-region 50] [--regions DL,KA] [--seed 1] [--verified-pct 15] [--max-photos 3] [--balanced-vibes] [--out scripts/seed/out] [--today 2026-11-12]
// Writes SQL (one file per region), manifest.json, image-prompts.csv and purge.sql. Nothing touches a database here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACTIVITIES, INTERESTS, MODE_WEIGHTS, NAMES, PROMPTS, REGIONS, TEXT } from './data.mjs';

export const SEED_DOMAIN = 'seed.waypoint.test';

// ---- tiny deterministic random numbers -------------------------------------------------------------------------------------------
function rng(seedStr) {
  let h = crypto.createHash('sha256').update(seedStr).digest().readUInt32LE(0);
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const chance = (r, p) => r() < p;
function weighted(r, obj) { const e = Object.entries(obj); let x = r() * e.reduce((s, [, w]) => s + w, 0); for (const [k, w] of e) { if ((x -= w) < 0) return k; } return e[0][0]; }
function sample(r, a, n) { const c = [...a]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(r() * c.length), 1)[0]); return out; }
const fill = (s, ctx) => s.replace(/\{city\}/g, ctx.city).replace(/\{local\}/g, ctx.local).replace(/\{like\}/g, () => fill(ctx.like(), ctx)).replace(/\{quirk\}/g, () => ctx.quirk());
function uuidFrom(s) { const h = crypto.createHash('sha1').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }

// ---- one person ----------------------------------------------------------------------------------------------------------------
function buildPerson(reg, i, o, usedNames) {
  const r = rng(`${o.seed}:${reg.code}:${i}`);
  const gender = r() < 0.48 ? 'woman' : r() < 0.923 ? 'man' : 'non_binary';   // ~48 / 48 / 4
  const ageBand = weighted(r, { a: 25, b: 35, c: 22, d: 12, e: 6 });
  const age = { a: 20 + Math.floor(r() * 5), b: 25 + Math.floor(r() * 5), c: 30 + Math.floor(r() * 5), d: 35 + Math.floor(r() * 5), e: 40 + Math.floor(r() * 6) }[ageBand];
  const today = new Date(o.today);
  const dob = new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()) - Math.floor(r() * 364) * 86_400_000);
  // name
  let name = '';
  for (let t = 0; t < 25; t++) {
    const pool = NAMES[weighted(r, reg.pools)];
    const list = gender === 'woman' ? pool.f : gender === 'man' ? pool.m : (chance(r, 0.5) ? pool.f : pool.m);
    name = pick(r, list); if (!usedNames.has(name)) break;
  }
  usedNames.add(name);
  // place: within ~9 km of the city centre, rounded to 2 decimals like the app does
  const dist = 9 * Math.sqrt(r()), ang = r() * 2 * Math.PI;
  const lat = +(reg.lat + (dist * Math.cos(ang)) / 111).toFixed(2), lng = +(reg.lng + (dist * Math.sin(ang)) / (111 * Math.cos((reg.lat * Math.PI) / 180))).toFixed(2);
  const neighborhood = reg.hoods.length && chance(r, 0.85) ? pick(r, reg.hoods) : null;
  const interests = sample(r, INTERESTS, 3 + Math.floor(r() * 5));
  // vibes
  const weights = o.balancedVibes ? Object.fromEntries(Object.keys(MODE_WEIGHTS).map((k) => [k, 0.4])) : MODE_WEIGHTS;   // --balanced-vibes: every vibe has plenty of people to test with
  let modes = Object.entries(weights).filter(([m, w]) => chance(r, w) && !(m === 'post_marital' && age < 30) && !((m === 'hookups' || m === 'experimentation') && age < 21)).map(([m]) => m);
  if (!modes.length) modes = [chance(r, 0.5) ? 'friendship' : 'serious_dating'];
  modes = modes.slice(0, 3);
  const local = pick(r, reg.flavour);
  const ctx = { city: reg.city, local, like: () => pick(r, TEXT.like), quirk: () => pick(r, TEXT.quirk) };
  const bio = fill(`${pick(r, TEXT.intro)} ${pick(r, TEXT.like)} ${pick(r, TEXT.quirk)} ${pick(r, TEXT.close)}`, ctx).slice(0, 600);
  const perMode = modes.map((m) => {
    const prompts = chance(r, 0.6) ? sample(r, PROMPTS, 1 + Math.floor(r() * 3)).map((q) => ({ q, a: fill(pick(r, TEXT.answers[q]), ctx).slice(0, 200) })) : [];
    return {
      mode: m,
      headline: chance(r, 0.85) ? fill(pick(r, TEXT.headline[m]), ctx).slice(0, 120) : null,
      bio: chance(r, 0.7) ? fill(pick(r, TEXT.modeBio[m]), ctx).slice(0, 600) : null,
      prompts,
      availability: weighted(r, { open_to_chat: 45, available_tonight: 15, meet_this_weekend: 20, virtual_coffee: 12, taking_a_break: 4, not_available: 4 }),
      seeking: seekingFor(r, gender, m),
      ageMin: Math.max(18, age - (m === 'friendship' ? 10 : 6)), ageMax: Math.min(99, age + (m === 'friendship' ? 15 : 8)),
      maxKm: weighted(r, { 25: 70, 50: 20, 15: 10 }) * 1,
    };
  });
  const dateIdeas = modes.some((m) => ['friendship', 'adventures', 'serious_dating'].includes(m)) && chance(r, 0.7)
    ? { ideas: sample(r, ACTIVITIES, 1 + Math.floor(r() * 3)), window: pick(r, ['weekday_evenings', 'weekends', 'flexible']) } : null;
  const nPhotos = Math.min(o.maxPhotos, weighted(r, { 1: 30, 2: 45, 3: 25 }) * 1);
  const id = uuidFrom(`waypoint-seed:${o.seed}:${reg.code}:${i}`);
  const verified = chance(r, o.verifiedPct / 100);
  return {
    id, email: `seed-${reg.code.toLowerCase()}-${String(i).padStart(2, '0')}@${SEED_DOMAIN}`, region: reg.code, regionName: reg.name, city: reg.city, neighborhood,
    name, gender, age, dob: dob.toISOString().slice(0, 10), lat, lng, interests, bio, acceptsIntros: chance(r, 0.85), verified, verifiedDaysAgo: Math.floor(r() * 60),
    modes: perMode, dateIdeas, photos: Array.from({ length: nPhotos }, (_, k) => `${id}/seed-${k + 1}.jpg`),
    imagePrompt: imagePrompt(r, gender, age, reg),
  };
}
function seekingFor(r, gender, mode) {
  if (mode === 'friendship' || mode === 'adventures') return chance(r, 0.8) ? [] : [pick(r, ['woman', 'man'])];
  if (gender === 'non_binary') return [];
  const x = r(), opp = gender === 'woman' ? 'man' : 'woman';
  return x < 0.7 ? [opp] : x < 0.8 ? [opp, 'non_binary'] : x < 0.9 ? [gender] : [];
}
function imagePrompt(r, gender, age, reg) {
  const who = gender === 'woman' ? 'woman' : gender === 'man' ? 'man' : 'person';
  const hair = gender === 'woman' ? pick(r, ['long dark hair', 'shoulder-length dark hair', 'a messy bun', 'short bob haircut', 'a loose side braid']) : pick(r, ['short dark hair', 'neat short hair with light stubble', 'medium-length wavy hair', 'a clean fade haircut', 'a full beard']);
  const outfit = pick(r, ['a plain cotton t-shirt', 'a casual kurta', 'a denim jacket', 'a hoodie', 'a linen shirt', 'a simple sweater', 'a graphic tee']);
  const setting = pick(r, ['a cafe table', 'a balcony at golden hour', 'a park path', 'a rooftop terrace', 'a bookshop aisle', 'a street market', 'a living room with plants', 'a rainy window seat', 'near a lake', 'a hill-view viewpoint']);
  const extra = pick(r, ['', '', 'wearing glasses', 'wearing small earrings', 'laughing mid-sentence', 'a small natural smile', 'looking slightly off camera']);
  return `candid smartphone photo of a ${age}-year-old Indian ${who}, ${hair}, wearing ${outfit}, at ${setting}${extra ? ', ' + extra : ''}, natural light, slightly imperfect framing, mild phone-camera grain, realistic skin texture, not a studio portrait, no text, no watermark`;
}

export function buildDataset(opts = {}) {
  const o = { perRegion: 50, regions: null, seed: '1', verifiedPct: 15, maxPhotos: 3, balancedVibes: false, today: new Date().toISOString().slice(0, 10), ...opts };
  const regs = REGIONS.filter((r) => !o.regions || o.regions.includes(r.code));
  if (o.regions) { const bad = o.regions.filter((c) => !REGIONS.some((r) => r.code === c)); if (bad.length) throw new Error(`Unknown region code(s): ${bad.join(', ')}. Valid: ${REGIONS.map((r) => r.code).join(' ')}`); }
  return { options: o, regions: regs.map((reg) => { const used = new Set(); return { reg, people: Array.from({ length: o.perRegion }, (_, i) => buildPerson(reg, i + 1, o, used)) }; }) };
}

// ---- SQL ------------------------------------------------------------------------------------------------------------------------
const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a, type = 'text') => `array[${a.map(q).join(', ')}]::${type}[]`;
const jb = (v) => `${q(JSON.stringify(v))}::jsonb`;
export function personSql(p, today) {
  const L = [];
  L.push(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', ${q(p.id)}, 'authenticated', 'authenticated', ${q(p.email)}, '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"seed":true}'::jsonb, now(), now(), '', '', '', '') on conflict (id) do nothing;`);
  L.push(`insert into profiles (id, display_name, date_of_birth, gender, city, neighborhood, bio, interests, lifestyle, timezone, accepts_intro_invites, incognito, approx_location, onboarding_complete, verified_at)
values (${q(p.id)}, ${q(p.name)}, ${q(p.dob)}, ${q(p.gender)}, ${q(p.city)}, ${q(p.neighborhood)}, ${q(p.bio)}, ${arr(p.interests)}, '{}'::jsonb, 'Asia/Kolkata', ${p.acceptsIntros}, false,
  st_setsrid(st_makepoint(${p.lng}, ${p.lat}), 4326)::geography, true, ${p.verified ? `now() - interval '${p.verifiedDaysAgo} days'` : 'null'}) on conflict (id) do nothing;`);
  for (const m of p.modes) {
    L.push(`insert into user_active_modes (user_id, mode_id, availability, discoverable, appear_in_visitor_lists) values (${q(p.id)}, ${q(m.mode)}, ${q(m.availability)}, true, true) on conflict do nothing;`);
    L.push(`insert into preferences (user_id, mode_id, seeking_genders, age_min, age_max, max_distance_km) values (${q(p.id)}, ${q(m.mode)}, ${arr(m.seeking)}, ${m.ageMin}, ${m.ageMax}, ${m.maxKm}) on conflict do nothing;`);
    L.push(`insert into mode_specific_profiles (user_id, mode_id, headline, bio, prompts) values (${q(p.id)}, ${q(m.mode)}, ${q(m.headline)}, ${q(m.bio)}, ${jb(m.prompts)}) on conflict do nothing;`);
  }
  if (p.dateIdeas) L.push(`insert into date_ideas (user_id, ideas, free_window) values (${q(p.id)}, ${arr(p.dateIdeas.ideas)}, ${q(p.dateIdeas.window)}) on conflict do nothing;`);
  p.photos.forEach((path_, k) => L.push(`insert into profile_photos (user_id, storage_path, position, moderation_status, visible_modes) values (${q(p.id)}, ${q(path_)}, ${k}, 'approved', ${arr(p.modes.map((m) => m.mode))});`));
  return L.join('\n');
}
export function regionSql(r, today) {
  return `-- Test profiles for ${r.reg.name} (${r.reg.code}), ${r.people.length} people. STAGING ONLY. Remove with purge.sql.\nbegin;\nset local search_path = public, extensions;\n\n${r.people.map((p) => personSql(p, today)).join('\n\n')}\n\ncommit;\n`;
}
export const PURGE_SQL = `-- Removes every test profile made by scripts/seed. Run scripts/seed/images.mjs --purge FIRST so their photo files are deleted from storage.
-- Test profiles are recognised by the e-mail domain @${SEED_DOMAIN}. Everything that belongs to them (profile, vibes, photos rows, likes, matches, messages) is removed with them.
begin;
delete from auth.users where email like '%@${SEED_DOMAIN}';
commit;
`;

// ---- CLI ------------------------------------------------------------------------------------------------------------------------
function main() {
  const a = process.argv.slice(2), get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const out = path.resolve(get('out', path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')));
  const ds = buildDataset({ perRegion: +get('per-region', 50), regions: get('regions') ? get('regions').split(',').map((s) => s.trim().toUpperCase()) : null, seed: get('seed', '1'),
    verifiedPct: +get('verified-pct', 15), maxPhotos: +get('max-photos', 3), balancedVibes: a.includes('--balanced-vibes'), today: get('today', new Date().toISOString().slice(0, 10)) });
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const files = [];
  ds.regions.forEach((r, n) => { const f = `${String(n + 1).padStart(2, '0')}_${r.reg.code}.sql`; fs.writeFileSync(path.join(out, f), regionSql(r, ds.options.today)); files.push(f); });
  fs.writeFileSync(path.join(out, 'all.sql'), `-- psql only:  psql "$DATABASE_URL" -f all.sql\n${files.map((f) => `\\i ${f}`).join('\n')}\n`);
  fs.writeFileSync(path.join(out, 'purge.sql'), PURGE_SQL);
  const people = ds.regions.flatMap((r) => r.people);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(people.map((p) => ({ id: p.id, email: p.email, name: p.name, gender: p.gender, age: p.age, region: p.region, city: p.city, photos: p.photos })), null, 1));
  const csv = ['key,gender,age,region,photo_index,prompt'];
  for (const p of people) p.photos.forEach((ph, k) => csv.push([ph, p.gender, p.age, p.region, k + 1, `"${p.imagePrompt.replace(/"/g, '""')}${k ? ', different outfit and setting from the first photo' : ''}"`].join(',')));
  fs.writeFileSync(path.join(out, 'image-prompts.csv'), csv.join('\n') + '\n');
  const by = (f) => people.reduce((m, p) => (m[f(p)] = (m[f(p)] || 0) + 1, m), {});
  console.log(`Wrote ${files.length} region file(s), ${people.length} people, ${people.reduce((s, p) => s + p.photos.length, 0)} photo slots to ${out}`);
  console.log('gender', by((p) => p.gender), '| verified', people.filter((p) => p.verified).length);
  console.log('vibes', people.flatMap((p) => p.modes.map((m) => m.mode)).reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
