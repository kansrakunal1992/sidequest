import type { ModeId } from '@sidequest/shared';
import { mapActivity, mapOpenCall, mapThreadInfo } from '@/core/plans';
import { supabase } from './supabase';

export type Scope = 'browse' | 'mine' | 'joined';
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export interface PlanPerson { userId: string; displayName: string; age: number; verified: boolean; status?: string; isHost?: boolean; canInvite?: boolean }
const person = (r: any): PlanPerson => ({ userId: r.user_id, displayName: r.display_name, age: Number(r.age), verified: !!r.verified, status: r.status, isHost: r.is_host, canInvite: r.can_invite });

// ---- Open Calls
export const listOpenCalls = async (mode: ModeId, scope: Scope, maxKm: number | null = null) => (await rpc<any[]>('open_calls_feed', { p_mode: mode, p_scope: scope, p_max_km: maxKm })).map(mapOpenCall);
export async function findOpenCall(mode: ModeId, id: string) {
  for (const scope of ['joined', 'mine', 'browse'] as const) { const hit = (await listOpenCalls(mode, scope)).find((c) => c.id === id); if (hit) return hit; }
  return null;
}
export const createOpenCall = (body: Record<string, unknown>) => rpc<string>('create_open_call', { p: body });
export const updateOpenCall = (id: string, body: Record<string, unknown>) => rpc<void>('update_open_call', { p_call: id, p: body });
export const expressInterest = (id: string) => rpc<string>('express_interest', { p_call: id });
export const decideParticipant = (id: string, userId: string, accept: boolean) => rpc<void>('decide_participant', { p_call: id, p_user: userId, p_accept: accept });
export const withdrawInterest = (id: string) => rpc<void>('withdraw_interest', { p_call: id });
export const cancelOpenCall = (id: string) => rpc<void>('cancel_open_call', { p_call: id });
export const completeOpenCall = (id: string) => rpc<void>('complete_open_call', { p_call: id });
export const openCallPeople = async (id: string) => (await rpc<any[]>('open_call_people', { p_call: id })).map(person);

// ---- Activities
export const listActivities = async (category: string | null, scope: Scope, maxKm: number | null = null) => (await rpc<any[]>('activities_feed', { p_category: category, p_scope: scope, p_max_km: maxKm })).map(mapActivity);
export async function findActivity(id: string) {
  for (const scope of ['joined', 'mine', 'browse'] as const) { const hit = (await listActivities(null, scope)).find((a) => a.id === id); if (hit) return hit; }
  return null;
}
export const createActivity = (body: Record<string, unknown>) => rpc<string>('create_activity', { p: body });
export const joinActivity = (id: string) => rpc<string>('join_activity', { p_event: id });
export const leaveActivity = (id: string) => rpc<void>('leave_activity', { p_event: id });
export const cancelActivity = (id: string) => rpc<void>('cancel_activity', { p_event: id });
export const activityPeople = async (id: string) => (await rpc<any[]>('activity_people', { p_event: id })).map(person);

// ---- Group chat and reporting
export async function getThreadInfo(conversationId: string) {
  const rows = await rpc<any[]>('thread_info', { p_conv: conversationId });
  if (!rows?.[0]) throw Object.assign(new Error('unavailable'), { code: '42501' });
  return mapThreadInfo(rows[0]);
}
export async function getThreadMembers(conversationId: string): Promise<Record<string, string>> {
  const rows = await rpc<any[]>('thread_members', { p_conv: conversationId });
  return Object.fromEntries((rows ?? []).map((r) => [r.user_id, r.display_name as string]));
}
export async function reportContent(me: string, kind: 'message' | 'open_call' | 'event', contentId: string, reportedUser: string | null, reason: string): Promise<void> {
  const { error } = await supabase.from('reports').insert({ reporter_id: me, reported_user_id: reportedUser, content_type: kind, content_id: contentId, reason });
  if (error) throw error;
}
