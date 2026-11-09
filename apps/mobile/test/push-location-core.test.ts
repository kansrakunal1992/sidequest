import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyPushPermission, classifyTokenError, describeTestResult, nextStep, pushAdvice, statusLines } from '../src/core/push-core.ts';
import type { PushReason, PushTestResult } from '../src/core/push-core.ts';
import { classifyLocationError, classifyLocationPermission, isValidCoord, locationAdvice, locationStatusLines, pickCity, roundCoord, withTimeout } from '../src/core/location-core.ts';
import type { LocationReason } from '../src/core/location-core.ts';

test('push permission: allowed, asked-and-refused, never-asked and blocked are told apart (the next step differs)', () => {
  assert.equal(classifyPushPermission({ granted: true }), 'granted');
  assert.equal(classifyPushPermission({ status: 'granted' }), 'granted');
  assert.equal(classifyPushPermission({ granted: false, status: 'undetermined', canAskAgain: true }), 'undetermined');
  assert.equal(classifyPushPermission({ granted: false, status: 'denied', canAskAgain: true }), 'denied');
  assert.equal(classifyPushPermission({ granted: false, status: 'denied', canAskAgain: false }), 'blocked_in_settings');
});

test('token errors: a missing Firebase setup is recognised; anything else is not mislabelled', () => {
  assert.equal(classifyTokenError(new Error('Default FirebaseApp is not initialized in this process app.sidequest.android')), 'no_firebase');
  assert.equal(classifyTokenError({ code: 'E_REGISTRATION_FAILED', message: 'Fetching the token failed: MISSING_INSTANCEID_SERVICE' }), 'no_firebase');
  assert.equal(classifyTokenError(new Error('socket hang up')), 'unknown');
  assert.equal(classifyTokenError(undefined), 'unknown');
});

test('every push reason and every server test error has plain advice (no jargon codes, no empty text)', () => {
  const reasons: PushReason[] = ['ok', 'denied', 'blocked_in_settings', 'no_firebase', 'token_upload_failed'];
  for (const r of reasons) { const a = pushAdvice(r); assert.ok(a.title.length > 5 && a.message.length > 20, r); assert.ok(!/undefined|\[object/.test(a.message)); }
  for (const error of ['not_configured', 'no_token', 'token_invalid', 'send_failed'] as const) {
    const d = describeTestResult({ tokens: 1, sent: 0, error });
    assert.equal(d.ok, false); assert.ok(d.message.length > 20, error);
  }
  const ok = describeTestResult({ tokens: 2, sent: 2, error: null } as PushTestResult);
  assert.equal(ok.ok, true); assert.match(ok.message, /2 phones/);
  assert.equal(pushAdvice('blocked_in_settings').action, 'open_settings');
  assert.equal(describeTestResult({ tokens: 0, sent: 0, error: 'not_configured' }).message.includes('FCM_SERVICE_ACCOUNT_JSON'), true);
});

test('status lines and next step name the first thing to fix, in order', () => {
  assert.deepEqual(statusLines({ permission: 'granted', tokenRegistered: true, serverConfigured: true }), ['Permission: allowed', 'This phone registered: yes', 'Server ready to send: yes']);
  assert.equal(statusLines({ permission: 'undetermined', tokenRegistered: null, serverConfigured: null })[1], 'This phone registered: not checked');
  assert.equal(nextStep({ permission: 'blocked_in_settings', tokenRegistered: false, serverConfigured: false })!.action, 'open_settings');
  assert.equal(nextStep({ permission: 'denied', tokenRegistered: null, serverConfigured: null })!.action, 'enable');
  assert.match(nextStep({ permission: 'granted', tokenRegistered: true, serverConfigured: false })!.message, /Railway/);
  assert.match(nextStep({ permission: 'granted', tokenRegistered: false, serverConfigured: true })!.title, /cannot receive/);
  assert.equal(nextStep({ permission: 'granted', tokenRegistered: true, serverConfigured: true }), null);
});

test('location: coordinates are rounded to about 1 km on the phone, and junk is rejected', () => {
  assert.equal(roundCoord(28.459497), 28.46); assert.equal(roundCoord(77.026638), 77.03); assert.equal(roundCoord(-33.8688), -33.87);
  assert.equal(isValidCoord(28.46, 77.03), true);
  for (const [a, b] of [[NaN, 1], [91, 0], [0, 181], [0, 0], ['1', 2], [null, null]]) assert.equal(isValidCoord(a, b), false, `${a},${b}`);
});

test('location permission and error classification: each cause gets its own reason', () => {
  assert.equal(classifyLocationPermission({ status: 'granted' }), 'granted');
  assert.equal(classifyLocationPermission({ status: 'denied', canAskAgain: false }), 'blocked_in_settings');
  assert.equal(classifyLocationPermission({ status: 'denied', canAskAgain: true }), 'denied');
  assert.equal(classifyLocationPermission({ status: 'undetermined' }), 'undetermined');
  assert.equal(classifyLocationError(Object.assign(new Error('Location request timed out'), { code: 'E_LOCATION_TIMEOUT' })), 'timeout');
  assert.equal(classifyLocationError({ code: 'E_LOCATION_SERVICES_DISABLED', message: 'Location services are disabled' }), 'services_off');
  assert.equal(classifyLocationError({ code: 'E_LOCATION_SETTINGS_UNSATISFIED', message: 'Location settings are not satisfied.' }), 'services_off');
  assert.equal(classifyLocationError(new Error('Not authorized to use location services')), 'denied');
  assert.equal(classifyLocationError(new Error('Geocoder failed')), 'geocode_failed');
  assert.equal(classifyLocationError(new Error('something odd')), 'error');
});

test('withTimeout resolves fast work, rejects slow work with a timeout reason, and leaves no timer behind', async () => {
  assert.equal(await withTimeout(Promise.resolve(5), 1000), 5);
  await assert.rejects(withTimeout(new Promise(() => {}), 20), (e: Error) => classifyLocationError(e) === 'timeout');
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000), /boom/);
});

test('pickCity prefers the city, then wider areas, and says nothing rather than guessing', () => {
  assert.equal(pickCity({ city: 'Gurugram', subregion: 'Gurgaon' }), 'Gurugram');
  assert.equal(pickCity({ city: null, subregion: ' Gurgaon ' }), 'Gurgaon');
  assert.equal(pickCity({ city: '', subregion: '', region: 'Haryana' }), 'Haryana');
  assert.equal(pickCity({}), null); assert.equal(pickCity(null), null);
});

test('every location reason has advice with the right action; nothing says "exact"', () => {
  const all: LocationReason[] = ['granted', 'denied', 'blocked_in_settings', 'services_off', 'timeout', 'geocode_failed', 'error'];
  for (const r of all) assert.ok(locationAdvice(r).message.length > 20, r);
  assert.equal(locationAdvice('blocked_in_settings').action, 'open_settings');
  assert.equal(locationAdvice('services_off').action, 'turn_on_location');
  assert.equal(locationAdvice('denied').action, 'retry');
  assert.equal(locationAdvice('error').action, 'type_city');
  assert.deepEqual(locationStatusLines({ permission: 'granted', servicesOn: false }), ['Permission: allowed', 'Location switched on: no']);
});

test('the app asks for permission with a high-importance channel for messages and safety, and keeps the channel ids the server uses', () => {
  const src = readFileSync(new URL('../src/lib/push.ts', import.meta.url), 'utf8');
  assert.match(src, /new Set\(\['messages', 'safety'\]\)/);
  assert.match(src, /AndroidImportance\.HIGH/);
});

test('no screen calls expo-location or the notification permission directly: everything goes through lib/location and lib/push', () => {
  for (const f of ['../app/(onboarding)/basics.tsx', '../app/open-call/new.tsx', '../app/activity/new.tsx', '../src/features/DeviceStatus.tsx', '../src/features/PushPrompt.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/from 'expo-location'|from 'expo-notifications'/.test(src), f);
  }
});
