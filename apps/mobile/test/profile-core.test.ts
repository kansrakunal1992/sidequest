// Pure logic added in v18: photo upload helpers, "how others see me", getting-started nudges, invitation availability. No phone, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PHOTOS, describeUploadError, nextPositions, uploadMessage } from '../src/core/photo-upload.ts';
import { photoNote, photosAsOthersSee, reorderToFront, shownBio, verificationReference } from '../src/core/self-profile.ts';
import type { OwnPhoto } from '../src/core/self-profile.ts';
import { DISMISS_DAYS, bannerVisible, gettingStartedSteps, nextStep, progress } from '../src/core/getting-started.ts';
import { inviteAvailability } from '../src/core/invite-ui.ts';
import { readiness, readinessText } from '../src/core/verify-core.ts';

const ph = (id: string, o: Partial<OwnPhoto> = {}): OwnPhoto => ({ id, path: `u/${id}.jpg`, status: 'approved', visibleModes: ['friendship'], position: 0, ...o });

test('new photos are positioned AFTER existing ones, so they can never overtake the main photo', () => {
  assert.deepEqual(nextPositions([], 3), [0, 1, 2]);
  assert.deepEqual(nextPositions([0, 1], 2), [2, 3]);
  assert.deepEqual(nextPositions([0, 4], 1), [5]);
  assert.equal(MAX_PHOTOS, 6);
});

test('upload errors say what actually went wrong, in plain words', () => {
  assert.match(describeUploadError(new Error('Network request failed')), /No connection/);
  assert.match(describeUploadError({ message: 'new row violates row-level security policy', code: '42501' }), /session may have expired/);
  assert.match(describeUploadError({ message: 'Bucket not found' }), /bucket is missing/);
  assert.match(describeUploadError({ message: 'The object exceeded the maximum allowed size' }), /too large/);
  assert.match(describeUploadError(new Error('something odd')), /Upload failed: something odd/);
  assert.match(describeUploadError(undefined), /unknown reason/);
  assert.equal(uploadMessage({ uploaded: 2, failed: 0, errors: [] }), '');
  assert.match(uploadMessage({ uploaded: 1, failed: 2, errors: ['No connection.'] }), /1 added, 2 did not upload\. No connection\./);
  assert.match(uploadMessage({ uploaded: 0, failed: 1, errors: [] }), /Your photo did not upload\./);
});

test('"how others see me" mirrors the server rule: approved AND visible in that vibe (or in the explicit per-vibe list)', () => {
  assert.equal(photoNote(ph('a'), 'friendship', []), null);
  assert.match(photoNote(ph('a', { status: 'pending' }), 'friendship', []) ?? '', /In review/);
  assert.match(photoNote(ph('a', { status: 'rejected' }), 'friendship', []) ?? '', /Not approved/);
  assert.match(photoNote(ph('a', { visibleModes: ['serious_dating'] }), 'friendship', []) ?? '', /Hidden in this vibe/);
  // an explicit visible_photo_ids list overrides visible_modes, exactly like view_profile
  assert.equal(photoNote(ph('a', { visibleModes: ['serious_dating'] }), 'friendship', ['a']), null);
  assert.match(photoNote(ph('b'), 'friendship', ['a']) ?? '', /Hidden/);
  const v = photosAsOthersSee([ph('b', { position: 1 }), ph('a', { position: 0, status: 'pending' })], 'friendship');
  assert.deepEqual(v.map((x) => [x.photo.id, x.liveToOthers]), [['a', false], ['b', true]], 'sorted by position, live flag set');
});

test('the verification reference is the first APPROVED photo by position, and bios follow the viewer rule', () => {
  assert.equal(verificationReference([ph('a', { status: 'pending', position: 0 }), ph('b', { position: 1 }), ph('c', { position: 2 })])?.id, 'b');
  assert.equal(verificationReference([ph('a', { status: 'pending' })]), null);
  assert.equal(shownBio('vibe intro', 'general'), 'vibe intro');
  assert.equal(shownBio('  ', 'general'), 'general');
  assert.equal(shownBio(null, null), '');
});

test('make-main moves one photo to the front and keeps everyone else in order', () => {
  const order = reorderToFront([{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }], 'c');
  assert.deepEqual(order, { c: 0, a: 1, b: 2 });
  assert.deepEqual(reorderToFront([{ id: 'a', position: 0 }], 'zzz'), {});
});

test('getting started: one next step at a time, in the right order, and nothing when done', () => {
  const base = { verified: false, verificationAvailable: true, approvedPhotos: 1, totalPhotos: 1, hasIntro: false };
  const s = gettingStartedSteps(base);
  assert.deepEqual(s.map((x) => x.id), ['verify', 'photos', 'intro']);
  assert.equal(nextStep(s)?.id, 'verify');
  assert.equal(nextStep(s)?.route, '/safety/verify');
  assert.deepEqual(progress(s), { done: 0, total: 3 });
  const noVerify = gettingStartedSteps({ ...base, verificationAvailable: false });
  assert.equal(nextStep(noVerify)?.id, 'photos', 'when the server has no verification, never nag about it');
  const all = gettingStartedSteps({ verified: true, verificationAvailable: true, approvedPhotos: 3, totalPhotos: 3, hasIntro: true });
  assert.equal(nextStep(all), null);
});

test('the Discover banner stays away for a week after being dismissed, then returns only if something is still undone', () => {
  const step = nextStep(gettingStartedSteps({ verified: false, verificationAvailable: true, approvedPhotos: 0, totalPhotos: 0, hasIntro: false }));
  const now = 1_800_000_000_000;
  assert.equal(bannerVisible(step, null, now), true);
  assert.equal(bannerVisible(step, now - 86_400_000, now), false);
  assert.equal(bannerVisible(step, now - (DISMISS_DAYS + 1) * 86_400_000, now), true);
  assert.equal(bannerVisible(null, null, now), false);
});

test('invitations: five vibes allow a first invitation without a match, Explore does not, a match always can', () => {
  for (const m of ['serious_dating', 'hookups', 'friendship', 'post_marital', 'adventures']) assert.equal(inviteAvailability(m, false).canInvite, true, m);
  const e = inviteAvailability('experimentation', false);
  assert.equal(e.canInvite, false); assert.match(e.hint ?? '', /once you have matched/);
  assert.equal(inviteAvailability('experimentation', true).canInvite, true);
});

test('verify readiness: needs an approved photo, and says why when it does not have one', () => {
  assert.equal(readiness(null), 'unknown');
  assert.equal(readiness([]), 'no_photo');
  assert.equal(readiness([{ status: 'pending' }]), 'in_review');
  assert.equal(readiness([{ status: 'pending' }, { status: 'approved' }]), 'ready');
  assert.ok(readinessText('no_photo') && readinessText('in_review'));
  assert.equal(readinessText('ready'), null); assert.equal(readinessText('unknown'), null);
});

import { MAX_PICK_DAYS, combineDateAndTime, formatDay, formatTime, startOfDay, whenProblem } from '../src/core/invite-ui.ts';
test('calendar picker helpers: combine a date with a time, and refuse moments that cannot work', () => {
  const day = new Date(2026, 10, 14, 3, 7, 9, 400);               // 14 Nov 2026, any time of day
  const d = combineDateAndTime(day, 20, 30);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()], [2026, 10, 14, 20, 30, 0, 0]);
  assert.equal(day.getHours(), 3, 'the input is not mutated');
  assert.equal(startOfDay(day).getHours(), 0);
  const now = new Date(2026, 10, 10, 12, 0);
  assert.match(whenProblem(new Date(2026, 10, 10, 12, 10), now) ?? '', /at least 15 minutes/);
  assert.match(whenProblem(new Date(2026, 10, 9, 12, 0), now) ?? '', /at least 15 minutes/);
  assert.equal(whenProblem(new Date(2026, 10, 10, 12, 20), now), null);
  assert.equal(whenProblem(new Date(now.getTime() + MAX_PICK_DAYS * 86_400_000 - 60_000), now), null);
  assert.match(whenProblem(new Date(now.getTime() + (MAX_PICK_DAYS + 1) * 86_400_000), now) ?? '', /within the next 90 days/);
  assert.match(formatDay(d), /14/); assert.match(formatTime(d), /8:30/);
});
