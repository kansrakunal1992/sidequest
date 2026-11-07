/** Anti-spam only. Generous by design, and never tied to payment. Tune via config. */
export const INVITE_LIMITS = {
  maxPer24h: 30,
  maxToNonMatchesPer24h: 10,
  maxPendingToSameRecipient: 1,
} as const;

export interface InviteRateInput {
  sentLast24h: number;
  sentToNonMatchesLast24h: number;
  pendingToRecipient: number;
  isMatch: boolean;
}
export type RateDecision = { allowed: true } | { allowed: false; reason: 'daily_limit' | 'non_match_limit' | 'pending_exists' };

export function evaluateInviteRate(i: InviteRateInput): RateDecision {
  if (i.pendingToRecipient >= INVITE_LIMITS.maxPendingToSameRecipient) return { allowed: false, reason: 'pending_exists' };
  if (i.sentLast24h >= INVITE_LIMITS.maxPer24h) return { allowed: false, reason: 'daily_limit' };
  if (!i.isMatch && i.sentToNonMatchesLast24h >= INVITE_LIMITS.maxToNonMatchesPer24h) {
    return { allowed: false, reason: 'non_match_limit' };
  }
  return { allowed: true };
}
