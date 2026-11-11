import { DATE_IDEA_LIMIT, FREE_WINDOWS, MEET_ACTIVITIES, freeWindowLabel, isFreeWindow, isMeetActivity, meetActivityLabel, sharedDateIdeas } from '@sidequest/shared';
import type { FreeWindowId, MeetActivityId } from '@sidequest/shared';

/** Date Ideas as the app uses them: a few activities and a broad "usually free" window. */
export interface DateIdeas { ideas: MeetActivityId[]; freeWindow: FreeWindowId | null }
export const EMPTY_IDEAS: DateIdeas = { ideas: [], freeWindow: null };

/** Rows come from the database as snake_case. Anything unknown is dropped, so a newer or older app version never shows junk. */
export function mapDateIdeas(r: { ideas?: unknown; free_window?: unknown } | null | undefined): DateIdeas {
  if (!r) return EMPTY_IDEAS;
  const ideas = Array.isArray(r.ideas) ? (r.ideas.filter(isMeetActivity) as MeetActivityId[]).slice(0, DATE_IDEA_LIMIT) : [];
  return { ideas, freeWindow: isFreeWindow(r.free_window) ? r.free_window : null };
}

/** Add or remove an idea, keeping at most DATE_IDEA_LIMIT. When full, a new pick is ignored (the screen says why). */
export function toggleIdea(current: readonly MeetActivityId[], id: MeetActivityId): MeetActivityId[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  return current.length >= DATE_IDEA_LIMIT ? [...current] : [...current, id];
}
export const isFull = (current: readonly string[]): boolean => current.length >= DATE_IDEA_LIMIT;

/** "Chai or coffee, A walk. Free weekends" for a short line; null when there is nothing to show. */
export function ideasSummary(d: DateIdeas): string | null {
  const parts: string[] = [];
  if (d.ideas.length) parts.push(d.ideas.map(meetActivityLabel).join(', '));
  const w = freeWindowLabel(d.freeWindow);
  if (w) parts.push(`Free: ${w.toLowerCase()}`);
  return parts.length ? parts.join('. ') : null;
}

/** Ideas you both listed, in your order, as readable labels. */
export const youBothLike = (mine: readonly string[], theirs: readonly string[]): MeetActivityId[] => sharedDateIdeas(mine, theirs).filter(isMeetActivity);

export { DATE_IDEA_LIMIT, FREE_WINDOWS, MEET_ACTIVITIES };
