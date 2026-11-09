import { modeHas, themeFor } from '@sidequest/shared';
import type { Feature, ModeTheme } from '@sidequest/shared';
import { useModes } from '@/lib/modes';

/** The look of the vibe the person is in right now (the neutral Waypoint look before a vibe is chosen). Read at render time, so switching vibe restyles the app. */
export function useTheme(): ModeTheme {
  const { current } = useModes();
  return themeFor(current);
}

/** Is this feature part of the vibe the person is in? The database refuses some of them in the wrong vibe; this hides the rest. */
export function useFeature(feature: Feature): boolean {
  const { current } = useModes();
  return modeHas(current, feature);
}
