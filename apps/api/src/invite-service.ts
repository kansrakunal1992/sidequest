import { IN_PERSON_MIN_LEAD_MINUTES, canStartContact, evaluateInviteRate, generateIcs, meetTitle, transitionInvite } from '@sidequest/shared';
import type { InviteEvent, Party } from '@sidequest/shared';
import type { Store } from './store.ts';
import type { CreateInviteInput, RescheduleInput } from './validate.ts';
import { err, ok } from './types.ts';
import type { CalendarEntry, Invite, InviteFormat, NotificationInput, Result } from './types.ts';

export interface InviteDeps {
  store: Store;
  clock: () => Date;
  notify: (n: NotificationInput) => Promise<void>;
}

const MIN_LEAD_MS = 5 * 60_000;
const MAX_LEAD_MS = 90 * 86_400_000;
const PENDING_TTL_MS = 7 * 86_400_000;
const CALL_FORMATS: InviteFormat[] = ['voice', 'video', 'virtual_coffee'];
const DAY_MS = 86_400_000;

const TITLES: Record<InviteFormat, (n: string) => string> = {
  text: (n) => `Text chat with ${n}`,
  voice: (n) => `Voice call with ${n}`,
  video: (n) => `Video call with ${n}`,
  virtual_coffee: (n) => `Virtual coffee with ${n}`,
  intro_chat: (n) => `Intro chat with ${n}`,
  in_person: (n) => `Meet ${n}`,
};
/** In-person plans are named after the activity ("A walk with Aman"); every other format keeps its fixed title. */
const titleFor = (inv: Pick<Invite, 'format' | 'activity'>, name: string): string =>
  inv.format === 'in_person' ? meetTitle(inv.activity, name) : TITLES[inv.format](name);

export class InviteService {
  deps: InviteDeps;
  constructor(deps: InviteDeps) { this.deps = deps; }

  private partyOf(inv: Invite, actorId: string): Party | null {
    return actorId === inv.senderId ? 'sender' : actorId === inv.recipientId ? 'recipient' : null;
  }
  private other(inv: Invite, actorId: string): string { return actorId === inv.senderId ? inv.recipientId : inv.senderId; }
  private expiryFor(now: Date, startsAt: Date): Date { return new Date(Math.min(startsAt.getTime(), now.getTime() + PENDING_TTL_MS)); }

  private checkSlot(now: Date, startsAt: Date): Result<true> {
    const lead = startsAt.getTime() - now.getTime();
    return lead < MIN_LEAD_MS || lead > MAX_LEAD_MS ? err(400, 'start_time_out_of_range') : ok(true);
  }

  private async load(actorId: string, id: string): Promise<Result<{ inv: Invite; party: Party }>> {
    const inv = await this.deps.store.getInvite(id);
    const party = inv ? this.partyOf(inv, actorId) : null;
    // Same response for "does not exist" and "not yours" so ids cannot be probed.
    if (!inv || !party) return err(404, 'not_found');
    return ok({ inv, party });
  }

  async create(actorId: string, input: CreateInviteInput): Promise<Result<Invite>> {
    const { store } = this.deps;
    const now = this.deps.clock();
    if (actorId === input.recipientId) return err(400, 'cannot_invite_self');
    const slot = this.checkSlot(now, input.startsAt);
    if (!slot.ok) return slot;
    // A meetup needs a little notice so the other person can answer and a friend can be told.
    if (input.format === 'in_person' && input.startsAt.getTime() - now.getTime() < IN_PERSON_MIN_LEAD_MINUTES * 60_000) return err(400, 'start_time_out_of_range');

    const [sender, recipient] = await Promise.all([store.getUserFlags(actorId), store.getUserFlags(input.recipientId)]);
    if (!sender || sender.state !== 'active') return err(403, 'account_restricted');
    if (!recipient || recipient.state !== 'active') return err(404, 'unavailable');

    const [blocked, matched, senderActive, recipientActive] = await Promise.all([
      store.isBlocked(actorId, input.recipientId),
      store.isMatched(actorId, input.recipientId, input.modeId),
      store.isActiveInMode(actorId, input.modeId),
      store.isActiveInMode(input.recipientId, input.modeId),
    ]);
    const decision = canStartContact({
      mode: input.modeId, kind: 'intro_invite', matched, blocked,
      senderActiveInMode: senderActive, recipientActiveInMode: recipientActive,
      recipientAcceptsIntros: recipient.acceptsIntros,
    });
    if (!decision.allowed) return decision.reason === 'needs_match' ? err(403, 'needs_match') : err(404, 'unavailable');
    // Meeting in person is only offered between people who have matched in this vibe.
    if (input.format === 'in_person' && !matched) return err(403, 'needs_match');

    const [sent, pending] = await Promise.all([
      store.countSentSince(actorId, new Date(now.getTime() - DAY_MS)),
      store.countPending(actorId, input.recipientId),
    ]);
    const rate = evaluateInviteRate({ sentLast24h: sent.total, sentToNonMatchesLast24h: sent.toNonMatches, pendingToRecipient: pending, isMatch: matched });
    if (!rate.allowed) return err(429, rate.reason);

    const inv = await store.insertInvite({
      senderId: actorId, recipientId: input.recipientId, modeId: input.modeId, format: input.format,
      state: 'pending', proposedBy: null, startsAt: input.startsAt, timezone: input.timezone,
      durationMinutes: input.durationMinutes, note: input.note,
      activity: input.activity, venueName: input.venueName, areaLabel: input.areaLabel, sequence: 0,
      expiresAt: this.expiryFor(now, input.startsAt), conversationId: null,
    });
    await this.deps.notify({ userId: inv.recipientId, kind: 'invite_received', payload: { inviteId: inv.id } });
    return ok(inv);
  }

  async get(actorId: string, id: string): Promise<Result<Invite>> {
    const l = await this.load(actorId, id);
    return l.ok ? ok(l.value.inv) : l;
  }

  async list(actorId: string, box: 'incoming' | 'outgoing' | 'all'): Promise<Invite[]> {
    return this.deps.store.listInvitesFor(actorId, box, 100);
  }

  /** accept | decline | too_new | cancel | complete */
  async act(actorId: string, id: string, action: 'accept' | 'decline' | 'too_new' | 'cancel' | 'complete'): Promise<Result<Invite>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv, party } = l.value;
    const event: InviteEvent = action === 'too_new' ? 'mark_too_new' : action;
    const now = this.deps.clock();
    const r = transitionInvite({ state: inv.state, proposedBy: inv.proposedBy, startsAt: inv.startsAt, now }, event, party);
    if (!r.ok) return err(409, 'invalid_transition', r.error);

    const { store } = this.deps;
    inv.state = r.state; inv.proposedBy = r.proposedBy; inv.sequence += 1;
    if (r.state === 'accepted') inv.conversationId = await store.ensureConversation(inv.senderId, inv.recipientId, inv.modeId);
    await store.saveInvite(inv);

    const otherId = this.other(inv, actorId);
    const payload = { inviteId: inv.id };
    switch (r.state) {
      case 'accepted': await this.syncCalendar(inv, 'confirmed'); await this.deps.notify({ userId: otherId, kind: 'invite_accepted', payload }); break;
      case 'declined': await this.deps.notify({ userId: otherId, kind: 'invite_declined', payload }); break;
      case 'too_new': await this.deps.notify({ userId: otherId, kind: 'invite_too_new', payload }); break;
      case 'cancelled':
        await store.setCalendarStatus(inv.id, 'cancelled', inv.sequence);
        await this.deps.notify({ userId: otherId, kind: 'invite_cancelled', payload }); break;
      case 'completed':
        await store.setCalendarStatus(inv.id, 'completed', inv.sequence);
        for (const u of [inv.senderId, inv.recipientId]) await this.deps.notify({ userId: u, kind: 'post_meet_prompt', payload, dedupeKey: `post-meet:${inv.id}` });
        break;
    }
    return ok(inv);
  }

  async requestReschedule(actorId: string, id: string, input: RescheduleInput): Promise<Result<Invite>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv, party } = l.value;
    const now = this.deps.clock();
    const slot = this.checkSlot(now, input.startsAt);
    if (!slot.ok) return slot;
    const r = transitionInvite({ state: inv.state, proposedBy: inv.proposedBy, startsAt: inv.startsAt, now }, 'request_reschedule', party);
    if (!r.ok) return err(409, 'invalid_transition', r.error);

    await this.deps.store.insertProposal({ inviteId: inv.id, proposedBy: actorId, startsAt: input.startsAt, durationMinutes: input.durationMinutes, note: input.note });
    inv.state = r.state; inv.proposedBy = r.proposedBy; inv.sequence += 1;
    inv.expiresAt = this.expiryFor(now, input.startsAt);
    await this.deps.store.saveInvite(inv);
    await this.deps.notify({ userId: this.other(inv, actorId), kind: 'invite_reschedule_requested', payload: { inviteId: inv.id } });
    return ok(inv);
  }

  async acceptReschedule(actorId: string, id: string): Promise<Result<Invite>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv, party } = l.value;
    const now = this.deps.clock();
    const r = transitionInvite({ state: inv.state, proposedBy: inv.proposedBy, startsAt: inv.startsAt, now }, 'accept_reschedule', party);
    if (!r.ok) return err(409, 'invalid_transition', r.error);
    const proposal = await this.deps.store.latestProposal(inv.id);
    if (!proposal) return err(409, 'no_proposal');
    if (proposal.startsAt.getTime() - now.getTime() < MIN_LEAD_MS) return err(409, 'proposal_in_past');

    inv.state = r.state; inv.proposedBy = null; inv.sequence += 1;
    inv.startsAt = proposal.startsAt; inv.durationMinutes = proposal.durationMinutes;
    if (!inv.conversationId) inv.conversationId = await this.deps.store.ensureConversation(inv.senderId, inv.recipientId, inv.modeId);
    await this.deps.store.saveInvite(inv);
    await this.syncCalendar(inv, 'confirmed');
    await this.deps.notify({ userId: proposal.proposedBy, kind: 'invite_rescheduled', payload: { inviteId: inv.id } });
    return ok(inv);
  }

  /** After "Too new to say hi": only the recipient can choose to say hello, and only if they allow it. */
  async startLightChat(actorId: string, id: string): Promise<Result<{ conversationId: string }>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv, party } = l.value;
    if (party !== 'recipient') return err(403, 'recipient_only');
    if (inv.state !== 'too_new') return err(409, 'invalid_transition');
    const flags = await this.deps.store.getUserFlags(actorId);
    if (!flags?.allowLightChat) return err(403, 'light_chat_disabled');
    const conversationId = await this.deps.store.ensureConversation(inv.senderId, inv.recipientId, inv.modeId);
    inv.conversationId = conversationId;
    await this.deps.store.saveInvite(inv);
    await this.deps.notify({ userId: inv.senderId, kind: 'light_chat_started', payload: { inviteId: inv.id } });
    return ok({ conversationId });
  }

  async ics(actorId: string, id: string): Promise<Result<string>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv } = l.value;
    if (!['accepted', 'rescheduled', 'cancelled'].includes(inv.state)) return err(409, 'no_calendar_event');
    const name = (await this.deps.store.getUserFlags(this.other(inv, actorId)))?.displayName ?? 'someone';
    return ok(generateIcs({
      uid: `invite-${inv.id}@sidequest.app`, title: titleFor(inv, name),
      ...(inv.venueName && inv.areaLabel ? { location: `${inv.venueName}, ${inv.areaLabel}` } : {}),
      description: 'Arranged on Waypoint. Open the app for details and to reschedule.',
      startsAt: inv.startsAt, durationMinutes: inv.durationMinutes, sequence: inv.sequence,
      status: inv.state === 'cancelled' ? 'CANCELLED' : 'CONFIRMED', now: this.deps.clock(),
    }));
  }

  /** Who may join a live call, and when. The caller turns this into a provider token. */
  async callWindow(actorId: string, id: string): Promise<Result<{ room: string; from: Date; until: Date }>> {
    const l = await this.load(actorId, id);
    if (!l.ok) return l;
    const { inv } = l.value;
    if (!CALL_FORMATS.includes(inv.format)) return err(409, 'not_a_call');
    if (inv.state !== 'accepted' && inv.state !== 'rescheduled') return err(409, 'not_confirmed');
    const from = new Date(inv.startsAt.getTime() - 10 * 60_000);
    const until = new Date(inv.startsAt.getTime() + (inv.durationMinutes + 30) * 60_000);
    const now = this.deps.clock();
    if (now < from) return err(409, 'too_early');
    if (now > until) return err(409, 'call_ended');
    return ok({ room: `invite-${inv.id}`, from, until });
  }

  private async syncCalendar(inv: Invite, status: CalendarEntry['status']): Promise<void> {
    const { store } = this.deps;
    const endsAt = new Date(inv.startsAt.getTime() + inv.durationMinutes * 60_000);
    for (const [userId, otherId] of [[inv.senderId, inv.recipientId], [inv.recipientId, inv.senderId]] as const) {
      const name = (await store.getUserFlags(otherId))?.displayName ?? 'someone';
      await store.upsertCalendar({ userId, sourceType: 'invite', sourceId: inv.id, title: titleFor(inv, name), startsAt: inv.startsAt, endsAt, status, sequence: inv.sequence });
    }
  }
}
