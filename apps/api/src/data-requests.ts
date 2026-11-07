import type { StorageSigner } from './photos.ts';
import type { Store } from './store.ts';
import { err, ok } from './types.ts';
import type { Result } from './types.ts';
import { isUuid } from './validate.ts';
import { EXPORT_BUCKET } from './supabase-admin.ts';

export const EXPORT_URL_SECONDS = 300;

/**
 * Hands a person a short-lived link to THEIR OWN finished data export. Someone else's request, a request that is not an export,
 * and a path outside the person's own folder all look the same: not found.
 */
export class ExportAccess {
  store: Store; signer: StorageSigner;
  constructor(store: Store, signer: StorageSigner) { this.store = store; this.signer = signer; }

  async urlFor(userId: string, requestId: string): Promise<Result<{ url: string; expiresInSeconds: number }>> {
    if (!isUuid(requestId)) return err(404, 'not_found');
    const r = await this.store.getDataRequest(requestId);
    if (!r || r.userId !== userId || r.kind !== 'export') return err(404, 'not_found');
    if (r.status !== 'done' || !r.resultPath) return err(409, 'not_ready');          // it is their own request, so saying so leaks nothing
    if (!r.resultPath.startsWith(`${userId}/`)) return err(404, 'not_found');          // defence in depth: the database also enforces this
    try { return ok({ url: await this.signer.signedUrl(EXPORT_BUCKET, r.resultPath, EXPORT_URL_SECONDS), expiresInSeconds: EXPORT_URL_SECONDS }); }
    catch { return err(502, 'storage_unavailable'); }
  }
}
