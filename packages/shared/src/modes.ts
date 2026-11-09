export const MODE_IDS = [
  'serious_dating',
  'hookups',
  'friendship',
  'post_marital',
  'experimentation',
  'adventures',
] as const;
export type ModeId = (typeof MODE_IDS)[number];

export type AvailabilityStatus =
  | 'available_tonight'
  | 'open_to_chat'
  | 'meet_this_weekend'
  | 'virtual_coffee'
  | 'taking_a_break'
  | 'not_available';

export interface ContactRule {
  /** Free-form chat requires a mutual match. */
  requiresMatchForChat: boolean;
  /** A controlled intro invitation may be sent before matching. */
  introInviteWithoutMatch: boolean;
  /** Romantic or sexual intent is allowed in this mode. */
  romanticAllowed: boolean;
}

export interface ModeConfig {
  id: ModeId;
  label: string;
  tagline: string;
  tint: string;
  accent: string;
  contact: ContactRule;
}

export const MODES: Record<ModeId, ModeConfig> = {
  serious_dating: {
    id: 'serious_dating', label: 'Dating', tagline: 'Something meaningful',
    tint: '#412B5D', accent: '#EF4BA8',
    contact: { requiresMatchForChat: true, introInviteWithoutMatch: true, romanticAllowed: true },
  },
  hookups: {
    id: 'hookups', label: 'Casual', tagline: 'Easygoing, low pressure',
    tint: '#692D4B', accent: '#FACC15',
    contact: { requiresMatchForChat: true, introInviteWithoutMatch: true, romanticAllowed: true },
  },
  friendship: {
    id: 'friendship', label: 'Friendship', tagline: 'Meet awesome people',
    tint: '#203340', accent: '#45D5E8',
    contact: { requiresMatchForChat: true, introInviteWithoutMatch: true, romanticAllowed: false },
  },
  post_marital: {
    id: 'post_marital', label: 'Post-Marital', tagline: 'Continue the journey',
    tint: '#3E2443', accent: '#D6A5FF',
    contact: { requiresMatchForChat: true, introInviteWithoutMatch: true, romanticAllowed: true },
  },
  experimentation: {
    id: 'experimentation', label: 'Explore', tagline: 'Try something new',
    tint: '#3E2A43', accent: '#A855F7',
    contact: { requiresMatchForChat: true, introInviteWithoutMatch: false, romanticAllowed: true },
  },
  adventures: {
    id: 'adventures', label: 'Adventures', tagline: 'Do more together',
    tint: '#4C3227', accent: '#F59E0B',
    contact: { requiresMatchForChat: false, introInviteWithoutMatch: true, romanticAllowed: false },
  },
};

export type ContactKind = 'free_chat' | 'intro_invite' | 'activity_join';

export interface ContactInput {
  mode: ModeId;
  kind: ContactKind;
  matched: boolean;
  /** Either direction. */
  blocked: boolean;
  senderActiveInMode: boolean;
  recipientActiveInMode: boolean;
  recipientAcceptsIntros: boolean;
}

export type ContactDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Reasons are deliberately generic so a block is never revealed to the blocked person.
 */
export function canStartContact(i: ContactInput): ContactDecision {
  if (i.blocked) return { allowed: false, reason: 'unavailable' };
  if (!i.senderActiveInMode || !i.recipientActiveInMode) return { allowed: false, reason: 'not_in_mode' };
  const rule = MODES[i.mode].contact;
  switch (i.kind) {
    case 'activity_join':
      return { allowed: true };
    case 'free_chat':
      return rule.requiresMatchForChat && !i.matched
        ? { allowed: false, reason: 'needs_match' }
        : { allowed: true };
    case 'intro_invite':
      if (i.matched) return { allowed: true };
      if (!rule.introInviteWithoutMatch) return { allowed: false, reason: 'needs_match' };
      return i.recipientAcceptsIntros ? { allowed: true } : { allowed: false, reason: 'unavailable' };
  }
}
