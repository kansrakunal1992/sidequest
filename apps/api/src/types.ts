import type { InviteState, ModeId, NotificationKind, Party } from '@sidequest/shared';

/** The list of kinds lives in @sidequest/shared so the API (push copy) and the app (inbox copy) must both cover every kind. */
export type { NotificationKind };

export const INVITE_FORMATS = ['text', 'voice', 'video', 'virtual_coffee', 'intro_chat', 'in_person'] as const;
export type InviteFormat = (typeof INVITE_FORMATS)[number];

export interface Invite {
  id: string;
  senderId: string;
  recipientId: string;
  modeId: ModeId;
  format: InviteFormat;
  state: InviteState;
  proposedBy: Party | null;
  startsAt: Date;
  timezone: string;
  durationMinutes: number;
  note: string | null;
  /** In-person plans only: what, where and the neighbourhood. Null for every other format. */
  activity: string | null;
  venueName: string | null;
  areaLabel: string | null;
  sequence: number;
  expiresAt: Date;
  conversationId: string | null;
  createdAt: Date;
}

export interface Proposal {
  id: string;
  inviteId: string;
  proposedBy: string;
  startsAt: Date;
  durationMinutes: number;
  note: string | null;
  createdAt: Date;
}

export type CalendarStatus = 'confirmed' | 'tentative' | 'cancelled' | 'completed';
export interface CalendarEntry {
  userId: string;
  sourceType: 'invite';
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: CalendarStatus;
  sequence: number;
}

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, string | number | boolean | null>;
  /** If set, a second notification with the same (userId, dedupeKey) is dropped. */
  dedupeKey?: string;
}

export interface UserFlags {
  state: 'active' | 'paused' | 'suspended' | 'banned' | 'deleted';
  acceptsIntros: boolean;
  allowLightChat: boolean;
  timezone: string;
  displayName: string;
}

export interface NotificationPrefs { push: boolean; quietStart: string | null; quietEnd: string | null }

export interface RouletteCandidate {
  signupId: string;
  userId: string;
  mode: ModeId;
  activity: string;
  slot: string;
  energy: 'chill' | 'flirty' | 'adventurous' | 'social';
  groupSize: number;
  blockedUserIds: string[];
}

export interface MessageMedia {
  id: string; conversationId: string; senderId: string; mediaPath: string | null; mediaKind: string | null;
  revealedBy: string[]; deleted: boolean; memberIds: string[];
}
export type PhotoStatus = 'pending' | 'approved' | 'rejected';
export interface PhotoRow { id: string; userId: string; storagePath: string; status: PhotoStatus; visibleModes?: string[]; position?: number }

export type CheckinStatus = 'scheduled' | 'prompted' | 'confirmed_safe' | 'missed' | 'needs_help' | 'cancelled';
/** A check-in whose time has come. `planActive` is false when the plan it was for has since been cancelled. */
export interface DueCheckin { id: string; userId: string; checkInAt: Date; planActive: boolean; userState: UserFlags['state'] }
/** A check-in that was prompted and never answered. `contactUserId` is null when the contact was removed. */
export interface UnansweredCheckin { id: string; userId: string; userName: string; contactUserId: string | null }

export type DataRequestKind = 'export' | 'deletion';
export interface DataRequest { id: string; userId: string; kind: DataRequestKind; requestedAt: Date; attempts: number }
export interface ExportRecord { id: string; userId: string; kind: DataRequestKind; status: string; resultPath: string | null; completedAt: Date | null }

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; detail?: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (status: number, error: string, detail?: string): Result<never> =>
  detail === undefined ? { ok: false, status, error } : { ok: false, status, error, detail };
