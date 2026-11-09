// Pure helpers for "why was my photo not approved". The reason is written by a moderator (max 200 characters) and shown only to the photo's owner.

export interface PhotoIssueRow { photoId: string; status: string; reason: string | null }

/** my_photo_issues answers with snake_case rows. Junk is dropped so a bad answer never hides the photo list. */
export function parsePhotoIssues(raw: unknown): PhotoIssueRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => r && typeof r === 'object' && typeof (r as any).photo_id === 'string'
    ? [{ photoId: (r as any).photo_id as string, status: String((r as any).status ?? ''), reason: typeof (r as any).reason === 'string' && (r as any).reason.trim() ? (r as any).reason.trim().slice(0, 200) : null }]
    : []);
}

/** One plain sentence per not-approved photo, with the number the person sees on screen. Pending photos are not an "issue". */
export function photoIssueLines(photoIds: string[], issues: PhotoIssueRow[]): string[] {
  return photoIds.flatMap((id, i) => {
    const issue = issues.find((x) => x.photoId === id && x.status === 'rejected');
    if (!issue) return [];
    const why = issue.reason ? `: ${issue.reason.replace(/[.\s]+$/, '')}.` : '.';
    return [`Photo ${i + 1} was not approved${why} Replace it with a clear photo of your face.`];
  });
}
