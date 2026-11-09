import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_TEXT, parseMyVerification, reasonText, startErrorText, verifyView } from '../src/core/verify-core.ts';

const NOW = new Date('2026-11-09T12:00:00Z');
test('the database answer is parsed defensively', () => {
  assert.deepEqual(parseMyVerification({ verified: false, verified_at: null, latest: { status: 'pending', reject_reason: null, expires_at: '2026-11-09T12:30:00Z' } }), { verified: false, verifiedAt: null, latest: { status: 'pending', reason: null, expiresAt: '2026-11-09T12:30:00Z' } });
  assert.equal(parseMyVerification({ verified: true, latest: { status: 'weird' } })!.latest, null);
  for (const bad of [null, undefined, 'x', 5]) assert.equal(parseMyVerification(bad), null);
});
test('what to show: verified beats everything; an open check waits; a refusal explains; otherwise start', () => {
  const v = (verified: boolean, latest: any) => parseMyVerification({ verified, verified_at: null, latest });
  assert.deepEqual(verifyView(v(true, { status: 'rejected', reject_reason: 'face_mismatch' }), NOW), { kind: 'verified' });
  assert.deepEqual(verifyView(v(false, { status: 'pending', expires_at: '2026-11-09T12:20:00Z' }), NOW), { kind: 'waiting' });
  assert.deepEqual(verifyView(v(false, { status: 'started', expires_at: '2026-11-09T11:00:00Z' }), NOW), { kind: 'idle' }, 'an old open check has lapsed');
  assert.equal(verifyView(v(false, { status: 'rejected', reject_reason: 'liveness_failed' }), NOW).kind, 'failed');
  assert.deepEqual(verifyView(v(false, { status: 'expired', reject_reason: 'not_finished' }), NOW), { kind: 'idle' });
  assert.deepEqual(verifyView(null, NOW), { kind: 'idle' });
});
test('every reason and every start error has kind, plain wording', () => {
  for (const c of ['liveness_failed', 'face_mismatch', 'low_match', 'not_finished', 'try_again', null, 'anything']) { const t = reasonText(c as string | null); assert.ok(t.length > 30 && !/error|invalid|failed to/i.test(t), String(c)); }
  assert.equal(reasonText('face_mismatch'), reasonText('low_match'), 'two near-identical causes read the same');
  for (const c of ['already_verified', 'too_many_attempts', 'no_approved_photo', 'photo_not_usable', 'verification_paused', 'provider_unavailable', 'in_progress', 'selfie_verification_not_configured', 'network_error', undefined]) assert.ok(startErrorText(c).length > 20, String(c));
  assert.match(startErrorText('too_many_attempts'), /tomorrow/);
});
test('the consent text says who, what, what we keep, and that it is optional', () => {
  for (const w of ['Didit', 'live selfie', 'never receive your selfie', 'delete', 'optional']) assert.ok(CONSENT_TEXT.includes(w), w);
});
