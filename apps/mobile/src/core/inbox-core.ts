import { NOTIFICATION_KINDS } from '@sidequest/shared';
import type { NotificationKind } from '@sidequest/shared';
import type { NotificationRow } from './db-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Payload = Record<string, unknown>;
const id = (p: Payload, k: string): string | null => (typeof p[k] === 'string' && UUID.test(p[k] as string) ? (p[k] as string) : null);
export interface InboxEntry { title: string; body: string; route: string | null }

/**
 * In-app wording for every notification kind. Like push, it never contains names, vibes or message text:
 * the person taps through to the screen that shows the details. Typed as a Record, so adding a kind in the shared list
 * without wording it here fails the type check.
 */
const ENTRY: Record<NotificationKind, (p: Payload) => InboxEntry> = {
  invite_received: (p) => ({ title: 'New invitation', body: 'Someone would like to meet. Open it to see the details.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_accepted: (p) => ({ title: 'Invitation accepted', body: 'Your invitation was accepted.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_declined: (p) => ({ title: 'Invitation declined', body: 'Your invitation was not accepted this time.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_too_new: (p) => ({ title: 'A request is waiting', body: 'A new connection would like a light chat first.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_reschedule_requested: (p) => ({ title: 'New time suggested', body: 'A different time was suggested for your plan.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_rescheduled: (p) => ({ title: 'Plan moved', body: 'The time of your plan changed.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_cancelled: (p) => ({ title: 'Plan cancelled', body: 'A plan was cancelled.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_expired: (p) => ({ title: 'Invitation expired', body: 'An invitation ran out of time.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_day_before: (p) => ({ title: 'Your plan is coming up', body: 'Check the details, or reschedule if something has changed.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  invite_reminder: (p) => ({ title: 'Coming up soon', body: 'You have a plan starting soon.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  light_chat_started: (p) => ({ title: 'A light chat started', body: 'You can say hello now.', route: id(p, 'conversationId') && `/chat/${id(p, 'conversationId')}` }),
  post_meet_prompt: (p) => ({ title: 'How did it go?', body: 'Tell us how your plan went. Only you see this.', route: id(p, 'inviteId') && `/invite/${id(p, 'inviteId')}` }),
  roulette_group_ready: () => ({ title: 'Your table is ready', body: 'Open Social Roulette to see the details.', route: '/(tabs)/circles' }),
  roulette_update: () => ({ title: 'Table update', body: 'Something changed with your Social Roulette table.', route: '/(tabs)/circles' }),
  open_call_expired: (p) => ({ title: 'Open call ended', body: 'One of your open calls has ended.', route: id(p, 'openCallId') && `/open-call/${id(p, 'openCallId')}` }),
  message_received: (p) => ({ title: 'New message', body: 'Open the chat to read it.', route: id(p, 'conversationId') && `/chat/${id(p, 'conversationId')}` }),
  open_call_interest: (p) => ({ title: 'Someone is interested', body: 'Someone would like to join your open call.', route: id(p, 'openCallId') && `/open-call/${id(p, 'openCallId')}` }),
  open_call_accepted: (p) => ({ title: 'You are in', body: 'You were accepted into an open call.', route: id(p, 'conversationId') ? `/chat/${id(p, 'conversationId')}` : id(p, 'openCallId') && `/open-call/${id(p, 'openCallId')}` }),
  open_call_update: (p) => ({ title: 'Open call update', body: 'Something changed with an open call.', route: id(p, 'openCallId') && `/open-call/${id(p, 'openCallId')}` }),
  activity_update: (p) => ({ title: 'Activity update', body: 'Something changed with an activity.', route: id(p, 'eventId') && `/activity/${id(p, 'eventId')}` }),
  wing_invited: () => ({ title: 'A request from a friend', body: 'Someone asked you to be their wingperson.', route: '/safety/wing' }),
  wing_suggestion: () => ({ title: 'A suggestion for you', body: 'Nothing changes unless you accept it.', route: '/safety/wing' }),
  team_invited: () => ({ title: 'Team invitation', body: 'You were invited to join a team.', route: '/teams' }),
  double_date_request: () => ({ title: 'A plan request', body: 'Another team would like to plan something together.', route: '/(tabs)/circles' }),
  double_date_update: () => ({ title: 'Plan update', body: 'Something changed with a double date.', route: '/(tabs)/circles' }),
  game_invite: (p) => ({ title: 'Game invitation', body: 'Someone would like to play a short game.', route: id(p, 'sessionId') && id(p, 'conversationId') ? `/game/${id(p, 'sessionId')}?conversationId=${id(p, 'conversationId')}` : id(p, 'conversationId') && `/chat/${id(p, 'conversationId')}` }),
  circle_request: (p) => ({ title: 'Circle request', body: 'Someone asked to join a circle you run.', route: id(p, 'circleId') && `/circle/${id(p, 'circleId')}` }),
  couple_invited: () => ({ title: 'A request to link up', body: 'You have a request waiting. Nothing is shared until you say yes.', route: '/safety/together' }),
  trusted_added: () => ({ title: 'Trusted contact', body: 'Someone chose you as a trusted contact. Open to see what that means.', route: '/safety/trusted' }),
  checkin_prompt: () => ({ title: 'Time to check in', body: 'Let us know you are okay. It takes one tap.', route: '/safety/trusted' }),
  checkin_missed: () => ({ title: 'Please check on a friend', body: 'A friend has not confirmed they are okay. Please try to reach them.', route: '/safety/trusted' }),
  checkin_help: () => ({ title: 'A friend asked for help', body: 'A friend has asked for help. Please reach out to them now.', route: '/safety/trusted' }),
  checkin_safe: () => ({ title: 'Good news', body: 'The friend you were worried about has confirmed they are okay.', route: '/safety/trusted' }),
  moderation_notice: () => ({ title: 'An update on your account', body: 'Open Safety to read an important message.', route: '/safety' }),
  verification_result: () => ({ title: 'Verification update', body: 'Your photo verification was reviewed. Open to see the result.', route: '/safety/verify' }),
  export_ready: () => ({ title: 'Your data export is ready', body: 'Download it within 7 days.', route: '/safety/data' }),
};
export function describeNotification(kind: string, payload: Payload | null): InboxEntry {
  const f = (ENTRY as Record<string, ((p: Payload) => InboxEntry) | undefined>)[kind];
  if (!f) return { title: 'Update', body: 'Open Waypoint to see what is new.', route: null };   // a kind a newer server knows but this app does not
  const e = f(payload ?? {});
  return { ...e, route: e.route || null };
}
export const KINDS_WITH_WORDING = Object.keys(ENTRY) as NotificationKind[];
export const unreadCount = (rows: NotificationRow[]): number => rows.filter((r) => !r.read_at).length;
/** Safety alerts float to the top of the inbox; everything else stays newest first. */
const URGENT = new Set(['checkin_help', 'checkin_missed', 'checkin_prompt']);
export function sortInbox(rows: NotificationRow[]): NotificationRow[] {
  return [...rows].sort((a, b) => (Number(URGENT.has(b.kind) && !b.read_at) - Number(URGENT.has(a.kind) && !a.read_at)) || b.created_at.localeCompare(a.created_at));
}
void NOTIFICATION_KINDS;
