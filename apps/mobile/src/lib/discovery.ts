import type { ModeId } from '@sidequest/shared';
import { mapCard, mapLike, mapMatch, mapProfile, mapSummary, mapVisitor } from '@/core/mappers';
import type { SwipeAction } from '@/core/swipe';
import { supabase } from '@/lib/supabase';

export interface Filters { interest: string | null; maxKm: number | null; availableTonight: boolean }
export const noFilters: Filters = { interest: null, maxKm: null, availableTonight: false };
export const hasFilters = (f: Filters) => f.interest !== null || f.maxKm !== null || f.availableTonight;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export const discoverPeople = async (mode: ModeId, f: Filters, offset: number, limit = 20) =>
  (await rpc<any[]>('discover_people', { p_mode: mode, p_limit: limit, p_offset: offset, p_interest: f.interest, p_max_km: f.maxKm, p_available_tonight: f.availableTonight })).map(mapCard);

export async function sendLike(to: string, mode: ModeId, action: Exclude<SwipeAction, 'pass'>): Promise<{ matched: boolean; matchId: string | null }> {
  const rows = await rpc<{ matched: boolean; match_id: string | null }[]>('send_like', { p_to: to, p_mode: mode, p_kind: action === 'spark' ? 'spark' : 'like' });
  return { matched: !!rows?.[0]?.matched, matchId: rows?.[0]?.match_id ?? null };
}
export const passPerson = (to: string, mode: ModeId) => rpc<void>('pass_person', { p_to: to, p_mode: mode });
export const undoPass = (to: string, mode: ModeId) => rpc<void>('undo_pass', { p_to: to, p_mode: mode });
export const undoLike = (to: string, mode: ModeId) => rpc<boolean>('undo_like', { p_to: to, p_mode: mode });

export const likesReceived = async (mode: ModeId) => (await rpc<any[]>('likes_received', { p_mode: mode })).map(mapLike);
export const visitorsList = async (mode: ModeId) => (await rpc<any[]>('visitors_list', { p_mode: mode })).map(mapVisitor);
export const myMatches = async (mode: ModeId) => (await rpc<any[]>('my_matches', { p_mode: mode })).map(mapMatch);
export const likesSummary = async (mode: ModeId) => mapSummary((await rpc<any[]>('likes_visitors_summary', { p_mode: mode }))?.[0]);

export const viewProfile = async (userId: string, mode: ModeId) => mapProfile(await rpc<any>('view_profile', { p_viewed: userId, p_mode: mode, p_kind: 'view', p_ref: null }));
export const recordInteraction = (userId: string, mode: ModeId, kind: 'photo_tap' | 'prompt_tap', ref: string) =>
  rpc<void>('record_interaction', { p_viewed: userId, p_mode: mode, p_kind: kind, p_ref: ref }).catch(() => { /* best effort */ });

export async function blockUser(me: string, other: string): Promise<void> {
  const { error } = await supabase.from('blocks').upsert({ blocker_id: me, blocked_id: other });
  if (error) throw error;
}
export const REPORT_REASONS = ['Fake profile or scam', 'Harassment or unwanted contact', 'Inappropriate photos or content', 'Might be under 18', 'Something else'] as const;
export async function reportUser(me: string, other: string, reason: string, details: string): Promise<void> {
  const { error } = await supabase.from('reports').insert({ reporter_id: me, reported_user_id: other, content_type: 'profile', content_id: other, reason, details: details.trim() || null });
  if (error) throw error;
}
