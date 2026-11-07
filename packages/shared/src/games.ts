export const GAME_KINDS = ['would_you_rather', 'rapid_fire', 'finish_sentence', 'compatibility'] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export const GAME_ROUNDS = 5;   // the database accepts rounds 0-4

export interface GameRound { prompt: string; choices?: string[] }
export const GAME_LABELS: Record<GameKind, { title: string; blurb: string }> = {
  would_you_rather: { title: 'Would you rather', blurb: 'Pick one. See what they picked.' },
  rapid_fire: { title: 'Rapid fire', blurb: 'Quick one-line answers.' },
  finish_sentence: { title: 'Finish the sentence', blurb: 'Complete it any way you like.' },
  compatibility: { title: 'Compatibility', blurb: 'Light questions about how you live.' },
};

const BANK: Record<GameKind, GameRound[]> = {
  would_you_rather: [
    { prompt: 'Would you rather...', choices: ['Cook a big dinner at home', 'Try a new restaurant'] }, { prompt: 'Would you rather...', choices: ['Weekend trek', 'Weekend by the pool'] },
    { prompt: 'Would you rather...', choices: ['Plan everything', 'Wing it'] }, { prompt: 'Would you rather...', choices: ['Live music', 'A quiet cafe'] },
    { prompt: 'Would you rather...', choices: ['Early morning', 'Late night'] }, { prompt: 'Would you rather...', choices: ['Road trip', 'Flight to somewhere new'] },
    { prompt: 'Would you rather...', choices: ['Movie night in', 'A night out'] }, { prompt: 'Would you rather...', choices: ['Street food', 'Fine dining'] },
  ],
  rapid_fire: ['Your go-to comfort food?', 'A song you know every word of?', 'Best trip you have taken?', 'Morning person or night owl?', 'A skill you wish you had?', 'Favourite way to spend a Sunday?', 'Last thing that made you laugh out loud?', 'A place you could go back to again and again?']
    .map((prompt) => ({ prompt })),
  finish_sentence: ['I feel most myself when...', 'My ideal evening is...', 'Something small that makes my day is...', 'People are usually surprised that I...', 'I could talk for hours about...', 'The best advice I have been given is...', 'On a perfect day off I...', 'I am looking forward to...']
    .map((prompt) => ({ prompt })),
  compatibility: [
    { prompt: 'How do you like to spend free time?', choices: ['Out and about', 'A mix of both', 'Quiet at home'] }, { prompt: 'How planned is your week?', choices: ['Fully planned', 'Loosely planned', 'Go with the flow'] },
    { prompt: 'How often do you like to travel?', choices: ['Whenever I can', 'A few times a year', 'Rarely'] }, { prompt: 'How do you feel about spontaneous plans?', choices: ['Love them', 'Sometimes', 'Prefer notice'] },
    { prompt: 'How social are you?', choices: ['Very', 'Somewhat', 'Selective'] }, { prompt: 'How do you recharge?', choices: ['With people', 'Alone', 'Depends on the day'] },
    { prompt: 'How do you like to communicate?', choices: ['Chat often', 'A few good chats', 'Mostly in person'] }, { prompt: 'How important is fitness to you?', choices: ['Very', 'Moderately', 'Not a focus'] },
  ],
};

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/** Both players derive the same five questions from the session id, so nothing needs to be stored. */
export function pickRounds(kind: GameKind, sessionId: string): GameRound[] {
  const rnd = seeded(`${kind}:${sessionId}`);
  const pool = [...BANK[kind]];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  return pool.slice(0, GAME_ROUNDS);
}
