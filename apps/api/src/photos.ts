import type { Store } from './store.ts';
import { err, ok } from './types.ts';
import type { PhotoStatus, Result } from './types.ts';

export type ModerationVerdict = 'approved' | 'rejected' | 'needs_human';
/** Plug a real provider in here (AWS Rekognition, Google Vision SafeSearch, Hive, Sightengine...). */
export interface ImageModerator { review(imageUrl: string): Promise<ModerationVerdict> }
export interface StorageSigner { signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string> }
export type ModerationMode = 'required' | 'off';

export interface PhotoDeps {
  store: Store;
  moderator: ImageModerator | null;
  signer: StorageSigner | null;
  /** 'required' (default): photos stay pending until a provider or a human approves. 'off': DEV ONLY, approve everything. */
  mode: ModerationMode;
  log?: (m: string) => void;
}

/**
 * Fail-closed photo review. A photo is only 'approved' by a provider verdict, a human moderator,
 * or the explicit development switch PHOTO_MODERATION=off (which logs loudly).
 */
export class PhotoService {
  deps: PhotoDeps;
  constructor(deps: PhotoDeps) { this.deps = deps; }

  async submit(userId: string, photoId: string): Promise<Result<{ status: PhotoStatus }>> {
    const { store, moderator, signer, mode } = this.deps;
    const log = this.deps.log ?? (() => {});
    const photo = await store.getPhoto(photoId);
    if (!photo || photo.userId !== userId) return err(404, 'not_found');         // same answer for "not yours"
    if (photo.status !== 'pending') return ok({ status: photo.status });          // idempotent; humans can overturn later

    if (mode === 'off') {
      log(`WARNING: PHOTO_MODERATION=off, auto-approving photo ${photo.id}. Never use this in production.`);
      await store.setPhotoStatus(photo.id, 'approved');
      return ok({ status: 'approved' });
    }
    if (!moderator || !signer) return ok({ status: 'pending' });                  // waits in the human moderation queue

    try {
      const url = await signer.signedUrl('profile-photos', photo.storagePath, 120);
      const verdict = await moderator.review(url);
      const status: PhotoStatus = verdict === 'approved' ? 'approved' : verdict === 'rejected' ? 'rejected' : 'pending';
      if (status !== 'pending') await store.setPhotoStatus(photo.id, status);
      return ok({ status });
    } catch (e) {
      log(`photo review failed for ${photo.id}: ${(e as Error).message}`);
      return ok({ status: 'pending' });                                           // fail closed
    }
  }
}

/** Short-lived signed URLs via the Supabase Storage REST API (needs the service role key; keep it server-side). */
export class SupabaseStorageSigner implements StorageSigner {
  baseUrl: string; serviceKey: string; fetchFn: typeof fetch;
  constructor(baseUrl: string, serviceKey: string, fetchFn: typeof fetch = fetch) { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.serviceKey = serviceKey; this.fetchFn = fetchFn; }
  async signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await this.fetchFn(`${this.baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encoded}`, {
      method: 'POST', headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!res.ok) throw new Error(`sign_failed_${res.status}`);
    const j = (await res.json()) as { signedURL?: string };
    if (!j.signedURL) throw new Error('sign_failed_no_url');
    return `${this.baseUrl}/storage/v1${j.signedURL.startsWith('/') ? '' : '/'}${j.signedURL}`;
  }
}

/** A self-declared date of birth is NOT identity or age verification. Real verification plugs in here. */
export interface AgeVerifier { start(userId: string): Promise<{ url: string }> }
