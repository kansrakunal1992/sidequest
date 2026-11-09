-- SideQuest/Waypoint part 14: not every vibe has every feature.
-- The shared matrix (packages/shared/src/mode-features.ts) is mirrored here; a test keeps the two identical.
-- Four features belong to one vibe in the database and are refused outside it: open calls, Social Roulette, double dates and chat games.
-- Circles, activities, wingperson and Together are not tied to one vibe in the database, so the app decides what to show for those.
-- The four functions below are the live definitions with ONE added line each (the vibe check), so no earlier fix is lost.
-- STATUS: run on a local Postgres 16 with stand-ins for Supabase; not on a hosted project.

create table public.mode_features (
  mode_id text not null,
  feature text not null,
  primary key (mode_id, feature)
);
alter table public.mode_features enable row level security;
revoke all on public.mode_features from anon, authenticated;   -- internal configuration: only the database functions read it
insert into public.mode_features (mode_id, feature) values
  ('serious_dating', 'activities'),
  ('serious_dating', 'double_dates'),
  ('serious_dating', 'games'),
  ('serious_dating', 'wingperson'),
  ('serious_dating', 'together'),
  ('friendship', 'open_calls'),
  ('friendship', 'activities'),
  ('friendship', 'circles'),
  ('friendship', 'roulette'),
  ('friendship', 'double_dates'),
  ('friendship', 'games'),
  ('friendship', 'wingperson'),
  ('post_marital', 'activities'),
  ('post_marital', 'circles'),
  ('post_marital', 'double_dates'),
  ('post_marital', 'games'),
  ('post_marital', 'wingperson'),
  ('post_marital', 'together'),
  ('experimentation', 'circles'),
  ('experimentation', 'games'),
  ('experimentation', 'together'),
  ('adventures', 'open_calls'),
  ('adventures', 'activities'),
  ('adventures', 'circles'),
  ('adventures', 'roulette');

create or replace function public.mode_has(p_mode text, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mode_features where mode_id = p_mode and feature = p_feature) $$;
revoke execute on function public.mode_has(text, text) from public, anon;
grant execute on function public.mode_has(text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.join_roulette(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); v_mode text := p->>'mode_id'; v_slot timestamptz := (p->>'slot_start')::timestamptz; v_size int := coalesce((p->>'group_size')::int, 4); sid uuid;
begin
  if not public.mode_has(v_mode, 'roulette') then raise exception 'unavailable' using errcode = '42501'; end if;
  if uid is null or not public.account_ok() or not public.in_mode(uid, v_mode) then raise exception 'unavailable' using errcode = '42501'; end if;
  if v_slot is null or v_slot < now() + interval '3 hours' or v_slot > now() + interval '14 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if v_size not between 2 and 8 or p->>'energy' not in ('chill', 'flirty', 'adventurous', 'social') or char_length(btrim(coalesce(p->>'area_label', ''))) < 2
     or char_length(btrim(coalesce(p->>'activity', ''))) not between 2 and 40 then raise exception 'invalid details' using errcode = '22023'; end if;
  if (select count(*) from roulette_signups where user_id = uid and status in ('waiting', 'waitlisted', 'grouped') and slot_start > now()) >= 3 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label)
  values (uid, v_mode, lower(btrim(p->>'activity')), v_slot, p->>'energy', v_size, btrim(p->>'area_label')) returning id into sid;
  return sid;
exception when unique_violation then raise exception 'you already signed up for this' using errcode = '22023';
end $function$;

CREATE OR REPLACE FUNCTION public.create_open_call(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare uid uuid := auth.uid(); v_mode text := p->>'mode_id'; v_start timestamptz := (p->>'starts_at')::timestamptz;
        v_cap int := coalesce((p->>'capacity')::int, 2); v_title text := btrim(coalesce(p->>'title', '')); v_area text := btrim(coalesce(p->>'area_label', ''));
        v_id uuid; v_fmt group_format;
begin
  if not public.mode_has(v_mode, 'open_calls') then raise exception 'unavailable' using errcode = '42501'; end if;
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.account_ok() or not public.in_mode(uid, v_mode) then raise exception 'unavailable' using errcode = '42501'; end if;
  if char_length(v_title) not between 2 and 120 or char_length(v_area) < 2 then raise exception 'title and area are required' using errcode = '22023'; end if;
  if char_length(coalesce(p->>'description', '')) > 1000 then raise exception 'description too long' using errcode = '22023'; end if;
  if v_start is null or v_start < now() + interval '15 minutes' or v_start > now() + interval '60 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if v_cap not between 2 and 50 then raise exception 'capacity must be 2 to 50' using errcode = '22023'; end if;
  if (select count(*) from open_calls where host_id = uid and status in ('open', 'full') and expires_at > now()) >= 5 then
    raise exception 'too_many_open_calls' using errcode = 'SQ431';
  end if;
  v_fmt := case when v_cap = 2 then 'one_to_one' else 'group' end;
  insert into open_calls (host_id, mode_id, title, description, starts_at, area_label, approx_location, public_venue_name, capacity, format,
                          budget_note, meet_style, expires_at)
  values (uid, v_mode, v_title, nullif(btrim(coalesce(p->>'description', '')), ''), v_start, v_area,
          public.snap_point(nullif(p->>'lat', '')::numeric, nullif(p->>'lng', '')::numeric), nullif(btrim(coalesce(p->>'public_venue_name', '')), ''),
          v_cap, v_fmt, nullif(left(btrim(coalesce(p->>'budget_note', '')), 120), ''), coalesce(nullif(p->>'meet_style', '')::meet_style, 'chat_first'), v_start)
  returning id into v_id;
  insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
  values (uid, 'open_call', v_id, v_title, v_start, v_start + interval '2 hours', 'tentative');
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.post_double_date(p_team uuid, p_mode text, p_starts timestamp with time zone, p_venue text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); did uuid;
begin
  if not public.mode_has(p_mode, 'double_dates') then raise exception 'unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from teams where id = p_team and created_by = uid) or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from team_members where team_id = p_team and status = 'accepted') <> 2 then raise exception 'a double date needs a pair' using errcode = '22023'; end if;
  if p_starts is null or p_starts < now() + interval '2 hours' or p_starts > now() + interval '60 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if exists (select 1 from team_members where team_id = p_team and status = 'accepted' and not public.in_mode(user_id, p_mode)) then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from double_dates where created_by = uid and state in ('looking', 'proposed', 'scheduled') and starts_at > now()) >= 3 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into double_dates (team_a, mode_id, state, starts_at, public_venue_name, created_by) values (p_team, p_mode, 'looking', p_starts, nullif(left(btrim(coalesce(p_venue, '')), 80), ''), uid) returning id into did;
  return did;
end $function$;

CREATE OR REPLACE FUNCTION public.start_game(p_conv uuid, p_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); other uuid; m text; sid uuid;
begin
  if p_kind not in ('would_you_rather', 'rapid_fire', 'finish_sentence', 'compatibility') then raise exception 'unknown game' using errcode = '22023'; end if;
  select om.user_id, c.mode_id into other, m from conversations c
    join conversation_members me on me.conversation_id = c.id and me.user_id = uid join conversation_members om on om.conversation_id = c.id and om.user_id <> uid
   where c.id = p_conv and c.kind = 'direct';
  if other is null or not public.account_ok() or public.blocked_between(uid, other) then raise exception 'unavailable' using errcode = '42501'; end if;
  if exists (select 1 from chemistry_sessions where conversation_id = p_conv and state in ('invited', 'active')) then raise exception 'a game is already running' using errcode = '22023'; end if;
  if not public.mode_has(m, 'games') then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into chemistry_sessions (kind, mode_id, created_by, conversation_id) values (p_kind, m, uid, p_conv) returning id into sid;
  insert into chemistry_players (session_id, user_id, accepted) values (sid, uid, true), (sid, other, false);
  perform public.notify_db(other, 'game_invite', jsonb_build_object('sessionId', sid::text, 'conversationId', p_conv::text), 'game:' || sid);
  return sid;
end $function$;
