import type { AvailabilityStatus, ModeId } from './modes.ts';
import { MODES } from './modes.ts';

export interface ModePresence {
  active: boolean;
  paused: boolean;
  discoverable: boolean;
  availability: AvailabilityStatus;
  /** Empty = open to any. */
  seekingGenders: string[];
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
}

export interface Person {
  userId: string;
  age: number;
  gender: string;
  interests: string[];
  modes: Partial<Record<ModeId, ModePresence>>;
}

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

const UNAVAILABLE: AvailabilityStatus[] = ['not_available', 'taking_a_break'];

function live(p: ModePresence | undefined): p is ModePresence {
  return !!p && p.active && !p.paused && p.discoverable && !UNAVAILABLE.includes(p.availability);
}

/** Both people must have opted into `mode`, be live in it, and satisfy each other's preferences. */
export function mutuallyEligible(a: Person, b: Person, mode: ModeId, distanceKm: number): Eligibility {
  if (a.userId === b.userId) return { eligible: false, reason: 'self' };
  const pa = a.modes[mode], pb = b.modes[mode];
  if (!live(pa) || !live(pb)) return { eligible: false, reason: 'not_live_in_mode' };
  const okGender = (seeking: string[], g: string) => seeking.length === 0 || seeking.includes(g);
  if (!okGender(pa.seekingGenders, b.gender) || !okGender(pb.seekingGenders, a.gender)) {
    return { eligible: false, reason: 'gender_preference' };
  }
  const okAge = (p: ModePresence, age: number) => age >= p.ageMin && age <= p.ageMax;
  if (!okAge(pa, b.age) || !okAge(pb, a.age)) return { eligible: false, reason: 'age_preference' };
  if (distanceKm > Math.min(pa.maxDistanceKm, pb.maxDistanceKm)) return { eligible: false, reason: 'distance' };
  return { eligible: true };
}

const AVAIL_TEXT: Partial<Record<AvailabilityStatus, string>> = {
  available_tonight: 'Available tonight',
  open_to_chat: 'Open to chatting',
  meet_this_weekend: 'Looking to meet this weekend',
  virtual_coffee: 'Up for a virtual coffee',
};

export interface Explanation { reasons: string[]; rank: number }

/** Human-readable reasons. `rank` is for ordering only and must never be shown as a score. */
export function explainCompatibility(a: Person, b: Person, mode: ModeId, distanceKm: number): Explanation {
  const reasons: string[] = [];
  const mine = new Set(a.interests.map((s) => s.toLowerCase()));
  const shared = b.interests.filter((s) => mine.has(s.toLowerCase())).slice(0, 3);
  if (shared.length) reasons.push(`You both enjoy ${shared.join(', ')}`);
  reasons.push(`You're both open to ${MODES[mode].label}`);
  reasons.push(distanceKm < 1 ? 'Very close by' : `About ${Math.round(distanceKm)} km away`);
  const avail = AVAIL_TEXT[b.modes[mode]?.availability ?? 'not_available'];
  if (avail) reasons.push(avail);
  let rank = shared.length * 10 + Math.max(0, 20 - distanceKm);
  if (b.modes[mode]?.availability === 'available_tonight') rank += 15;
  return { reasons, rank };
}
