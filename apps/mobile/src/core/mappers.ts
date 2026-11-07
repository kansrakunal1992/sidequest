import type { CalendarItem } from './calendar-core';
import type { ChatMessage } from './chat-core';
import type { PromptAnswer } from './prompts';

export interface PersonCard { userId: string; displayName: string; age: number; headline: string | null; area: string | null; distanceKm: number | null;
  availability: string; sharedInterests: string[]; verified: boolean; likesYou: boolean }
export interface LikeItem { userId: string; displayName: string; age: number; headline: string | null; kind: 'like' | 'spark' | 'interest'; likedAt: Date; iLikedBack: boolean; matched: boolean; verified: boolean }
export interface VisitorItem { userId: string; displayName: string; age: number; lastVisitAt: Date; visits: number; lookedAtPhotos: boolean; lookedAtPrompts: boolean; theyLikedYou: boolean; verified: boolean }
export interface MatchItem { matchId: string; userId: string; displayName: string; age: number; matchedAt: Date; verified: boolean; conversationId: string | null }
export interface FullProfile { userId: string; displayName: string; age: number; area: string | null; headline: string | null; bio: string | null; prompts: PromptAnswer[];
  interests: string[]; availability: string; verified: boolean }
export interface Summary { likes: number; matches: number; visitors: number }

type Row = Record<string, any>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const mapCard = (r: Row): PersonCard => ({ userId: r.user_id, displayName: r.display_name, age: Number(r.age), headline: r.headline ?? null, area: r.area ?? null,
  distanceKm: num(r.distance_km), availability: String(r.availability), sharedInterests: Array.isArray(r.shared_interests) ? r.shared_interests : [], verified: !!r.verified, likesYou: !!r.likes_you });
export const mapLike = (r: Row): LikeItem => ({ userId: r.user_id, displayName: r.display_name, age: Number(r.age), headline: r.headline ?? null, kind: r.kind,
  likedAt: new Date(r.liked_at), iLikedBack: !!r.i_liked_back, matched: !!r.matched, verified: !!r.verified });
export const mapVisitor = (r: Row): VisitorItem => ({ userId: r.user_id, displayName: r.display_name, age: Number(r.age), lastVisitAt: new Date(r.last_visit_at), visits: Number(r.visits),
  lookedAtPhotos: !!r.looked_at_photos, lookedAtPrompts: !!r.looked_at_prompts, theyLikedYou: !!r.they_liked_you, verified: !!r.verified });
export const mapMatch = (r: Row): MatchItem => ({ matchId: r.match_id, userId: r.user_id, displayName: r.display_name, age: Number(r.age), matchedAt: new Date(r.matched_at),
  verified: !!r.verified, conversationId: r.conversation_id ?? null });
export const mapSummary = (r: Row | null | undefined): Summary => ({ likes: Number(r?.likes ?? 0), matches: Number(r?.matches ?? 0), visitors: Number(r?.visitors ?? 0) });
export const mapProfile = (j: Row): FullProfile => ({ userId: j.user_id, displayName: j.display_name, age: Number(j.age), area: j.area ?? null, headline: j.headline ?? null, bio: j.bio ?? null,
  prompts: Array.isArray(j.prompts) ? j.prompts.filter((p: Row) => typeof p?.q === 'string' && typeof p?.a === 'string').map((p: Row) => ({ q: p.q, a: p.a })) : [],
  interests: Array.isArray(j.interests) ? j.interests : [], availability: String(j.availability ?? ''), verified: !!j.verified });

export interface ConversationItem { conversationId: string; userId: string; displayName: string; age: number; verified: boolean; lastBody: string | null; lastMediaKind: string | null; lastAt: Date; lastFromMe: boolean; unread: number }
export interface ConversationInfo { userId: string; displayName: string; age: number; verified: boolean; modeId: string; sharedInterests: string[]; otherLastReadAt: Date | null; myLastReadAt: Date | null }
export const mapConversation = (r: Row): ConversationItem => ({ conversationId: r.conversation_id, userId: r.user_id, displayName: r.display_name, age: Number(r.age), verified: !!r.verified,
  lastBody: r.last_body ?? null, lastMediaKind: r.last_media_kind ?? null, lastAt: new Date(r.last_at), lastFromMe: !!r.last_from_me, unread: Number(r.unread ?? 0) });
export const mapConversationInfo = (r: Row): ConversationInfo => ({ userId: r.user_id, displayName: r.display_name, age: Number(r.age), verified: !!r.verified, modeId: r.mode_id,
  sharedInterests: Array.isArray(r.shared_interests) ? r.shared_interests : [], otherLastReadAt: r.other_last_read_at ? new Date(r.other_last_read_at) : null, myLastReadAt: r.my_last_read_at ? new Date(r.my_last_read_at) : null });
export const mapMessage = (r: Row): ChatMessage => ({ id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, body: r.body ?? null, mediaKind: r.media_kind ?? null,
  revealedBy: Array.isArray(r.media_revealed_by) ? r.media_revealed_by : [], createdAt: new Date(r.created_at) });
export const mapCalendar = (r: Row): CalendarItem => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, title: r.title, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), status: r.status });
