import type { ModeId } from '@sidequest/shared';
import type { Store } from './store.ts';
import type {
  CalendarEntry, CalendarStatus, Invite, NotificationInput, NotificationKind, NotificationPrefs,
  MessageMedia, PhotoRow, PhotoStatus, Proposal, RouletteCandidate, UserFlags,
  CheckinStatus, DataRequest, DataRequestKind, DueCheckin, ExportRecord, UnansweredCheckin,
} from './types.ts';

let seq = 0;
const nextId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** In-memory Store used by tests and local development. Mirrors the semantics of PgStore. */
export class MemoryStore implements Store {
  users = new Map<string, UserFlags>();
  modes = new Set<string>();           // `${userId}|${mode}`
  matches = new Set<string>();         // `${pairKey}|${mode}`
  blocks = new Set<string>();          // `${blocker}>${blocked}`
  invites = new Map<string, Invite>();
  proposals: Proposal[] = [];
  calendar = new Map<string, CalendarEntry>();   // `${userId}|${inviteId}`
  notifications: (NotificationInput & { at: number })[] = [];
  private dedupe = new Set<string>();
  prefs = new Map<string, NotificationPrefs>();  // `${userId}|${kind}` or `${userId}|*`
  tokens: { userId: string; token: string; platform: 'android' | 'ios' }[] = [];
  conversations = new Map<string, string>();     // pairKey -> id
  expiredOpenCalls = 0;
  openCallsToExpire = 0;
  roulette: (RouletteCandidate & { status: string })[] = [];
  rouletteGroups: { key: string; memberIds: string[] }[] = [];
  photos = new Map<string, PhotoRow>();
  messages = new Map<string, MessageMedia>();
  /** Test switch: the database refuses every table (as if signups changed in between). */
  refuseRouletteGroups = false;
  suspensionsToLift = 0;
  liftedSuspensions = 0;
  checkins: { id: string; userId: string; status: CheckinStatus; checkInAt: Date; promptedAt: Date | null; planActive: boolean; contactUserId: string | null }[] = [];
  dataRequests: { id: string; userId: string; kind: DataRequestKind; status: string; requestedAt: Date; claimedAt: Date | null; attempts: number; resultPath: string | null; completedAt: Date | null; lastError: string | null }[] = [];
  exportBody: (userId: string) => unknown = (userId) => ({ profile: { id: userId } });
  moderators = new Set<string>();
  reportedPhotoIds = new Set<string>();
  visiblePhotoIds = new Map<string, string[]>();   // `${userId}|${mode}` -> explicit per-mode photo selection

  // ---- test helpers ----
  addUser(id: string, o: Partial<UserFlags> = {}, modes: ModeId[] = ['serious_dating']): void {
    this.users.set(id, { state: 'active', acceptsIntros: true, allowLightChat: true, timezone: 'UTC', displayName: `User ${id.slice(-4)}`, ...o });
    for (const m of modes) this.modes.add(`${id}|${m}`);
  }
  addMatch(a: string, b: string, mode: ModeId): void { this.matches.add(`${pairKey(a, b)}|${mode}`); }
  block(blocker: string, blocked: string): void { this.blocks.add(`${blocker}>${blocked}`); }

  // ---- Store ----
  async getInvite(id: string) { const i = this.invites.get(id); return i ? structuredClone(i) : null; }
  async insertInvite(i: Omit<Invite, 'id' | 'createdAt'>) {
    const row: Invite = { ...structuredClone(i), id: nextId(), createdAt: new Date(this.clockNow()) };
    this.invites.set(row.id, row);
    return structuredClone(row);
  }
  clockNow: () => number = () => Date.now();
  async saveInvite(i: Invite) { this.invites.set(i.id, structuredClone(i)); }
  async latestProposal(inviteId: string) {
    const ps = this.proposals.filter((p) => p.inviteId === inviteId);
    return ps.length ? structuredClone(ps[ps.length - 1]!) : null;
  }
  async insertProposal(p: Omit<Proposal, 'id' | 'createdAt'>) {
    const row: Proposal = { ...structuredClone(p), id: nextId(), createdAt: new Date(this.clockNow()) };
    this.proposals.push(row);
    return structuredClone(row);
  }
  async listInvitesFor(userId: string, box: 'incoming' | 'outgoing' | 'all', limit: number) {
    return [...this.invites.values()]
      .filter((i) => (box === 'incoming' ? i.recipientId === userId : box === 'outgoing' ? i.senderId === userId : i.recipientId === userId || i.senderId === userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map((i) => structuredClone(i));
  }
  async countSentSince(senderId: string, since: Date) {
    const mine = [...this.invites.values()].filter((i) => i.senderId === senderId && i.createdAt >= since);
    const toNon = mine.filter((i) => !this.matches.has(`${pairKey(i.senderId, i.recipientId)}|${i.modeId}`)).length;
    return { total: mine.length, toNonMatches: toNon };
  }
  async countPending(senderId: string, recipientId: string) {
    return [...this.invites.values()].filter((i) => i.senderId === senderId && i.recipientId === recipientId && i.state === 'pending').length;
  }
  async isMatched(a: string, b: string, mode: ModeId) { return this.matches.has(`${pairKey(a, b)}|${mode}`); }
  async isBlocked(a: string, b: string) { return this.blocks.has(`${a}>${b}`) || this.blocks.has(`${b}>${a}`); }
  async getUserFlags(userId: string) { const u = this.users.get(userId); return u ? { ...u } : null; }
  async isActiveInMode(userId: string, mode: ModeId) { return this.modes.has(`${userId}|${mode}`); }
  async ensureConversation(a: string, b: string, _mode: ModeId) {
    const k = pairKey(a, b);
    let id = this.conversations.get(k);
    if (!id) { id = nextId(); this.conversations.set(k, id); }
    return id;
  }
  async upsertCalendar(e: CalendarEntry) { this.calendar.set(`${e.userId}|${e.sourceId}`, structuredClone(e)); }
  async setCalendarStatus(inviteId: string, status: CalendarStatus, sequence: number) {
    for (const [k, e] of this.calendar) if (e.sourceId === inviteId) this.calendar.set(k, { ...e, status, sequence });
  }
  async addNotification(n: NotificationInput) {
    if (n.dedupeKey) {
      const k = `${n.userId}|${n.dedupeKey}`;
      if (this.dedupe.has(k)) return false;
      this.dedupe.add(k);
    }
    this.notifications.push({ ...structuredClone(n), at: this.clockNow() });
    return true;
  }
  async getPrefs(userId: string, kind: NotificationKind): Promise<NotificationPrefs> {
    return this.prefs.get(`${userId}|${kind}`) ?? this.prefs.get(`${userId}|*`) ?? { push: true, quietStart: null, quietEnd: null };
  }
  async listPushTokens(userId: string) { return this.tokens.filter((t) => t.userId === userId).map(({ token, platform }) => ({ token, platform })); }
  async removePushToken(token: string) { this.tokens = this.tokens.filter((t) => t.token !== token); }
  async expirableInvites(now: Date, limit: number) {
    return [...this.invites.values()].filter((i) => (i.state === 'pending' || i.state === 'reschedule_requested') && i.expiresAt < now)
      .slice(0, limit).map((i) => structuredClone(i));
  }
  async confirmedInvitesStartingBetween(from: Date, to: Date) {
    return [...this.invites.values()].filter((i) => (i.state === 'accepted' || i.state === 'rescheduled') && i.startsAt > from && i.startsAt <= to)
      .map((i) => structuredClone(i));
  }
  async expireOpenCalls(_now: Date) { const n = this.openCallsToExpire; this.expiredOpenCalls += n; this.openCallsToExpire = 0; return n; }
  async rouletteCandidates(_now: Date) {
    return this.roulette.filter((r) => r.status === 'waiting' || r.status === 'waitlisted').map(({ status: _s, ...c }) => structuredClone(c));
  }
  async createRouletteGroup(memberIds: string[], signupIds: string[], key: string) {
    if (this.refuseRouletteGroups) return false;
    // mirror the database: every signup must still be waiting
    const mine = this.roulette.filter((r) => signupIds.includes(r.signupId));
    if (mine.length !== signupIds.length || mine.some((r) => r.status !== 'waiting' && r.status !== 'waitlisted')) return false;
    this.rouletteGroups.push({ key, memberIds });
    for (const r of mine) r.status = 'grouped';
    return true;
  }
  async markRouletteWaitlisted(signupIds: string[]) {
    for (const r of this.roulette) if (signupIds.includes(r.signupId) && r.status === 'waiting') r.status = 'waitlisted';
  }

  async liftExpiredSuspensions() { const n = this.suspensionsToLift; this.liftedSuspensions += n; this.suspensionsToLift = 0; return n; }

  async dueCheckins(now: Date, limit: number): Promise<DueCheckin[]> {
    return this.checkins.filter((c) => c.status === 'scheduled' && c.checkInAt <= now).slice(0, limit)
      .map((c) => ({ id: c.id, userId: c.userId, checkInAt: c.checkInAt, planActive: c.planActive, userState: this.users.get(c.userId)?.state ?? 'deleted' }));
  }
  async moveCheckin(id: string, from: CheckinStatus, to: CheckinStatus, now: Date) {
    const c = this.checkins.find((x) => x.id === id);
    if (!c || c.status !== from) return false;
    c.status = to; if (to === 'prompted' && from === 'scheduled') c.promptedAt = now;
    return true;
  }
  async unansweredCheckins(promptedBefore: Date, limit: number): Promise<UnansweredCheckin[]> {
    return this.checkins.filter((c) => c.status === 'prompted' && c.promptedAt !== null && c.promptedAt <= promptedBefore).slice(0, limit)
      .map((c) => ({ id: c.id, userId: c.userId, userName: this.users.get(c.userId)?.displayName ?? '', contactUserId: c.contactUserId }));
  }

  async claimDataRequest(q: { kind: DataRequestKind; requestedBefore: Date; retryBefore: Date; staleBefore: Date; now: Date; maxAttempts: number }): Promise<DataRequest | null> {
    const r = this.dataRequests.find((d) => d.kind === q.kind && d.attempts < q.maxAttempts
      && ((d.status === 'queued' && d.requestedAt <= q.requestedBefore && (d.claimedAt === null || d.claimedAt < q.retryBefore)) || (d.status === 'processing' && d.claimedAt !== null && d.claimedAt < q.staleBefore)));
    if (!r) return null;
    r.status = 'processing'; r.claimedAt = q.now; r.attempts += 1;
    return { id: r.id, userId: r.userId, kind: r.kind, requestedAt: r.requestedAt, attempts: r.attempts };
  }
  async exportUserData(userId: string) { return this.exportBody(userId); }
  async completeExport(id: string, path: string, now: Date) { const r = this.dataRequests.find((d) => d.id === id); if (r) { r.status = 'done'; r.resultPath = path; r.completedAt = now; } }
  async completeDeletion(id: string, now: Date) { const r = this.dataRequests.find((d) => d.id === id); if (r) { r.status = 'done'; r.completedAt = now; } }
  async failDataRequest(id: string, error: string, maxAttempts: number): Promise<'retry' | 'failed'> {
    const r = this.dataRequests.find((d) => d.id === id); if (!r) return 'failed';
    r.lastError = error; r.status = r.attempts >= maxAttempts ? 'failed' : 'queued';
    return r.status === 'failed' ? 'failed' : 'retry';
  }
  async getDataRequest(id: string): Promise<ExportRecord | null> {
    const r = this.dataRequests.find((d) => d.id === id);
    return r ? { id: r.id, userId: r.userId, kind: r.kind, status: r.status, resultPath: r.resultPath, completedAt: r.completedAt } : null;
  }
  async expiredExports(completedBefore: Date, limit: number) {
    return this.dataRequests.filter((d) => d.kind === 'export' && d.status === 'done' && d.resultPath && d.completedAt && d.completedAt < completedBefore)
      .slice(0, limit).map((d) => ({ id: d.id, path: d.resultPath! }));
  }
  async clearExportPath(id: string) { const r = this.dataRequests.find((d) => d.id === id); if (r) r.resultPath = null; }

  async isModerator(userId: string) { return this.moderators.has(userId); }
  async photoForReview(photoId: string) { const p = this.photos.get(photoId); return p && (p.status === 'pending' || this.reportedPhotoIds.has(photoId)) ? p.storagePath : null; }

  verifiedUsers = new Set<string>();
  verifications: { id: string; userId: string; status: 'started' | 'pending' | 'approved' | 'rejected' | 'expired'; providerSessionId: string | null; reason: string | null; createdAt: Date }[] = [];
  async isVerified(userId: string) { return this.verifiedUsers.has(userId); }
  async approvedPhotoPaths(userId: string) {
    return [...this.photos.values()].filter((p) => p.userId === userId && p.status === 'approved').sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, 3).map((p) => p.storagePath);
  }
  async countVerificationAttempts(since: Date, userId?: string) {
    return this.verifications.filter((v) => v.providerSessionId && v.createdAt >= since && (!userId || v.userId === userId)).length;
  }
  async openVerification(userId: string) {
    const v = this.verifications.find((x) => x.userId === userId && (x.status === 'started' || x.status === 'pending'));
    return v ? { id: v.id, providerSessionId: v.providerSessionId, createdAt: v.createdAt } : null;
  }
  async createVerification(userId: string, now: Date) {
    if (this.verifications.some((x) => x.userId === userId && (x.status === 'started' || x.status === 'pending'))) return null;
    const id = `ver-${this.verifications.length + 1}`;
    this.verifications.push({ id, userId, status: 'started', providerSessionId: null, reason: null, createdAt: now });
    return id;
  }
  async attachProviderSession(id: string, providerSessionId: string) {
    const v = this.verifications.find((x) => x.id === id && x.status === 'started'); if (v) { v.providerSessionId = providerSessionId; v.status = 'pending'; }
  }
  async findVerificationBySession(providerSessionId: string) {
    const v = this.verifications.find((x) => x.providerSessionId === providerSessionId); return v ? { id: v.id, userId: v.userId } : null;
  }
  async finishVerification(id: string, status: 'approved' | 'rejected' | 'expired', reason: string | null) {
    const v = this.verifications.find((x) => x.id === id && (x.status === 'started' || x.status === 'pending')); if (!v) return false;
    v.status = status; v.reason = reason; if (status === 'approved') this.verifiedUsers.add(v.userId); return true;
  }
  async getPhoto(id: string) { const p = this.photos.get(id); return p ? { ...p } : null; }
  async setPhotoStatus(id: string, status: PhotoStatus) { const p = this.photos.get(id); if (p) p.status = status; }

  async visiblePhotoPaths(viewerId: string, ownerId: string, mode: ModeId) {
    if (!this.modes.has(`${viewerId}|${mode}`) || !this.modes.has(`${ownerId}|${mode}`)) return [];
    if (this.blocks.has(`${viewerId}>${ownerId}`) || this.blocks.has(`${ownerId}>${viewerId}`)) return [];
    const picked = this.visiblePhotoIds.get(`${ownerId}|${mode}`) ?? [];
    return [...this.photos.values()]
      .filter((p) => p.userId === ownerId && p.status === 'approved' && (picked.length ? picked.includes(p.id) : (p.visibleModes ?? []).includes(mode)))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((p) => p.storagePath);
  }

  async getMessageMedia(id: string) { const m = this.messages.get(id); return m ? structuredClone(m) : null; }
  async conversationMemberIds(conversationId: string) {
    const ids = new Set<string>();
    for (const m of this.messages.values()) if (m.conversationId === conversationId) for (const u of m.memberIds) ids.add(u);
    return [...ids];
  }
}
