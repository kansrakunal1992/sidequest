import { IN_PERSON_MIN_LEAD_MINUTES, MODES as SHARED_MODES, buildPlanShareText, hasContactDetails, isMeetActivity, meetActivityLabel, meetTitle, validateMeetPlace, PLACE_ERROR_TEXT, transitionInvite } from '@sidequest/shared';
import type { InviteEvent, InviteState } from '@sidequest/shared';
import type { ApiInvite, CreateInviteBody } from './api-client';

export const FORMATS = ['in_person', 'text', 'voice', 'video', 'virtual_coffee', 'intro_chat'] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<Format, string> = { text: 'Text chat', voice: 'Voice call', video: 'Video call', virtual_coffee: 'Virtual coffee', intro_chat: 'Quick intro chat', in_person: 'Meet in person' };
export const FORMAT_ICONS: Record<Format, string> = { text: 'chatbubble-ellipses', voice: 'call', video: 'videocam', virtual_coffee: 'cafe', intro_chat: 'hand-left', in_person: 'walk' };
export const DURATIONS = [15, 20, 30, 45, 60] as const;
/** Meeting in person takes longer than a call. */
export const IN_PERSON_DURATIONS = [60, 90, 120, 180] as const;
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
export function buildInvitePayload(i: { recipientId: string; modeId: string; format: Format; startsAt: Date | null; durationMinutes: number; note: string; activity?: string | null; venueName?: string; areaLabel?: string }, tz: string, now: Date): PayloadResult {
  if (!i.startsAt) return { ok: false, error: 'Pick a day and time.' };
  const lead = i.startsAt.getTime() - now.getTime();
  const inPerson = i.format === 'in_person';
  if (inPerson && lead < IN_PERSON_MIN_LEAD_MINUTES * 60_000) return { ok: false, error: 'Pick a time at least an hour from now, so they have time to reply.' };
  if (lead < 10 * 60_000) return { ok: false, error: 'Pick a time at least 10 minutes from now.' };
  if (lead > 90 * 86_400_000) return { ok: false, error: 'Pick a time within the next 90 days.' };
  if (!(FORMATS as readonly string[]).includes(i.format)) return { ok: false, error: 'Choose how you would like to connect.' };
  if (!(i.durationMinutes >= 5 && i.durationMinutes <= 240)) return { ok: false, error: 'Choose a duration.' };
  if (i.note.length > NOTE_MAX) return { ok: false, error: `Keep your note under ${NOTE_MAX} characters.` };
  const note = i.note.trim();
  const base = { recipientId: i.recipientId, modeId: i.modeId, format: i.format, startsAt: i.startsAt.toISOString(), timezone: tz, durationMinutes: i.durationMinutes, ...(note ? { note } : {}) };
  if (!inPerson) return { ok: true, body: base };
  if (!isMeetActivity(i.activity)) return { ok: false, error: 'Choose what you would like to do.' };
  const place = validateMeetPlace(i.venueName, i.areaLabel);
  if (!place.ok) return { ok: false, error: PLACE_ERROR_TEXT[place.error] };
  if (hasContactDetails(note)) return { ok: false, error: 'Please leave phone numbers, links and handles out of the note.' };
  return { ok: true, body: { ...base, activity: i.activity, venueName: place.venueName, areaLabel: place.areaLabel } };
}

export const isInPerson = (inv: Pick<ApiInvite, 'format'>): boolean => inv.format === 'in_person';
/** "Blue Tokai, Khan Market" for an in-person plan, otherwise null. */
export const placeText = (inv: Pick<ApiInvite, 'venueName' | 'areaLabel'>): string | null => (inv.venueName && inv.areaLabel ? `${inv.venueName}, ${inv.areaLabel}` : null);
/** Headline for an invitation: the activity for a meetup, the format for everything else. */
export const inviteHeadline = (inv: Pick<ApiInvite, 'format' | 'activity'>): string => (inv.format === 'in_person' ? meetActivityLabel(inv.activity) : FORMAT_LABELS[inv.format]);
export const inviteTitle = (inv: Pick<ApiInvite, 'format' | 'activity'>, name: string): string => (inv.format === 'in_person' ? meetTitle(inv.activity, name) : `${FORMAT_LABELS[inv.format]} with ${name}`);

const OPEN_STATES = ['pending', 'reschedule_requested', 'accepted', 'rescheduled'];
/** Is there already a live meetup plan with this person? Used so the "make a plan" nudge never nags. */
export function hasOpenPlanWith(invites: Pick<ApiInvite, 'format' | 'state' | 'senderId' | 'recipientId' | 'startsAt'>[], me: string, other: string, now: Date): boolean {
  return invites.some((v) => v.format === 'in_person' && OPEN_STATES.includes(v.state) && new Date(v.startsAt).getTime() > now.getTime() &&
    ((v.senderId === me && v.recipientId === other) || (v.senderId === other && v.recipientId === me)));
}

/** The message a person can send a friend about a confirmed plan. Null when the plan has no place (not a meetup). */
export function planShareMessage(inv: ApiInvite, otherName: string): string | null {
  if (!isInPerson(inv) || !inv.venueName || !inv.areaLabel) return null;
  return buildPlanShareText({ name: otherName, activityId: inv.activity, venueName: inv.venueName, areaLabel: inv.areaLabel, whenText: formatWhen(inv.startsAt, inv.timezone), durationMinutes: inv.durationMinutes });
}

// ---- Who can be invited before matching ------------------------------------------------------------------------------------------
// The rule lives in packages/shared (MODES[mode].contact.introInviteWithoutMatch). Five vibes allow a first invitation without a match;
// Explore does not. The recipient can also switch "Allow invitations before matching" off. We show the button only when it can work,
// so nobody fills in a whole form just to be told no.
export function inviteAvailability(mode: string, matched: boolean): { canInvite: boolean; hint: string | null } {
  if (matched) return { canInvite: true, hint: null };
  const rule = (SHARED_MODES as Record<string, { contact: { introInviteWithoutMatch: boolean } }>)[mode]?.contact;
  if (rule && !rule.introInviteWithoutMatch) return { canInvite: false, hint: 'In this vibe, invitations open up once you have matched. Send a Like first.' };
  return { canInvite: true, hint: null };
}

// ---- Calendar picker helpers (pure) -------------------------------------------------------------------------------------------------
export const DEFAULT_PICK_HOUR = 19;          // after choosing only a date we pre-fill 7:00 pm so one tap is enough
export const MAX_PICK_DAYS = 90;              // the API refuses invitations more than 90 days ahead
export const MIN_PICK_MINUTES = 15;

/** Date from one picker, hours and minutes from the other. */
export function combineDateAndTime(day: Date, hour: number, minute: number): Date {
  const d = new Date(day); d.setHours(hour, minute, 0, 0); return d;
}
export const startOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** A plain sentence when the chosen moment cannot be used, otherwise null. The API accepts 5 minutes to 90 days ahead; the app asks for 15 minutes so the other person has a moment to see it. */
export function whenProblem(d: Date, now: Date, maxDays = MAX_PICK_DAYS): string | null {
  const lead = d.getTime() - now.getTime();
  if (lead < MIN_PICK_MINUTES * 60_000) return 'Pick a time at least 15 minutes from now.';
  if (lead > maxDays * 86_400_000) return `Pick a day within the next ${maxDays} days.`;
  return null;
}
export const formatDay = (d: Date, locale = 'en-IN'): string => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
export const formatTime = (d: Date, locale = 'en-IN'): string => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
