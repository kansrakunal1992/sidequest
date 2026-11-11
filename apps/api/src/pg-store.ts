import { parseRouletteKey, withRouletteArea } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';
import type { Store } from './store.ts';
import type {
  CalendarEntry, CalendarStatus, Invite, NotificationInput, NotificationKind, NotificationPrefs, Proposal,
  MessageMedia, PhotoRow, PhotoStatus, RouletteCandidate, UserFlags,
  CheckinStatus, DataRequest, DataRequestKind, DueCheckin, ExportRecord, UnansweredCheckin,
} from './types.ts';

export interface PgLike { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> }

const inviteFrom = (r: any): Invite => ({
  id: r.id, senderId: r.sender_id, recipientId: r.recipient_id, modeId: r.mode_id, format: r.format, state: r.state,
  proposedBy: r.proposed_by, startsAt: new Date(r.starts_at), timezone: r.timezone, durationMinutes: r.duration_minutes,
  note: r.note, activity: r.activity ?? null, venueName: r.venue_name ?? null, areaLabel: r.area_label ?? null,
  sequence: r.sequence, expiresAt: new Date(r.expires_at), conversationId: r.conversation_id, createdAt: new Date(r.created_at),
});
const proposalFrom = (r: any): Proposal => ({
  id: r.id, inviteId: r.invite_id, proposedBy: r.proposed_by, startsAt: new Date(r.starts_at),
  durationMinutes: r.duration_minutes, note: r.note, createdAt: new Date(r.created_at),
});

/**
 * Production store. Connects with the database owner (service) role, so RLS is bypassed:
 * every query here must therefore scope by the ids it is given. Never expose this to clients.
 * STATUS: written but NOT yet run against a real Postgres.
 */
export class PgStore implements Store {
  db: PgLike;
  constructor(db: PgLike) { this.db = db; }

  async getInvite(id: string) {
    const r = await this.db.query('select * from conversation_invites where id = $1', [id]);
    return r.rows[0] ? inviteFrom(r.rows[0]) : null;
  }
  async insertInvite(i: Omit<Invite, 'id' | 'createdAt'>) {
    const r = await this.db.query(
      `insert into conversation_invites (sender_id, recipient_id, mode_id, format, state, proposed_by, starts_at, timezone, duration_minutes, note, sequence, expires_at, conversation_id, activity, venue_name, area_label)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [i.senderId, i.recipientId, i.modeId, i.format, i.state, i.proposedBy, i.startsAt, i.timezone, i.durationMinutes, i.note, i.sequence, i.expiresAt, i.conversationId, i.activity, i.venueName, i.areaLabel]);
    return inviteFrom(r.rows[0]);
  }
  async saveInvite(i: Invite) {
    await this.db.query(
      `update conversation_invites set state=$2, proposed_by=$3, starts_at=$4, duration_minutes=$5, note=$6, sequence=$7, expires_at=$8, conversation_id=$9
       where id=$1`,
      [i.id, i.state, i.proposedBy, i.startsAt, i.durationMinutes, i.note, i.sequence, i.expiresAt, i.conversationId]);
  }
  async latestProposal(inviteId: string) {
    const r = await this.db.query('select * from invite_time_proposals where invite_id = $1 order by created_at desc limit 1', [inviteId]);
    return r.rows[0] ? proposalFrom(r.rows[0]) : null;
  }
  async insertProposal(p: Omit<Proposal, 'id' | 'createdAt'>) {
    const r = await this.db.query(
      'insert into invite_time_proposals (invite_id, proposed_by, starts_at, duration_minutes, note) values ($1,$2,$3,$4,$5) returning *',
      [p.inviteId, p.proposedBy, p.startsAt, p.durationMinutes, p.note]);
    return proposalFrom(r.rows[0]);
  }
  async listInvitesFor(userId: string, box: 'incoming' | 'outgoing' | 'all', limit: number) {
    const where = box === 'incoming' ? 'recipient_id = $1' : box === 'outgoing' ? 'sender_id = $1' : '(recipient_id = $1 or sender_id = $1)';
    const r = await this.db.query(`select * from conversation_invites where ${where} order by created_at desc limit $2`, [userId, limit]);
    return r.rows.map(inviteFrom);
  }

  async countSentSince(senderId: string, since: Date) {
    const r = await this.db.query(
      `select count(*)::int as total, count(*) filter (where not s.matched)::int as non
         from (select exists (select 1 from matches m
                               where m.user_a = least(i.sender_id, i.recipient_id) and m.user_b = greatest(i.sender_id, i.recipient_id)
                                 and m.mode_id = i.mode_id and m.unmatched_at is null) as matched
                 from conversation_invites i where i.sender_id = $1 and i.created_at >= $2) s`, [senderId, since]);
    return { total: r.rows[0].total as number, toNonMatches: r.rows[0].non as number };
  }
  async countPending(senderId: string, recipientId: string) {
    const r = await this.db.query("select count(*)::int as n from conversation_invites where sender_id=$1 and recipient_id=$2 and state='pending'", [senderId, recipientId]);
    return r.rows[0].n as number;
  }
  async isMatched(a: string, b: string, mode: ModeId) {
    const r = await this.db.query(
      'select 1 from matches where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid) and mode_id = $3 and unmatched_at is null', [a, b, mode]);
    return r.rows.length > 0;
  }
  async isBlocked(a: string, b: string) {
    const r = await this.db.query('select 1 from blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)', [a, b]);
    return r.rows.length > 0;
  }
  async getUserFlags(userId: string): Promise<UserFlags | null> {
    const r = await this.db.query(
      'select state, accepts_intro_invites, allow_light_chat_after_too_new, timezone, display_name from profiles where id = $1', [userId]);
    const x = r.rows[0];
    return x ? { state: x.state, acceptsIntros: x.accepts_intro_invites, allowLightChat: x.allow_light_chat_after_too_new, timezone: x.timezone, displayName: x.display_name } : null;
  }
  async isActiveInMode(userId: string, mode: ModeId) {
    const r = await this.db.query('select 1 from user_active_modes where user_id=$1 and mode_id=$2 and not paused', [userId, mode]);
    return r.rows.length > 0;
  }
  async ensureConversation(a: string, b: string, mode: ModeId) {
    const found = await this.db.query(
      `select c.id from conversations c
        where c.kind = 'direct'
          and exists (select 1 from conversation_members x where x.conversation_id = c.id and x.user_id = $1)
          and exists (select 1 from conversation_members y where y.conversation_id = c.id and y.user_id = $2)
        limit 1`, [a, b]);
    if (found.rows[0]) return found.rows[0].id as string;
    const made = await this.db.query(
      `with c as (insert into conversations (kind, mode_id) values ('direct', $2) returning id),
            m as (insert into conversation_members (conversation_id, user_id) select c.id, u from c, unnest($1::uuid[]) u returning 1)
       select id from c`, [[a, b], mode]);
    return made.rows[0].id as string;
  }

  async upsertCalendar(e: CalendarEntry) {
    await this.db.query(
      `insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status, sequence)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (user_id, source_type, source_id)
       do update set title=excluded.title, starts_at=excluded.starts_at, ends_at=excluded.ends_at, status=excluded.status, sequence=excluded.sequence`,
      [e.userId, e.sourceType, e.sourceId, e.title, e.startsAt, e.endsAt, e.status, e.sequence]);
  }
  async setCalendarStatus(inviteId: string, status: CalendarStatus, sequence: number) {
    await this.db.query("update calendar_entries set status=$2, sequence=$3 where source_type='invite' and source_id=$1", [inviteId, status, sequence]);
  }

  async addNotification(n: NotificationInput) {
    const r = await this.db.query(
      `insert into notifications (user_id, kind, payload, dedupe_key) values ($1,$2,$3::jsonb,$4)
       on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing returning id`,
      [n.userId, n.kind, JSON.stringify(n.payload), n.dedupeKey ?? null]);
    return r.rows.length > 0;
  }
  async getPrefs(userId: string, kind: NotificationKind): Promise<NotificationPrefs> {
    const r = await this.db.query(
      "select push, to_char(quiet_start,'HH24:MI') as qs, to_char(quiet_end,'HH24:MI') as qe from notification_preferences where user_id=$1 and kind in ($2,'*') order by (kind='*') limit 1",
      [userId, kind]);
    const x = r.rows[0];
    return x ? { push: x.push, quietStart: x.qs, quietEnd: x.qe } : { push: true, quietStart: null, quietEnd: null };
  }
  async listPushTokens(userId: string) {
    const r = await this.db.query('select token, platform from push_tokens where user_id = $1', [userId]);
    return r.rows.map((x) => ({ token: x.token as string, platform: x.platform as 'android' | 'ios' }));
  }
  async removePushToken(token: string) { await this.db.query('delete from push_tokens where token = $1', [token]); }

  async expirableInvites(now: Date, limit: number) {
    const r = await this.db.query("select * from conversation_invites where state in ('pending','reschedule_requested') and expires_at < $1 order by expires_at limit $2", [now, limit]);
    return r.rows.map(inviteFrom);
  }
  async confirmedInvitesStartingBetween(from: Date, to: Date) {
    const r = await this.db.query("select * from conversation_invites where state in ('accepted','rescheduled') and starts_at > $1 and starts_at <= $2", [from, to]);
    return r.rows.map(inviteFrom);
  }
  async expireOpenCalls(now: Date) {
    const r = await this.db.query("update open_calls set status='expired' where status in ('open','full') and expires_at < $1", [now]);
    return r.rowCount ?? 0;
  }
  async rouletteCandidates(now: Date): Promise<RouletteCandidate[]> {
    // Only people who could actually be seated: active account, still in that vibe and not paused in it.
    const r = await this.db.query(
      `select s.id, s.user_id, s.mode_id, s.activity, s.area_label, s.slot_start, s.energy, s.group_size,
              coalesce(array(select blocked_id from blocks where blocker_id = s.user_id
                             union select blocker_id from blocks where blocked_id = s.user_id), '{}') as blocked
         from roulette_signups s
         join profiles p on p.id = s.user_id and p.state = 'active'
        where s.status in ('waiting','waitlisted') and s.slot_start > $1::timestamptz + interval '1 hour'
          and exists (select 1 from user_active_modes a where a.user_id = s.user_id and a.mode_id = s.mode_id and not a.paused)
        order by s.created_at`, [now]);
    // The matcher only compares `activity`, so the area is folded into it: people in different places are never grouped.
    return r.rows.map((x) => ({ signupId: x.id, userId: x.user_id, mode: x.mode_id, activity: withRouletteArea(x.activity, x.area_label),
      slot: new Date(x.slot_start).toISOString(), energy: x.energy, groupSize: x.group_size, blockedUserIds: x.blocked }));
  }
  async createRouletteGroup(memberIds: string[], signupIds: string[], key: string): Promise<boolean> {
    const k = parseRouletteKey(key);
    if (!k) throw new Error(`bad roulette key: ${key}`);
    const r = await this.db.query('select public.form_roulette_group($1::uuid[], $2::uuid[], $3, $4, $5::timestamptz) as id', [memberIds, signupIds, k.mode, k.activity, k.slot]);
    return r.rows[0]?.id != null;
  }
  async markRouletteWaitlisted(signupIds: string[]) {
    await this.db.query("update roulette_signups set status='waitlisted' where id = any($1::uuid[]) and status='waiting'", [signupIds]);
  }

  async liftExpiredSuspensions() {
    const r = await this.db.query('select public.lift_expired_suspensions() as n');
    return (r.rows[0]?.n as number) ?? 0;
  }

  async dueCheckins(now: Date, limit: number): Promise<DueCheckin[]> {
    const r = await this.db.query(
      `select c.id, c.user_id, c.check_in_at, p.state,
              exists (select 1 from calendar_entries e where e.user_id = c.user_id and e.source_type = c.source_type and e.source_id = c.source_id
                         and e.status in ('confirmed','tentative')) as plan_active
         from meeting_checkins c join profiles p on p.id = c.user_id
        where c.status = 'scheduled' and c.check_in_at <= $1 order by c.check_in_at limit $2`, [now, limit]);
    return r.rows.map((x) => ({ id: x.id, userId: x.user_id, checkInAt: new Date(x.check_in_at), planActive: x.plan_active, userState: x.state }));
  }
  async moveCheckin(id: string, from: CheckinStatus, to: CheckinStatus, now: Date) {
    const r = await this.db.query(
      "update meeting_checkins set status = $3, prompted_at = case when $3 = 'prompted' and $2 = 'scheduled' then $4::timestamptz else prompted_at end where id = $1 and status = $2", [id, from, to, now]);
    return (r.rowCount ?? 0) > 0;
  }
  async unansweredCheckins(promptedBefore: Date, limit: number): Promise<UnansweredCheckin[]> {
    const r = await this.db.query(
      `select c.id, c.user_id, p.display_name, t.contact_user_id
         from meeting_checkins c join profiles p on p.id = c.user_id left join trusted_contacts t on t.id = c.trusted_contact_id
        where c.status = 'prompted' and c.prompted_at <= $1 order by c.prompted_at limit $2`, [promptedBefore, limit]);
    return r.rows.map((x) => ({ id: x.id, userId: x.user_id, userName: x.display_name, contactUserId: x.contact_user_id ?? null }));
  }

  async claimDataRequest(q: { kind: DataRequestKind; requestedBefore: Date; retryBefore: Date; staleBefore: Date; now: Date; maxAttempts: number }): Promise<DataRequest | null> {
    const r = await this.db.query(
      `update data_requests r set status = 'processing', claimed_at = $4, attempts = r.attempts + 1
        where r.id = (select d.id from data_requests d
                       where d.kind = $1 and d.attempts < $5
                         and ((d.status = 'queued' and d.requested_at <= $2 and (d.claimed_at is null or d.claimed_at < $6))
                              or (d.status = 'processing' and d.claimed_at < $3))
                       order by d.requested_at limit 1 for update skip locked)
        returning r.id, r.user_id, r.kind, r.requested_at, r.attempts`, [q.kind, q.requestedBefore, q.staleBefore, q.now, q.maxAttempts, q.retryBefore]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, kind: x.kind, requestedAt: new Date(x.requested_at), attempts: x.attempts } : null;
  }
  async exportUserData(userId: string) {
    const r = await this.db.query('select public.export_user_data($1::uuid) as j', [userId]);
    return r.rows[0]?.j ?? null;
  }
  async completeExport(id: string, path: string, now: Date) {
    await this.db.query("update data_requests set status = 'done', result_path = $2, completed_at = $3, last_error = null where id = $1", [id, path, now]);
  }
  async completeDeletion(id: string, now: Date) {
    await this.db.query("update data_requests set status = 'done', completed_at = $2, last_error = null where id = $1", [id, now]);
  }
  async failDataRequest(id: string, error: string, maxAttempts: number): Promise<'retry' | 'failed'> {
    const r = await this.db.query(
      "update data_requests set status = case when attempts >= $3 then 'failed' else 'queued' end, last_error = left($2, 500) where id = $1 returning status", [id, error, maxAttempts]);
    return r.rows[0]?.status === 'failed' ? 'failed' : 'retry';
  }
  async getDataRequest(id: string): Promise<ExportRecord | null> {
    const r = await this.db.query('select id, user_id, kind, status, result_path, completed_at from data_requests where id = $1', [id]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, kind: x.kind, status: x.status, resultPath: x.result_path ?? null, completedAt: x.completed_at ? new Date(x.completed_at) : null } : null;
  }
  async expiredExports(completedBefore: Date, limit: number) {
    const r = await this.db.query(
      "select id, result_path from data_requests where kind = 'export' and status = 'done' and result_path is not null and completed_at < $1 order by completed_at limit $2", [completedBefore, limit]);
    return r.rows.map((x) => ({ id: x.id as string, path: x.result_path as string }));
  }
  async clearExportPath(id: string) { await this.db.query('update data_requests set result_path = null where id = $1', [id]); }

  async isModerator(userId: string) {
    const r = await this.db.query('select public.is_moderator($1::uuid) as m', [userId]);
    return r.rows[0]?.m === true;
  }
  async photoForReview(photoId: string) {
    const r = await this.db.query(
      `select ph.storage_path from profile_photos ph
        where ph.id = $1 and (ph.moderation_status = 'pending'
              or exists (select 1 from reports r where r.content_type = 'photo' and r.content_id = ph.id and r.status = 'open'))`, [photoId]);
    return (r.rows[0]?.storage_path as string | undefined) ?? null;
  }

  async isVerified(userId: string) {
    const r = await this.db.query('select verified_at is not null as v from profiles where id = $1', [userId]);
    return r.rows[0]?.v === true;
  }
  async approvedPhotoPaths(userId: string) {
    const r = await this.db.query(`select storage_path from profile_photos where user_id = $1 and moderation_status = 'approved' order by position, created_at limit 3`, [userId]);
    return r.rows.map((x: any) => x.storage_path as string);
  }
  async countVerificationAttempts(since: Date, userId?: string) {
    const r = await this.db.query('select count(*)::int as n from photo_verifications where provider_session_id is not null and created_at >= $1 and ($2::uuid is null or user_id = $2::uuid)', [since, userId ?? null]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async openVerification(userId: string) {
    const r = await this.db.query(`select id, provider_session_id, created_at from photo_verifications where user_id = $1 and status in ('started', 'pending')`, [userId]);
    const x = r.rows[0];
    return x ? { id: x.id as string, providerSessionId: (x.provider_session_id as string | null) ?? null, createdAt: new Date(x.created_at) } : null;
  }
  async createVerification(userId: string, now: Date, expiresAt: Date) {
    try {
      const r = await this.db.query(`insert into photo_verifications (user_id, pose, status, provider, consent_at, created_at, expires_at) values ($1, 'auto', 'started', 'didit', $2, $2, $3) returning id`, [userId, now, expiresAt]);
      return r.rows[0].id as string;
    } catch (e) { if ((e as { code?: string }).code === '23505') return null; throw e; }   // photo_verifications_one_open
  }
  async attachProviderSession(id: string, providerSessionId: string) {
    await this.db.query(`update photo_verifications set provider_session_id = $2, status = 'pending', submitted_at = now() where id = $1 and status = 'started'`, [id, providerSessionId]);
  }
  async findVerificationBySession(providerSessionId: string) {
    const r = await this.db.query('select id, user_id from photo_verifications where provider_session_id = $1', [providerSessionId]);
    const x = r.rows[0];
    return x ? { id: x.id as string, userId: x.user_id as string } : null;
  }
  async finishVerification(id: string, status: 'approved' | 'rejected' | 'expired', reason: string | null, now: Date) {
    // One statement, so "decided" and "verified" can never disagree.
    const r = await this.db.query(
      `with a as (update photo_verifications set status = $2, reject_reason = $3, decided_at = $4 where id = $1 and status in ('started', 'pending') returning user_id),
            p as (update profiles set verified_at = $4 where $2 = 'approved' and verified_at is null and id in (select user_id from a) returning id)
       select (select count(*) from a)::int as n`, [id, status, reason, now]);
    return Number(r.rows[0]?.n ?? 0) > 0;
  }

  async getPhoto(id: string): Promise<PhotoRow | null> {
    const r = await this.db.query('select id, user_id, storage_path, moderation_status from profile_photos where id = $1', [id]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, storagePath: x.storage_path, status: x.moderation_status } : null;
  }
  async setPhotoStatus(id: string, status: PhotoStatus) {
    await this.db.query('update profile_photos set moderation_status = $2 where id = $1', [id, status]);
  }

  async visiblePhotoPaths(viewerId: string, ownerId: string, mode: ModeId) {
    const r = await this.db.query(
      `select ph.storage_path
         from profile_photos ph
         left join mode_specific_profiles msp on msp.user_id = ph.user_id and msp.mode_id = $3
        where ph.user_id = $2 and ph.moderation_status = 'approved'
          and exists (select 1 from user_active_modes a where a.user_id = $1 and a.mode_id = $3 and not a.paused)
          and exists (select 1 from user_active_modes b where b.user_id = $2 and b.mode_id = $3 and not b.paused)
          and not exists (select 1 from blocks k where (k.blocker_id = $1 and k.blocked_id = $2) or (k.blocker_id = $2 and k.blocked_id = $1))
          and ((cardinality(coalesce(msp.visible_photo_ids, '{}')) > 0 and ph.id = any (msp.visible_photo_ids))
            or (cardinality(coalesce(msp.visible_photo_ids, '{}')) = 0 and $3 = any (ph.visible_modes)))
        order by ph.position`, [viewerId, ownerId, mode]);
    return r.rows.map((x) => x.storage_path as string);
  }

  async getMessageMedia(messageId: string): Promise<MessageMedia | null> {
    const r = await this.db.query(
      `select m.id, m.conversation_id, m.sender_id, m.media_path, m.media_kind, m.media_revealed_by, m.deleted_at,
              array(select user_id from conversation_members where conversation_id = m.conversation_id) as members
         from messages m where m.id = $1`, [messageId]);
    const x = r.rows[0];
    return x ? { id: x.id, conversationId: x.conversation_id, senderId: x.sender_id, mediaPath: x.media_path, mediaKind: x.media_kind,
      revealedBy: x.media_revealed_by ?? [], deleted: !!x.deleted_at, memberIds: x.members ?? [] } : null;
  }
  async conversationMemberIds(conversationId: string) {
    const r = await this.db.query('select user_id from conversation_members where conversation_id = $1', [conversationId]);
    return r.rows.map((x) => x.user_id as string);
  }
}
