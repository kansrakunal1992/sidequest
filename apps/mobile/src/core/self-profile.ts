// "How others see me": what a viewer would get for one vibe, built from the person's OWN rows.
// view_profile refuses to show you yourself and the photo-URL API returns nothing for your own id, so this mirrors the viewer rules
// on the device. Keep it in step with view_profile / discover_people (0003, 0006): a photo is shown to others only when it is approved
// AND (the vibe has an explicit visible_photo_ids list that contains it, or the list is empty and the photo is visible in that vibe).

export interface OwnPhoto { id: string; path: string; status: string; visibleModes: string[]; position: number; url?: string }

export interface PhotoView { photo: OwnPhoto; liveToOthers: boolean; note: string | null }

/** Why a photo is not live, in words a person understands. null when it is. */
export function photoNote(p: OwnPhoto, mode: string | null, visibleIds: string[]): string | null {
  if (p.status === 'pending') return 'In review. Only you can see it for now.';
  if (p.status === 'rejected') return 'Not approved. Others cannot see it.';
  if (p.status !== 'approved') return 'Not live yet.';
  if (!mode) return null;
  const inVibe = visibleIds.length ? visibleIds.includes(p.id) : p.visibleModes.includes(mode);
  return inVibe ? null : 'Hidden in this vibe.';
}

export function photosAsOthersSee(photos: OwnPhoto[], mode: string | null, visibleIds: string[] = []): PhotoView[] {
  return [...photos].sort((a, b) => a.position - b.position).map((photo) => {
    const note = photoNote(photo, mode, visibleIds);
    return { photo, liveToOthers: note === null, note };
  });
}

/** The photo the verification selfie is compared with: the first approved one by position (mirrors the API). */
export function verificationReference(photos: OwnPhoto[]): OwnPhoto | null {
  return [...photos].sort((a, b) => a.position - b.position).find((p) => p.status === 'approved') ?? null;
}

/** What the viewer sees as the bio: the vibe-specific intro wins over the general bio. */
export function shownBio(modeBio: string | null | undefined, baseBio: string | null | undefined): string {
  return (modeBio?.trim() || baseBio?.trim() || '');
}

/** New order after "make main": the chosen photo moves to the front, everything keeps its relative order. Returns id -> position. */
export function reorderToFront(photos: Pick<OwnPhoto, 'id' | 'position'>[], id: string): Record<string, number> {
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  const chosen = sorted.find((p) => p.id === id);
  if (!chosen) return {};
  return Object.fromEntries([chosen, ...sorted.filter((p) => p.id !== id)].map((p, i) => [p.id, i]));
}
