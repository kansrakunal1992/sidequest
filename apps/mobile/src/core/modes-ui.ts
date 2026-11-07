import { MODES } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';

/** Tile order and icons follow the brand reference. Icon names are Ionicons. */
export const MODE_TILES: { id: ModeId; icon: string; blurb: string }[] = [
  { id: 'serious_dating', icon: 'heart', blurb: MODES.serious_dating.tagline },
  { id: 'hookups', icon: 'flash', blurb: MODES.hookups.tagline },
  { id: 'friendship', icon: 'people', blurb: MODES.friendship.tagline },
  { id: 'adventures', icon: 'rocket', blurb: MODES.adventures.tagline },
  { id: 'post_marital', icon: 'diamond-outline', blurb: MODES.post_marital.tagline },
  { id: 'experimentation', icon: 'flask', blurb: MODES.experimentation.tagline },
];

export const ENERGY_LABELS = { chill: 'Chill', flirty: 'Flirty', adventurous: 'Adventurous', social: 'Social' } as const;
