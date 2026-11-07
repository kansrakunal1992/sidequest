export type SwipeAction = 'like' | 'spark' | 'pass';
export interface Deck<T extends { userId: string }> {
  queue: T[];
  history: { card: T; action: SwipeAction; matched: boolean }[];
}

export const createDeck = <T extends { userId: string }>(cards: T[] = []): Deck<T> => appendCards({ queue: [], history: [] }, cards);

/** Adds new cards at the back, skipping anyone already queued or already swiped this session. */
export function appendCards<T extends { userId: string }>(d: Deck<T>, cards: T[]): Deck<T> {
  const seen = new Set([...d.queue.map((c) => c.userId), ...d.history.map((h) => h.card.userId)]);
  const fresh: T[] = [];
  for (const c of cards) if (!seen.has(c.userId)) { seen.add(c.userId); fresh.push(c); }
  return { ...d, queue: [...d.queue, ...fresh] };
}

export function swipe<T extends { userId: string }>(d: Deck<T>, action: SwipeAction, matched = false): Deck<T> {
  const [top, ...rest] = d.queue;
  if (!top) return d;
  return { queue: rest, history: [...d.history, { card: top, action, matched }] };
}

/** A match involves someone else's choice, so it cannot be rewound. Everything else can. */
export const canRewind = <T extends { userId: string }>(d: Deck<T>): boolean => d.history.length > 0 && !d.history[d.history.length - 1]!.matched;

export function rewind<T extends { userId: string }>(d: Deck<T>): { deck: Deck<T>; undo: { userId: string; action: SwipeAction } | null } {
  if (!canRewind(d)) return { deck: d, undo: null };
  const last = d.history[d.history.length - 1]!;
  return { deck: { queue: [last.card, ...d.queue], history: d.history.slice(0, -1) }, undo: { userId: last.card.userId, action: last.action } };
}

export const needsMore = <T extends { userId: string }>(d: Deck<T>, threshold = 5): boolean => d.queue.length <= threshold;

/** The like turned out to be mutual: remember it so it cannot be rewound. */
export function markMatched<T extends { userId: string }>(d: Deck<T>, userId: string): Deck<T> {
  return { ...d, history: d.history.map((h) => (h.card.userId === userId ? { ...h, matched: true } : h)) };
}
