import { colors } from './tokens.ts';
import type { ModeId } from './modes.ts';

/** A full look for one vibe: not just an accent but the whole mood (backgrounds, surfaces, borders, gradient). Dark themes, all readable. */
export interface ModeTheme {
  name: string;
  bg: string; bgTop: string; surface: string; surfaceRaised: string; border: string;
  /** Button gradient (accent → accent2). */
  accent: string; accent2: string;
  /** Bright colour for icons, selected chips, links and focus: readable on the cards. Usually the accent itself. */
  highlight: string;
  /** Text colour that is readable on a button filled with accent→accent2 (chosen automatically, see onAccentFor). */
  onAccent: string;
  /** Short line shown on the vibe picker. */
  mood: string;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lin = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (h: string): number => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG contrast ratio between two #rrggbb colours (1 to 21). Body text should reach 4.5. */
export const contrastRatio = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };

const WHITE = '#FFFFFF', INK = '#14101F';
/** White or near-black, whichever reads better on the WORSE of the two gradient ends. */
export function onAccentFor(a: string, b: string): string {
  const w = Math.min(contrastRatio(WHITE, a), contrastRatio(WHITE, b)), k = Math.min(contrastRatio(INK, a), contrastRatio(INK, b));
  return w >= k ? WHITE : INK;
}
const make = (name: string, mood: string, bg: string, bgTop: string, surface: string, surfaceRaised: string, border: string, accent: string, accent2: string, highlight = accent): ModeTheme =>
  ({ name, mood, bg, bgTop, surface, surfaceRaised, border, accent, accent2, highlight, onAccent: onAccentFor(accent, accent2) });

/** Used before a vibe is chosen (sign-in, onboarding) and for screens that are not about one vibe. */
export const NEUTRAL_THEME: ModeTheme = make('Waypoint', 'Where do you want to go?', colors.bg, '#1A1235', colors.surface, colors.surfaceRaised, '#3A3160', colors.ctaFrom, colors.ctaTo, colors.violet);

export const MODE_THEMES: Record<ModeId, ModeTheme> = {
  serious_dating: make('Rose', 'Warm, romantic, unhurried', '#1B0F26', '#3A1747', '#291639', '#35204B', '#52306B', '#EF4BA8', '#B36BFF'),
  hookups: make('Midnight', 'Bold, late-night, direct', '#1C0B12', '#3B0F22', '#2B1320', '#3A1A2B', '#5E2A43', '#FF4D6D', '#FF9F1C'),
  friendship: make('Ocean', 'Fresh, open, easygoing', '#0A1A22', '#0F3342', '#10262F', '#18343F', '#25505F', '#45D5E8', '#3B82F6'),
  post_marital: make('Lavender', 'Calm, grown-up, gentle', '#141425', '#2B2B57', '#1E1F38', '#292B4D', '#42456E', '#D6A5FF', '#9D7BFF'),
  experimentation: make('Neon', 'Curious, electric, playful', '#0D0C22', '#1B1450', '#161536', '#201E4A', '#3A3585', '#A855F7', '#22D3EE'),
  adventures: make('Ember', 'Warm, outdoorsy, energetic', '#1C130B', '#4A2A10', '#2A1D11', '#392916', '#5C4220', '#F59E0B', '#F97316'),
};
export const themeFor = (mode: ModeId | null | undefined): ModeTheme => (mode ? MODE_THEMES[mode] : NEUTRAL_THEME);
