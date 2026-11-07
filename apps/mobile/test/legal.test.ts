import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalLinks } from '../src/core/legal.ts';

test('legal links come from the API address: https only, trailing slashes removed, nothing when it is missing', () => {
  assert.deepEqual(legalLinks('https://api.example.com/'), { terms: 'https://api.example.com/terms', privacy: 'https://api.example.com/privacy', deleteAccount: 'https://api.example.com/delete-account' });
  assert.equal(legalLinks('https://api.example.com//')!.privacy, 'https://api.example.com/privacy');
  for (const bad of [undefined, null, '', '  ', 'http://insecure.example.com', 'api.example.com', 'javascript:alert(1)', 'https://']) assert.equal(legalLinks(bad as never), null, String(bad));
});
test('the release configuration is consistent: package name, pinned target API 36, no broad storage or fine location, public settings for cloud builds', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
  assert.equal(app.android.package, 'app.sidequest.android');
  const bp = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
  assert.equal(bp[1].android.targetSdkVersion, 36); assert.ok(bp[1].android.compileSdkVersion >= 36);
  for (const p of ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION']) { assert.ok(!app.android.permissions.includes(p), p); assert.ok(app.android.blockedPermissions.includes(p), `${p} should be blocked`); }
  assert.deepEqual([...app.android.permissions].sort(), ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.POST_NOTIFICATIONS']);
  assert.equal(eas.build.production.android.buildType, 'app-bundle'); assert.equal(eas.build.production.autoIncrement, true);
  for (const k of ['development', 'preview', 'production']) assert.deepEqual(Object.keys(eas.build[k].env).sort(), ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL']);
});
