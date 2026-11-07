-- SideQuest part 8: Open Calls, Activities, group chat support.
-- Principle: every write goes through a checked function. Clients can read what they may see, but cannot insert rows,
-- re-open a rejected request, exceed capacity, or place an exact location. The old direct-write policies are removed.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.

-- ===== Remove direct client writes (replaced by the functions below) ====================================
drop policy open_calls_insert on public.open_calls;
drop policy open_calls_host_update on public.open_calls;
drop policy open_calls_host_delete on public.open_calls;
drop policy oc_part_insert on public.open_call_participants;
drop policy oc_part_self_update on public.open_call_participants;
drop policy oc_part_host_update on public.open_call_participants;
drop policy events_insert on public.events;
drop policy events_host_update on public.events;
drop policy events_host_delete on public.events;
drop policy event_part_insert on public.event_participants;
drop policy event_part_self_update on public.event_participants;
drop policy event_part_host_update on public.event_participants;
drop policy event_part_delete_self on public.event_participants;

-- Messages from someone you blocked (or who blocked you) are hidden everywhere, including group chats.
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id) and deleted_at is null and not public.blocked_between(auth.uid(), sender_id));

-- Notifications written by these functions are pushed through the API's database webhook; ones the API writes are not.
alter table public.notifications add column origin text not null default 'api';

-- ===== Shared helpers ===================================================================================
-- Mutual preference check (gender and age, both directions). Only applies to vibes where romance is allowed.
create or replace function public.prefs_compatible(a uuid, b uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when not coalesce((select romantic_allowed from intent_modes where id = m), true) then true else exists (
    select 1 from profiles pa join profiles pb on pb.id = b
      left join preferences xa on xa.user_id = a and xa.mode_id = m
      left join preferences xb on xb.user_id = b and xb.mode_id = m
     where pa.id = a
       and (cardinality(coalesce(xa.seeking_genders, '{}')) = 0 or pb.gender = any (xa.seeking_genders))
       and (cardinality(coalesce(xb.seeking_genders, '{}')) = 0 or pa.gender = any (xb.seeking_genders))
       and date_part('year', age(pb.date_of_birth))::int between coalesce(xa.age_min, 18) and coalesce(xa.age_max, 99)
       and date_part('year', age(pa.date_of_birth))::int between coalesce(xb.age_min, 18) and coalesce(xb.age_max, 99)) end $$;

create or replace function public.snap_point(p_lat numeric, p_lng numeric) returns extensions.geography
language sql immutable set search_path = public, extensions as $$
  select case when p_lat between -90 and 90 and p_lng between -180 and 180
    then st_setsrid(st_makepoint(round(p_lng, 2), round(p_lat, 2)), 4326)::geography end $$;

create or replace function public.notify_db(p_user uuid, p_kind text, p_payload jsonb, p_dedupe text default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, payload, dedupe_key, origin) values (p_user, p_kind, p_payload, p_dedupe, 'db')
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing $$;
revoke execute on function public.notify_db(uuid, text, jsonb, text), public.snap_point(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.prefs_compatible(uuid, uuid, text) from public, anon;
grant execute on function public.prefs_compatible(uuid, uuid, text) to authenticated;

-- ===== Open Calls =======================================================================================
create or replace function public.create_open_call(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); v_mode text := p->>'mode_id'; v_start timestamptz := (p->>'starts_at')::timestamptz;
        v_cap int := coalesce((p->>'capacity')::int, 2); v_title text := btrim(coalesce(p->>'title', '')); v_area text := btrim(coalesce(p->>'area_label', ''));
        v_id uuid; v_fmt group_format;
begin
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
end $$;

create or replace function public.open_calls_feed(p_mode text, p_scope text default 'browse', p_limit int default 30, p_offset int default 0, p_max_km int default null)
returns table (id uuid, host_id uuid, host_name text, host_age int, host_verified boolean, title text, description text, starts_at timestamptz,
               area_label text, public_venue_name text, distance_km numeric, capacity int, accepted_count int, format group_format, budget_note text,
               meet_style meet_style, status open_call_status, my_status participant_status, is_mine boolean, conversation_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select oc.id, oc.host_id, h.display_name, date_part('year', age(h.date_of_birth))::int, coalesce(v.identity_verified, false), oc.title, oc.description,
         oc.starts_at, oc.area_label, oc.public_venue_name,
         round((st_distance(oc.approx_location, me.approx_location) / 1000.0)::numeric, 1), oc.capacity,
         (select count(*)::int from open_call_participants x where x.open_call_id = oc.id and x.status = 'accepted'),
         oc.format, oc.budget_note, oc.meet_style, oc.status, mp.status, (oc.host_id = auth.uid()),
         case when oc.host_id = auth.uid() or mp.status = 'accepted' then oc.conversation_id end
    from open_calls oc
    join profiles h on h.id = oc.host_id and h.state = 'active'
    join profiles me on me.id = auth.uid()
    left join verification_status v on v.user_id = h.id
    left join open_call_participants mp on mp.open_call_id = oc.id and mp.user_id = auth.uid()
   where oc.mode_id = p_mode and public.in_mode(auth.uid(), p_mode) and public.account_ok()
     and not public.blocked_between(auth.uid(), oc.host_id)
     and case p_scope
           when 'mine' then oc.host_id = auth.uid() and oc.starts_at > now() - interval '7 days'
           when 'joined' then mp.status in ('interested', 'waitlisted', 'accepted') and oc.starts_at > now() - interval '1 day'
           else oc.host_id <> auth.uid() and oc.status in ('open', 'full') and oc.expires_at > now() and public.in_mode(oc.host_id, p_mode)
                and public.prefs_compatible(auth.uid(), oc.host_id, p_mode) and coalesce(mp.status, 'interested') <> 'rejected'
                and (p_max_km is null or oc.approx_location is null or me.approx_location is null or st_distance(oc.approx_location, me.approx_location) / 1000.0 <= p_max_km)
         end
   order by oc.starts_at asc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0) $$;

create or replace function public.express_interest(p_call uuid) returns participant_status
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); oc open_calls%rowtype; st participant_status;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into oc from open_calls where id = p_call;
  if not found or oc.status not in ('open', 'full') or oc.expires_at <= now() or oc.host_id = uid or not public.account_ok()
     or not public.in_mode(uid, oc.mode_id) or not public.in_mode(oc.host_id, oc.mode_id) or public.blocked_between(uid, oc.host_id)
     or not public.prefs_compatible(uid, oc.host_id, oc.mode_id)
     or exists (select 1 from open_call_participants where open_call_id = p_call and user_id = uid and status = 'rejected') then
    raise exception 'unavailable' using errcode = '42501';     -- same answer for hidden, full-and-closed, blocked, or previously declined
  end if;
  if (select count(*) from open_call_participants where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'slow_down' using errcode = 'SQ429';
  end if;
  insert into open_call_participants (open_call_id, user_id, status) values (p_call, uid, (case when oc.status = 'full' then 'waitlisted' else 'interested' end)::participant_status)
  on conflict (open_call_id, user_id) do update set status = excluded.status where open_call_participants.status = 'withdrawn'
  returning status into st;
  if st is null then select status into st from open_call_participants where open_call_id = p_call and user_id = uid; return st; end if;
  perform public.notify_db(oc.host_id, 'open_call_interest', jsonb_build_object('openCallId', p_call::text), 'oci:' || p_call || ':' || uid || ':' || current_date);
  return st;
end $$;

create or replace function public.decide_participant(p_call uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); oc open_calls%rowtype; accepted int; cid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into oc from open_calls where id = p_call and host_id = uid and status in ('open', 'full') and expires_at > now();
  if not found or public.blocked_between(uid, p_user) then raise exception 'unavailable' using errcode = '42501'; end if;
  select count(*) into accepted from open_call_participants where open_call_id = p_call and status = 'accepted';
  if p_accept then
    if accepted >= oc.capacity - 1 then raise exception 'full' using errcode = 'SQ432'; end if;
    update open_call_participants set status = 'accepted' where open_call_id = p_call and user_id = p_user and status in ('interested', 'waitlisted');
    if not found then raise exception 'unavailable' using errcode = '42501'; end if;
    cid := oc.conversation_id;
    if cid is null then
      insert into conversations (kind, mode_id, title) values ('open_call', oc.mode_id, oc.title) returning id into cid;
      insert into conversation_members (conversation_id, user_id) values (cid, uid);
      update open_calls set conversation_id = cid where id = p_call;
    end if;
    insert into conversation_members (conversation_id, user_id) values (cid, p_user) on conflict do nothing;
    if accepted + 1 >= oc.capacity - 1 then update open_calls set status = 'full' where id = p_call; end if;
    insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
    values (p_user, 'open_call', p_call, oc.title, oc.starts_at, oc.starts_at + interval '2 hours', 'confirmed')
    on conflict (user_id, source_type, source_id) do update set status = 'confirmed', starts_at = excluded.starts_at, ends_at = excluded.ends_at;
    update calendar_entries set status = 'confirmed' where user_id = uid and source_type = 'open_call' and source_id = p_call and status = 'tentative';
    perform public.notify_db(p_user, 'open_call_accepted', jsonb_build_object('openCallId', p_call::text, 'conversationId', cid::text), 'oca:' || p_call || ':' || p_user);
  else
    update open_call_participants set status = 'rejected' where open_call_id = p_call and user_id = p_user and status in ('interested', 'waitlisted');
    if found then perform public.notify_db(p_user, 'open_call_update', jsonb_build_object('openCallId', p_call::text), 'ocu:' || p_call || ':' || p_user); end if;
  end if;
end $$;

create or replace function public.withdraw_interest(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); oc open_calls%rowtype; was participant_status;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into oc from open_calls where id = p_call;
  select status into was from open_call_participants where open_call_id = p_call and user_id = uid;
  if oc.id is null or was is null or was in ('rejected', 'withdrawn') then return; end if;   -- a rejection stays a rejection
  update open_call_participants set status = 'withdrawn' where open_call_id = p_call and user_id = uid;
  if was = 'accepted' then
    delete from conversation_members where conversation_id = oc.conversation_id and user_id = uid;
    update calendar_entries set status = 'cancelled' where user_id = uid and source_type = 'open_call' and source_id = p_call;
    if oc.status = 'full' and oc.expires_at > now() then update open_calls set status = 'open' where id = p_call; end if;
    perform public.notify_db(oc.host_id, 'open_call_update', jsonb_build_object('openCallId', p_call::text), 'ocw:' || p_call || ':' || uid);
  end if;
end $$;

create or replace function public.cancel_open_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update open_calls set status = 'cancelled' where id = p_call and host_id = uid and status in ('open', 'full');
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update calendar_entries set status = 'cancelled' where source_type = 'open_call' and source_id = p_call;
  for r in select user_id from open_call_participants where open_call_id = p_call and status in ('interested', 'waitlisted', 'accepted') loop
    perform public.notify_db(r.user_id, 'open_call_update', jsonb_build_object('openCallId', p_call::text), 'occ:' || p_call || ':' || r.user_id);
  end loop;
end $$;

create or replace function public.complete_open_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update open_calls set status = 'completed' where id = p_call and host_id = uid and status in ('open', 'full') and starts_at <= now();
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update calendar_entries set status = 'completed' where source_type = 'open_call' and source_id = p_call and status <> 'cancelled';
end $$;

-- Host edits: title, description, venue, budget, meeting style, time and capacity (never below who is already in).
create or replace function public.update_open_call(p_call uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); oc open_calls%rowtype; accepted int; v_start timestamptz; v_cap int; r record;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into oc from open_calls where id = p_call and host_id = uid and status in ('open', 'full') and starts_at > now();
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  select count(*) into accepted from open_call_participants where open_call_id = p_call and status = 'accepted';
  v_start := coalesce((p->>'starts_at')::timestamptz, oc.starts_at); v_cap := coalesce((p->>'capacity')::int, oc.capacity);
  if v_start < now() + interval '15 minutes' or v_start > now() + interval '60 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if v_cap not between 2 and 50 or v_cap < accepted + 1 then raise exception 'capacity cannot be lower than who is already in' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p->>'title', oc.title))) not between 2 and 120 or char_length(coalesce(p->>'description', oc.description, '')) > 1000 then
    raise exception 'invalid text' using errcode = '22023';
  end if;
  update open_calls set title = btrim(coalesce(p->>'title', title)), description = case when p ? 'description' then nullif(btrim(p->>'description'), '') else description end,
         public_venue_name = case when p ? 'public_venue_name' then nullif(btrim(p->>'public_venue_name'), '') else public_venue_name end,
         budget_note = case when p ? 'budget_note' then nullif(left(btrim(p->>'budget_note'), 120), '') else budget_note end,
         meet_style = coalesce(nullif(p->>'meet_style', '')::meet_style, meet_style), starts_at = v_start, expires_at = v_start, capacity = v_cap,
         format = case when v_cap = 2 then 'one_to_one'::group_format else 'group'::group_format end,
         status = case when accepted >= v_cap - 1 then 'full'::open_call_status else 'open'::open_call_status end
   where id = p_call;
  if v_start <> oc.starts_at then
    update calendar_entries set starts_at = v_start, ends_at = v_start + interval '2 hours' where source_type = 'open_call' and source_id = p_call and status <> 'cancelled';
    for r in select user_id from open_call_participants where open_call_id = p_call and status in ('interested', 'waitlisted', 'accepted') loop
      perform public.notify_db(r.user_id, 'open_call_update', jsonb_build_object('openCallId', p_call::text), 'ocu2:' || p_call || ':' || r.user_id || ':' || v_start::text);
    end loop;
  end if;
end $$;

-- Who is in: the host sees everyone with a request; accepted people see each other. Blocked people never appear.
create or replace function public.open_call_people(p_call uuid)
returns table (user_id uuid, display_name text, age int, verified boolean, status participant_status)
language sql stable security definer set search_path = public as $$
  select x.user_id, p.display_name, date_part('year', age(p.date_of_birth))::int, coalesce(v.identity_verified, false), x.status
    from open_call_participants x
    join open_calls oc on oc.id = x.open_call_id
    join profiles p on p.id = x.user_id and p.state = 'active'
    left join verification_status v on v.user_id = p.id
   where x.open_call_id = p_call and x.user_id <> auth.uid() and not public.blocked_between(auth.uid(), x.user_id)
     and ((oc.host_id = auth.uid() and x.status in ('interested', 'waitlisted', 'accepted'))
       or (x.status = 'accepted' and exists (select 1 from open_call_participants me where me.open_call_id = p_call and me.user_id = auth.uid() and me.status = 'accepted')))
   order by (x.status = 'interested') desc, x.created_at $$;

-- ===== Activities (public listings people can join) =====================================================
-- capacity counts everyone including the host; null means no limit.
create or replace function public.create_activity(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); v_start timestamptz := (p->>'starts_at')::timestamptz; v_title text := btrim(coalesce(p->>'title', ''));
        v_cat text := p->>'category'; v_area text := btrim(coalesce(p->>'area_label', '')); v_cap int := nullif(p->>'capacity', '')::int; v_id uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if v_cat is null or not (v_cat = any (array['cafes','restaurants','comedy','music','board_games','bowling','sports','workshops','art','walking','travel','adventure','local'])) then
    raise exception 'unknown category' using errcode = '22023';
  end if;
  if char_length(v_title) not between 2 and 120 or char_length(v_area) < 2 or char_length(coalesce(p->>'description', '')) > 1000 then raise exception 'invalid text' using errcode = '22023'; end if;
  if v_start is null or v_start < now() + interval '30 minutes' or v_start > now() + interval '120 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if v_cap is not null and v_cap not between 2 and 200 then raise exception 'capacity must be 2 to 200' using errcode = '22023'; end if;
  if (select count(*) from events where host_id = uid and kind = 'activity' and status = 'scheduled' and starts_at > now()) >= 5 then raise exception 'too_many_activities' using errcode = 'SQ431'; end if;
  insert into events (kind, host_id, category, title, description, area_label, approx_location, public_venue_name, starts_at, ends_at, capacity, is_public_listing)
  values ('activity', uid, v_cat, v_title, nullif(btrim(coalesce(p->>'description', '')), ''), v_area, public.snap_point(nullif(p->>'lat', '')::numeric, nullif(p->>'lng', '')::numeric),
          nullif(btrim(coalesce(p->>'public_venue_name', '')), ''), v_start, v_start + interval '2 hours', v_cap, true) returning id into v_id;
  insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status) values (uid, 'event', v_id, v_title, v_start, v_start + interval '2 hours', 'confirmed');
  return v_id;
end $$;

create or replace function public.activities_feed(p_category text default null, p_scope text default 'browse', p_limit int default 30, p_offset int default 0, p_max_km int default null)
returns table (id uuid, host_id uuid, host_name text, title text, category text, description text, starts_at timestamptz, area_label text, public_venue_name text,
               distance_km numeric, capacity int, going int, my_status participant_status, is_mine boolean, status text)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.host_id, h.display_name, e.title, e.category, e.description, e.starts_at, e.area_label, e.public_venue_name,
         round((st_distance(e.approx_location, me.approx_location) / 1000.0)::numeric, 1), e.capacity,
         1 + (select count(*)::int from event_participants x where x.event_id = e.id and x.status = 'accepted'),
         mp.status, (e.host_id = auth.uid()), e.status
    from events e
    join profiles h on h.id = e.host_id and h.state = 'active'
    join profiles me on me.id = auth.uid()
    left join event_participants mp on mp.event_id = e.id and mp.user_id = auth.uid()
   where e.kind = 'activity' and public.account_ok() and not public.blocked_between(auth.uid(), e.host_id)
     and (p_category is null or e.category = p_category)
     and case p_scope
           when 'mine' then e.host_id = auth.uid() and e.starts_at > now() - interval '7 days'
           when 'joined' then mp.status in ('accepted', 'waitlisted') and e.starts_at > now() - interval '1 day'
           else e.host_id <> auth.uid() and e.is_public_listing and e.status = 'scheduled' and e.starts_at > now()
                and (p_max_km is null or e.approx_location is null or me.approx_location is null or st_distance(e.approx_location, me.approx_location) / 1000.0 <= p_max_km)
         end
   order by e.starts_at asc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0) $$;

create or replace function public.join_activity(p_event uuid) returns participant_status
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e events%rowtype; going int; st participant_status;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into e from events where id = p_event and kind = 'activity' and status = 'scheduled' and is_public_listing and starts_at > now();
  if not found or e.host_id = uid or not public.account_ok() or public.blocked_between(uid, e.host_id) then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from event_participants where user_id = uid and joined_at > now() - interval '1 day') >= 20 then raise exception 'slow_down' using errcode = 'SQ429'; end if;
  select 1 + count(*) into going from event_participants where event_id = p_event and status = 'accepted';
  st := case when e.capacity is not null and going >= e.capacity then 'waitlisted' else 'accepted' end;
  insert into event_participants (event_id, user_id, status) values (p_event, uid, st)
  on conflict (event_id, user_id) do update set status = excluded.status, joined_at = now() where event_participants.status = 'withdrawn'
  returning status into st;
  if st is null then select status into st from event_participants where event_id = p_event and user_id = uid; return st; end if;
  insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
  values (uid, 'event', p_event, e.title, e.starts_at, coalesce(e.ends_at, e.starts_at + interval '2 hours'), case when st = 'accepted' then 'confirmed'::calendar_status else 'tentative'::calendar_status end)
  on conflict (user_id, source_type, source_id) do update set status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at;
  return st;
end $$;

create or replace function public.leave_activity(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e events%rowtype; was participant_status; nxt uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into e from events where id = p_event;
  select status into was from event_participants where event_id = p_event and user_id = uid;
  if e.id is null or was is null or was = 'withdrawn' then return; end if;
  update event_participants set status = 'withdrawn' where event_id = p_event and user_id = uid;
  update calendar_entries set status = 'cancelled' where user_id = uid and source_type = 'event' and source_id = p_event;
  if was = 'accepted' then
    select user_id into nxt from event_participants where event_id = p_event and status = 'waitlisted' order by joined_at limit 1;
    if nxt is not null then
      update event_participants set status = 'accepted' where event_id = p_event and user_id = nxt;
      update calendar_entries set status = 'confirmed' where user_id = nxt and source_type = 'event' and source_id = p_event;
      perform public.notify_db(nxt, 'activity_update', jsonb_build_object('eventId', p_event::text), 'actp:' || p_event || ':' || nxt);
    end if;
  end if;
end $$;

create or replace function public.cancel_activity(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update events set status = 'cancelled' where id = p_event and host_id = uid and kind = 'activity' and status = 'scheduled';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update calendar_entries set status = 'cancelled' where source_type = 'event' and source_id = p_event;
  for r in select user_id from event_participants where event_id = p_event and status in ('accepted', 'waitlisted') loop
    perform public.notify_db(r.user_id, 'activity_update', jsonb_build_object('eventId', p_event::text), 'actc:' || p_event || ':' || r.user_id);
  end loop;
end $$;

-- People going. Visible to the host and to others who are going. can_invite: both are in Adventures, so a friendly invitation is allowed.
create or replace function public.activity_people(p_event uuid)
returns table (user_id uuid, display_name text, age int, verified boolean, is_host boolean, can_invite boolean)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select 1 from events e where e.id = p_event and (e.host_id = auth.uid()
      or exists (select 1 from event_participants m where m.event_id = p_event and m.user_id = auth.uid() and m.status = 'accepted'))),
  who as (
    select e.host_id as uid, true as host from events e where e.id = p_event
    union all select x.user_id, false from event_participants x where x.event_id = p_event and x.status = 'accepted')
  select p.id, p.display_name, date_part('year', age(p.date_of_birth))::int, coalesce(v.identity_verified, false), who.host,
         (public.in_mode(auth.uid(), 'adventures') and public.in_mode(p.id, 'adventures'))
    from who join profiles p on p.id = who.uid and p.state = 'active' left join verification_status v on v.user_id = p.id
   where exists (select 1 from allowed) and p.id <> auth.uid() and not public.blocked_between(auth.uid(), p.id)
   order by who.host desc, p.display_name $$;

-- ===== Group chat support =================================================================================
create or replace function public.thread_info(p_conv uuid)
returns table (kind conversation_kind, title text, mode_id text, user_id uuid, display_name text, age int, verified boolean, shared_interests text[],
               other_last_read_at timestamptz, my_last_read_at timestamptz, member_count int)
language sql stable security definer set search_path = public as $$
  select c.kind, c.title, c.mode_id, o.id, o.display_name, date_part('year', age(o.date_of_birth))::int, coalesce(v.identity_verified, false),
         case when o.id is null then '{}'::text[] else array(select unnest(o.interests) intersect select unnest(mp.interests)) end,
         case when o.id is not null and o.read_receipts then om.last_read_at end, me.last_read_at,
         (select count(*)::int from conversation_members x where x.conversation_id = c.id)
    from conversations c
    join conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
    join profiles mp on mp.id = auth.uid()
    left join conversation_members om on c.kind = 'direct' and om.conversation_id = c.id and om.user_id <> auth.uid()
    left join profiles o on o.id = om.user_id and o.state = 'active'
    left join verification_status v on v.user_id = o.id
   where c.id = p_conv and (c.kind <> 'direct' or (o.id is not null and not public.blocked_between(auth.uid(), o.id))) $$;

create or replace function public.thread_members(p_conv uuid) returns table (user_id uuid, display_name text, verified boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, coalesce(v.identity_verified, false)
    from conversation_members m join profiles p on p.id = m.user_id left join verification_status v on v.user_id = p.id
   where m.conversation_id = p_conv and m.user_id <> auth.uid() and public.is_conversation_member(p_conv) and not public.blocked_between(auth.uid(), p.id) $$;

revoke execute on function public.create_open_call(jsonb), public.open_calls_feed(text, text, int, int, int), public.express_interest(uuid),
  public.decide_participant(uuid, uuid, boolean), public.withdraw_interest(uuid), public.cancel_open_call(uuid), public.complete_open_call(uuid),
  public.update_open_call(uuid, jsonb), public.open_call_people(uuid), public.create_activity(jsonb), public.activities_feed(text, text, int, int, int),
  public.join_activity(uuid), public.leave_activity(uuid), public.cancel_activity(uuid), public.activity_people(uuid),
  public.thread_info(uuid), public.thread_members(uuid) from public, anon;
grant execute on function public.create_open_call(jsonb), public.open_calls_feed(text, text, int, int, int), public.express_interest(uuid),
  public.decide_participant(uuid, uuid, boolean), public.withdraw_interest(uuid), public.cancel_open_call(uuid), public.complete_open_call(uuid),
  public.update_open_call(uuid, jsonb), public.open_call_people(uuid), public.create_activity(jsonb), public.activities_feed(text, text, int, int, int),
  public.join_activity(uuid), public.leave_activity(uuid), public.cancel_activity(uuid), public.activity_people(uuid),
  public.thread_info(uuid), public.thread_members(uuid) to authenticated;
