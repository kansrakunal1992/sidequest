import { SupabaseStorageSigner } from './photos.ts';
import type { StorageSigner } from './photos.ts';
import { isUuid } from './validate.ts';

/** Buckets that hold a person's files, each organised as `<user id>/...`. Account deletion empties all of them. */
export const USER_FILE_BUCKETS = ['profile-photos', 'chat-media', 'voice-intros', 'exports'] as const;
export const EXPORT_BUCKET = 'exports';

/** The few privileged operations the worker and the download route need. Kept narrow on purpose. */
export interface SupabaseAdmin extends StorageSigner {
  /** Stores a private file, replacing any existing one at the same path. */
  uploadJson(bucket: string, path: string, json: string): Promise<void>;
  /** Deletes exact paths. Missing files are not an error. */
  removeObjects(bucket: string, paths: string[]): Promise<void>;
  /** Deletes everything under `<userId>/` in a bucket (including sub-folders). Returns how many files were removed. */
  removeUserFolder(bucket: string, userId: string): Promise<number>;
  /** Removes the login account; the database cascades remove the profile and the rest. An account that is already gone counts as success. */
  deleteAuthUser(userId: string): Promise<void>;
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const PAGE = 100;

/**
 * Talks to Supabase's Storage and Auth REST APIs with the service role key (server only, never in the app).
 * Request shapes follow the published supabase-js client libraries (storage-js and auth-js).
 * STATUS: unit-tested against a fake server; not yet run against a real Supabase project.
 */
export class SupabaseAdminClient implements SupabaseAdmin {
  private base: string; private key: string; private fetchFn: typeof fetch; private signer: SupabaseStorageSigner;
  constructor(baseUrl: string, serviceKey: string, fetchFn: typeof fetch = fetch) {
    this.base = baseUrl.replace(/\/+$/, ''); this.key = serviceKey; this.fetchFn = fetchFn;
    this.signer = new SupabaseStorageSigner(this.base, serviceKey, fetchFn);
  }
  private headers(extra: Record<string, string> = {}): Record<string, string> { return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra }; }

  signedUrl(bucket: string, path: string, ttlSeconds: number) { return this.signer.signedUrl(bucket, path, ttlSeconds); }

  async uploadJson(bucket: string, path: string, json: string): Promise<void> {
    const res = await this.fetchFn(`${this.base}/storage/v1/object/${encodeURIComponent(bucket)}/${enc(path)}`, {
      method: 'POST', headers: this.headers({ 'content-type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=0' }), body: json });
    if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  }

  async removeObjects(bucket: string, paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += PAGE) {
      const res = await this.fetchFn(`${this.base}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: paths.slice(i, i + PAGE) }) });
      if (!res.ok) throw new Error(`remove_failed_${res.status}`);
    }
  }

  private async listFolder(bucket: string, prefix: string): Promise<{ name: string; isFolder: boolean }[]> {
    const out: { name: string; isFolder: boolean }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.fetchFn(`${this.base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST', headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }) });
      if (!res.ok) throw new Error(`list_failed_${res.status}`);
      const rows = (await res.json()) as { name: string; id: string | null }[];
      for (const r of rows) out.push({ name: r.name, isFolder: r.id === null });
      if (rows.length < PAGE) return out;
    }
  }

  async removeUserFolder(bucket: string, userId: string): Promise<number> {
    // An empty or malformed prefix would list (and delete) the whole bucket, so the id is checked before anything else.
    if (!isUuid(userId)) throw new Error('refusing to clear a folder that is not a user id');
    const files: string[] = [];
    const walk = async (prefix: string, depth: number): Promise<void> => {
      if (depth > 6) throw new Error('folder nesting too deep');
      for (const e of await this.listFolder(bucket, prefix)) {
        if (e.isFolder) await walk(`${prefix}/${e.name}`, depth + 1); else files.push(`${prefix}/${e.name}`);
      }
    };
    await walk(userId, 0);
    if (files.length) await this.removeObjects(bucket, files);
    return files.length;
  }

  async deleteAuthUser(userId: string): Promise<void> {
    if (!isUuid(userId)) throw new Error('not a user id');
    const res = await this.fetchFn(`${this.base}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ should_soft_delete: false }) });
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`delete_user_failed_${res.status}`);
  }
}
