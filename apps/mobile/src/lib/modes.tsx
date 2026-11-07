import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ModeId } from '@sidequest/shared';
import { supabase } from './supabase';
import { useSession } from './session';

export interface ActiveMode { modeId: ModeId; paused: boolean; availability: string }
interface ModeState {
  active: ActiveMode[];
  current: ModeId | null;
  setCurrent: (m: ModeId) => void;
  togglePause: (m: ModeId, paused: boolean) => Promise<void>;
  addMode: (m: ModeId) => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<ModeState | null>(null);

/** Which vibe the app is currently showing, and which vibes the person has switched on. */
export function ModeProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useSession();
  const uid = session?.user.id;
  const ready = !!uid && !!profile?.onboardingComplete;
  const [active, setActive] = useState<ActiveMode[]>([]);
  const [current, setCurrentState] = useState<ModeId | null>(null);

  const refresh = useCallback(async () => {
    if (!uid || !ready) { setActive([]); setCurrentState(null); return; }
    const { data } = await supabase.from('user_active_modes').select('mode_id, paused, availability').eq('user_id', uid);
    const rows: ActiveMode[] = (data ?? []).map((r: any) => ({ modeId: r.mode_id, paused: !!r.paused, availability: String(r.availability) }));
    setActive(rows);
    setCurrentState((cur) => (cur && rows.some((r) => r.modeId === cur && !r.paused)) ? cur : (rows.find((r) => !r.paused)?.modeId ?? null));
  }, [uid, ready]);
  useEffect(() => { void refresh(); }, [refresh]);

  const togglePause = useCallback(async (m: ModeId, paused: boolean) => {
    if (!uid) return;
    const { error } = await supabase.from('user_active_modes').update({ paused }).eq('user_id', uid).eq('mode_id', m);
    if (error) throw error;
    await refresh();
  }, [uid, refresh]);

  const addMode = useCallback(async (m: ModeId) => {
    if (!uid) return;
    const { error } = await supabase.from('user_active_modes').insert({ user_id: uid, mode_id: m });
    if (error) throw error;
    await supabase.from('preferences').upsert({ user_id: uid, mode_id: m });
    await supabase.from('mode_specific_profiles').upsert({ user_id: uid, mode_id: m });
    await refresh();
  }, [uid, refresh]);

  const value = useMemo(() => ({ active, current, setCurrent: setCurrentState as (m: ModeId) => void, togglePause, addMode, refresh }), [active, current, togglePause, addMode, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useModes(): ModeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useModes must be used inside ModeProvider');
  return v;
}
