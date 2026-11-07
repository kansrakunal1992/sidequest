import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { listConversations, subscribeToInbox } from './chat';
import { useModes } from './modes';

const Ctx = createContext<{ total: number; refresh: () => void }>({ total: 0, refresh: () => {} });

/** Unread message count for the current vibe, kept fresh by a realtime nudge plus a slow poll as a safety net. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { current } = useModes();
  const [total, setTotal] = useState(0);
  const refresh = useCallback(() => {
    if (!current) { setTotal(0); return; }
    listConversations(current).then((cs) => setTotal(cs.reduce((n, c) => n + c.unread, 0))).catch(() => {});
  }, [current]);
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 45_000);
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeToInbox(() => { if (t) clearTimeout(t); t = setTimeout(refresh, 400); });
    return () => { clearInterval(poll); off(); if (t) clearTimeout(t); };
  }, [refresh]);
  const value = useMemo(() => ({ total, refresh }), [total, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useUnread = () => useContext(Ctx);
