import { createContext, useContext, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { initialOnboarding, onboardingReducer } from '@/core/onboarding';
import type { OnboardingAction, OnboardingState } from '@/core/onboarding';

const Ctx = createContext<{ state: OnboardingState; dispatch: Dispatch<OnboardingAction> } | null>(null);
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}
export function useOnboarding() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return v;
}
