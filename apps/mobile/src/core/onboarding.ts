import { MODE_IDS, ageOn, isAdult } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';

export const GENDERS = ['woman', 'man', 'non_binary', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const ENERGIES = ['chill', 'flirty', 'adventurous', 'social'] as const;
export type Energy = (typeof ENERGIES)[number];
export const SUGGESTED_INTERESTS = [
  'Food', 'Coffee', 'Trekking', 'Travel', 'Music', 'Movies', 'Board games', 'Fitness', 'Cricket', 'Football',
  'Photography', 'Art', 'Reading', 'Cooking', 'Dancing', 'Comedy', 'Gaming', 'Yoga', 'Road trips', 'Tech',
] as const;

export const LIMITS = { interestsMin: 3, interestsMax: 12, photosMax: 6, bioMax: 600, nameMin: 2, nameMax: 40, interestMax: 30 } as const;

export interface OnboardingState {
  dob: string;                   // YYYY-MM-DD
  displayName: string;
  gender: Gender | null;
  city: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  modes: ModeId[];
  energy: Energy | null;
  interests: string[];
  bio: string;
  photos: { uri: string }[];
  seeking: Gender[];             // empty = open to anyone
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
  acceptsIntros: boolean;
  incognito: boolean;
  discoverable: boolean;
  appearInVisitorLists: boolean;
}

export const initialOnboarding: OnboardingState = {
  dob: '', displayName: '', gender: null, city: '', neighborhood: '', lat: null, lng: null,
  modes: [], energy: null, interests: [], bio: '', photos: [], seeking: [], ageMin: 18, ageMax: 60, maxDistanceKm: 25,
  acceptsIntros: true, incognito: false, discoverable: true, appearInVisitorLists: true,
};

export type OnboardingAction =
  | { type: 'set'; patch: Partial<OnboardingState> }
  | { type: 'toggleMode'; mode: ModeId }
  | { type: 'toggleInterest'; interest: string }
  | { type: 'toggleSeeking'; gender: Gender }
  | { type: 'addPhotos'; uris: string[] }
  | { type: 'removePhoto'; index: number }
  | { type: 'reset' };

export const normalizeInterest = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, LIMITS.interestMax);

export function onboardingReducer(state: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'set': return { ...state, ...a.patch };
    case 'toggleMode':
      return { ...state, modes: state.modes.includes(a.mode) ? state.modes.filter((m) => m !== a.mode) : [...state.modes, a.mode] };
    case 'toggleInterest': {
      const v = normalizeInterest(a.interest);
      if (!v) return state;
      const has = state.interests.find((i) => i.toLowerCase() === v.toLowerCase());
      if (has) return { ...state, interests: state.interests.filter((i) => i !== has) };
      if (state.interests.length >= LIMITS.interestsMax) return state;
      return { ...state, interests: [...state.interests, v] };
    }
    case 'toggleSeeking':
      return { ...state, seeking: state.seeking.includes(a.gender) ? state.seeking.filter((g) => g !== a.gender) : [...state.seeking, a.gender] };
    case 'addPhotos': {
      const have = new Set(state.photos.map((p) => p.uri));
      const next = [...state.photos];
      for (const uri of a.uris) if (!have.has(uri) && next.length < LIMITS.photosMax) { next.push({ uri }); have.add(uri); }
      return { ...state, photos: next };
    }
    case 'removePhoto': return { ...state, photos: state.photos.filter((_, i) => i !== a.index) };
    case 'reset': return initialOnboarding;
  }
}

export const STEPS = ['age', 'basics', 'vibe', 'energy', 'interests', 'photos', 'preferences'] as const;
export type Step = (typeof STEPS)[number];

/** Names are shown to strangers, so they must not smuggle in contact details. */
export function nameProblem(raw: string): string | null {
  const n = raw.trim();
  if (n.length < LIMITS.nameMin) return `Your name needs at least ${LIMITS.nameMin} characters.`;
  if (n.length > LIMITS.nameMax) return `Keep your name under ${LIMITS.nameMax} characters.`;
  if (/@|https?:|www\.|\.com\b/i.test(n) || /\d{6,}/.test(n.replace(/[\s-]/g, ''))) return 'Please leave contact details out of your name. You can chat inside Waypoint.';
  return null;
}

export function validateStep(step: Step, s: OnboardingState, now: Date): string[] {
  const e: string[] = [];
  switch (step) {
    case 'age': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dob)) { e.push('Enter your date of birth as day, month and year.'); break; }
      let age: number;
      try { age = ageOn(s.dob, now); } catch { e.push('That date does not look right.'); break; }
      if (age > 110) e.push('That date does not look right.');
      else if (!isAdult(s.dob, now)) e.push('Waypoint is for adults. You need to be 18 or over.');
      break;
    }
    case 'basics': {
      const n = nameProblem(s.displayName); if (n) e.push(n);
      if (!s.gender) e.push('Choose how you describe yourself.');
      if (s.city.trim().length < 2) e.push('Tell us your city.');
      break;
    }
    case 'vibe': if (s.modes.length < 1) e.push('Pick at least one vibe. You can change it any time.'); break;
    case 'energy': break; // optional
    case 'interests':
      if (s.interests.length < LIMITS.interestsMin) e.push(`Pick at least ${LIMITS.interestsMin} interests.`);
      if (s.bio.length > LIMITS.bioMax) e.push(`Keep your bio under ${LIMITS.bioMax} characters.`);
      break;
    case 'photos':
      if (s.photos.length < 1) e.push('Add at least one photo.');
      break;
    case 'preferences':
      if (s.ageMin < 18) e.push('Minimum age cannot be below 18.');
      if (s.ageMax < s.ageMin) e.push('Maximum age must be at least the minimum age.');
      if (s.ageMax > 99) e.push('Maximum age cannot be above 99.');
      if (s.maxDistanceKm < 1 || s.maxDistanceKm > 200) e.push('Distance must be between 1 and 200 km.');
      break;
  }
  return e;
}

export const canAdvance = (step: Step, s: OnboardingState, now: Date) => validateStep(step, s, now).length === 0;
export const firstInvalidStep = (s: OnboardingState, now: Date): Step | null => STEPS.find((st) => !canAdvance(st, s, now)) ?? null;
export const nextStep = (step: Step): Step | null => STEPS[STEPS.indexOf(step) + 1] ?? null;
export const prevStep = (step: Step): Step | null => STEPS[STEPS.indexOf(step) - 1] ?? null;

/** Shape expected by the save_onboarding() database function. Photos are uploaded separately. */
export function buildSavePayload(s: OnboardingState, timezone: string, now: Date) {
  const bad = firstInvalidStep(s, now);
  if (bad) throw new Error(`Onboarding is incomplete at step "${bad}"`);
  for (const m of s.modes) if (!(MODE_IDS as readonly string[]).includes(m)) throw new Error(`Unknown mode ${m}`);
  return {
    display_name: s.displayName.trim(),
    date_of_birth: s.dob,
    gender: s.gender,
    city: s.city.trim(),
    neighborhood: s.neighborhood.trim() || null,
    bio: s.bio.trim() || null,
    interests: s.interests,
    timezone,
    accepts_intro_invites: s.acceptsIntros,
    incognito: s.incognito,
    lat: s.lat, lng: s.lng,   // snapped to ~1 km by the server; never stored exactly
    lifestyle: s.energy ? { energy_tonight: s.energy, energy_set_at: now.toISOString() } : {},
    modes: s.modes.map((mode_id) => ({
      mode_id, discoverable: s.discoverable, appear_in_visitor_lists: s.appearInVisitorLists,
      seeking_genders: s.seeking, age_min: s.ageMin, age_max: s.ageMax, max_distance_km: s.maxDistanceKm,
    })),
  };
}
