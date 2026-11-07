export const PROMPT_QUESTIONS = [
  'My ideal unexpected Sunday...',
  'Something I could talk about for hours...',
  "One thing people wouldn't guess about me...",
  'My most unusual opinion...',
  'An experience I want to try...',
  'The best plan I ever made on a whim...',
  "I'm happiest when...",
] as const;
export interface PromptAnswer { q: string; a: string }
export const PROMPT_LIMITS = { maxPrompts: 3, answerMax: 200, headlineMax: 120, bioMax: 600 } as const;

export function validateModeText(t: { headline: string; bio: string; prompts: PromptAnswer[] }): string[] {
  const e: string[] = [];
  if (t.headline.length > PROMPT_LIMITS.headlineMax) e.push(`Keep your headline under ${PROMPT_LIMITS.headlineMax} characters.`);
  if (t.bio.length > PROMPT_LIMITS.bioMax) e.push(`Keep your intro under ${PROMPT_LIMITS.bioMax} characters.`);
  if (t.prompts.length > PROMPT_LIMITS.maxPrompts) e.push(`Choose at most ${PROMPT_LIMITS.maxPrompts} prompts.`);
  const qs = t.prompts.map((p) => p.q);
  if (new Set(qs).size !== qs.length) e.push('Each prompt can only be used once.');
  for (const p of t.prompts) {
    if (!(PROMPT_QUESTIONS as readonly string[]).includes(p.q)) e.push('Unknown prompt.');
    if (p.a.trim().length === 0) e.push('Write an answer, or remove the prompt.');
    if (p.a.length > PROMPT_LIMITS.answerMax) e.push(`Keep each answer under ${PROMPT_LIMITS.answerMax} characters.`);
  }
  return [...new Set(e)];
}

/** Drops blank answers and trims, so the server never stores empty prompts. */
export const cleanPrompts = (ps: PromptAnswer[]): PromptAnswer[] =>
  ps.map((p) => ({ q: p.q, a: p.a.trim() })).filter((p) => p.a.length > 0).slice(0, PROMPT_LIMITS.maxPrompts);
