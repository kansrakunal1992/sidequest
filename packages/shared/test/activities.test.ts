import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITY_CATEGORIES, activityLabel } from '../src/index.ts';

test('activity categories match the database function exactly', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0008_open_calls_activities.sql', import.meta.url), 'utf8');
  const m = /v_cat = any \(array\[([^\]]+)\]\)/.exec(sql);
  assert.ok(m, 'category list not found in create_activity');
  const inSql = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
  assert.deepEqual(inSql, ACTIVITY_CATEGORIES.map((c) => c.id).sort());
});
test('labels', () => {
  assert.equal(activityLabel('board_games'), 'Board games');
  assert.equal(activityLabel('mystery'), 'mystery');
  assert.equal(new Set(ACTIVITY_CATEGORIES.map((c) => c.id)).size, ACTIVITY_CATEGORIES.length);
});
