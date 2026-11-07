export type Availability = 'available_tonight' | 'open_to_chat' | 'meet_this_weekend' | 'virtual_coffee' | 'taking_a_break' | 'not_available' | string;

const AVAIL: Record<string, string> = {
  available_tonight: 'Available tonight', open_to_chat: 'Open to chatting', meet_this_weekend: 'Looking to meet this weekend', virtual_coffee: 'Up for a virtual coffee',
};
export const availabilityLabel = (a: Availability): string | null => AVAIL[a] ?? null;

export function distanceLabel(km: number | null): string | null {
  if (km === null || Number.isNaN(km)) return null;
  return km < 1 ? 'Less than 1 km away' : `${Math.round(km)} km away`;
}

/** Plain-language "why you might click". Never a number, never a score. */
export function cardReasons(c: { sharedInterests: string[]; distanceKm: number | null; availability: Availability; likesYou: boolean; modeLabel: string }): string[] {
  const out: string[] = [];
  if (c.likesYou) out.push('Likes you. Like them back to match');
  if (c.sharedInterests.length) out.push(`You both enjoy ${c.sharedInterests.slice(0, 3).join(', ')}`);
  out.push(`You're both open to ${c.modeLabel}`);
  const a = availabilityLabel(c.availability); if (a) out.push(a);
  const d = distanceLabel(c.distanceKm); if (d) out.push(d);
  return out;
}
