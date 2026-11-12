// Progressive reveal: instead of a tour, show ONE useful next step at a time, only when it matters, and never again once done.
// Order matters: the first unfinished step is the one the Discover banner shows.

export type StepId = 'verify' | 'photos' | 'intro';
export interface StepInput {
  verified: boolean;
  verificationAvailable: boolean;   // the server has the selfie check switched on
  approvedPhotos: number;
  totalPhotos: number;
  hasIntro: boolean;                // a headline or intro for the current vibe, or a general bio
}
export interface Step { id: StepId; title: string; why: string; cta: string; route: string; done: boolean }

export const RECOMMENDED_PHOTOS = 3;

export function gettingStartedSteps(i: StepInput): Step[] {
  const steps: Step[] = [
    { id: 'verify', done: i.verified || !i.verificationAvailable, title: 'Get your free Photo verified badge',
      why: 'Takes about a minute. People trust verified profiles more, and it costs nothing.', cta: 'Verify now', route: '/safety/verify' },
    { id: 'photos', done: i.totalPhotos >= RECOMMENDED_PHOTOS, title: `Add ${RECOMMENDED_PHOTOS} or more photos`,
      why: i.totalPhotos === 0 ? 'Profiles with photos get far more replies.' : `You have ${i.totalPhotos}. A few more helps people get a feel for you.`, cta: 'Add photos', route: '/edit-profile' },
    { id: 'intro', done: i.hasIntro, title: 'Say a little about yourself',
      why: 'One line is enough. It gives people something to start a chat with.', cta: 'Write it', route: '/edit-profile' },
  ];
  return steps;
}

export const nextStep = (steps: Step[]): Step | null => steps.find((s) => !s.done) ?? null;
export const progress = (steps: Step[]) => ({ done: steps.filter((s) => s.done).length, total: steps.length });

/** Dismissal is remembered per person for a week, then the banner may come back if something is still undone. */
export const DISMISS_DAYS = 7;
export function bannerVisible(step: Step | null, dismissedAt: number | null, now: number): boolean {
  if (!step) return false;
  if (dismissedAt === null) return true;
  return now - dismissedAt > DISMISS_DAYS * 86_400_000;
}
