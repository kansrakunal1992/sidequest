import type { ModeId } from './modes.ts';

export type Energy = 'chill' | 'flirty' | 'adventurous' | 'social';
export interface RouletteSignup {
  userId: string;
  mode: ModeId;
  activity: string;
  slot: string;
  energy: Energy;
  groupSize: number;
  blockedUserIds: string[];
}
export interface RouletteGroup { key: string; memberIds: string[] }

const blocked = (a: RouletteSignup, b: RouletteSignup) =>
  a.blockedUserIds.includes(b.userId) || b.blockedUserIds.includes(a.userId);

/**
 * First-come, first-served greedy grouping inside (mode, activity, slot, size) buckets.
 * Nobody is grouped with someone they blocked or who blocked them. Leftovers are waitlisted.
 * Heuristic, not an optimal matcher; swap for a smarter one later without changing the shape.
 */
export function assembleRouletteGroups(signups: RouletteSignup[]): { groups: RouletteGroup[]; waitlist: string[] } {
  const buckets = new Map<string, RouletteSignup[]>();
  const seen = new Set<string>();
  for (const s of signups) {
    if (s.groupSize < 2) continue;
    const key = `${s.mode}|${s.activity}|${s.slot}|${s.groupSize}`;
    const dedupe = `${key}|${s.userId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(s);
  }
  const groups: RouletteGroup[] = [];
  const waitlist: string[] = [];
  for (const [key, list] of buckets) {
    let rest = [...list];
    while (rest.length) {
      const seed = rest[0]!;
      const members = [seed];
      for (const c of rest.slice(1)) {
        if (members.length >= seed.groupSize) break;
        if (members.every((m) => !blocked(m, c))) members.push(c);
      }
      if (members.length === seed.groupSize) {
        groups.push({ key, memberIds: members.map((m) => m.userId) });
        rest = rest.filter((r) => !members.includes(r));
      } else {
        waitlist.push(seed.userId);
        rest = rest.slice(1);
      }
    }
  }
  return { groups, waitlist };
}

/** Area text is free-form, so it is normalised before it is used to keep people in different places apart. */
export const rouletteAreaKey = (area: string): string => area.toLowerCase().replace(/[|@]/g, ' ').replace(/\s+/g, ' ').trim();

/** The grouping matcher only sees `activity`, so the area is folded into it: people in different areas never share a bucket. */
export const withRouletteArea = (activity: string, area: string): string => `${activity}@${rouletteAreaKey(area)}`;

/** Inverse of withRouletteArea. The area is whatever follows the LAST '@' (activity text may itself contain '@'). */
export function splitRouletteActivity(value: string): { activity: string; area: string | null } {
  const i = value.lastIndexOf('@');
  return i < 0 ? { activity: value, area: null } : { activity: value.slice(0, i), area: value.slice(i + 1) };
}

/**
 * Reads a group key of the form `mode|activity@area|slot` or `mode|activity@area|slot|size`.
 * The activity is free text and may contain '|', so it is read between the first and the last fixed fields.
 */
export function parseRouletteKey(key: string): { mode: string; activity: string; area: string | null; slot: string; groupSize: number | null } | null {
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const isDate = (v: string | undefined) => v !== undefined && Number.isFinite(Date.parse(v));
  let end = parts.length;
  let groupSize: number | null = null;
  if (parts.length >= 4 && /^\d{1,2}$/.test(parts[end - 1]!) && isDate(parts[end - 2])) { groupSize = Number(parts[end - 1]); end -= 1; }
  const slot = parts[end - 1];
  if (!isDate(slot) || end - 1 < 2) return null;
  const { activity, area } = splitRouletteActivity(parts.slice(1, end - 1).join('|'));
  if (!activity) return null;
  return { mode: parts[0]!, activity, area, slot: slot!, groupSize };
}
