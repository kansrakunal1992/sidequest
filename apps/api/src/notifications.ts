import { NOTIFICATION_KINDS } from '@sidequest/shared';
import type { Store } from './store.ts';
import type { NotificationInput, NotificationKind } from './types.ts';

export interface PushMessage { title: string; body: string; data: Record<string, string>; channel: string }
export type PushResult = 'ok' | 'invalid_token' | 'error';
export interface PushSender { send(token: string, msg: PushMessage, platform: 'android' | 'ios'): Promise<PushResult> }

export class NoopPushSender implements PushSender {
  sent: { token: string; msg: PushMessage }[] = [];
  async send(token: string, msg: PushMessage): Promise<PushResult> { this.sent.push({ token, msg }); return 'ok'; }
}

/**
 * Lock-screen safe copy: no names, no mode labels, nothing about orientation or intent.
 * Details are fetched by the app after the user unlocks and opens the notification.
 */
/** Android notification channels the app creates at start-up (apps/mobile/src/lib/push.ts). A test keeps the two lists in step. */
export const PUSH_CHANNELS = ['invites', 'messages', 'open_calls', 'safety'] as const;
type PushCopy = { title: string; body: string; channel: (typeof PUSH_CHANNELS)[number] };
const COPY: Record<NotificationKind, PushCopy> = {
  invite_received: { title: 'New invitation', body: 'Someone would like to say hi. Open Waypoint to respond.', channel: 'invites' },
  invite_accepted: { title: 'Invitation accepted', body: 'It is on. Check your calendar for the details.', channel: 'invites' },
  invite_declined: { title: 'Invitation update', body: 'This invitation was not taken up this time.', channel: 'invites' },
  invite_too_new: { title: 'A gentle reply', body: 'They would like to take things slowly for now. No pressure either way.', channel: 'invites' },
  invite_reschedule_requested: { title: 'New time suggested', body: 'Open Waypoint to accept it or suggest another.', channel: 'invites' },
  invite_rescheduled: { title: 'Time updated', body: 'Your plan has a new time. Your calendar is updated.', channel: 'invites' },
  invite_cancelled: { title: 'Plan cancelled', body: 'A plan on your calendar was cancelled.', channel: 'invites' },
  invite_expired: { title: 'Invitation expired', body: 'An invitation timed out without a reply.', channel: 'invites' },
  invite_reminder: { title: 'Coming up soon', body: 'You have a plan starting shortly.', channel: 'invites' },
  invite_day_before: { title: 'Your plan is coming up', body: 'Open Waypoint to check the details, or to reschedule.', channel: 'invites' },
  light_chat_started: { title: 'A friendly hello', body: 'Someone you invited has started a relaxed chat.', channel: 'messages' },
  post_meet_prompt: { title: 'How did it go?', body: 'Two quick private questions help keep everyone safe.', channel: 'safety' },
  roulette_group_ready: { title: 'Your table is ready', body: 'Your Social Roulette group is set. Open the app for details.', channel: 'open_calls' },
  open_call_expired: { title: 'Open Call ended', body: 'One of your Open Calls has ended.', channel: 'open_calls' },
  open_call_interest: { title: 'Someone is interested', body: 'Open Waypoint to see who and decide.', channel: 'open_calls' },
  open_call_accepted: { title: 'You are in', body: 'Your spot is confirmed. Open Waypoint for details.', channel: 'open_calls' },
  open_call_update: { title: 'Open Call update', body: 'Something changed with a plan you are part of.', channel: 'open_calls' },
  activity_update: { title: 'Activity update', body: 'Something changed with an activity you joined.', channel: 'open_calls' },
  message_received: { title: 'New message', body: 'Open Waypoint to read it.', channel: 'messages' },
  wing_invited: { title: 'A request from a friend', body: 'Someone asked you to be their wingperson. Open Waypoint to decide.', channel: 'invites' },
  wing_suggestion: { title: 'A suggestion for you', body: 'A suggestion is waiting. Nothing changes unless you accept it.', channel: 'invites' },
  team_invited: { title: 'Team invitation', body: 'You have been invited to join a team. Open Waypoint to respond.', channel: 'open_calls' },
  double_date_request: { title: 'A plan request', body: 'Another team would like to plan something together. Open Waypoint to respond.', channel: 'open_calls' },
  double_date_update: { title: 'Plan update', body: 'Something changed with a plan you are part of.', channel: 'open_calls' },
  roulette_update: { title: 'Table update', body: 'Something changed with your Social Roulette table.', channel: 'open_calls' },
  game_invite: { title: 'Game invitation', body: 'Someone would like to play a short game. Open Waypoint to join.', channel: 'messages' },
  circle_request: { title: 'Circle update', body: 'There is a new request on a circle you run. Open Waypoint to review it.', channel: 'open_calls' },
  couple_invited: { title: 'A request to link up', body: 'You have a request waiting. Open Waypoint to review it.', channel: 'invites' },
  trusted_added: { title: 'You were added as a trusted contact', body: 'Open Waypoint to see what that means. You can step down at any time.', channel: 'safety' },
  checkin_prompt: { title: 'Time to check in', body: 'Let us know you are okay. It takes one tap.', channel: 'safety' },
  checkin_missed: { title: 'Please check on a friend', body: 'A friend has not confirmed they are okay. Please try to reach them.', channel: 'safety' },
  checkin_help: { title: 'A friend asked for help', body: 'A friend has asked for help. Please reach out to them now.', channel: 'safety' },
  checkin_safe: { title: 'Good news', body: 'The friend you were worried about has confirmed they are okay.', channel: 'safety' },
  moderation_notice: { title: 'An update on your account', body: 'Open Waypoint to read an important message about your account.', channel: 'safety' },
  verification_result: { title: 'Photo verification update', body: 'Your photo verification was reviewed. Open the app to see the result.', channel: 'safety' },
  export_ready: { title: 'Your data export is ready', body: 'Open Waypoint within 7 days to download it.', channel: 'safety' },
};
/** True when this code knows how to word a push for `kind` (the database may know kinds this deployment does not). */
export const hasPushCopy = (kind: string): kind is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(kind);
/** Safety alerts are never held back by quiet hours: a check-in prompt or a call for help at 2am is exactly when it matters. */
export const URGENT_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['checkin_prompt', 'checkin_missed', 'checkin_help', 'checkin_safe']);
export const renderNotification = (kind: NotificationKind) => COPY[kind];

/** True when local time in `tz` falls inside [start, end), where the window may wrap past midnight. */
export function inQuietHours(now: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now); }
  catch { return false; }
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const cur = h * 60 + m, s = toMin(start), e = toMin(end);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** 'stored' = saved and pushed; 'duplicate' = this dedupeKey was already stored; 'failed' = could not even be saved (callers that must not lose a message retry). */
export type SendResult = 'stored' | 'duplicate' | 'failed';
/** send = store the in-app notification, then push. deliverPush = push only (the row already exists, e.g. written by the database). */
export interface Notifier { send(n: NotificationInput): Promise<SendResult>; deliverPush(n: NotificationInput): Promise<void> }

/** Stores the in-app notification first (always), then best-effort push. Never throws to callers. */
export function createNotifier(deps: { store: Store; sender: PushSender; clock: () => Date; log?: (m: string) => void }): Notifier {
  const log = deps.log ?? (() => {});
  async function push(n: NotificationInput): Promise<void> {
    const prefs = await deps.store.getPrefs(n.userId, n.kind);
    if (!prefs.push) return;
    const flags = await deps.store.getUserFlags(n.userId);
    if (flags && !URGENT_KINDS.has(n.kind) && inQuietHours(deps.clock(), flags.timezone, prefs.quietStart, prefs.quietEnd)) return;
    const tokens = await deps.store.listPushTokens(n.userId);
    if (!tokens.length) return;
    const copy = COPY[n.kind];
    const data: Record<string, string> = { kind: n.kind };
    for (const [k, v] of Object.entries(n.payload)) if (v !== null && k.endsWith('Id')) data[k] = String(v);
    for (const t of tokens) {
      const res = await deps.sender.send(t.token, { title: copy.title, body: copy.body, data, channel: copy.channel }, t.platform);
      if (res === 'invalid_token') await deps.store.removePushToken(t.token);
    }
  }
  return {
    async send(n) {
      let stored: boolean;
      try { stored = await deps.store.addNotification(n); } catch (e) { log(`notify failed: ${(e as Error).message}`); return 'failed'; }
      if (!stored) return 'duplicate';
      try { await push(n); } catch (e) { log(`push failed: ${(e as Error).message}`); }
      return 'stored';
    },
    async deliverPush(n) {
      try { if (hasPushCopy(n.kind)) await push(n); } catch (e) { log(`push failed: ${(e as Error).message}`); }
    },
  };
}

/** What the "Send test notification" button gets back. `error` names the first thing that went wrong so the app can say what to do. */
export interface PushTestResult {
  /** Phones registered for this account. */
  tokens: number;
  /** Phones the push service accepted the test for. */
  sent: number;
  error: 'not_configured' | 'no_token' | 'token_invalid' | 'send_failed' | null;
}
export interface PushTester { configured: boolean; test(userId: string): Promise<PushTestResult> }

/**
 * Sends one harmless test push to the caller's own registered phones.
 * `configured` is false when FCM_SERVICE_ACCOUNT_JSON is not set (the sender is then a no-op that would pretend to succeed).
 * The text is fixed: no names, no vibes, nothing from the database.
 */
export function createPushTester(deps: { store: Store; sender: PushSender; configured: boolean; log?: (m: string) => void }): PushTester {
  const log = deps.log ?? (() => {});
  return {
    configured: deps.configured,
    async test(userId) {
      const tokens = await deps.store.listPushTokens(userId);
      if (!deps.configured) return { tokens: tokens.length, sent: 0, error: 'not_configured' };
      if (!tokens.length) return { tokens: 0, sent: 0, error: 'no_token' };
      let sent = 0, invalid = 0, failed = 0;
      for (const t of tokens) {
        try {
          const r = await deps.sender.send(t.token, { title: 'Test notification', body: 'Notifications are working on this phone.', data: { kind: 'push_test' }, channel: 'messages' }, t.platform);
          if (r === 'ok') sent++;
          else if (r === 'invalid_token') { invalid++; await deps.store.removePushToken(t.token); }
          else failed++;
        } catch (e) { failed++; log(`push test failed: ${(e as Error).message}`); }
      }
      if (sent > 0) return { tokens: tokens.length, sent, error: null };
      return { tokens: tokens.length, sent: 0, error: invalid > 0 && failed === 0 ? 'token_invalid' : 'send_failed' };
    },
  };
}
