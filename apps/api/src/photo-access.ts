import { MODE_IDS } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';
import type { StorageSigner } from './photos.ts';
import type { Store } from './store.ts';
import { isUuid } from './validate.ts';

export interface PhotoRequestItem { userId: string; modeId: string; all?: boolean }
export interface PhotoUrls { userId: string; modeId: string; urls: string[] }

const TTL_S = 600;
const MAX_ITEMS = 30;
const MAX_PER_PERSON = 6;

/**
 * Signed, short-lived image URLs for other people's photos. The rules match the database's profile rules:
 * both people active in the same vibe, not blocked, only approved photos, only photos chosen for that vibe.
 * People's own photos are signed on the device (storage policy) and never come through here.
 */
export class PhotoAccess {
  store: Store; signer: StorageSigner; now: () => number;
  private cache = new Map<string, { url: string; exp: number }>();
  constructor(store: Store, signer: StorageSigner, now: () => number = Date.now) { this.store = store; this.signer = signer; this.now = now; }

  private async sign(path: string): Promise<string | null> {
    const hit = this.cache.get(path);
    const t = this.now();
    if (hit && hit.exp - 60_000 > t) return hit.url;
    try {
      const url = await this.signer.signedUrl('profile-photos', path, TTL_S);
      this.cache.set(path, { url, exp: t + TTL_S * 1000 });
      if (this.cache.size > 5000) for (const [k, v] of this.cache) if (v.exp < t) this.cache.delete(k);
      return url;
    } catch { return null; }
  }

  async urlsFor(viewerId: string, items: PhotoRequestItem[]): Promise<PhotoUrls[]> {
    const out: PhotoUrls[] = [];
    for (const it of items.slice(0, MAX_ITEMS)) {
      const empty = { userId: it.userId, modeId: it.modeId, urls: [] as string[] };
      if (!isUuid(it.userId) || it.userId === viewerId || !(MODE_IDS as readonly string[]).includes(it.modeId)) { out.push(empty); continue; }
      const paths = await this.store.visiblePhotoPaths(viewerId, it.userId, it.modeId as ModeId);
      const wanted = it.all ? paths.slice(0, MAX_PER_PERSON) : paths.slice(0, 1);
      const urls = (await Promise.all(wanted.map((p) => this.sign(p)))).filter((u): u is string => !!u);
      out.push({ ...empty, urls });
    }
    return out;
  }
}
