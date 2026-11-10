import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The product is called Waypoint. These tests keep the old name out of everything people can see, and keep the identifiers that must NOT change.
const root = new URL('../../../', import.meta.url).pathname;
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git' || n === 'migrations' || n.startsWith('.')) continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) files(p, out); else if (/\.(ts|tsx|json|mjs|html)$/.test(n) && !/package-lock|pnpm-lock/.test(n)) out.push(p);
  }
  return out;
}

test('the old product name appears nowhere in app, API or shared code', () => {
  const hits: string[] = [];
  for (const d of ['apps/api/src', 'apps/api/test', 'apps/mobile/app', 'apps/mobile/src', 'apps/mobile/test', 'packages/shared/src']) {
    for (const f of files(join(root, d))) if (/side\s?quest/i.test(readFileSync(f, 'utf8').replace(/@sidequest\/shared/g, '').replace(/sidequest:\/\//g, '').replace(/app\.sidequest\.android/g, '').replace(/@sidequest\.app/g, '').replace(/inv-1@sidequest/g, ''))) hits.push(f.replace(root, ''));
  }
  assert.deepEqual(hits, [], 'rename these (user-visible text), or add the identifier to the allowed list in this test');
});

test('app.json: the phone shows Waypoint, and the identifiers that must stay stable are unchanged', () => {
  const app = JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')).expo;
  assert.equal(app.name, 'Waypoint');
  assert.equal(app.android.package, 'app.sidequest.android');   // permanent once uploaded to Google Play, and tied to google-services.json
  assert.equal(app.slug, 'sidequest');                          // identity of the EAS project
  assert.equal(app.scheme, 'sidequest');                        // sign-in and verification return links (Supabase and Didit are set up with it)
  assert.equal(app.android.googleServicesFile, './google-services.json');
  const text = JSON.stringify(app);
  assert.ok(/Waypoint uses the photos/.test(text) && /Waypoint uses your approximate location/.test(text), 'permission explanations use the new name');
});

test('the calendar file and notification text use the new name', () => {
  const api = readFileSync(join(root, 'apps/api/src/app.ts'), 'utf8');
  assert.ok(api.includes('filename="waypoint-${id}.ics"'));
  assert.ok(readFileSync(join(root, 'packages/shared/src/ics.ts'), 'utf8').includes('PRODID:-//Waypoint//Calendar//EN'));
  assert.ok(readFileSync(join(root, 'apps/api/src/notifications.ts'), 'utf8').includes('Open Waypoint to read it.'));
});
