import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface ProfileStatus { onboardingComplete: boolean; state: string }
interface SessionState {
  sessionLoaded: boolean;
  session: Session | null;
  /** undefined = loading, null = no profile yet */
  profile: ProfileStatus | null | undefined;
  profileError: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionLoaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileStatus | null | undefined>(undefined);
  const [profileError, setProfileError] = useState(false);
  const uid = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoaded(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!uid) { setProfile(undefined); return; }
    setProfileError(false);
    const { data, error } = await supabase.from('profiles').select('onboarding_complete, state').eq('id', uid).maybeSingle();
    if (error) { setProfileError(true); return; }
    setProfile(data ? { onboardingComplete: !!data.onboarding_complete, state: String(data.state) } : null);
  }, [uid]);

  useEffect(() => { setProfile(undefined); void refreshProfile(); }, [refreshProfile]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(undefined); }, []);
  const value = useMemo(() => ({ sessionLoaded, session, profile, profileError, refreshProfile, signOut }), [sessionLoaded, session, profile, profileError, refreshProfile, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
