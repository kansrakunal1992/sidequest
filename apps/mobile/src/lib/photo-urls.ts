import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

const cache = new Map<string, { urls: string[]; exp: number }>();
const TTL = 8 * 60_000;
export interface PhotoWant { userId: string; modeId: string }

/** Signed photo URLs for other people, fetched in batches and cached for a few minutes. Missing means "no photo to show". */
export function usePhotoUrls(wants: PhotoWant[], all = false): Record<string, string[]> {
  const key = (w: PhotoWant) => `${w.userId}|${w.modeId}|${all ? 'a' : 'f'}`;
  const signature = useMemo(() => wants.map(key).join(','), [wants, all]);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const now = Date.now();
    const missing = wants.filter((w) => { const hit = cache.get(key(w)); return !hit || hit.exp < now; });
    (async () => {
      for (let i = 0; i < missing.length; i += 30) {
        const batch = missing.slice(i, i + 30);
        try {
          const res = await api.photoUrls(batch.map((w) => ({ ...w, all })));
          for (const r of res.results) cache.set(`${r.userId}|${r.modeId}|${all ? 'a' : 'f'}`, { urls: r.urls, exp: Date.now() + TTL });
        } catch { /* leave blank; will retry on next render */ }
      }
      if (live && missing.length) bump((n) => n + 1);
    })();
    return () => { live = false; };
  }, [signature]);
  const out: Record<string, string[]> = {};
  for (const w of wants) out[w.userId] = cache.get(key(w))?.urls ?? [];
  return out;
}
