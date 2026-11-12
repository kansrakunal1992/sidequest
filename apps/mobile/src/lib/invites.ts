import * as IntentLauncher from 'expo-intent-launcher';
import { mapCalendar } from '@/core/mappers';
import type { ApiInvite } from '@/core/api-client';
import { inviteTitle, placeText } from '@/core/invite-ui';
import { supabase } from '@/lib/supabase';

export interface Counterpart { userId: string; displayName: string; age: number; verified: boolean }
export async function counterparts(ids: string[]): Promise<Record<string, Counterpart>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return {};
  const { data, error } = await supabase.rpc('invite_counterparts', { p_ids: uniq });
  if (error) throw error;
  const out: Record<string, Counterpart> = {};
  for (const r of (data ?? []) as any[]) out[r.user_id] = { userId: r.user_id, displayName: r.display_name, age: Number(r.age), verified: !!r.verified };
  return out;
}

export async function listCalendar() {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await supabase.from('calendar_entries').select('id, source_type, source_id, title, starts_at, ends_at, status').gte('ends_at', since).order('starts_at');
  if (error) throw error;
  return (data ?? []).map(mapCalendar);
}

/** Opens the phone's own calendar app with the event filled in. No calendar permission and no contact details are involved. */
export async function addToDeviceCalendar(inv: Pick<ApiInvite, 'format' | 'startsAt' | 'durationMinutes' | 'activity' | 'venueName' | 'areaLabel'>, withName: string): Promise<void> {
  const begin = new Date(inv.startsAt).getTime();
  await IntentLauncher.startActivityAsync('android.intent.action.INSERT', {
    data: 'content://com.android.calendar/events',
    extra: { title: inviteTitle(inv, withName), ...(placeText(inv) ? { eventLocation: placeText(inv) } : {}), beginTime: begin, endTime: begin + inv.durationMinutes * 60_000, description: 'Arranged on Waypoint. Open the app for details or to reschedule.' },
  });
}

export async function hasPostMeetFeedback(me: string, inviteId: string): Promise<boolean> {
  const { data } = await supabase.from('post_meet_feedback').select('id').eq('from_user', me).eq('source_id', inviteId).limit(1);
  return (data?.length ?? 0) > 0;
}
export interface PostMeetAnswers { comfortable: boolean | null; boundariesRespected: boolean | null; showedUp: boolean | null; wouldInteractAgain: boolean | null; concern: string }
export async function submitPostMeet(me: string, about: string, inviteId: string, a: PostMeetAnswers): Promise<void> {
  const { error } = await supabase.from('post_meet_feedback').insert({
    from_user: me, about_user: about, source_type: 'invite', source_id: inviteId, comfortable: a.comfortable, boundaries_respected: a.boundariesRespected,
    showed_up: a.showedUp, would_interact_again: a.wouldInteractAgain, concern: a.concern.trim() || null });
  if (error) throw error;
}
