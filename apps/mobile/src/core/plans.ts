import { ACTIVITY_CATEGORIES } from '@sidequest/shared';

type Row = Record<string, any>;

// ================= Open Calls =================
export interface OpenCallItem {
  id: string; hostId: string; hostName: string; hostAge: number; hostVerified: boolean; title: string; description: string | null; startsAt: Date;
  areaLabel: string; venue: string | null; distanceKm: number | null; capacity: number; acceptedCount: number; format: string; budgetNote: string | null;
  meetStyle: 'chat_first' | 'direct_meet'; status: string; myStatus: string | null; isMine: boolean; conversationId: string | null;
}
export const mapOpenCall = (r: Row): OpenCallItem => ({
  id: r.id, hostId: r.host_id, hostName: r.host_name, hostAge: Number(r.host_age), hostVerified: !!r.host_verified, title: r.title, description: r.description ?? null,
  startsAt: new Date(r.starts_at), areaLabel: r.area_label, venue: r.public_venue_name ?? null, distanceKm: r.distance_km == null ? null : Number(r.distance_km),
  capacity: Number(r.capacity), acceptedCount: Number(r.accepted_count ?? 0), format: r.format, budgetNote: r.budget_note ?? null, meetStyle: r.meet_style,
  status: r.status, myStatus: r.my_status ?? null, isMine: !!r.is_mine, conversationId: r.conversation_id ?? null,
});

export const OPEN_CALL_TEMPLATES = [
  { title: 'Coffee and conversation tonight', capacity: 2 },
  { title: 'Looking for a spontaneous dinner companion', capacity: 2 },
  { title: 'Two friends looking for two more: bowling', capacity: 4 },
  { title: 'Exploring a new part of the city', capacity: 3 },
  { title: 'Virtual introduction first, then maybe coffee', capacity: 2 },
] as const;

/** Places left for guests. The host holds one of the `capacity` seats. */
export const slotsLeft = (c: Pick<OpenCallItem, 'capacity' | 'acceptedCount'>) => Math.max(0, c.capacity - 1 - c.acceptedCount);
export const meetStyleLabel = (s: string) => (s === 'direct_meet' ? 'Meet directly' : 'Chat first');
export const canExpressInterest = (c: Pick<OpenCallItem, 'isMine' | 'status' | 'myStatus'>) =>
  !c.isMine && (c.status === 'open' || c.status === 'full') && (c.myStatus === null || c.myStatus === 'withdrawn');

export type Tone = 'good' | 'wait' | 'soft' | 'neutral';
/** What to show on a card. A closed request reads as "not available", never as rejection. */
export function callBadge(c: Pick<OpenCallItem, 'isMine' | 'status' | 'myStatus' | 'capacity' | 'acceptedCount'>): { label: string; tone: Tone } | null {
  if (c.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  if (c.status === 'completed') return { label: 'Done', tone: 'neutral' };
  if (c.isMine) return { label: c.status === 'full' ? 'Hosting · full' : 'Hosting', tone: 'good' };
  if (c.myStatus === 'accepted') return { label: "You're in", tone: 'good' };
  if (c.myStatus === 'interested') return { label: 'Requested', tone: 'wait' };
  if (c.myStatus === 'waitlisted') return { label: 'On the waitlist', tone: 'wait' };
  if (c.myStatus === 'rejected') return { label: 'Not available', tone: 'soft' };
  if (c.status === 'full') return { label: 'Full · join the waitlist', tone: 'soft' };
  return null;
}

export interface OpenCallForm { title: string; description: string; startsAt: Date | null; area: string; venue: string; capacity: number; budget: string; meetStyle: 'chat_first' | 'direct_meet' }
export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

export function buildOpenCallPayload(f: OpenCallForm, mode: string, now: Date, loc: { lat: number; lng: number } | null): Built {
  const title = f.title.trim();
  if (title.length < 2) return { ok: false, error: 'Give your Open Call a short title.' };
  if (title.length > 120) return { ok: false, error: 'Keep the title under 120 characters.' };
  if (f.area.trim().length < 2) return { ok: false, error: 'Add the area, for example "Koregaon Park". Never a home address.' };
  if (f.description.length > 1000) return { ok: false, error: 'Keep the description under 1000 characters.' };
  if (!f.startsAt) return { ok: false, error: 'Pick a day and time.' };
  const lead = f.startsAt.getTime() - now.getTime();
  if (lead < 15 * 60_000) return { ok: false, error: 'Pick a time at least 15 minutes from now.' };
  if (lead > 60 * 86_400_000) return { ok: false, error: 'Pick a time within the next 60 days.' };
  if (!Number.isInteger(f.capacity) || f.capacity < 2 || f.capacity > 50) return { ok: false, error: 'Choose between 2 and 50 people, including you.' };
  return { ok: true, body: {
    mode_id: mode, title, description: f.description.trim() || null, starts_at: f.startsAt.toISOString(), area_label: f.area.trim(),
    public_venue_name: f.venue.trim() || null, capacity: f.capacity, budget_note: f.budget.trim() || null, meet_style: f.meetStyle,
    lat: loc?.lat ?? null, lng: loc?.lng ?? null } };
}

// ================= Activities =================
export interface ActivityItem {
  id: string; hostId: string; hostName: string; title: string; category: string; description: string | null; startsAt: Date; areaLabel: string; venue: string | null;
  distanceKm: number | null; capacity: number | null; going: number; myStatus: string | null; isMine: boolean; status: string;
}
export const mapActivity = (r: Row): ActivityItem => ({
  id: r.id, hostId: r.host_id, hostName: r.host_name, title: r.title, category: r.category, description: r.description ?? null, startsAt: new Date(r.starts_at),
  areaLabel: r.area_label, venue: r.public_venue_name ?? null, distanceKm: r.distance_km == null ? null : Number(r.distance_km), capacity: r.capacity == null ? null : Number(r.capacity),
  going: Number(r.going ?? 1), myStatus: r.my_status ?? null, isMine: !!r.is_mine, status: r.status,
});
export const spotsLeft = (a: Pick<ActivityItem, 'capacity' | 'going'>): number | null => (a.capacity === null ? null : Math.max(0, a.capacity - a.going));
export function goingLabel(a: Pick<ActivityItem, 'capacity' | 'going'>): string {
  const left = spotsLeft(a);
  if (left === null) return `${a.going} going`;
  return left === 0 ? `${a.going} going · full` : `${a.going} going · ${left} spot${left === 1 ? '' : 's'} left`;
}
export const canJoinActivity = (a: Pick<ActivityItem, 'isMine' | 'status' | 'myStatus'>) => !a.isMine && a.status === 'scheduled' && (a.myStatus === null || a.myStatus === 'withdrawn');
export function activityBadge(a: Pick<ActivityItem, 'isMine' | 'status' | 'myStatus'>): { label: string; tone: Tone } | null {
  if (a.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  if (a.isMine) return { label: 'Hosting', tone: 'good' };
  if (a.myStatus === 'accepted') return { label: "You're going", tone: 'good' };
  if (a.myStatus === 'waitlisted') return { label: 'On the waitlist', tone: 'wait' };
  return null;
}

export interface ActivityForm { title: string; category: string | null; description: string; startsAt: Date | null; area: string; venue: string; capacity: number | null }
export function buildActivityPayload(f: ActivityForm, now: Date, loc: { lat: number; lng: number } | null): Built {
  if (!f.category || !ACTIVITY_CATEGORIES.some((c) => c.id === f.category)) return { ok: false, error: 'Choose a category.' };
  const title = f.title.trim();
  if (title.length < 2) return { ok: false, error: 'Give the activity a short title.' };
  if (title.length > 120) return { ok: false, error: 'Keep the title under 120 characters.' };
  if (f.area.trim().length < 2) return { ok: false, error: 'Add the area. Use a public venue, never a home address.' };
  if (f.description.length > 1000) return { ok: false, error: 'Keep the description under 1000 characters.' };
  if (!f.startsAt) return { ok: false, error: 'Pick a day and time.' };
  const lead = f.startsAt.getTime() - now.getTime();
  if (lead < 30 * 60_000) return { ok: false, error: 'Pick a time at least 30 minutes from now.' };
  if (lead > 120 * 86_400_000) return { ok: false, error: 'Pick a time within the next 120 days.' };
  if (f.capacity !== null && (!Number.isInteger(f.capacity) || f.capacity < 2 || f.capacity > 200)) return { ok: false, error: 'Choose between 2 and 200 people, or no limit.' };
  return { ok: true, body: { category: f.category, title, description: f.description.trim() || null, starts_at: f.startsAt.toISOString(), area_label: f.area.trim(),
    public_venue_name: f.venue.trim() || null, capacity: f.capacity, lat: loc?.lat ?? null, lng: loc?.lng ?? null } };
}

// ================= Group chat + errors =================
export interface ThreadInfo { kind: 'direct' | 'group' | 'open_call' | 'circle'; title: string | null; modeId: string; userId: string | null; displayName: string | null; age: number | null; verified: boolean;
  sharedInterests: string[]; otherLastReadAt: Date | null; myLastReadAt: Date | null; memberCount: number }
export const mapThreadInfo = (r: Row): ThreadInfo => ({ kind: r.kind, title: r.title ?? null, modeId: r.mode_id, userId: r.user_id ?? null, displayName: r.display_name ?? null,
  age: r.age == null ? null : Number(r.age), verified: !!r.verified, sharedInterests: Array.isArray(r.shared_interests) ? r.shared_interests : [],
  otherLastReadAt: r.other_last_read_at ? new Date(r.other_last_read_at) : null, myLastReadAt: r.my_last_read_at ? new Date(r.my_last_read_at) : null, memberCount: Number(r.member_count ?? 2) });

/** Friendly copy for the database's checked-function errors. Hidden, blocked and closed all read the same. */
export function planErrorMessage(code: string | undefined): string {
  switch (code) {
    case '42501': return 'This is not available any more.';
    case 'SQ429': return 'You are doing that very fast. Try again in a moment.';
    case 'SQ431': return 'You already have five active plans. Cancel or finish one first.';
    case 'SQ432': return 'That plan is full. Decline someone, or raise the number of places first.';
    case '22023': return 'Please check the details and try again.';
    default: return 'That did not go through. Check your connection and try again.';
  }
}
