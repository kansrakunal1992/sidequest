import { useCallback, useEffect, useRef, useState } from 'react';
import { mapDateIdeas } from '@/core/date-ideas';
import type { DateIdeas } from '@/core/date-ideas';
import { db } from '@/lib/db';

/**
 * Date Ideas for a batch of people on screen (the swipe deck). One request covers up to 50 people, each person is asked about once per vibe,
 * and any failure (for example the database update has not been run yet) just means no ideas are shown.
 */
export function useDateIdeas(ids: string[], mode: string | null): (id: string) => DateIdeas | null {
  const [found, setFound] = useState<Record<string, DateIdeas>>({});
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const key = ids.join(',');
  useEffect(() => {
    if (!mode) return;
    const fresh = ids.filter((id) => !asked.current.has(`${mode}:${id}`)).slice(0, 50);
    if (!fresh.length) return;
    fresh.forEach((id) => asked.current.add(`${mode}:${id}`));
    db.dateIdeasFor(fresh, mode).then((rows) => {
      if (!alive.current || !rows.length) return;
      setFound((prev) => ({ ...prev, ...Object.fromEntries(rows.filter((r) => r.user_id).map((r) => [`${mode}:${r.user_id}`, mapDateIdeas(r)])) }));
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode]);
  return useCallback((id: string) => (mode ? found[`${mode}:${id}`] ?? null : null), [found, mode]);
}
