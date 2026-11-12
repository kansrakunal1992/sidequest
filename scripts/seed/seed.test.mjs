// Checks the generator, not a database:  node --test scripts/seed/seed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODE_IDS } from '../../packages/shared/src/modes.ts';
import { INTERESTS, PROMPTS, REGIONS, ACTIVITIES } from './data.mjs';
import { PURGE_SQL, SEED_DOMAIN, buildDataset, personSql, regionSql } from './generate.mjs';

const TODAY = '2026-11-12';
const ds = buildDataset({ today: TODAY });
const people = ds.regions.flatMap((r) => r.people);
const km = (a, b, c, d) => { const R = 6371, x = ((d - b) * Math.PI) / 180 * Math.cos(((a + c) / 2) * Math.PI / 180), y = ((c - a) * Math.PI) / 180; return R * Math.hypot(x, y); };
const ageOn = (dob, now) => { const d = new Date(dob), n = new Date(now); let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--; return a; };

test('36 states and union territories, 50 people each, every one unique and clearly marked as a test account', () => {
  assert.equal(REGIONS.length, 36); assert.equal(ds.regions.length, 36);
  assert.ok(ds.regions.every((r) => r.people.length === 50)); assert.equal(people.length, 1800);
  assert.equal(new Set(people.map((p) => p.id)).size, 1800); assert.equal(new Set(people.map((p) => p.email)).size, 1800);
  assert.ok(people.every((p) => p.email.endsWith(`@${SEED_DOMAIN}`)), 'the purge recognises test accounts by this e-mail domain');
  assert.equal(new Set(REGIONS.map((r) => r.code)).size, 36);
});

test('everyone is an adult with a believable profile that fits the database limits', () => {
  for (const p of people) {
    assert.ok(p.name.length >= 2 && p.name.length <= 40, p.name);
    assert.ok(['woman', 'man', 'non_binary'].includes(p.gender));
    assert.equal(ageOn(p.dob, TODAY), p.age, `${p.name} dob matches the stated age`); assert.ok(p.age >= 20 && p.age <= 45);
    assert.ok(p.bio.length > 20 && p.bio.length <= 600, 'bio length'); assert.ok(!/[{}]/.test(p.bio), `unfilled placeholder in: ${p.bio}`);
    assert.ok(p.interests.length >= 3 && p.interests.length <= 12 && new Set(p.interests).size === p.interests.length && p.interests.every((i) => INTERESTS.includes(i)));
    assert.ok(p.photos.length >= 1 && p.photos.length <= 3 && p.photos.every((x) => x.startsWith(`${p.id}/`)), 'photo paths sit in the person\'s own folder, as storage rules require');
    for (const m of p.modes) {
      assert.ok(MODE_IDS.includes(m.mode), `unknown vibe ${m.mode}`);
      assert.ok(!m.headline || (m.headline.length <= 120 && !/[{}]/.test(m.headline))); assert.ok(!m.bio || (m.bio.length <= 600 && !/[{}]/.test(m.bio)));
      assert.ok(m.prompts.length <= 3 && new Set(m.prompts.map((x) => x.q)).size === m.prompts.length);
      for (const x of m.prompts) { assert.ok(PROMPTS.includes(x.q)); assert.ok(x.a.length > 3 && x.a.length <= 200 && !/[{}]/.test(x.a), x.a); }
      assert.ok(m.ageMin >= 18 && m.ageMax <= 99 && m.ageMin <= p.age && p.age <= m.ageMax, 'a person fits their own age range');
    }
    assert.ok(p.modes.length >= 1 && p.modes.length <= 3 && new Set(p.modes.map((m) => m.mode)).size === p.modes.length);
    if (p.modes.some((m) => m.mode === 'post_marital')) assert.ok(p.age >= 30); if (p.modes.some((m) => ['hookups', 'experimentation'].includes(m.mode))) assert.ok(p.age >= 21);
    if (p.dateIdeas) assert.ok(p.dateIdeas.ideas.length >= 1 && p.dateIdeas.ideas.length <= 3 && p.dateIdeas.ideas.every((i) => ACTIVITIES.includes(i)));
  }
});

test('people live near their region\'s city (so a tester there finds them within the default 25 km)', () => {
  for (const r of ds.regions) for (const p of r.people) assert.ok(km(r.reg.lat, r.reg.lng, p.lat, p.lng) <= 12, `${p.name} in ${r.reg.name} is ${km(r.reg.lat, r.reg.lng, p.lat, p.lng).toFixed(1)} km out`);
  const lat = people[0].lat; assert.equal(+lat.toFixed(2), lat, 'coordinates are rounded to 2 decimals like the app does');
});

test('the same options give the same people; a different seed gives different ones; the mix looks like a real population', () => {
  const again = buildDataset({ today: TODAY }).regions.flatMap((r) => r.people);
  assert.deepEqual(again.map((p) => p.id + p.name + p.bio), people.map((p) => p.id + p.name + p.bio));
  const other = buildDataset({ today: TODAY, seed: '2', regions: ['DL'] }).regions[0].people;
  assert.notDeepEqual(other.map((p) => p.name), ds.regions.find((r) => r.reg.code === 'DL').people.map((p) => p.name));
  const w = people.filter((p) => p.gender === 'woman').length / people.length; assert.ok(w > 0.4 && w < 0.56, `women ${w}`);
  const v = people.filter((p) => p.verified).length / people.length; assert.ok(v > 0.1 && v < 0.2, `verified ${v}`);
  assert.equal(buildDataset({ today: TODAY, regions: ['DL'], verifiedPct: 0 }).regions[0].people.filter((p) => p.verified).length, 0);
  assert.equal(buildDataset({ today: TODAY, regions: ['DL'], verifiedPct: 100 }).regions[0].people.every((p) => p.verified), true);
  const balanced = buildDataset({ today: TODAY, balancedVibes: true }).regions.flatMap((r) => r.people).filter((p) => p.modes.some((m) => m.mode === 'hookups')).length;
  assert.ok(balanced > people.filter((p) => p.modes.some((m) => m.mode === 'hookups')).length * 2, '--balanced-vibes gives the niche vibes real numbers');
  assert.throws(() => buildDataset({ regions: ['ZZ'] }), /Unknown region/);
});

test('names look right for the region and do not repeat much inside one region', () => {
  const kerala = ds.regions.find((r) => r.reg.code === 'KL').people.map((p) => p.name);
  assert.ok(kerala.length - new Set(kerala).size <= 12, 'few repeated first names in one region');
  const mix = (code) => new Set(ds.regions.find((r) => r.reg.code === code).people.map((p) => p.name));
  assert.ok(mix('PB').has('Gurpreet') || mix('PB').has('Simran') || mix('PB').has('Harpreet') || mix('PB').has('Jaspreet'), 'Punjab draws Punjabi names');
});

test('SQL is safe to run: quotes are escaped, every table is covered, and a region file is one transaction', () => {
  const p = structuredClone(people[0]); p.name = "D'Souza"; p.bio = "It's a test; drop table profiles; --";
  const sql = personSql(p, TODAY);
  assert.ok(sql.includes("'D''Souza'") && sql.includes("'It''s a test; drop table profiles; --'"), 'single quotes are doubled, so text can never break out');
  for (const t of ['auth.users', 'profiles', 'user_active_modes', 'preferences', 'mode_specific_profiles', 'profile_photos']) assert.ok(sql.includes(`insert into ${t}`), t);
  assert.ok(/'approved'/.test(sql), 'photos are pre-approved so the people appear in Discover');
  const file = regionSql(ds.regions[0], TODAY); assert.ok(file.startsWith('-- Test profiles') && /\nbegin;\n/.test(file) && /commit;\n$/.test(file));
  assert.ok(PURGE_SQL.includes(`'%@${SEED_DOMAIN}'`) && !/drop\s|truncate/i.test(PURGE_SQL), 'purge only deletes test accounts');
});
