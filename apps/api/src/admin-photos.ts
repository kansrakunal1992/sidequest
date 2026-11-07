import type { StorageSigner } from './photos.ts';
import type { Store } from './store.ts';
import { err, ok } from './types.ts';
import type { Result } from './types.ts';
import { isUuid } from './validate.ts';

/**
 * A moderator may look at a photo only when it is waiting for review or has been reported. The role is checked here with the
 * database (not trusted from the page), the link lasts two minutes, and everyone else gets the same "not found" for every failure.
 */
export class AdminPhotoAccess {
  store: Store; signer: StorageSigner;
  constructor(store: Store, signer: StorageSigner) { this.store = store; this.signer = signer; }
  async urlFor(userId: string, photoId: unknown): Promise<Result<{ url: string }>> {
    if (!isUuid(photoId)) return err(404, 'not_found');
    if (!(await this.store.isModerator(userId))) return err(404, 'not_found');
    const path = await this.store.photoForReview(photoId);
    if (!path) return err(404, 'not_found');
    try { return ok({ url: await this.signer.signedUrl('profile-photos', path, 120) }); } catch { return err(502, 'storage_unavailable'); }
  }
}
