import { MODE_IDS } from './modes.ts';
import type { ModeId } from './modes.ts';

/**
 * Not every vibe has every feature. Discover, likes, chat, invitations, the calendar and ALL trust and safety tools
 * (reporting, blocking, verification, check-ins) are in every vibe and are not listed here.
 * The database enforces the five that take a vibe (open calls, roulette, double dates, games) through `mode_features`; a test keeps this table
 * and the migration identical. Circles, activities, wingperson and Together do not belong to one vibe in the database, so for those the app decides what to show.
 */
export const FEATURES = ['open_calls', 'activities', 'circles', 'roulette', 'double_dates', 'games', 'wingperson', 'together'] as const;
export type Feature = (typeof FEATURES)[number];

export const MODE_FEATURES: Record<ModeId, readonly Feature[]> = {
  serious_dating: ['activities', 'double_dates', 'games', 'wingperson', 'together'],
  hookups: [],
  friendship: ['open_calls', 'activities', 'circles', 'roulette', 'double_dates', 'games', 'wingperson'],
  post_marital: ['activities', 'circles', 'double_dates', 'games', 'wingperson', 'together'],
  experimentation: ['circles', 'games', 'together'],
  adventures: ['open_calls', 'activities', 'circles', 'roulette'],
};
export const modeHas = (mode: ModeId | null | undefined, feature: Feature): boolean => !!mode && MODE_FEATURES[mode].includes(feature);
/** Features the database refuses outside the right vibe. */
export const DB_ENFORCED_FEATURES: readonly Feature[] = ['open_calls', 'roulette', 'double_dates', 'games'];

export const FEATURE_LABEL: Record<Feature, { title: string; blurb: string }> = {
  open_calls: { title: 'Open calls', blurb: 'Invite a few people to do something together' },
  activities: { title: 'Activities', blurb: 'Plans and events near you' },
  circles: { title: 'Circles', blurb: 'Groups around an interest' },
  roulette: { title: 'Social Roulette', blurb: 'We seat you with a small group' },
  double_dates: { title: 'Double dates', blurb: 'Bring a friend, meet another pair' },
  games: { title: 'Chat games', blurb: 'Quick games to break the ice' },
  wingperson: { title: 'Wingperson', blurb: 'A friend who helps with your profile' },
  together: { title: 'Together', blurb: 'Link with a partner' },
};
/** What is in a vibe, for the vibe picker. */
export const modeFeatureList = (mode: ModeId): { title: string; blurb: string }[] => MODE_FEATURES[mode].map((f) => FEATURE_LABEL[f]);
export const ALWAYS_ON = ['Discover and likes', 'Chat and invitations', 'Verification, reporting, blocking and check-ins'] as const;
void MODE_IDS;
