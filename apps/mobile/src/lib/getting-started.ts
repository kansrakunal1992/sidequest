import { useCallback, useEffect, useState } from 'react';
import { bannerVisible, gettingStartedSteps, nextStep } from '@/core/getting-started';
import type { Step } from '@/core/getting-started';
import { shownBio } from '@/core/self-profile';
import { api } from '@/lib/api';
import { getFlag, setFlag } from '@/lib/local-flags';
import { loadOwnProfile } from '@/lib/own-profile';
import { useModes } from '@/lib/modes';
import { useSession } from '@/lib/session';

export interface GettingStarted { loading: boolean; name: string; age: number | null; mainPhotoUrl: string | null; steps: Step[]; next: Step | null; verified: boolean; verificationAvailable: boolean; bannerShown: boolean; dismiss: () => void; refresh: () => void }

/** One place that knows what a person has and has not done yet. Discover shows the banner; Profile shows the full list. */
export function useGettingStarted(): GettingStarted {
  const { session } = useSession();
  const { current } = useModes();
  const uid = session?.user.id ?? '';
  const [state, setState] = useState<{ steps: Step[]; verified: boolean; available: boolean; dismissedAt: number | null; name: string; age: number | null; mainPhotoUrl: string | null } | null>(null);

  const refresh = useCallback(() => {
    if (!uid) return;
    void (async () => {
      try {
        const [own, cfg, dismissed] = await Promise.all([loadOwnProfile(uid, current), api.config().catch(() => null), getFlag(`gs.dismissed.${uid}`)]);
        const approved = own.photos.filter((p) => p.status === 'approved').length;
        const steps = gettingStartedSteps({ verified: own.verified, verificationAvailable: !!cfg?.verification, approvedPhotos: approved, totalPhotos: own.photos.length,
          hasIntro: !!(own.headline?.trim() || shownBio(own.modeBio, own.baseBio)) });
        setState({ steps, verified: own.verified, available: !!cfg?.verification, dismissedAt: dismissed ? Number(dismissed) || null : null,
          name: own.displayName, age: own.age, mainPhotoUrl: own.photos.find((p) => p.url)?.url ?? null });
      } catch { /* leave as is: a banner that fails to load is simply not shown */ }
    })();
  }, [uid, current]);
  useEffect(() => { refresh(); }, [refresh]);

  const next = state ? nextStep(state.steps) : null;
  const dismiss = useCallback(() => { const t = Date.now(); void setFlag(`gs.dismissed.${uid}`, String(t)); setState((s) => (s ? { ...s, dismissedAt: t } : s)); }, [uid]);
  return { loading: !state, name: state?.name ?? '', age: state?.age ?? null, mainPhotoUrl: state?.mainPhotoUrl ?? null, steps: state?.steps ?? [], next, verified: !!state?.verified, verificationAvailable: !!state?.available,
    bannerShown: !!state && bannerVisible(next, state.dismissedAt, Date.now()), dismiss, refresh };
}
