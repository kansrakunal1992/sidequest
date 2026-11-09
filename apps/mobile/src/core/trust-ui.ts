// Pure rules for what the chat shows about trust. The text checks live in @sidequest/shared (assessMessageText); this decides what to do with them.
import { accountLooksSuspicious, assessMessageText, describeAccountTrust } from '@sidequest/shared';
import type { AccountTrust, RiskFlag, RiskLevel } from '@sidequest/shared';


export interface MessageLike { id: string; senderId: string; body: string | null; mediaKind: string | null }
export interface MessageWarning { level: Exclude<RiskLevel, 'none'>; flags: RiskFlag[]; explicit: boolean }

/** Messages this early in a chat get stricter treatment: moving to another app or sharing a link in the first few messages is the classic scam pattern. */
export const EARLY_MESSAGES = 6;

/**
 * Warnings for messages the person RECEIVED. Their own messages are never judged, and neither are images (we do not look at pictures here).
 * `messages` must be oldest first. Returns only messages that have something to say.
 */
export function incomingWarnings(messages: MessageLike[], me: string): Map<string, MessageWarning> {
  const out = new Map<string, MessageWarning>();
  messages.forEach((m, i) => {
    if (m.senderId === me || !m.body || m.mediaKind) return;
    const a = assessMessageText(m.body, { earlyInConversation: i < EARLY_MESSAGES });
    if (a.level !== 'none') out.set(m.id, { level: a.level, flags: a.flags, explicit: a.explicit });
  });
  return out;
}

/** One headline and one piece of advice for a banner (the most serious flag first). */
export function bannerText(w: MessageWarning): { title: string; advice: string; more: string[] } {
  const sorted = [...w.flags].sort((a, b) => Number(b.level === 'warning') - Number(a.level === 'warning'));
  const first = sorted[0]!;
  return { title: first.title, advice: first.advice, more: sorted.slice(1).map((f) => f.title) };
}

/** Explicit text is covered until the person chooses to look. Nothing is deleted or reported on their behalf. */
export const startsHidden = (w: MessageWarning): boolean => w.explicit;

export interface TrustCardLine { label: string; tone: 'good' | 'neutral' | 'warn'; detail?: string }
/** What the other person's account looks like, in plain facts. Empty when there is nothing worth saying. */
/** `verificationAvailable` comes from the server (/v1/config). While it is false nothing says "verified" or "not verified" anywhere. */
export function trustCard(t: AccountTrust | null, verificationAvailable = false): { lines: TrustCardLine[]; suspicious: boolean } {
  if (!t) return { lines: [], suspicious: false };
  const lines = describeAccountTrust(t, { verificationAvailable });
  return { lines, suspicious: accountLooksSuspicious(t) };
}

/** The database function returns snake_case JSON; tolerate junk so a bad answer never breaks the chat. */
export function parseTrust(raw: unknown): AccountTrust | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const age = Number(r.account_age_days), rep = Number(r.repeated_message_to);
  if (!Number.isFinite(age) || !Number.isFinite(rep)) return null;
  return { verified: r.verified === true, accountAgeDays: Math.max(0, Math.floor(age)), repeatedMessageTo: Math.max(0, Math.floor(rep)) };
}
