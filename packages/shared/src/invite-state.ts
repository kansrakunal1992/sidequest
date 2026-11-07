export const INVITE_STATES = [
  'pending', 'accepted', 'declined', 'reschedule_requested', 'rescheduled',
  'too_new', 'cancelled', 'completed', 'expired',
] as const;
export type InviteState = (typeof INVITE_STATES)[number];

export type InviteEvent =
  | 'accept' | 'decline' | 'request_reschedule' | 'accept_reschedule'
  | 'mark_too_new' | 'cancel' | 'complete' | 'expire';
export type Party = 'sender' | 'recipient';
export type InviteActor = Party | 'system';

export interface InviteContext {
  state: InviteState;
  /** Who made the currently open time proposal (only meaningful in reschedule_requested). */
  proposedBy: Party | null;
  /** Start of the currently agreed or proposed slot. */
  startsAt: Date;
  now: Date;
}

export type TransitionResult =
  | { ok: true; state: InviteState; proposedBy: Party | null }
  | { ok: false; error: string };

const TERMINAL: InviteState[] = ['declined', 'cancelled', 'completed', 'expired'];
export const isTerminal = (s: InviteState) => TERMINAL.includes(s);
export const isConfirmed = (s: InviteState) => s === 'accepted' || s === 'rescheduled';

const ok = (state: InviteState, proposedBy: Party | null = null): TransitionResult => ({ ok: true, state, proposedBy });
const fail = (error: string): TransitionResult => ({ ok: false, error });

export function transitionInvite(ctx: InviteContext, event: InviteEvent, actor: InviteActor): TransitionResult {
  const { state } = ctx;
  if (isTerminal(state)) return fail(`Invite is already ${state}`);

  if (event === 'expire') {
    if (actor !== 'system') return fail('Only the system can expire an invite');
    if (state === 'too_new' || isConfirmed(state)) return fail(`A ${state} invite does not expire`);
    return ok('expired');
  }
  if (actor === 'system') return fail('The system may only expire invites');

  switch (state) {
    case 'pending':
      if (actor === 'recipient') {
        if (event === 'accept') return ok('accepted');
        if (event === 'decline') return ok('declined');
        if (event === 'request_reschedule') return ok('reschedule_requested', 'recipient');
        if (event === 'mark_too_new') return ok('too_new');
      } else if (event === 'cancel') return ok('cancelled');
      break;

    case 'reschedule_requested': {
      const proposer = ctx.proposedBy;
      if (!proposer) return fail('Reschedule has no proposer');
      if (event === 'cancel') return ok('cancelled');
      if (actor !== proposer) {
        if (event === 'accept_reschedule') return ok('rescheduled');
        if (event === 'request_reschedule') return ok('reschedule_requested', actor); // counter-proposal
        if (event === 'decline') return ok('declined');
      }
      break;
    }

    case 'accepted':
    case 'rescheduled':
      if (event === 'cancel') return ok('cancelled');
      if (event === 'request_reschedule') return ok('reschedule_requested', actor);
      if (event === 'complete') {
        return ctx.now.getTime() >= ctx.startsAt.getTime() ? ok('completed') : fail('Meeting has not started yet');
      }
      break;

    case 'too_new':
      // The recipient can come back later and propose a time; the sender cannot push.
      if (actor === 'recipient') {
        if (event === 'request_reschedule') return ok('reschedule_requested', 'recipient');
        if (event === 'decline') return ok('declined');
      } else if (event === 'cancel') return ok('cancelled');
      break;
  }
  return fail(`'${event}' by ${actor} is not allowed while the invite is ${state}`);
}

/** After "Too new to say hi", a light-touch chat may continue if the recipient allows it. */
export function lightweightChatAllowed(state: InviteState, recipientAllows: boolean): boolean {
  return state === 'too_new' && recipientAllows;
}
