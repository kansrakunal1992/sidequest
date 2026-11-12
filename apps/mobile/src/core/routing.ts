export interface RouteInputs {
  /** false until the stored session has been read from the device. */
  sessionLoaded: boolean;
  signedIn: boolean;
  /** undefined while loading, null if the user has no profile row yet. */
  profile: { onboardingComplete: boolean; state: string } | null | undefined;
}
export type Route = 'loading' | '/(auth)/welcome' | '/(onboarding)/age' | '/(tabs)/discover' | '/account-restricted';

/** Top-level routes added with Circles, safety, notifications and games. Notification routes (core/inbox-core.ts) are tested against this list. */
export const NEW_SCREEN_SEGMENTS = ['circle', 'teams', 'roulette', 'double-date', 'safety', 'notifications', 'game'] as const;

export function decideRoute(i: RouteInputs): Route {
  if (!i.sessionLoaded) return 'loading';
  if (!i.signedIn) return '/(auth)/welcome';
  if (i.profile === undefined) return 'loading';
  if (i.profile === null) return '/(onboarding)/age';
  if (i.profile.state === 'suspended' || i.profile.state === 'banned' || i.profile.state === 'deleted') return '/account-restricted';
  return i.profile.onboardingComplete ? '/(tabs)/discover' : '/(onboarding)/age';
}

/** Top-level route groups a signed-in person may be in without being redirected. */
export function allowedSegments(route: Exclude<Route, 'loading'>): string[] {
  switch (route) {
    case '/(auth)/welcome': return ['(auth)'];
    case '/(onboarding)/age': return ['(onboarding)'];
    case '/(tabs)/discover': return ['(tabs)', 'person', 'likes', 'edit-profile', 'my-profile', 'call', 'chat', 'invite', 'open-call', 'activity', ...NEW_SCREEN_SEGMENTS];
    case '/account-restricted': return ['account-restricted'];
  }
}
