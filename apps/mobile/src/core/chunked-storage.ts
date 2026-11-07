export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Android Keystore-backed SecureStore has a small per-value limit, but a Supabase session (access + refresh token)
 * is bigger. This splits values over several keys and reassembles them, treating any damage as "no session".
 */
export function createChunkedStorage(kv: KV, chunkSize = 1800): KV {
  const countKey = (k: string) => `${k}.n`;
  const chunkKey = (k: string, i: number) => `${k}.${i}`;
  async function clear(key: string) {
    const n = Number(await kv.getItem(countKey(key)));
    if (Number.isInteger(n) && n > 0) for (let i = 0; i < n; i++) await kv.removeItem(chunkKey(key, i));
    await kv.removeItem(countKey(key));
  }
  return {
    async getItem(key) {
      const raw = await kv.getItem(countKey(key));
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1000) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await kv.getItem(chunkKey(key, i));
        if (p === null) return null;
        parts.push(p);
      }
      return parts.join('');
    },
    async setItem(key, value) {
      await clear(key);
      const n = Math.max(1, Math.ceil(value.length / chunkSize));
      for (let i = 0; i < n; i++) await kv.setItem(chunkKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      await kv.setItem(countKey(key), String(n));   // written last: a crash mid-write reads as "no session"
    },
    async removeItem(key) { await clear(key); },
  };
}
