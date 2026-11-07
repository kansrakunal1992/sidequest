import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { friendlyError } from '@/core/errors';

/** Loads data when the screen opens and again each time it comes back into view (so a screen reflects what happened on the screen after it). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    set((s) => ({ ...s, loading: true, error: null }));
    try { const data = await fn(); if (mine === seq.current) set({ data, error: null, loading: false }); }
    catch (e) { if (mine === seq.current) set((s) => ({ data: s.data, error: friendlyError(e), loading: false })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useFocusEffect(useCallback(() => { void run(); return () => { seq.current += 1; }; }, [run]));
  return { ...state, reload: run };
}

/** Runs one action at a time, tracking "busy" and a friendly error. Returns true if it worked. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(friendlyError(e)); return false; } finally { setBusy(false); }
  }, []);
  return { run, busy, error, setError };
}

export const fmtWhen = (iso: string | Date): string => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
