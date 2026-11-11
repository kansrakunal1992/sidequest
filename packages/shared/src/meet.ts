/**
 * Let's Meet (in-person plans) and Date Ideas: the rules the app, the API and the database share.
 * The database function set_date_ideas() holds the same activity and window lists; a test keeps them identical.
 */

/** Things people can plan to do, and can list on their profile as Date Ideas. `minutes` is the usual length. */
export const MEET_ACTIVITIES = [
  { id: 'chai_coffee', label: 'Chai or coffee', icon: 'cafe', minutes: 60 },
  { id: 'walk', label: 'A walk', icon: 'walk', minutes: 60 },
  { id: 'meal', label: 'Lunch or dinner', icon: 'restaurant', minutes: 90 },
  { id: 'street_food', label: 'Street food', icon: 'fast-food', minutes: 60 },
  { id: 'live_music', label: 'Live music', icon: 'musical-notes', minutes: 120 },
  { id: 'movie', label: 'A movie', icon: 'film', minutes: 150 },
  { id: 'museum', label: 'Museum or gallery', icon: 'color-palette', minutes: 90 },
  { id: 'board_games', label: 'Board games', icon: 'dice', minutes: 90 },
  { id: 'comedy', label: 'Comedy night', icon: 'happy', minutes: 120 },
  { id: 'bowling', label: 'Bowling or games', icon: 'baseball', minutes: 90 },
  { id: 'sports', label: 'Play a sport', icon: 'football', minutes: 90 },
  { id: 'market', label: 'Market or bookshop', icon: 'book', minutes: 60 },
  { id: 'trivia', label: 'Trivia night', icon: 'help-circle', minutes: 120 },
] as const;
export type MeetActivityId = (typeof MEET_ACTIVITIES)[number]['id'];

export const isMeetActivity = (id: unknown): id is MeetActivityId => typeof id === 'string' && MEET_ACTIVITIES.some((a) => a.id === id);
export const meetActivityLabel = (id: string | null | undefined): string => MEET_ACTIVITIES.find((a) => a.id === id)?.label ?? 'Meet up';
export const meetActivity = (id: string | null | undefined) => MEET_ACTIVITIES.find((a) => a.id === id) ?? null;

/** How many Date Ideas a person can list. Few on purpose: it is a nudge, not a questionnaire. */
export const DATE_IDEA_LIMIT = 3;

/** Broad, lasting availability (it does not go stale like "this weekend"). */
export const FREE_WINDOWS = [
  { id: 'weekday_evenings', label: 'Weekday evenings' },
  { id: 'weekends', label: 'Weekends' },
  { id: 'flexible', label: 'Flexible' },
] as const;
export type FreeWindowId = (typeof FREE_WINDOWS)[number]['id'];
export const isFreeWindow = (id: unknown): id is FreeWindowId => typeof id === 'string' && FREE_WINDOWS.some((w) => w.id === id);
export const freeWindowLabel = (id: string | null | undefined): string | null => FREE_WINDOWS.find((w) => w.id === id)?.label ?? null;

export const PLACE_MIN = 2;
export const PLACE_MAX = 80;

/** True when text looks like it carries a phone number, e-mail, web link or handle. Used to keep contact details out of plans. */
export function hasContactDetails(text: string): boolean {
  if (/@|https?:|www\.|\.com\b|\.in\b|wa\.me/i.test(text)) return true;
  return /\d{7,}/.test(text.replace(/[\s().+-]/g, ''));
}

export type PlaceResult = { ok: true; venueName: string; areaLabel: string } | { ok: false; error: 'venue_required' | 'area_required' | 'place_too_long' | 'place_contact_details' };

/** A plan needs a named place and a neighbourhood. No exact addresses are collected, and no contact details are allowed. */
export function validateMeetPlace(venue: unknown, area: unknown): PlaceResult {
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const venueName = clean(venue), areaLabel = clean(area);
  if (venueName.length < PLACE_MIN) return { ok: false, error: 'venue_required' };
  if (areaLabel.length < PLACE_MIN) return { ok: false, error: 'area_required' };
  if (venueName.length > PLACE_MAX || areaLabel.length > PLACE_MAX) return { ok: false, error: 'place_too_long' };
  if (hasContactDetails(venueName) || hasContactDetails(areaLabel)) return { ok: false, error: 'place_contact_details' };
  return { ok: true, venueName, areaLabel };
}

/** Plain wording for each place error, for the app. */
export const PLACE_ERROR_TEXT: Record<Exclude<PlaceResult, { ok: true }>['error'], string> = {
  venue_required: 'Name the place, for example a cafe or a market.',
  area_required: 'Add the neighbourhood or area.',
  place_too_long: 'Keep the place and area under 80 characters each.',
  place_contact_details: 'Please leave phone numbers, links and handles out of the place. You can chat inside Waypoint.',
};

/** An in-person plan needs at least this much notice, so the other person has time to answer and tell a friend. */
export const IN_PERSON_MIN_LEAD_MINUTES = 60;

/** Short, calm safety tips shown when planning a first meeting. */
export const FIRST_MEET_TIPS = [
  'Pick a busy public place for a first meeting.',
  'Tell a friend where you will be. You can share the plan in one tap.',
  'Make your own way there and back, and leave whenever you want to.',
] as const;

/** Ideas both people listed, in the order of `mine`. */
export function sharedDateIdeas(mine: readonly string[], theirs: readonly string[]): string[] {
  const t = new Set(theirs);
  return mine.filter((i) => t.has(i));
}

export const meetTitle = (activityId: string | null | undefined, name: string): string => `${meetActivityLabel(activityId)} with ${name}`;

/**
 * The note a person can send to a friend so someone knows where they will be.
 * It names the place and time only: no phone number, no photo, nothing about the other person except the first name they gave.
 */
export function buildPlanShareText(p: { name: string; activityId: string | null | undefined; venueName: string; areaLabel: string; whenText: string; durationMinutes: number }): string {
  const first = p.name.trim().split(/\s+/)[0] || 'someone';
  return `Heads up: I am meeting ${first} for ${meetActivityLabel(p.activityId).toLowerCase()} at ${p.venueName}, ${p.areaLabel} on ${p.whenText} (about ${p.durationMinutes} minutes). Planned on Waypoint. I will let you know I am home safe.`;
}
