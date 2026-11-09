import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { colors, contrastRatio, DB_ENFORCED_FEATURES, FEATURES, MODE_FEATURES, MODE_IDS, MODE_THEMES, modeFeatureList, modeHas, NEUTRAL_THEME, onAccentFor, themeFor } from '../src/index.ts';

const all = [...MODE_IDS.map((m) => ({ id: m as string, t: MODE_THEMES[m] })), { id: 'neutral', t: NEUTRAL_THEME }];

test('every theme is readable: text on backgrounds and cards, muted text, and the label on the accent button', () => {
  for (const { id, t } of all) {
    for (const bg of [t.bg, t.bgTop, t.surface, t.surfaceRaised]) {
      assert.ok(contrastRatio(colors.text, bg) >= 7, `${id}: main text on ${bg}`);
      assert.ok(contrastRatio(colors.textMuted, bg) >= 4.5, `${id}: muted text on ${bg}`);
    }
    assert.ok(contrastRatio(t.onAccent, t.accent) >= 4.5, `${id}: button label on accent ${t.accent}`);
    assert.ok(contrastRatio(t.onAccent, t.accent2) >= 4.5, `${id}: button label on accent2 ${t.accent2}`);
    assert.ok(contrastRatio(t.highlight, t.surface) >= 3, `${id}: highlight visible on cards (icons, selected chips)`);
    assert.ok(contrastRatio(t.border, t.bg) >= 1.2, `${id}: borders visible`);
  }
});
test('the themes really look different: distinct backgrounds and accents (not one palette with a tint)', () => {
  const dist = (a: string, b: string) => { const h = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)); const [p, q] = [h(a), h(b)]; return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!); };
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
    assert.ok(dist(all[i]!.t.accent, all[j]!.t.accent) > 60, `${all[i]!.id} vs ${all[j]!.id} accents too alike`);
    assert.ok(dist(all[i]!.t.bgTop, all[j]!.t.bgTop) > 25, `${all[i]!.id} vs ${all[j]!.id} backgrounds too alike`);
  }
  assert.equal(new Set(all.map((x) => x.t.name)).size, all.length);
});
test('onAccent picks white or ink by contrast, and themeFor falls back to neutral', () => {
  assert.equal(onAccentFor('#101010', '#202020'), '#FFFFFF'); assert.equal(onAccentFor('#FFE066', '#FFC300'), '#14101F');
  assert.equal(themeFor(null), NEUTRAL_THEME); assert.equal(themeFor(undefined), NEUTRAL_THEME); assert.equal(themeFor('friendship'), MODE_THEMES.friendship);
});

test('feature matrix: every vibe is listed, nothing unknown, and the vibes really differ', () => {
  assert.deepEqual(Object.keys(MODE_FEATURES).sort(), [...MODE_IDS].sort());
  for (const m of MODE_IDS) for (const f of MODE_FEATURES[m]) assert.ok((FEATURES as readonly string[]).includes(f));
  const sets = MODE_IDS.map((m) => [...MODE_FEATURES[m]].sort().join(','));
  assert.equal(new Set(sets).size, MODE_IDS.length, 'two vibes have identical features');
  assert.ok(MODE_IDS.every((m) => MODE_FEATURES[m].length < FEATURES.length), 'no vibe should have everything');
  assert.ok(FEATURES.every((f) => MODE_IDS.some((m) => modeHas(m, f))), 'every feature belongs to at least one vibe');
  assert.equal(modeHas(null, 'games'), false); assert.equal(modeHas('hookups', 'roulette'), false); assert.equal(modeHas('friendship', 'roulette'), true);
  assert.deepEqual(modeFeatureList('experimentation').map((x) => x.title), ['Circles', 'Chat games', 'Together']);
});
test('the matrix respects each vibe\'s intent: friends-only vibes have no couple features, group vibes have group features', () => {
  assert.equal(modeHas('friendship', 'together'), false); assert.equal(modeHas('adventures', 'together'), false); assert.equal(modeHas('adventures', 'double_dates'), false);
  assert.ok(modeHas('serious_dating', 'together') && modeHas('post_marital', 'together'));
  assert.ok(modeHas('adventures', 'open_calls') && modeHas('adventures', 'roulette') && modeHas('friendship', 'open_calls'));
  assert.deepEqual([...DB_ENFORCED_FEATURES].sort(), ['double_dates', 'games', 'open_calls', 'roulette']);
});

test('the SQL seed of mode_features equals the TypeScript matrix exactly (so the app and the database cannot disagree)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0014_mode_features.sql', import.meta.url), 'utf8');
  const seed = sql.slice(sql.indexOf('insert into public.mode_features'), sql.indexOf('create or replace function public.mode_has'));
  const rows = [...seed.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  const expected = MODE_IDS.flatMap((m) => MODE_FEATURES[m].map((f) => `${m}:${f}`)).sort();
  assert.deepEqual(rows, expected);
});

import { describeAccountTrust } from '../src/trust.ts';
test('trust card: the "not verified" line can be switched off while selfie verification is parked', () => {
  const t = { verified: false, accountAgeDays: 30, repeatedMessageTo: 0 };
  assert.equal(describeAccountTrust(t).length, 1);                                         // default: unchanged behaviour
  assert.deepEqual(describeAccountTrust(t, { verificationAvailable: false }), []);
  assert.equal(describeAccountTrust({ ...t, verified: true }, { verificationAvailable: false })[0]!.label, 'Photo verified');
});
