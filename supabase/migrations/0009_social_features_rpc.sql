-- SideQuest part 9: Wingperson, Double Dates, Social Roulette, Circles, chemistry games, date planner, Together (couples).
-- Same rule as 0008: every write goes through a checked function; direct-write policies are removed.
-- Friend codes: a person shares a short code to be invited as a wingperson, team-mate, trusted contact or partner.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.

-- ===== Friend codes (rate-limited so they cannot be guessed) =============================================
alter table public.profiles add column friend_code text unique;
create table public.friend_code_lookups (
  user_id uuid not null references public.profiles(id) on delete cascade,
  looked_up_at timestamptz not null default now()
);
create index friend_code_lookups_idx on public.friend_code_lookups (user_id, looked_up_at desc);
alter table public.friend_code_lookups enable row level security;   -- no client policies on purpose: only the functions below touch it

create or replace function public.my_friend_code() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select friend_code into c from profiles where id = uid;
  while c is null loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin update profiles set friend_code = c where id = uid; exception when unique_violation then c := null; end;
  end loop;
  return c;
end $$;

create or replace function public.reset_friend_code() returns text
language plpgsql security definer set search_path = public as $$
begin update profiles set friend_code = null where id = auth.uid(); return public.my_friend_code(); end $$;

create or replace function public.resolve_friend_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); found uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from friend_code_lookups where user_id = uid and looked_up_at > now() - interval '1 day') >= 20 then raise exception 'slow_down' using errcode = 'SQ429'; end if;
  insert into friend_code_lookups (user_id) values (uid);
  select id into found from profiles where friend_code = upper(btrim(p_code)) and state = 'active';
  if found is null or found = uid or public.blocked_between(uid, found) then return null; end if;
  return found;
end $$;
revoke execute on function public.resolve_friend_code(text) from public, anon, authenticated;
revoke execute on function public.my_friend_code(), public.reset_friend_code() from public, anon;
grant execute on function public.my_friend_code(), public.reset_friend_code() to authenticated;

-- ===== Wingperson ============================================================================================
-- A trusted friend helps with YOUR profile and plans. There is no permission for chats, ever.
drop policy wing_grants_owner_all on public.wingperson_grants;
drop policy wing_grants_wing_respond on public.wingperson_grants;
drop policy wing_sugg_insert on public.wing_suggestions;
drop policy wing_sugg_owner_update on public.wing_suggestions;
create policy wing_grants_owner_select on public.wingperson_grants for select to authenticated using (owner_id = auth.uid());
alter table public.wing_suggestions drop constraint wing_suggestions_kind_check;
alter table public.wing_suggestions add constraint wing_suggestions_kind_check check (kind in ('person','opener','open_call','profile_text','activity'));
alter table public.wing_suggestions add column payload jsonb not null default '{}';

create or replace function public.invite_wingperson(p_code text, p_permissions text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); wing uuid; gid uuid;
begin
  wing := public.resolve_friend_code(p_code);
  if wing is null or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if cardinality(p_permissions) = 0 then raise exception 'choose what your wingperson can do' using errcode = '22023'; end if;
  insert into wingperson_grants (owner_id, wing_id, permissions, status) values (uid, wing, p_permissions, 'invited')
  on conflict (owner_id, wing_id) do update set permissions = excluded.permissions, status = 'invited', revoked_at = null
    where wingperson_grants.status = 'revoked'
  returning id into gid;
  if gid is null then select id into gid from wingperson_grants where owner_id = uid and wing_id = wing; return gid; end if;
  perform public.notify_db(wing, 'wing_invited', jsonb_build_object('grantId', gid::text), 'wingi:' || gid || ':' || current_date);
  return gid;
end $$;

create or replace function public.respond_wing_invite(p_grant uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update wingperson_grants set status = case when p_accept then 'active' else 'revoked' end, revoked_at = case when p_accept then null else now() end
   where id = p_grant and wing_id = auth.uid() and status = 'invited';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
end $$;

create or replace function public.revoke_wing(p_grant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update wingperson_grants set status = 'revoked', revoked_at = now() where id = p_grant and auth.uid() in (owner_id, wing_id) and status <> 'revoked';
end $$;

create or replace function public.my_wing_grants()
returns table (grant_id uuid, role text, other_id uuid, other_name text, permissions text[], status text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, case when g.owner_id = auth.uid() then 'owner' else 'wing' end, o.id, o.display_name, g.permissions, g.status, g.expires_at
    from wingperson_grants g join profiles o on o.id = case when g.owner_id = auth.uid() then g.wing_id else g.owner_id end
   where auth.uid() in (g.owner_id, g.wing_id) and g.status <> 'revoked' and not public.blocked_between(auth.uid(), o.id)
   order by g.created_at desc $$;

-- What a wingperson may see: the owner's own words for one vibe. Never chats, matches, likes or photos of other people.
create or replace function public.wing_owner_view(p_grant uuid, p_mode text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('display_name', p.display_name, 'headline', msp.headline, 'bio', coalesce(msp.bio, p.bio),
                            'prompts', coalesce(msp.prompts, '[]'::jsonb), 'interests', to_jsonb(p.interests))
    from wingperson_grants g join profiles p on p.id = g.owner_id
    left join mode_specific_profiles msp on msp.user_id = p.id and msp.mode_id = p_mode
   where g.id = p_grant and public.wing_can(p_grant, 'view_shared_profile') and public.in_mode(p.id, p_mode) $$;

create or replace function public.wing_suggest(p_grant uuid, p_kind text, p_payload jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare owner uuid; sid uuid;
begin
  if not (case p_kind when 'profile_text' then public.wing_can(p_grant, 'view_shared_profile') when 'activity' then public.wing_can(p_grant, 'suggest_profiles') else false end) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  if p_kind = 'profile_text' and (char_length(coalesce(p_payload->>'headline', '')) > 120 or char_length(coalesce(p_payload->>'bio', '')) > 600 or p_payload->>'mode_id' is null) then
    raise exception 'invalid suggestion' using errcode = '22023';
  end if;
  if p_kind = 'activity' and not exists (select 1 from events where id = (p_payload->>'event_id')::uuid and kind = 'activity' and is_public_listing and status = 'scheduled') then
    raise exception 'invalid suggestion' using errcode = '22023';
  end if;
  select owner_id into owner from wingperson_grants where id = p_grant;
  insert into wing_suggestions (grant_id, kind, payload, note) values (p_grant, p_kind, p_payload, left(p_note, 280)) returning id into sid;
  perform public.notify_db(owner, 'wing_suggestion', jsonb_build_object('grantId', p_grant::text), 'wings:' || p_grant || ':' || current_date);
  return sid;
end $$;

create or replace function public.my_wing_suggestions()
returns table (id uuid, grant_id uuid, from_name text, kind text, payload jsonb, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.grant_id, w.display_name, s.kind, s.payload, s.note, s.created_at
    from wing_suggestions s join wingperson_grants g on g.id = s.grant_id join profiles w on w.id = g.wing_id
   where g.owner_id = auth.uid() and s.status = 'pending' and g.status = 'active' order by s.created_at desc $$;

create or replace function public.resolve_wing_suggestion(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s wing_suggestions%rowtype; uid uuid := auth.uid();
begin
  select ws.* into s from wing_suggestions ws join wingperson_grants g on g.id = ws.grant_id where ws.id = p_id and g.owner_id = uid and ws.status = 'pending';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  if p_accept and s.kind = 'profile_text' and public.in_mode(uid, s.payload->>'mode_id') then
    insert into mode_specific_profiles (user_id, mode_id, headline, bio) values (uid, s.payload->>'mode_id', nullif(s.payload->>'headline', ''), nullif(s.payload->>'bio', ''))
    on conflict (user_id, mode_id) do update set headline = coalesce(nullif(s.payload->>'headline', ''), mode_specific_profiles.headline), bio = coalesce(nullif(s.payload->>'bio', ''), mode_specific_profiles.bio), updated_at = now();
  end if;
  update wing_suggestions set status = case when p_accept then 'accepted' else 'dismissed' end where id = p_id;
end $$;

-- ===== Teams and Double Dates ================================================================================
drop policy teams_insert on public.teams;
drop policy teams_creator_update on public.teams;
drop policy teams_creator_delete on public.teams;
drop policy team_members_creator_insert on public.team_members;
drop policy team_members_self_respond on public.team_members;
drop policy team_members_creator_delete on public.team_members;
drop policy double_dates_insert on public.double_dates;
drop policy double_dates_update on public.double_dates;

create or replace function public.create_team(p_kind text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if p_kind not in ('friends', 'couple', 'singles') then raise exception 'unknown team type' using errcode = '22023'; end if;
  if (select count(*) from teams where created_by = uid and created_at > now() - interval '1 day') >= 5 then raise exception 'slow_down' using errcode = 'SQ429'; end if;
  insert into teams (kind, name, created_by) values (p_kind, nullif(left(btrim(coalesce(p_name, '')), 60), ''), uid) returning id into tid;
  insert into team_members (team_id, user_id, status) values (tid, uid, 'accepted');
  return tid;
end $$;

create or replace function public.invite_to_team(p_team uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid;
begin
  if not exists (select 1 from teams where id = p_team and created_by = uid) then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from team_members where team_id = p_team and status in ('invited', 'accepted')) >= 2 then raise exception 'a team is a pair' using errcode = '22023'; end if;
  other := public.resolve_friend_code(p_code);
  if other is null then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into team_members (team_id, user_id, status) values (p_team, other, 'invited')
  on conflict (team_id, user_id) do update set status = 'invited' where team_members.status = 'left';
  perform public.notify_db(other, 'team_invited', jsonb_build_object('teamId', p_team::text), 'teami:' || p_team || ':' || other);
end $$;

create or replace function public.respond_team_invite(p_team uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update team_members set status = case when p_accept then 'accepted' else 'left' end where team_id = p_team and user_id = auth.uid() and status = 'invited';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
end $$;

create or replace function public.leave_team(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record;
begin
  update team_members set status = 'left' where team_id = p_team and user_id = uid and status in ('invited', 'accepted');
  -- a team that loses a member cannot keep an open double date
  for r in select id from double_dates where (team_a = p_team or team_b = p_team) and state in ('looking', 'proposed') loop
    update double_dates set state = 'cancelled' where id = r.id;
  end loop;
end $$;

create or replace function public.my_teams()
returns table (team_id uuid, kind text, name text, is_creator boolean, my_status text, members jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.created_by = auth.uid(), me.status,
         (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name, 'status', m.status)), '[]'::jsonb)
            from team_members m join profiles p on p.id = m.user_id
           where m.team_id = t.id and m.status in ('invited', 'accepted') and not public.blocked_between(auth.uid(), p.id))
    from teams t join team_members me on me.team_id = t.id and me.user_id = auth.uid() and me.status in ('invited', 'accepted')
   order by t.created_at desc $$;

create or replace function public.teams_compatible(ta uuid, tb uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  with a as (select user_id from team_members where team_id = ta and status = 'accepted'),
       b as (select user_id from team_members where team_id = tb and status = 'accepted')
  select (select count(*) from a) = 2 and (select count(*) from b) = 2
     and not exists (select 1 from a join b on true where public.blocked_between(a.user_id, b.user_id))
     and not exists (select 1 from (select user_id from a union all select user_id from b) u where not public.in_mode(u.user_id, m))
     and (not coalesce((select romantic_allowed from intent_modes where id = m), true)
          or exists (select 1 from a join b on true where public.prefs_compatible(a.user_id, b.user_id, m))) $$;

create or replace function public.post_double_date(p_team uuid, p_mode text, p_starts timestamptz, p_venue text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); did uuid;
begin
  if not exists (select 1 from teams where id = p_team and created_by = uid) or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from team_members where team_id = p_team and status = 'accepted') <> 2 then raise exception 'a double date needs a pair' using errcode = '22023'; end if;
  if p_starts is null or p_starts < now() + interval '2 hours' or p_starts > now() + interval '60 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if exists (select 1 from team_members where team_id = p_team and status = 'accepted' and not public.in_mode(user_id, p_mode)) then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from double_dates where created_by = uid and state in ('looking', 'proposed', 'scheduled') and starts_at > now()) >= 3 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into double_dates (team_a, mode_id, state, starts_at, public_venue_name, created_by) values (p_team, p_mode, 'looking', p_starts, nullif(left(btrim(coalesce(p_venue, '')), 80), ''), uid) returning id into did;
  return did;
end $$;

create or replace function public.double_dates_feed(p_mode text, p_scope text default 'browse')
returns table (id uuid, state text, starts_at timestamptz, venue text, team_a_names text[], team_b_names text[], team_a_kind text, is_mine boolean, my_team uuid, can_request boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.state, d.starts_at, d.public_venue_name,
         array(select p.display_name from team_members m join profiles p on p.id = m.user_id where m.team_id = d.team_a and m.status = 'accepted' and not public.blocked_between(auth.uid(), p.id)),
         array(select p.display_name from team_members m join profiles p on p.id = m.user_id where m.team_id = d.team_b and m.status = 'accepted' and not public.blocked_between(auth.uid(), p.id)),
         (select kind from teams where id = d.team_a),
         exists (select 1 from team_members m where m.team_id in (d.team_a, d.team_b) and m.user_id = auth.uid() and m.status = 'accepted'),
         (select m.team_id from team_members m where m.team_id in (d.team_a, d.team_b) and m.user_id = auth.uid() and m.status = 'accepted' limit 1),
         d.state = 'looking'
    from double_dates d
   where d.mode_id = p_mode and public.in_mode(auth.uid(), p_mode) and public.account_ok() and d.starts_at > now() - interval '1 day'
     and case p_scope
           when 'mine' then exists (select 1 from team_members m where m.team_id in (d.team_a, d.team_b) and m.user_id = auth.uid() and m.status = 'accepted')
           else d.state = 'looking' and not exists (select 1 from team_members m where m.team_id = d.team_a and m.user_id = auth.uid())
                and exists (select 1 from teams t join team_members m on m.team_id = t.id where t.created_by = auth.uid() and m.user_id = auth.uid() and m.status = 'accepted' and public.teams_compatible(d.team_a, t.id, p_mode))
         end
   order by d.starts_at $$;

create or replace function public.request_double_date(p_dd uuid, p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d double_dates%rowtype; creator uuid;
begin
  select * into d from double_dates where id = p_dd and state = 'looking' and starts_at > now();
  if not found or not exists (select 1 from teams where id = p_team and created_by = uid) or d.team_a = p_team or not public.teams_compatible(d.team_a, p_team, d.mode_id) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  update double_dates set team_b = p_team, state = 'proposed' where id = p_dd and state = 'looking';
  select created_by into creator from teams where id = d.team_a;
  perform public.notify_db(creator, 'double_date_request', jsonb_build_object('doubleDateId', p_dd::text), 'ddr:' || p_dd || ':' || p_team);
end $$;

create or replace function public.respond_double_date(p_dd uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d double_dates%rowtype; cid uuid; r record; bcreator uuid;
begin
  select dd.* into d from double_dates dd join teams t on t.id = dd.team_a where dd.id = p_dd and dd.state = 'proposed' and t.created_by = uid;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  select created_by into bcreator from teams where id = d.team_b;
  if not p_accept then
    update double_dates set state = 'looking', team_b = null where id = p_dd;
    perform public.notify_db(bcreator, 'double_date_update', jsonb_build_object('doubleDateId', p_dd::text), 'ddu:' || p_dd || ':' || d.team_b);
    return;
  end if;
  insert into conversations (kind, mode_id, title) values ('group', d.mode_id, 'Double date') returning id into cid;
  for r in select user_id from team_members where team_id in (d.team_a, d.team_b) and status = 'accepted' loop
    insert into conversation_members (conversation_id, user_id) values (cid, r.user_id) on conflict do nothing;
    insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
    values (r.user_id, 'double_date', p_dd, 'Double date', d.starts_at, d.starts_at + interval '3 hours', 'confirmed')
    on conflict (user_id, source_type, source_id) do update set status = 'confirmed';
    perform public.notify_db(r.user_id, 'double_date_update', jsonb_build_object('doubleDateId', p_dd::text, 'conversationId', cid::text), 'ddc:' || p_dd || ':' || r.user_id);
  end loop;
  update double_dates set state = 'scheduled', conversation_id = cid where id = p_dd;
end $$;

create or replace function public.cancel_double_date(p_dd uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  update double_dates set state = 'cancelled'
   where id = p_dd and state in ('looking', 'proposed', 'scheduled')
     and exists (select 1 from teams t where t.id in (double_dates.team_a, double_dates.team_b) and t.created_by = auth.uid());
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update calendar_entries set status = 'cancelled' where source_type = 'double_date' and source_id = p_dd;
  for r in select m.user_id from double_dates d join team_members m on m.team_id in (d.team_a, d.team_b) and m.status = 'accepted' where d.id = p_dd and m.user_id <> auth.uid() loop
    perform public.notify_db(r.user_id, 'double_date_update', jsonb_build_object('doubleDateId', p_dd::text), 'ddx:' || p_dd || ':' || r.user_id);
  end loop;
end $$;

-- ===== Social Roulette =======================================================================================
drop policy roulette_signups_own_insert on public.roulette_signups;
drop policy roulette_signups_own_update on public.roulette_signups;
drop policy roulette_members_confirm on public.roulette_group_members;
alter table public.roulette_groups add column activity text;
alter table public.roulette_groups add column slot_start timestamptz;
alter table public.roulette_groups add column mode_id text references public.intent_modes(id);

create or replace function public.join_roulette(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_mode text := p->>'mode_id'; v_slot timestamptz := (p->>'slot_start')::timestamptz; v_size int := coalesce((p->>'group_size')::int, 4); sid uuid;
begin
  if uid is null or not public.account_ok() or not public.in_mode(uid, v_mode) then raise exception 'unavailable' using errcode = '42501'; end if;
  if v_slot is null or v_slot < now() + interval '3 hours' or v_slot > now() + interval '14 days' then raise exception 'start time out of range' using errcode = '22023'; end if;
  if v_size not between 2 and 8 or p->>'energy' not in ('chill', 'flirty', 'adventurous', 'social') or char_length(btrim(coalesce(p->>'area_label', ''))) < 2
     or char_length(btrim(coalesce(p->>'activity', ''))) not between 2 and 40 then raise exception 'invalid details' using errcode = '22023'; end if;
  if (select count(*) from roulette_signups where user_id = uid and status in ('waiting', 'waitlisted', 'grouped') and slot_start > now()) >= 3 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label)
  values (uid, v_mode, lower(btrim(p->>'activity')), v_slot, p->>'energy', v_size, btrim(p->>'area_label')) returning id into sid;
  return sid;
exception when unique_violation then raise exception 'you already signed up for this' using errcode = '22023';
end $$;

create or replace function public.cancel_roulette(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s roulette_signups%rowtype; g uuid; conv uuid;
begin
  select * into s from roulette_signups where id = p_id and user_id = uid and status in ('waiting', 'waitlisted', 'grouped');
  if not found then return; end if;
  update roulette_signups set status = 'cancelled' where id = p_id;
  select group_id into g from roulette_group_members where user_id = uid and group_id in (select id from roulette_groups where mode_id = s.mode_id and activity = s.activity and slot_start = s.slot_start);
  if g is not null then
    delete from roulette_group_members where group_id = g and user_id = uid;
    select conversation_id into conv from roulette_groups where id = g;
    delete from conversation_members where conversation_id = conv and user_id = uid;
    update calendar_entries set status = 'cancelled' where user_id = uid and source_type = 'roulette' and source_id = g;
  end if;
end $$;

create or replace function public.my_roulette()
returns table (signup_id uuid, mode_id text, activity text, slot_start timestamptz, group_size int, area_label text, status text, group_id uuid, venue text, conversation_id uuid, is_host boolean, members text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.mode_id, s.activity, s.slot_start, s.group_size, s.area_label, s.status, g.id, g.public_venue_name, case when gm.user_id is not null then g.conversation_id end, g.host_id = auth.uid(),
         array(select p.display_name from roulette_group_members x join profiles p on p.id = x.user_id where x.group_id = g.id and x.user_id <> auth.uid() and not public.blocked_between(auth.uid(), p.id))
    from roulette_signups s
    left join roulette_groups g on g.mode_id = s.mode_id and g.activity = s.activity and g.slot_start = s.slot_start
         and exists (select 1 from roulette_group_members m where m.group_id = g.id and m.user_id = auth.uid())
    left join roulette_group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
   where s.user_id = auth.uid() and s.status <> 'cancelled' and s.slot_start > now() - interval '1 day' order by s.slot_start $$;

create or replace function public.set_roulette_venue(p_group uuid, p_venue text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if char_length(btrim(coalesce(p_venue, ''))) not between 2 and 80 then raise exception 'name a public venue' using errcode = '22023'; end if;
  update roulette_groups set public_venue_name = btrim(p_venue) where id = p_group and host_id = auth.uid();
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  for r in select user_id from roulette_group_members where group_id = p_group and user_id <> auth.uid() loop
    perform public.notify_db(r.user_id, 'roulette_update', jsonb_build_object('groupId', p_group::text), 'rv:' || p_group || ':' || r.user_id || ':' || md5(p_venue));
  end loop;
end $$;

create or replace function public.confirm_roulette(p_group uuid) returns void
language sql security definer set search_path = public as $$
  update roulette_group_members set confirmed = true where group_id = p_group and user_id = auth.uid() $$;

-- Service only (called by the worker): forms one table from people the matcher put together.
create or replace function public.form_roulette_group(p_members uuid[], p_signups uuid[], p_mode text, p_activity text, p_slot timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; cid uuid; u uuid;
begin
  insert into conversations (kind, mode_id, title) values ('group', p_mode, 'Social Roulette: ' || p_activity) returning id into cid;
  insert into roulette_groups (conversation_id, host_id, activity, slot_start, mode_id) values (cid, p_members[1], p_activity, p_slot, p_mode) returning id into gid;
  foreach u in array p_members loop
    insert into roulette_group_members (group_id, user_id) values (gid, u);
    insert into conversation_members (conversation_id, user_id) values (cid, u);
    insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
    values (u, 'roulette', gid, 'Social Roulette: ' || p_activity, p_slot, p_slot + interval '3 hours', 'tentative');
  end loop;
  update roulette_signups set status = 'grouped' where id = any (p_signups);
  return gid;
end $$;
revoke execute on function public.form_roulette_group(uuid[], uuid[], text, text, timestamptz) from public, anon, authenticated;

-- ===== Circles ===============================================================================================
drop policy circles_insert on public.circles;
drop policy circles_owner_update on public.circles;
drop policy circles_owner_delete on public.circles;
drop policy circle_members_self_join on public.circle_members;
drop policy circle_members_admin_all on public.circle_members;
drop policy circle_members_leave on public.circle_members;

create or replace function public.create_circle(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid uuid; conv uuid; v_name text := btrim(coalesce(p->>'name', '')); v_vis circle_visibility := coalesce(nullif(p->>'visibility', '')::circle_visibility, 'public');
begin
  if uid is null or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 80 or char_length(coalesce(p->>'description', '')) > 600 then raise exception 'invalid details' using errcode = '22023'; end if;
  if (select count(*) from circles where owner_id = uid) >= 5 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into circles (owner_id, name, description, visibility, category) values (uid, v_name, nullif(btrim(coalesce(p->>'description', '')), ''), v_vis, nullif(left(btrim(coalesce(p->>'category', '')), 40), '')) returning id into cid;
  insert into conversations (kind, title) values ('circle', v_name) returning id into conv;
  insert into conversation_members (conversation_id, user_id) values (conv, uid);
  update circles set conversation_id = conv where id = cid;
  return cid;
end $$;

create or replace function public.circles_feed(p_scope text default 'browse', p_category text default null)
returns table (id uuid, name text, description text, visibility circle_visibility, category text, member_count int, my_role text, my_status text, owner_name text, conversation_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.visibility, c.category, (select count(*)::int from circle_members x where x.circle_id = c.id and x.status = 'active'),
         me.role, me.status, o.display_name, case when me.status = 'active' then c.conversation_id end
    from circles c join profiles o on o.id = c.owner_id and o.state = 'active'
    left join circle_members me on me.circle_id = c.id and me.user_id = auth.uid()
   where public.account_ok() and not public.blocked_between(auth.uid(), c.owner_id) and (p_category is null or c.category = p_category)
     and case p_scope when 'mine' then me.status in ('active', 'requested', 'invited')
                      else c.visibility in ('public', 'request_to_join') and coalesce(me.status, 'none') not in ('removed', 'active') end
   order by 6 desc, c.created_at desc limit 100 $$;

create or replace function public.join_circle(p_circle uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c circles%rowtype; st text; cur text;
begin
  select * into c from circles where id = p_circle;
  if not found or not public.account_ok() or public.blocked_between(uid, c.owner_id) or c.visibility = 'private' then raise exception 'unavailable' using errcode = '42501'; end if;
  select status into cur from circle_members where circle_id = p_circle and user_id = uid;
  if cur in ('removed') then raise exception 'unavailable' using errcode = '42501'; end if;
  if cur in ('active', 'requested') then return cur; end if;
  if (select count(*) from circle_members where circle_id = p_circle and status = 'active') >= 500 then raise exception 'unavailable' using errcode = '42501'; end if;
  st := case when c.visibility = 'public' then 'active' else 'requested' end;
  insert into circle_members (circle_id, user_id, role, status) values (p_circle, uid, 'member', st)
  on conflict (circle_id, user_id) do update set status = excluded.status where circle_members.status in ('invited');
  if st = 'active' then insert into conversation_members (conversation_id, user_id) values (c.conversation_id, uid) on conflict do nothing;
  else perform public.notify_db(c.owner_id, 'circle_request', jsonb_build_object('circleId', p_circle::text), 'cr:' || p_circle || ':' || uid); end if;
  return st;
end $$;

create or replace function public.leave_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare conv uuid;
begin
  if exists (select 1 from circles where id = p_circle and owner_id = auth.uid()) then raise exception 'owners delete the circle instead' using errcode = '22023'; end if;
  delete from circle_members where circle_id = p_circle and user_id = auth.uid() and status <> 'removed';
  select conversation_id into conv from circles where id = p_circle;
  delete from conversation_members where conversation_id = conv and user_id = auth.uid();
end $$;

create or replace function public.decide_circle_member(p_circle uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare conv uuid;
begin
  if not public.is_circle_admin(p_circle) then raise exception 'unavailable' using errcode = '42501'; end if;
  select conversation_id into conv from circles where id = p_circle;
  if p_accept then
    update circle_members set status = 'active' where circle_id = p_circle and user_id = p_user and status in ('requested', 'invited');
    if found then insert into conversation_members (conversation_id, user_id) values (conv, p_user) on conflict do nothing; end if;
  else
    update circle_members set status = 'removed' where circle_id = p_circle and user_id = p_user and status = 'requested';
  end if;
end $$;

create or replace function public.remove_circle_member(p_circle uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare conv uuid;
begin
  if not public.is_circle_admin(p_circle) or exists (select 1 from circle_members where circle_id = p_circle and user_id = p_user and role = 'owner') then raise exception 'unavailable' using errcode = '42501'; end if;
  update circle_members set status = 'removed' where circle_id = p_circle and user_id = p_user;
  select conversation_id into conv from circles where id = p_circle;
  delete from conversation_members where conversation_id = conv and user_id = p_user;
end $$;

create or replace function public.circle_people(p_circle uuid)
returns table (user_id uuid, display_name text, role text, status text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.display_name, m.role, m.status from circle_members m join profiles p on p.id = m.user_id and p.state = 'active'
   where m.circle_id = p_circle and public.is_circle_member(p_circle) and not public.blocked_between(auth.uid(), p.id)
     and (m.status = 'active' or (m.status = 'requested' and public.is_circle_admin(p_circle))) order by (m.status = 'requested') desc, m.role, p.display_name $$;

create or replace function public.delete_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare conv uuid;
begin
  select conversation_id into conv from circles where id = p_circle and owner_id = auth.uid();
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update events set status = 'cancelled' where circle_id = p_circle and status = 'scheduled';
  delete from circles where id = p_circle;
  delete from conversations where id = conv;
end $$;

create or replace function public.post_circle_event(p_circle uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_start timestamptz := (p->>'starts_at')::timestamptz; v_title text := btrim(coalesce(p->>'title', '')); eid uuid;
begin
  if not public.is_circle_admin(p_circle) or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if char_length(v_title) not between 2 and 120 or char_length(btrim(coalesce(p->>'area_label', ''))) < 2 or v_start is null or v_start < now() + interval '30 minutes' or v_start > now() + interval '120 days' then
    raise exception 'invalid details' using errcode = '22023';
  end if;
  insert into events (kind, host_id, circle_id, category, title, description, area_label, public_venue_name, starts_at, ends_at, capacity, is_public_listing)
  values ('circle_event', uid, p_circle, 'circle', v_title, nullif(btrim(coalesce(p->>'description', '')), ''), btrim(p->>'area_label'), nullif(btrim(coalesce(p->>'public_venue_name', '')), ''),
          v_start, v_start + interval '2 hours', nullif(p->>'capacity', '')::int, false) returning id into eid;
  insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status) values (uid, 'event', eid, v_title, v_start, v_start + interval '2 hours', 'confirmed');
  return eid;
end $$;

create or replace function public.circle_events(p_circle uuid)
returns table (id uuid, title text, description text, starts_at timestamptz, area_label text, public_venue_name text, capacity int, going int, my_status participant_status, is_mine boolean, status text)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.description, e.starts_at, e.area_label, e.public_venue_name, e.capacity,
         1 + (select count(*)::int from event_participants x where x.event_id = e.id and x.status = 'accepted'), mp.status, e.host_id = auth.uid(), e.status
    from events e left join event_participants mp on mp.event_id = e.id and mp.user_id = auth.uid()
   where e.circle_id = p_circle and e.kind = 'circle_event' and public.is_circle_member(p_circle) and e.starts_at > now() - interval '1 day' order by e.starts_at $$;

-- join_activity now also serves circle events (members only).
create or replace function public.join_activity(p_event uuid) returns participant_status
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e events%rowtype; going int; st participant_status;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into e from events where id = p_event and status = 'scheduled' and starts_at > now()
     and ((kind = 'activity' and is_public_listing) or (kind = 'circle_event' and public.is_circle_member(circle_id)));
  if not found or e.host_id = uid or not public.account_ok() or public.blocked_between(uid, e.host_id) then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from event_participants where user_id = uid and joined_at > now() - interval '1 day') >= 20 then raise exception 'slow_down' using errcode = 'SQ429'; end if;
  select 1 + count(*) into going from event_participants where event_id = p_event and status = 'accepted';
  st := case when e.capacity is not null and going >= e.capacity then 'waitlisted' else 'accepted' end;
  insert into event_participants (event_id, user_id, status) values (p_event, uid, st)
  on conflict (event_id, user_id) do update set status = excluded.status, joined_at = now() where event_participants.status = 'withdrawn' returning status into st;
  if st is null then select status into st from event_participants where event_id = p_event and user_id = uid; return st; end if;
  insert into calendar_entries (user_id, source_type, source_id, title, starts_at, ends_at, status)
  values (uid, 'event', p_event, e.title, e.starts_at, coalesce(e.ends_at, e.starts_at + interval '2 hours'), case when st = 'accepted' then 'confirmed'::calendar_status else 'tentative'::calendar_status end)
  on conflict (user_id, source_type, source_id) do update set status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at;
  return st;
end $$;

-- ===== Chemistry games =======================================================================================
-- Answers stay private until you have answered that round yourself. Question banks live in the app (shared package).
drop policy chem_sessions_insert on public.chemistry_sessions;
drop policy chem_sessions_update on public.chemistry_sessions;
drop policy chem_players_insert on public.chemistry_players;
drop policy chem_players_respond on public.chemistry_players;
drop policy chem_responses_select on public.chemistry_responses;
drop policy chem_responses_insert on public.chemistry_responses;

create or replace function public.answered_round(p_session uuid, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chemistry_responses where session_id = p_session and user_id = auth.uid() and round = p_round) $$;
revoke execute on function public.answered_round(uuid, int) from public, anon;
grant execute on function public.answered_round(uuid, int) to authenticated;
create policy chem_responses_select on public.chemistry_responses for select to authenticated
  using (user_id = auth.uid() or (public.is_chem_player(session_id) and public.answered_round(session_id, round)));

create or replace function public.start_game(p_conv uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid; m text; sid uuid;
begin
  if p_kind not in ('would_you_rather', 'rapid_fire', 'finish_sentence', 'compatibility') then raise exception 'unknown game' using errcode = '22023'; end if;
  select om.user_id, c.mode_id into other, m from conversations c
    join conversation_members me on me.conversation_id = c.id and me.user_id = uid join conversation_members om on om.conversation_id = c.id and om.user_id <> uid
   where c.id = p_conv and c.kind = 'direct';
  if other is null or not public.account_ok() or public.blocked_between(uid, other) then raise exception 'unavailable' using errcode = '42501'; end if;
  if exists (select 1 from chemistry_sessions where conversation_id = p_conv and state in ('invited', 'active')) then raise exception 'a game is already running' using errcode = '22023'; end if;
  insert into chemistry_sessions (kind, mode_id, created_by, conversation_id) values (p_kind, m, uid, p_conv) returning id into sid;
  insert into chemistry_players (session_id, user_id, accepted) values (sid, uid, true), (sid, other, false);
  perform public.notify_db(other, 'game_invite', jsonb_build_object('sessionId', sid::text, 'conversationId', p_conv::text), 'game:' || sid);
  return sid;
end $$;

create or replace function public.respond_game(p_session uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update chemistry_players set accepted = p_accept where session_id = p_session and user_id = auth.uid() and not accepted;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  update chemistry_sessions set state = case when p_accept then 'active' else 'declined' end where id = p_session and state = 'invited';
end $$;

create or replace function public.active_game(p_conv uuid)
returns table (session_id uuid, kind text, state text, created_by uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.state, s.created_by from chemistry_sessions s
   where s.conversation_id = p_conv and s.state in ('invited', 'active') and public.is_conversation_member(p_conv) order by s.created_at desc limit 1 $$;

create or replace function public.submit_answer(p_session uuid, p_round int, p_answer jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if p_round not between 0 and 4 or char_length(p_answer::text) > 600 then raise exception 'invalid answer' using errcode = '22023'; end if;
  if not exists (select 1 from chemistry_sessions s join chemistry_players p on p.session_id = s.id and p.user_id = uid where s.id = p_session and s.state = 'active') then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into chemistry_responses (session_id, user_id, round, answer) values (p_session, uid, p_round, p_answer) on conflict do nothing;
  if (select count(*) from chemistry_responses where session_id = p_session) >= 10 then update chemistry_sessions set state = 'finished' where id = p_session; end if;
end $$;

-- ===== Date planner and Together (couples) ===================================================================
create or replace function public.create_date_plan(p_invite uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i conversation_invites%rowtype; pid uuid;
begin
  select * into i from conversation_invites where id = p_invite and state in ('accepted', 'rescheduled') and uid in (sender_id, recipient_id);
  if not found or public.blocked_between(i.sender_id, i.recipient_id) then raise exception 'unavailable' using errcode = '42501'; end if;
  select id into pid from date_plans where source_type = 'invite' and source_id = p_invite;
  if pid is not null then return pid; end if;
  insert into date_plans (created_by, source_type, source_id, title) values (uid, 'invite', p_invite, left(btrim(coalesce(nullif(p_title, ''), 'Our plan')), 80)) returning id into pid;
  insert into date_plan_members (plan_id, user_id) values (pid, case when i.sender_id = uid then i.recipient_id else i.sender_id end) on conflict do nothing;
  return pid;
end $$;

drop policy couple_links_insert on public.couple_links;
create or replace function public.create_couple_link(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid; lid uuid; a uuid; b uuid;
begin
  other := public.resolve_friend_code(p_code);
  if other is null or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  a := least(uid, other); b := greatest(uid, other);
  select id into lid from couple_links where partner_a = a and partner_b = b and unlinked_at is null;
  if lid is not null then return lid; end if;
  insert into couple_links (partner_a, partner_b, a_link, b_link) values (a, b, uid = a, uid = b)
  on conflict (partner_a, partner_b) do update set unlinked_at = null, a_link = (uid = a), b_link = (uid = b), a_shared_profile = false, b_shared_profile = false, a_discovery = false, b_discovery = false, a_withdrawn = false, b_withdrawn = false, paused = false
  returning id into lid;
  perform public.notify_db(other, 'couple_invited', jsonb_build_object('coupleId', lid::text), 'cpl:' || lid || ':' || current_date);
  return lid;
end $$;

create or replace function public.my_couple()
returns table (couple_id uuid, partner_id uuid, partner_name text, i_am_a boolean, a_link boolean, a_shared_profile boolean, a_discovery boolean, b_link boolean, b_shared_profile boolean, b_discovery boolean, paused boolean)
language sql stable security definer set search_path = public as $$
  select l.id, o.id, o.display_name, l.partner_a = auth.uid(), l.a_link, l.a_shared_profile, l.a_discovery, l.b_link, l.b_shared_profile, l.b_discovery, l.paused
    from couple_links l join profiles o on o.id = case when l.partner_a = auth.uid() then l.partner_b else l.partner_a end
   where auth.uid() in (l.partner_a, l.partner_b) and l.unlinked_at is null and not public.blocked_between(auth.uid(), o.id) limit 1 $$;

create or replace function public.unlink_couple(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update couple_links set unlinked_at = now() where id = p_id and auth.uid() in (partner_a, partner_b) $$;

-- ===== Grants ================================================================================================
revoke execute on function public.invite_wingperson(text, text[]), public.respond_wing_invite(uuid, boolean), public.revoke_wing(uuid), public.my_wing_grants(),
  public.wing_owner_view(uuid, text), public.wing_suggest(uuid, text, jsonb, text), public.my_wing_suggestions(), public.resolve_wing_suggestion(uuid, boolean),
  public.create_team(text, text), public.invite_to_team(uuid, text), public.respond_team_invite(uuid, boolean), public.leave_team(uuid), public.my_teams(),
  public.teams_compatible(uuid, uuid, text), public.post_double_date(uuid, text, timestamptz, text), public.double_dates_feed(text, text), public.request_double_date(uuid, uuid),
  public.respond_double_date(uuid, boolean), public.cancel_double_date(uuid), public.join_roulette(jsonb), public.cancel_roulette(uuid), public.my_roulette(),
  public.set_roulette_venue(uuid, text), public.confirm_roulette(uuid), public.create_circle(jsonb), public.circles_feed(text, text), public.join_circle(uuid), public.leave_circle(uuid),
  public.decide_circle_member(uuid, uuid, boolean), public.remove_circle_member(uuid, uuid), public.circle_people(uuid), public.delete_circle(uuid), public.post_circle_event(uuid, jsonb),
  public.circle_events(uuid), public.join_activity(uuid), public.start_game(uuid, text), public.respond_game(uuid, boolean), public.active_game(uuid), public.submit_answer(uuid, int, jsonb),
  public.create_date_plan(uuid, text), public.create_couple_link(text), public.my_couple(), public.unlink_couple(uuid) from public, anon;
grant execute on function public.invite_wingperson(text, text[]), public.respond_wing_invite(uuid, boolean), public.revoke_wing(uuid), public.my_wing_grants(),
  public.wing_owner_view(uuid, text), public.wing_suggest(uuid, text, jsonb, text), public.my_wing_suggestions(), public.resolve_wing_suggestion(uuid, boolean),
  public.create_team(text, text), public.invite_to_team(uuid, text), public.respond_team_invite(uuid, boolean), public.leave_team(uuid), public.my_teams(),
  public.teams_compatible(uuid, uuid, text), public.post_double_date(uuid, text, timestamptz, text), public.double_dates_feed(text, text), public.request_double_date(uuid, uuid),
  public.respond_double_date(uuid, boolean), public.cancel_double_date(uuid), public.join_roulette(jsonb), public.cancel_roulette(uuid), public.my_roulette(),
  public.set_roulette_venue(uuid, text), public.confirm_roulette(uuid), public.create_circle(jsonb), public.circles_feed(text, text), public.join_circle(uuid), public.leave_circle(uuid),
  public.decide_circle_member(uuid, uuid, boolean), public.remove_circle_member(uuid, uuid), public.circle_people(uuid), public.delete_circle(uuid), public.post_circle_event(uuid, jsonb),
  public.circle_events(uuid), public.join_activity(uuid), public.start_game(uuid, text), public.respond_game(uuid, boolean), public.active_game(uuid), public.submit_answer(uuid, int, jsonb),
  public.create_date_plan(uuid, text), public.create_couple_link(text), public.my_couple(), public.unlink_couple(uuid) to authenticated;
