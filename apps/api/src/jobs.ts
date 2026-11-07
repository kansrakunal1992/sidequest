import { assembleRouletteGroups, splitRouletteActivity, transitionInvite } from '@sidequest/shared';
import type { SupabaseAdmin } from './supabase-admin.ts';
import { EXPORT_BUCKET, USER_FILE_BUCKETS } from './supabase-admin.ts';
import type { Notifier } from './notifications.ts';
import type { Store } from './store.ts';

export interface JobDeps { store: Store; notifier: Notifier; clock: () => Date; log?: (m: string) => void }

/** Pending/reschedule invites past their expiry become 'expired'; the sender is told. */
export async function expireInvites(d: JobDeps): Promise<number> {
  const now = d.clock();
  const due = await d.store.expirableInvites(now, 200);
  let n = 0;
  for (const inv of due) {
    const r = transitionInvite({ state: inv.state, proposedBy: inv.proposedBy, startsAt: inv.startsAt, now }, 'expire', 'system');
    if (!r.ok) continue;
    inv.state = r.state; inv.proposedBy = null; inv.sequence += 1;
    await d.store.saveInvite(inv);
    await d.notifier.send({ userId: inv.senderId, kind: 'invite_expired', payload: { inviteId: inv.id }, dedupeKey: `expired:${inv.id}` });
    n += 1;
  }
  return n;
}

const REMINDER_WINDOWS_MIN = [60, 15];
/** One reminder per window per person; only the tightest applicable window fires, and dedupe makes reruns safe. */
export async function sendReminders(d: JobDeps): Promise<number> {
  const now = d.clock();
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_WINDOWS_MIN) * 60_000);
  let n = 0;
  for (const inv of await d.store.confirmedInvitesStartingBetween(now, horizon)) {
    const minsLeft = (inv.startsAt.getTime() - now.getTime()) / 60_000;
    const window = [...REMINDER_WINDOWS_MIN].sort((a, b) => a - b).find((w) => minsLeft <= w);
    if (!window) continue;
    for (const userId of [inv.senderId, inv.recipientId]) {
      await d.notifier.send({ userId, kind: 'invite_reminder', payload: { inviteId: inv.id, minutes: window }, dedupeKey: `reminder:${inv.id}:${inv.sequence}:${window}` });
      n += 1;
    }
  }
  return n;
}

export const expireOpenCalls = (d: JobDeps): Promise<number> => d.store.expireOpenCalls(d.clock());

/**
 * Forms Social Roulette tables with the shared grouping rules (blocks respected) and notifies members.
 * The database re-checks every signup when the table is formed; if anything changed it refuses, nobody is notified,
 * and the same people are simply considered again on the next run.
 */
export async function runRoulette(d: JobDeps): Promise<{ groups: number; waitlisted: number; refused: number }> {
  const cands = await d.store.rouletteCandidates(d.clock());
  const bySeat = new Map(cands.map((c) => [`${c.userId}|${c.mode}|${c.activity}|${c.slot}|${c.groupSize}`, c]));
  const { groups, waitlist } = assembleRouletteGroups(cands.map((c) => ({
    userId: c.userId, mode: c.mode, activity: c.activity, slot: c.slot, energy: c.energy, groupSize: c.groupSize, blockedUserIds: c.blockedUserIds })));
  let formed = 0, refused = 0;
  for (const g of groups) {
    const members = g.memberIds.map((u) => bySeat.get(`${u}|${g.key}`)).filter((m): m is NonNullable<typeof m> => !!m);
    if (members.length !== g.memberIds.length) continue;
    if (!(await d.store.createRouletteGroup(g.memberIds, members.map((m) => m.signupId), g.key))) { refused += 1; continue; }
    formed += 1;
    const { activity } = splitRouletteActivity(members[0]!.activity);   // the area is only for grouping; never sent in a notification
    for (const m of members) await d.notifier.send({ userId: m.userId, kind: 'roulette_group_ready', payload: { slot: m.slot, activity }, dedupeKey: `roulette:${m.signupId}` });
  }
  const seated = new Set(groups.flatMap((g) => g.memberIds));
  const waitIds = cands.filter((c) => waitlist.includes(c.userId) && !seated.has(c.userId)).map((c) => c.signupId);
  if (waitIds.length) await d.store.markRouletteWaitlisted(waitIds);
  return { groups: formed, waitlisted: waitIds.length, refused };
}

// ===== Suspensions =============================================================================================
/** A suspension with an end date ends by itself. Run every 10 minutes. */
export const liftSuspensions = (d: JobDeps): Promise<number> => d.store.liftExpiredSuspensions();

// ===== Meeting check-ins =======================================================================================
export const CHECKIN_ESCALATE_AFTER_MIN = 30;
/** If the worker was down and a check-in is this late, asking "are you okay?" now would only confuse; it is closed instead and logged. */
export const CHECKIN_STALE_AFTER_HOURS = 6;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/**
 * Asks the person to confirm they are okay when their check-in time arrives.
 * Each check-in is claimed atomically (scheduled -> prompted) before the message is stored, so reruns and two workers never double-prompt;
 * if the message cannot even be saved the claim is undone and it is retried on the next run.
 */
export async function promptCheckins(d: JobDeps): Promise<{ prompted: number; cancelled: number; stale: number }> {
  const now = d.clock(); const log = d.log ?? (() => {});
  let prompted = 0, cancelled = 0, stale = 0;
  for (const c of await d.store.dueCheckins(now, 200)) {
    if (c.userState === 'deleted' || !c.planActive) { if (await d.store.moveCheckin(c.id, 'scheduled', 'cancelled', now)) cancelled += 1; continue; }
    if (now.getTime() - c.checkInAt.getTime() > CHECKIN_STALE_AFTER_HOURS * HOUR) {
      if (await d.store.moveCheckin(c.id, 'scheduled', 'cancelled', now)) { stale += 1; log(`check-in ${c.id} was ${Math.round((now.getTime() - c.checkInAt.getTime()) / HOUR)}h late and was closed without a prompt`); }
      continue;
    }
    if (!(await d.store.moveCheckin(c.id, 'scheduled', 'prompted', now))) continue;
    const r = await d.notifier.send({ userId: c.userId, kind: 'checkin_prompt', payload: { checkinId: c.id }, dedupeKey: `checkin:${c.id}:prompt` });
    if (r === 'failed') { await d.store.moveCheckin(c.id, 'prompted', 'scheduled', now); continue; }
    prompted += 1;
  }
  return { prompted, cancelled, stale };
}

/**
 * Tells the trusted contact when a prompted check-in has gone unanswered for 30 minutes.
 * The state change (prompted -> missed) happens first and atomically, so someone who taps "I'm safe" in the same moment is never reported.
 * The contact's notification carries the friend's name inside the app only; the push itself stays name-free.
 */
export async function escalateCheckins(d: JobDeps): Promise<{ escalated: number; noContact: number }> {
  const now = d.clock(); const log = d.log ?? (() => {});
  let escalated = 0, noContact = 0;
  for (const c of await d.store.unansweredCheckins(new Date(now.getTime() - CHECKIN_ESCALATE_AFTER_MIN * MIN), 200)) {
    if (!(await d.store.moveCheckin(c.id, 'prompted', 'missed', now))) continue;
    if (!c.contactUserId) { noContact += 1; log(`check-in ${c.id} missed but its trusted contact is gone`); continue; }
    const r = await d.notifier.send({ userId: c.contactUserId, kind: 'checkin_missed', payload: { checkinId: c.id, name: c.userName }, dedupeKey: `checkin:${c.id}:missed` });
    if (r === 'failed') { await d.store.moveCheckin(c.id, 'missed', 'prompted', now); continue; }   // keeps the original prompt time, so it is retried at once
    escalated += 1;
  }
  return { escalated, noContact };
}

// ===== Data requests (export and deletion) ======================================================================
export const DELETION_GRACE_DAYS = 7;
export const EXPORT_LINK_DAYS = 7;
export const DATA_REQUEST_MAX_ATTEMPTS = 5;
const STALE_CLAIM_MIN = 30;
/** A failed request waits this long before its next attempt, so a transient outage is not burned through in one run. */
export const DATA_REQUEST_RETRY_MIN = 5;
export interface DataJobDeps extends JobDeps { admin: SupabaseAdmin }

/** Builds each queued export, stores it in the private `exports` bucket under the person's own folder, and tells them it is ready. */
export async function processExports(d: DataJobDeps, max = 10): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0; const log = d.log ?? (() => {});
  for (let i = 0; i < max; i += 1) {
    const now = d.clock();
    const req = await d.store.claimDataRequest({ kind: 'export', requestedBefore: now, retryBefore: new Date(now.getTime() - DATA_REQUEST_RETRY_MIN * MIN), staleBefore: new Date(now.getTime() - STALE_CLAIM_MIN * MIN), now, maxAttempts: DATA_REQUEST_MAX_ATTEMPTS });
    if (!req) break;
    try {
      const body = await d.store.exportUserData(req.userId);
      if (!body) throw new Error('nothing to export');
      const path = `${req.userId}/${req.id}.json`;
      await d.admin.uploadJson(EXPORT_BUCKET, path, JSON.stringify(body, null, 2));
      await d.store.completeExport(req.id, path, d.clock());
      await d.notifier.send({ userId: req.userId, kind: 'export_ready', payload: { requestId: req.id }, dedupeKey: `export:${req.id}` });
      done += 1;
    } catch (e) {
      failed += 1; log(`export ${req.id} failed: ${(e as Error).message}`);
      await d.store.failDataRequest(req.id, (e as Error).message, DATA_REQUEST_MAX_ATTEMPTS);
    }
  }
  return { done, failed };
}

/**
 * Removes accounts whose 7-day deletion window has passed: files first (safe to repeat), then the login account via the Supabase Admin API,
 * whose database cascades remove the profile and everything attached. Requests the person cancelled are never touched.
 */
export async function processDeletions(d: DataJobDeps, max = 5): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0; const log = d.log ?? (() => {});
  for (let i = 0; i < max; i += 1) {
    const now = d.clock();
    const req = await d.store.claimDataRequest({ kind: 'deletion', requestedBefore: new Date(now.getTime() - DELETION_GRACE_DAYS * DAY), retryBefore: new Date(now.getTime() - DATA_REQUEST_RETRY_MIN * MIN), staleBefore: new Date(now.getTime() - STALE_CLAIM_MIN * MIN), now, maxAttempts: DATA_REQUEST_MAX_ATTEMPTS });
    if (!req) break;
    try {
      for (const bucket of USER_FILE_BUCKETS) await d.admin.removeUserFolder(bucket, req.userId);
      await d.admin.deleteAuthUser(req.userId);
      await d.store.completeDeletion(req.id, d.clock());
      log(`deleted account for request ${req.id}`);
      done += 1;
    } catch (e) {
      failed += 1; log(`deletion ${req.id} failed: ${(e as Error).message}`);
      if (await d.store.failDataRequest(req.id, (e as Error).message, DATA_REQUEST_MAX_ATTEMPTS) === 'failed') log(`ALERT: deletion ${req.id} gave up after ${DATA_REQUEST_MAX_ATTEMPTS} attempts and needs a person to look at it`);
    }
  }
  return { done, failed };
}

/** Export files are links that last a week; after that the file itself is removed too. */
export async function purgeExpiredExports(d: DataJobDeps): Promise<number> {
  let n = 0;
  for (const x of await d.store.expiredExports(new Date(d.clock().getTime() - EXPORT_LINK_DAYS * DAY), 100)) {
    try { await d.admin.removeObjects(EXPORT_BUCKET, [x.path]); await d.store.clearExportPath(x.id); n += 1; }
    catch (e) { (d.log ?? (() => {}))(`could not remove expired export ${x.id}: ${(e as Error).message}`); }
  }
  return n;
}
