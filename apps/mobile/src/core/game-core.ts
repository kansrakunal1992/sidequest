import { GAME_KINDS, GAME_ROUNDS, pickRounds } from '@sidequest/shared';
import type { GameKind, GameRound } from '@sidequest/shared';
import type { GamePlayerRow, GameResponseRow, GameSessionRow } from './db-types';

export const isGameKind = (k: string): k is GameKind => (GAME_KINDS as readonly string[]).includes(k);
export type GamePhase = 'respond' | 'waiting_accept' | 'play' | 'waiting_partner' | 'finished' | 'declined' | 'unknown';
export interface RevealedRound { round: number; prompt: string; choices?: string[]; mine: string; theirs: string | null }
export interface GameView { phase: GamePhase; round: number; rounds: GameRound[]; revealed: RevealedRound[]; matches: number | null; compared: number }

/** An answer is stored as JSON: a string for free text, or `{choice: n}` for pick-one rounds. This turns either into what to show. */
export function answerText(a: unknown, round: GameRound | undefined): string {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    const o = a as { text?: unknown; choice?: unknown };
    if (typeof o.choice === 'number' && round?.choices?.[o.choice] !== undefined) return round.choices[o.choice]!;
    if (typeof o.text === 'string') return o.text;
  }
  return '';
}
export const buildAnswer = (round: GameRound, v: { choice?: number; text?: string }): unknown =>
  round.choices ? { choice: v.choice } : { text: (v.text ?? '').trim().slice(0, 200) };
export function answerValid(round: GameRound, v: { choice?: number; text?: string }): boolean {
  if (round.choices) return Number.isInteger(v.choice) && v.choice! >= 0 && v.choice! < round.choices.length;
  return (v.text ?? '').trim().length >= 1;
}

export function gameView(session: GameSessionRow, players: GamePlayerRow[], responses: GameResponseRow[], me: string): GameView {
  const empty = { round: 0, rounds: [] as GameRound[], revealed: [] as RevealedRound[], matches: null, compared: 0 };
  if (!isGameKind(session.kind)) return { phase: 'unknown', ...empty };
  const rounds = pickRounds(session.kind, session.id);
  const mine = new Map(responses.filter((r) => r.user_id === me).map((r) => [r.round, r.answer]));
  const theirs = new Map(responses.filter((r) => r.user_id !== me).map((r) => [r.round, r.answer]));
  const revealed: RevealedRound[] = [...mine.keys()].sort((a, b) => a - b).filter((r) => r < GAME_ROUNDS).map((r) => ({
    round: r, prompt: rounds[r]!.prompt, ...(rounds[r]!.choices ? { choices: rounds[r]!.choices } : {}), mine: answerText(mine.get(r), rounds[r]),
    theirs: theirs.has(r) ? answerText(theirs.get(r), rounds[r]) : null }));
  let round = 0; while (round < GAME_ROUNDS && mine.has(round)) round += 1;
  const both = revealed.filter((r) => r.theirs !== null);
  const matches = session.kind === 'compatibility' || session.kind === 'would_you_rather' ? both.filter((r) => r.mine === r.theirs).length : null;
  const base = { round, rounds, revealed, matches, compared: both.length };
  if (session.state === 'declined') return { phase: 'declined', ...base };
  if (session.state === 'invited') return { phase: players.find((p) => p.user_id === me)?.accepted ? 'waiting_accept' : 'respond', ...base };
  if (session.state === 'finished') return { phase: 'finished', ...base };
  return { phase: round >= GAME_ROUNDS ? 'waiting_partner' : 'play', ...base };
}
export const partnerProgress = (responses: GameResponseRow[], me: string): number => responses.filter((r) => r.user_id !== me).length;
