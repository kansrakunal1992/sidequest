import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoIssues, photoIssueLines } from '../src/core/photo-issues.ts';

test('photo issues: parsed defensively, reasons trimmed, junk dropped', () => {
  assert.deepEqual(parsePhotoIssues([{ photo_id: 'a', status: 'rejected', reason: '  Face is hidden  ' }, { photo_id: 'b', status: 'pending', reason: null }, null, { status: 'x' }, { photo_id: 'c', status: 'rejected', reason: '   ' }]),
    [{ photoId: 'a', status: 'rejected', reason: 'Face is hidden' }, { photoId: 'b', status: 'pending', reason: null }, { photoId: 'c', status: 'rejected', reason: null }]);
  for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(parsePhotoIssues(bad), []);
  assert.equal(parsePhotoIssues([{ photo_id: 'a', status: 'rejected', reason: 'x'.repeat(500) }])[0]!.reason!.length, 200);
});
test('photo issue lines: only rejected photos, numbered as on screen, with the reason when there is one', () => {
  const issues = parsePhotoIssues([{ photo_id: 'b', status: 'rejected', reason: 'Face is hidden' }, { photo_id: 'c', status: 'pending', reason: null }, { photo_id: 'd', status: 'rejected', reason: null }]);
  assert.deepEqual(photoIssueLines(['a', 'b', 'c', 'd'], issues), [
    'Photo 2 was not approved: Face is hidden. Replace it with a clear photo of your face.',
    'Photo 4 was not approved. Replace it with a clear photo of your face.',
  ]);
  assert.deepEqual(photoIssueLines(['a'], []), []);
});
