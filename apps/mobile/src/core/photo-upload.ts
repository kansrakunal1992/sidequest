// Pure helpers for adding photos. Kept free of native modules so they run in plain tests.

export const MAX_PHOTOS = 6;

/** Positions for newly added photos: always AFTER the existing ones. (Before, every batch started at 0, so a new photo could tie with
 *  and overtake the person's main photo, which is also the photo their verification selfie is matched against.) */
export function nextPositions(existing: number[], count: number): number[] {
  const start = existing.length ? Math.max(...existing) + 1 : 0;
  return Array.from({ length: count }, (_, i) => start + i);
}

/** Turn a raw storage / database / network error into one plain sentence that says what actually went wrong. */
export function describeUploadError(e: unknown): string {
  const raw = e && typeof e === 'object' ? `${(e as any).message ?? ''} ${(e as any).error ?? ''} ${(e as any).code ?? ''}` : String(e ?? '');
  const m = raw.toLowerCase();
  if (m.includes('network request failed') || m.includes('failed to fetch') || m.includes('timeout')) return 'No connection. Check your internet and try again.';
  if (m.includes('row-level security') || m.includes('42501') || m.includes('not authorized') || m.includes('unauthorized') || m.includes('jwt')) return 'Your session may have expired. Sign out, sign in again and retry.';
  if (m.includes('bucket not found')) return 'The photo storage bucket is missing on the server (profile-photos). The app owner needs to create it.';
  if (m.includes('payload too large') || m.includes('exceeded the maximum') || m.includes('413')) return 'That photo is too large. Pick a smaller one.';
  if (m.includes('mime') || m.includes('not allowed')) return 'That file type is not supported. Use a JPG or PNG photo.';
  if (m.includes('limit') || m.includes('photo_limit') || m.includes('too many')) return `You can have up to ${MAX_PHOTOS} photos. Remove one to add another.`;
  const msg = raw.trim();
  return msg ? `Upload failed: ${msg.slice(0, 120)}` : 'Upload failed for an unknown reason. Please try again.';
}

export interface UploadSummary { uploaded: number; failed: number; errors: string[] }

/** One sentence for the screen, with the first real reason. Empty string when everything worked. */
export function uploadMessage(s: UploadSummary): string {
  if (s.failed === 0) return '';
  const first = s.errors[0] ? ` ${s.errors[0]}` : '';
  return s.uploaded > 0 ? `${s.uploaded} added, ${s.failed} did not upload.${first}` : `Your photo${s.failed > 1 ? 's' : ''} did not upload.${first}`;
}
