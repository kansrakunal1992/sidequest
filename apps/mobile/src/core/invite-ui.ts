import { transitionInvite } from '@sidequest/shared';
import type { InviteEvent, InviteState } from '@sidequest/shared';
import type { ApiInvite, CreateInviteBody } from './api-client';

export const FORMATS = ['text', 'voice', 'video', 'virtual_coffee', 'intro_chat'] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<Format, string> = { text: 'Text chat', voice: 'Voice call', video: 'Video call', virtual_coffee: 'Virtual coffee', intro_chat: 'Quick intro chat' };
export const FORMAT_ICONS: Record<Format, string> = { text: 'chatbubble-ellipses', voice: 'call', video: 'videocam', virtual_coffee: 'cafe', intro_chat: 'hand-left' };
export const DURATIONS = [15, 20, 30, 45, 60] as const;
export const NOTE_MAX = 280;

export type Party = 'sender' | 'recipient';
export const myParty = (inv: Pick<ApiInvite, 'senderId' | 'recipientId'>, me: string): Party | null => (inv.senderId === me ? 'sender' : inv.recipientId === me ? 'recipient' : null);
export const otherId = (inv: Pick<ApiInvite, 'senderId' | 'recipientId'>, me: string): string => (inv.senderId === me ? inv.recipientId : inv.senderId);

export type InviteAction = 'accept' | 'accept_reschedule' | 'reschedule' | 'decline' | 'too_new' | 'light_chat' | 'complete' | 'cancel';
const EVENT_FOR: Record<Exclude<InviteAction, 'light_chat'>, InviteEvent> = {
  accept: 'accept', accept_reschedule: 'accept_reschedule', reschedule: 'request_reschedule', decline: 'decline', too_new: 'mark_too_new', complete: 'complete', cancel: 'cancel',
};
const ORDER: InviteAction[] = ['accept', 'accept_reschedule', 'reschedule', 'decline', 'too_new', 'light_chat', 'complete', 'cancel'];

/** Which buttons to show. Decided by the same state machine the server enforces, so the app never offers an action that would be refused. */
export function availableActions(inv: ApiInvite, me: string, now: Date): InviteAction[] {
  const party = myParty(inv, me);
  if (!party) return [];
  const ctx = { state: inv.state as InviteState, proposedBy: inv.proposedBy, startsAt: new Date(inv.startsAt), now };
  const out: InviteAction[] = (Object.keys(EVENT_FOR) as (keyof typeof EVENT_FOR)[]).filter((a) => transitionInvite(ctx, EVENT_FOR[a], party).ok);
  if (inv.state === 'too_new' && party === 'recipient') out.push('light_chat');
  return ORDER.filter((a) => out.includes(a));
}

export type Tone = 'wait' | 'good' | 'neutral' | 'soft';
/** Gentle wording: being declined or delayed is never framed as rejection. */
export function stateSummary(inv: ApiInvite, me: string): { label: string; tone: Tone } {
  const sender = inv.senderId === me;
  switch (inv.state) {
    case 'pending': return sender ? { label: 'Waiting for their reply', tone: 'wait' } : { label: 'Waiting for you', tone: 'wait' };
    case 'accepted': case 'rescheduled': return { label: 'Confirmed', tone: 'good' };
    case 'declined': return sender ? { label: 'Not this time', tone: 'soft' } : { label: 'You declined', tone: 'neutral' };
    case 'too_new': return sender ? { label: 'They would like to take it slowly', tone: 'soft' } : { label: 'You said "Too new to say hi"', tone: 'neutral' };
    case 'reschedule_requested': return (inv.proposedBy === 'sender') === sender ? { label: 'You suggested a new time', tone: 'wait' } : { label: 'A new time was suggested', tone: 'wait' };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' };
    case 'completed': return { label: 'Done', tone: 'neutral' };
    case 'expired': return { label: sender ? 'No reply in time' : 'Expired', tone: 'neutral' };
    default: return { label: inv.state, tone: 'neutral' };
  }
}

export function parseLocalDateTime(day: string, month: string, year: string, hour: string, minute: string): Date | null {
  if (![day, month, year, hour, minute].every((s) => /^\d+$/.test(s.trim()))) return null;
  const [d, mo, y, h, mi] = [day, month, year, hour, minute].map((s) => Number(s.trim())) as [number, number, number, number, number];
  if (y < 2000 || y > 2200 || h > 23 || mi > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi ? date : null;
}

const at = (base: Date, addDays: number, h: number, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d; };
export function quickSlots(now: Date): { label: string; date: Date }[] {
  const out: { label: string; date: Date }[] = [];
  const tonight = at(now, 0, 20);
  if (tonight.getTime() - now.getTime() > 45 * 60_000) out.push({ label: 'Tonight', date: tonight });
  out.push({ label: 'Tomorrow evening', date: at(now, 1, 19) });
  const toSat = ((6 - now.getDay() + 7) % 7) || 7;
  out.push({ label: 'This Saturday', date: at(now, toSat < 2 ? toSat + 7 : toSat, 11) });
  out.push({ label: 'Sunday afternoon', date: at(now, (((0 - now.getDay() + 7) % 7) || 7) < 2 ? 8 : (((0 - now.getDay() + 7) % 7) || 7), 16) });
  return out;
}

export function formatWhen(iso: string | Date, tz?: string, locale = 'en-IN'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).format(d);
}

export type PayloadResult = { ok: true; body: CreateInviteBody } | { ok: false; error: string };
export function buildInvitePayload(i: { recipientId: string; modeId: string; format: Format; startsAt: Date | null; durationMinutes: number; note: string }, tz: string, now: Date): PayloadResult {
  if (!i.startsAt) return { ok: false, error: 'Pick a day and time.' };
  const lead = i.startsAt.getTime() - now.getTime();
  if (lead < 10 * 60_000) return { ok: false, error: 'Pick a time at least 10 minutes from now.' };
  if (lead > 90 * 86_400_000) return { ok: false, error: 'Pick a time within the next 90 days.' };
  if (!(FORMATS as readonly string[]).includes(i.format)) return { ok: false, error: 'Choose how you would like to connect.' };
  if (!(i.durationMinutes >= 5 && i.durationMinutes <= 240)) return { ok: false, error: 'Choose a duration.' };
  if (i.note.length > NOTE_MAX) return { ok: false, error: `Keep your note under ${NOTE_MAX} characters.` };
  const note = i.note.trim();
  return { ok: true, body: { recipientId: i.recipientId, modeId: i.modeId, format: i.format, startsAt: i.startsAt.toISOString(), timezone: tz, durationMinutes: i.durationMinutes, ...(note ? { note } : {}) } };
}
