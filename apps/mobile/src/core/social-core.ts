import { ACTIVITY_CATEGORIES, WING_PERMISSIONS } from '@sidequest/shared';
import type { Energy, WingPermission } from '@sidequest/shared';
import type { CircleRow, DoubleDateRow, RouletteRow } from './db-types';

const HOUR = 3_600_000, DAY = 86_400_000;
export type Check<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };
const bad = (errors: Record<string, string>): { ok: false; errors: Record<string, string> } => ({ ok: false, errors });

// ---------- Social Roulette (limits mirror join_roulette in the database; the database stays the authority) ----------
export const ROULETTE = { minLeadHours: 3, maxLeadDays: 14, minSize: 2, maxSize: 8, defaultSize: 4, energies: ['chill', 'flirty', 'adventurous', 'social'] as Energy[] };
export interface RouletteForm { modeId: string | null; activity: string; area: string; slotStart: Date | null; groupSize: number; energy: Energy | null }
export function validateRoulette(f: RouletteForm, now: Date): Check<{ mode_id: string; activity: string; area_label: string; slot_start: string; group_size: number; energy: Energy }> {
  const e: Record<string, string> = {};
  const activity = f.activity.trim(), area = f.area.trim();
  if (!f.modeId) e.modeId = 'Choose a vibe first.';
  if (activity.length < 2 || activity.length > 40) e.activity = 'Say what you would like to do (2 to 40 characters).';
  if (area.length < 2) e.area = 'Add the area you would meet in.';
  if (!f.slotStart) e.slotStart = 'Pick a day and time.';
  else if (f.slotStart.getTime() < now.getTime() + ROULETTE.minLeadHours * HOUR) e.slotStart = `Pick a time at least ${ROULETTE.minLeadHours} hours from now.`;
  else if (f.slotStart.getTime() > now.getTime() + ROULETTE.maxLeadDays * DAY) e.slotStart = `Pick a time within the next ${ROULETTE.maxLeadDays} days.`;
  if (!Number.isInteger(f.groupSize) || f.groupSize < ROULETTE.minSize || f.groupSize > ROULETTE.maxSize) e.groupSize = `Choose a table of ${ROULETTE.minSize} to ${ROULETTE.maxSize}.`;
  if (!f.energy) e.energy = 'Pick the energy you are in the mood for.';
  if (Object.keys(e).length) return bad(e);
  return { ok: true, value: { mode_id: f.modeId!, activity, area_label: area, slot_start: f.slotStart!.toISOString(), group_size: f.groupSize, energy: f.energy! } };
}
export function rouletteStatus(r: RouletteRow): { text: string; tone: 'wait' | 'good' | 'done' } {
  if (r.status === 'grouped' && r.group_id) return { text: r.venue ? `Table ready at ${r.venue}` : 'Table ready. Pick a place in the group chat.', tone: 'good' };
  if (r.status === 'waitlisted') return { text: 'On the waitlist. We need a few more people for this time and area.', tone: 'wait' };
  if (r.status === 'waiting') return { text: 'Looking for your table. We group people shortly before the day.', tone: 'wait' };
  return { text: 'Cancelled', tone: 'done' };
}
export const canCancelRoulette = (r: RouletteRow): boolean => r.status === 'waiting' || r.status === 'waitlisted' || r.status === 'grouped';

// ---------- Circles ----------
export const VISIBILITY_LABEL: Record<CircleRow['visibility'], string> = { public: 'Open to everyone', request_to_join: 'Request to join', private: 'Private (invite only)' };
export const CIRCLE_CATEGORIES = ACTIVITY_CATEGORIES.map((c) => ({ id: c.id as string, label: c.label as string }));
export function circleAction(c: CircleRow): { kind: 'open' | 'join' | 'request' | 'pending' | 'none'; label: string } {
  if (c.my_status === 'active') return { kind: 'open', label: c.my_role === 'owner' ? 'Manage circle' : 'Open circle' };
  if (c.my_status === 'requested') return { kind: 'pending', label: 'Request sent' };
  if (c.my_status === 'removed' || c.visibility === 'private') return { kind: 'none', label: 'Not available' };
  return c.visibility === 'public' ? { kind: 'join', label: 'Join' } : { kind: 'request', label: 'Ask to join' };
}
export const joinOutcomeMessage = (status: string): string => status === 'active' ? 'You are in. Say hello in the circle chat.' : 'Request sent. The organiser will take a look.';
export function validateCircle(f: { name: string; description: string; visibility: CircleRow['visibility']; category: string | null }): Check<{ name: string; description: string; visibility: string; category: string | null }> {
  const e: Record<string, string> = {}; const name = f.name.trim(), description = f.description.trim();
  if (name.length < 2 || name.length > 80) e.name = 'Give the circle a name (2 to 80 characters).';
  if (description.length > 600) e.description = 'Keep the description under 600 characters.';
  if (f.visibility === 'private') e.visibility = 'Private circles are not available yet. Choose open or request to join.';
  return Object.keys(e).length ? bad(e) : { ok: true, value: { name, description, visibility: f.visibility, category: f.category } };
}
export function validateCircleEvent(f: { title: string; area: string; venue: string; startsAt: Date | null; capacity: string; description: string }, now: Date): Check<Record<string, unknown>> {
  const e: Record<string, string> = {}; const title = f.title.trim(), area = f.area.trim();
  if (title.length < 2 || title.length > 120) e.title = 'Give it a title (2 to 120 characters).';
  if (area.length < 2) e.area = 'Add the area.';
  if (!f.startsAt) e.startsAt = 'Pick a day and time.';
  else if (f.startsAt.getTime() < now.getTime() + 30 * 60_000) e.startsAt = 'Pick a time at least 30 minutes from now.';
  else if (f.startsAt.getTime() > now.getTime() + 120 * DAY) e.startsAt = 'Pick a time within the next 120 days.';
  const cap = f.capacity.trim() === '' ? null : Number(f.capacity);
  if (cap !== null && (!Number.isInteger(cap) || cap < 2 || cap > 500)) e.capacity = 'Capacity should be a whole number from 2 to 500, or empty.';
  if (Object.keys(e).length) return bad(e);
  return { ok: true, value: { title, area_label: area, public_venue_name: f.venue.trim() || null, starts_at: f.startsAt!.toISOString(), capacity: cap, description: f.description.trim() || null } };
}

// ---------- Teams and double dates ----------
export const TEAM_KINDS = [{ id: 'friends', label: 'Two friends' }, { id: 'couple', label: 'A couple' }, { id: 'singles', label: 'Two singles' }] as const;
export const teamNameOk = (n: string): boolean => n.trim().length <= 60;
export const isFullTeam = (members: { status: string }[]): boolean => members.filter((m) => m.status === 'accepted').length === 2;
export function validateDoubleDate(f: { teamId: string | null; modeId: string | null; startsAt: Date | null; venue: string }, team: { members: { status: string }[] } | null, now: Date): Check<{ p_team: string; p_mode: string; p_starts: string; p_venue: string | null }> {
  const e: Record<string, string> = {};
  if (!f.teamId || !team) e.teamId = 'Choose your team.';
  else if (!isFullTeam(team.members)) e.teamId = 'A double date needs a pair. Wait for your teammate to accept.';
  if (!f.modeId) e.modeId = 'Choose a vibe.';
  if (!f.startsAt) e.startsAt = 'Pick a day and time.';
  else if (f.startsAt.getTime() < now.getTime() + 2 * HOUR) e.startsAt = 'Pick a time at least 2 hours from now.';
  else if (f.startsAt.getTime() > now.getTime() + 60 * DAY) e.startsAt = 'Pick a time within the next 60 days.';
  if (f.venue.trim().length > 80) e.venue = 'Keep the venue under 80 characters.';
  return Object.keys(e).length ? bad(e) : { ok: true, value: { p_team: f.teamId!, p_mode: f.modeId!, p_starts: f.startsAt!.toISOString(), p_venue: f.venue.trim() || null } };
}
export function doubleDateStatus(d: DoubleDateRow): string {
  switch (d.state) {
    case 'looking': return d.is_mine ? 'Waiting for another pair' : 'Looking for another pair';
    case 'proposed': return 'A pair has asked to join';
    case 'accepted': case 'scheduled': return 'Confirmed';
    case 'declined': return 'Declined';
    case 'completed': return 'Done';
    case 'cancelled': return 'Cancelled';
    default: return d.state;
  }
}

// ---------- Wingperson ----------
export const WING_PERMISSION_INFO: Record<WingPermission, { label: string; hint: string }> = {
  view_shared_profile: { label: 'See my profile text', hint: 'They can read the words on my profile for one vibe. Never my chats, matches or likes.' },
  suggest_profiles: { label: 'Suggest activities', hint: 'They can suggest public activities for me. I decide.' },
  suggest_openers: { label: 'Suggest openers', hint: 'They can suggest things I could say. I choose whether to use them.' },
  shortlist: { label: 'Help me shortlist', hint: 'They can help pick people I might like to meet. They cannot message anyone as me.' },
  co_host_open_call: { label: 'Co-host an open call', hint: 'They can help organise a group outing with me.' },
  join_double_date: { label: 'Join a double date', hint: 'They can be my partner on a double date.' },
};
export const wingPermissionList = (): WingPermission[] => [...WING_PERMISSIONS];
export const toggleWingPermission = (cur: WingPermission[], p: WingPermission): WingPermission[] => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
export const wingStatusLabel = (status: string, role: 'owner' | 'wing'): string =>
  status === 'invited' ? (role === 'owner' ? 'Waiting for them to accept' : 'Invitation') : status === 'active' ? 'Active' : status;
