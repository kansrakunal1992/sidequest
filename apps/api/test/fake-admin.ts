import type { SupabaseAdmin } from '../src/supabase-admin.ts';

/** In-memory stand-in for the Supabase Storage + Auth admin API, with failure injection and a call log. */
export class FakeAdmin implements SupabaseAdmin {
  files = new Map<string, string>();            // `${bucket}/${path}` -> body
  authUsers = new Set<string>();
  calls: string[] = [];
  failNext: { op: string; times: number } | null = null;
  private maybeFail(op: string) { if (this.failNext && this.failNext.op === op && this.failNext.times > 0) { this.failNext.times -= 1; throw new Error(`${op}_boom`); } }
  async uploadJson(bucket: string, path: string, json: string) { this.calls.push(`upload ${bucket}/${path}`); this.maybeFail('upload'); this.files.set(`${bucket}/${path}`, json); }
  async removeObjects(bucket: string, paths: string[]) { this.calls.push(`remove ${bucket} ${paths.join(',')}`); for (const p of paths) this.files.delete(`${bucket}/${p}`); }
  async removeUserFolder(bucket: string, userId: string) {
    this.calls.push(`clear ${bucket}/${userId}`); this.maybeFail('clear');
    let n = 0; for (const k of [...this.files.keys()]) if (k.startsWith(`${bucket}/${userId}/`)) { this.files.delete(k); n += 1; }
    return n;
  }
  async deleteAuthUser(userId: string) { this.calls.push(`deleteUser ${userId}`); this.maybeFail('deleteUser'); this.authUsers.delete(userId); }
  async signedUrl(bucket: string, path: string, ttl: number) { this.calls.push(`sign ${bucket}/${path}`); return `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&ttl=${ttl}`; }
}
