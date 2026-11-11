-- Waypoint part 18: Let's Meet (in-person plans) and Date Ideas.
--  * conversation_invites gain an in-person format with an activity, a named public place and an area. No exact address is collected.
--  * date_ideas: up to three activities and a broad "usually free" window on a profile. Written only through set_date_ideas();
--    other people see them only through date_ideas_for(), under the same rules as view_profile() (same vibe, not blocked, active).
--  * The data export now includes both.
-- Run order: after 0017. ADD VALUE is not used by any statement in this file, so it also runs inside a single transaction.
-- STATUS: run on a local Postgres 16 with stand-ins for Supabase; not on a hosted project.

alter type invite_format add value if not exists 'in_person';

alter table public.conversation_invites
  add column activity text check (activity is null or char_length(activity) between 2 and 30),
  add column venue_name text check (venue_name is null or char_length(venue_name) between 2 and 80),
  add column area_label text check (area_label is null or char_length(area_label) between 2 and 80);
-- compared as text on purpose: a freshly added enum value cannot be used in the same transaction
alter table public.conversation_invites add constraint invites_in_person_details
  check (format::text <> 'in_person' or (activity is not null and venue_name is not null and area_label is not null));

-- ===== Date Ideas ==============================================================================================
create table public.date_ideas (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ideas text[] not null default '{}' check (cardinality(ideas) <= 3),
  free_window text check (free_window in ('weekday_evenings', 'weekends', 'flexible')),
  updated_at timestamptz not null default now()
);
alter table public.date_ideas enable row level security;
create policy date_ideas_own_read on public.date_ideas for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.date_ideas from anon, authenticated;   -- function-only writes

create or replace function public.set_date_ideas(p_ideas text[], p_window text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_ok text[] := array['chai_coffee','walk','meal','street_food','live_music','movie','museum','board_games','comedy','bowling','sports','market','trivia'];
        v_ideas text[];
begin
  if uid is null or not public.account_ok() then raise exception 'not authenticated' using errcode = '28000'; end if;
  select coalesce(array_agg(x order by o), '{}') into v_ideas
    from (select t.x, min(t.o) as o from unnest(coalesce(p_ideas, '{}')) with ordinality as t(x, o) group by t.x) d;
  if cardinality(v_ideas) > 3 then raise exception 'too many date ideas' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_ideas) x where x <> all (v_ok)) then raise exception 'unknown date idea' using errcode = '22023'; end if;
  if p_window is not null and p_window not in ('weekday_evenings', 'weekends', 'flexible') then raise exception 'unknown window' using errcode = '22023'; end if;
  if cardinality(v_ideas) = 0 and p_window is null then
    delete from date_ideas where user_id = uid;
  else
    insert into date_ideas (user_id, ideas, free_window) values (uid, v_ideas, p_window)
    on conflict (user_id) do update set ideas = excluded.ideas, free_window = excluded.free_window, updated_at = now();
  end if;
end $$;

create or replace function public.my_date_ideas() returns table (ideas text[], free_window text)
language sql stable security definer set search_path = public as $$
  select d.ideas, d.free_window from date_ideas d where d.user_id = auth.uid() $$;

-- Other people's Date Ideas. Same gate as view_profile(): both of you in the vibe, not blocked, their account active.
-- Anyone who fails the gate is simply missing from the result (no error, so nothing can be probed).
create or replace function public.date_ideas_for(p_ids uuid[], p_mode text) returns table (user_id uuid, ideas text[], free_window text)
language sql stable security definer set search_path = public as $$
  select d.user_id, d.ideas, d.free_window
    from date_ideas d
   where public.account_ok() and public.in_mode(auth.uid(), p_mode)
     and d.user_id = any (p_ids[1:50]) and d.user_id <> auth.uid()
     and public.in_mode(d.user_id, p_mode)
     and not public.blocked_between(auth.uid(), d.user_id)
     and exists (select 1 from profiles p where p.id = d.user_id and p.state = 'active')
     and (cardinality(d.ideas) > 0 or d.free_window is not null) $$;

revoke execute on function public.set_date_ideas(text[], text), public.my_date_ideas(), public.date_ideas_for(uuid[], text) from public, anon;
grant execute on function public.set_date_ideas(text[], text), public.my_date_ideas(), public.date_ideas_for(uuid[], text) to authenticated;

-- ===== Data export: same as 0010, plus the new plan details and Date Ideas ====================================
create or replace function public.export_user_data(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'profile', (select to_jsonb(p) - 'approx_location' - 'friend_code' from profiles p where p.id = p_user),
    'vibes', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from user_active_modes m where m.user_id = p_user),
    'preferences', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from preferences x where x.user_id = p_user),
    'vibe_text', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from mode_specific_profiles x where x.user_id = p_user),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'status', moderation_status, 'visible_in', visible_modes, 'added', created_at)), '[]') from profile_photos where user_id = p_user),
    'likes_sent', (select coalesce(jsonb_agg(jsonb_build_object('vibe', mode_id, 'kind', kind, 'at', created_at)), '[]') from likes where from_user = p_user),
    'likes_received_count', (select count(*) from likes where to_user = p_user),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object('vibe', mode_id, 'at', created_at, 'unmatched_at', unmatched_at)), '[]') from matches where p_user in (user_a, user_b)),
    'messages_sent', (select coalesce(jsonb_agg(jsonb_build_object('conversation', conversation_id, 'text', body, 'media', media_kind, 'at', created_at) order by created_at), '[]') from (select * from messages where sender_id = p_user and deleted_at is null order by created_at desc limit 20000) m),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('role', case when sender_id = p_user then 'sender' else 'recipient' end, 'format', format, 'activity', activity, 'venue', venue_name, 'area', area_label, 'state', state, 'starts_at', starts_at, 'vibe', mode_id, 'created', created_at)), '[]') from conversation_invites where p_user in (sender_id, recipient_id)),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', starts_at, 'status', status, 'kind', source_type)), '[]') from calendar_entries where user_id = p_user),
    'open_calls_hosted', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', starts_at, 'status', status, 'area', area_label)), '[]') from open_calls where host_id = p_user),
    'activities_hosted', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'category', category, 'starts_at', starts_at, 'status', status)), '[]') from events where host_id = p_user),
    'circles', (select coalesce(jsonb_agg(jsonb_build_object('circle', c.name, 'role', m.role, 'status', m.status)), '[]') from circle_members m join circles c on c.id = m.circle_id where m.user_id = p_user),
    'blocks_count', (select count(*) from blocks where blocker_id = p_user),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'about', content_type, 'at', created_at)), '[]') from reports where reporter_id = p_user),
    'post_meeting_feedback_written', (select coalesce(jsonb_agg(jsonb_build_object('comfortable', comfortable, 'boundaries_respected', boundaries_respected, 'showed_up', showed_up, 'would_interact_again', would_interact_again, 'concern', concern, 'at', created_at)), '[]') from post_meet_feedback where from_user = p_user),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'at', created_at, 'read_at', read_at)), '[]') from notifications where user_id = p_user),
    'trusted_contacts', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'added', created_at)), '[]') from trusted_contacts where user_id = p_user),
    'date_ideas', (select to_jsonb(d) - 'user_id' from date_ideas d where d.user_id = p_user),
    'data_requests', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'at', requested_at)), '[]') from data_requests where user_id = p_user)
  ) $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;
