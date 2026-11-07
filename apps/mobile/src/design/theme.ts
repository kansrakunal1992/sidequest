import { colors, fontSizes, radius, spacing } from '@sidequest/shared';
import { MODES } from '@sidequest/shared';

export { colors, fontSizes, radius, spacing, MODES };
export const gradients = {
  cta: [colors.ctaFrom, colors.ctaTo] as const,
  brand: [colors.primary, colors.pink] as const,
  sunset: ['#2B1055', '#7A2E8E', '#E0507A'] as const,
  night: ['#1A1235', colors.bg] as const,
};
export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };
