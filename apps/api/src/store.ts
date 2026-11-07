import type { ModeId } from '@sidequest/shared';
import type {
  CalendarEntry, CalendarStatus, Invite, NotificationInput, NotificationPrefs, Proposal,
  RouletteCandidate, UserFlags, NotificationKind, PhotoRow, PhotoStatus, MessageMedia,
  CheckinStatus, DataRequest, DataRequestKind, DueCheckin, ExportRecord, UnansweredCheckin,
} from './types.ts';

/** Everything the services need from persistence. Implemented by MemoryStore (tests) and PgStore (production). */
export interface Store {
  getInvite(id: string): Promise<Invite | null>;
  insertInvite(i: Omit<Invite, 'id' | 'createdAt'>): Promise<Invite>;
  saveInvite(i: Invite): Promise<void>;
  latestProposal(inviteId: string): Promise<Proposal | null>;
  insertProposal(p: Omit<Proposal, 'id' | 'createdAt'>): Promise<Proposal>;
  listInvitesFor(userId: string, box: 'incoming' | 'outgoing' | 'all', limit: number): Promise<Invite[]>;

  countSentSince(senderId: string, since: Date): Promise<{ total: number; toNonMatches: number }>;
  countPending(senderId: string, recipientId: string): Promise<number>;
  isMatched(a: string, b: string, mode: ModeId): Promise<boolean>;
  isBlocked(a: string, b: string): Promise<boolean>;
  getUserFlags(userId: string): Promise<UserFlags | null>;
  isActiveInMode(userId: string, mode: ModeId): Promise<boolean>;
  ensureConversation(a: string, b: string, mode: ModeId): Promise<string>;

  upsertCalendar(e: CalendarEntry): Promise<void>;
  setCalendarStatus(inviteId: string, status: CalendarStatus, sequence: number): Promise<void>;

  /** Returns false when dropped by dedupeKey. */
  addNotification(n: NotificationInput): Promise<boolean>;
  getPrefs(userId: string, kind: NotificationKind): Promise<NotificationPrefs>;
  listPushTokens(userId: string): Promise<{ token: string; platform: 'android' | 'ios' }[]>;
  removePushToken(token: string): Promise<void>;

  expirableInvites(now: Date, limit: number): Promise<Invite[]>;
  confirmedInvitesStartingBetween(from: Date, to: Date): Promise<Invite[]>;
  expireOpenCalls(now: Date): Promise<number>;
  rouletteCandidates(now: Date): Promise<RouletteCandidate[]>;
  /** Forms one table through the database function form_roulette_group. False = the database refused because something changed since the matcher looked (cancelled, blocked, paused...). */
  createRouletteGroup(memberIds: string[], signupIds: string[], key: string): Promise<boolean>;
  markRouletteWaitlisted(signupIds: string[]): Promise<void>;

  /** Suspensions that have run their course end by themselves. Returns how many accounts were restored. */
  liftExpiredSuspensions(): Promise<number>;

  /** Check-ins: read what is due / unanswered, and move one between states atomically (false = someone else already did). */
  dueCheckins(now: Date, limit: number): Promise<DueCheckin[]>;
  moveCheckin(id: string, from: CheckinStatus, to: CheckinStatus, now: Date): Promise<boolean>;
  unansweredCheckins(promptedBefore: Date, limit: number): Promise<UnansweredCheckin[]>;

  /** Data requests. Claiming is atomic, so two workers never process the same request. */
  claimDataRequest(q: { kind: DataRequestKind; requestedBefore: Date; retryBefore: Date; staleBefore: Date; now: Date; maxAttempts: number }): Promise<DataRequest | null>;
  exportUserData(userId: string): Promise<unknown>;
  completeExport(id: string, path: string, now: Date): Promise<void>;
  completeDeletion(id: string, now: Date): Promise<void>;
  failDataRequest(id: string, error: string, maxAttempts: number): Promise<'retry' | 'failed'>;
  getDataRequest(id: string): Promise<ExportRecord | null>;
  expiredExports(completedBefore: Date, limit: number): Promise<{ id: string; path: string }[]>;
  clearExportPath(id: string): Promise<void>;

  /** Moderator tools: is this person a moderator or admin, and which photo file may they look at (waiting for review, or reported). */
  isModerator(userId: string): Promise<boolean>;
  photoForReview(photoId: string): Promise<string | null>;

  getPhoto(id: string): Promise<PhotoRow | null>;
  setPhotoStatus(id: string, status: PhotoStatus): Promise<void>;
  /** Storage paths of `ownerId`'s approved photos that `viewerId` may see in `mode`. Empty if blocked, not in the mode, or nothing is visible. */
  visiblePhotoPaths(viewerId: string, ownerId: string, mode: ModeId): Promise<string[]>;
  getMessageMedia(messageId: string): Promise<MessageMedia | null>;
  conversationMemberIds(conversationId: string): Promise<string[]>;
}
