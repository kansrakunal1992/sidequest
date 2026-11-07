-- SideQuest part 6: discovery with filters, likes/passes/undo, Likes & Visitors lists, matches, profile interactions.
-- Everything here is free and unlimited by design: nothing is blurred, gated, boosted or capped to push payment.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.

-- A person only appears in a vibe once at least one approved photo is visible in that vibe.
create or replace function public.has_visible_photo(u uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_photos ph
    left join mode_specific_profiles msp on msp.user_id = ph.user_id and msp.mode_id = m
    where ph.user_id = u and ph.moderation_status = 'approved'
      and ((cardinality(coalesce(msp.visible_photo_ids, '{}')) > 0 and ph.id = any (msp.visible_photo_ids))
        or (cardinality(coalesce(msp.visible_photo_ids, '{}')) = 0 and m = any (ph.visible_modes)))) $$;
revoke execute on function public.has_visible_photo(uuid, text) from public, anon;
grant execute on function public.has_visible_photo(uuid, text) to authenticated;

-- ===== Discovery (replaces the 0003 version: adds filters, "likes you", photo requirement) ==========
drop function public.discover_people(text, int, int);
create or replace function public.discover_people(
  p_mode text, p_limit int default 30, p_offset int default 0,
  p_interest text default null, p_max_km int default null, p_available_tonight boolean default false)
returns table (user_id uuid, display_name text, age int, headline text, area text, distance_km numeric,
               availability availability_status, shared_interests text[], verified boolean, likes_you boolean)
language sql stable security definer set search_path = public, extensions as $$
  with me as (
    select p.id, p.gender, p.interests, p.approx_location,
           date_part('year', age(p.date_of_birth))::int as age,
           coalesce(pr.seeking_genders, '{}') as seeking, coalesce(pr.age_min, 18) as age_min,
           coalesce(pr.age_max, 99) as age_max, coalesce(pr.max_distance_km, 25) as max_km
      from profiles p
      join user_active_modes m on m.user_id = p.id and m.mode_id = p_mode and not m.paused and m.discoverable
      left join preferences pr on pr.user_id = p.id and pr.mode_id = p_mode
     where p.id = auth.uid() and p.state = 'active'
  )
  select c.id, c.display_name, ca.age, msp.headline, coalesce(c.neighborhood, c.city),
         round((st_distance(c.approx_location, me.approx_location) / 1000.0)::numeric, 1),
         cm.availability,
         array(select unnest(c.interests) intersect select unnest(me.interests)),
         coalesce(v.identity_verified, false),
         exists (select 1 from likes lk where lk.from_user = c.id and lk.to_user = me.id and lk.mode_id = p_mode)
    from me
    join profiles c on c.id <> me.id and c.state = 'active' and c.onboarding_complete
    join user_active_modes cm on cm.user_id = c.id and cm.mode_id = p_mode and not cm.paused and cm.discoverable
         and cm.availability not in ('taking_a_break', 'not_available')
    left join preferences cp on cp.user_id = c.id and cp.mode_id = p_mode
    left join mode_specific_profiles msp on msp.user_id = c.id and msp.mode_id = p_mode
    left join verification_status v on v.user_id = c.id
    cross join lateral (select date_part('year', age(c.date_of_birth))::int as age) ca
   where public.has_visible_photo(c.id, p_mode)
     and not exists (select 1 from blocks b where (b.blocker_id = me.id and b.blocked_id = c.id) or (b.blocker_id = c.id and b.blocked_id = me.id))
     and not exists (select 1 from likes l where l.from_user = me.id and l.to_user = c.id and l.mode_id = p_mode)
     and not exists (select 1 from passes ps where ps.from_user = me.id and ps.to_user = c.id and ps.mode_id = p_mode and ps.undone_at is null)
     and (cardinality(me.seeking) = 0 or c.gender = any (me.seeking))
     and (cardinality(coalesce(cp.seeking_genders, '{}')) = 0 or me.gender = any (cp.seeking_genders))
     and ca.age between me.age_min and me.age_max
     and me.age between coalesce(cp.age_min, 18) and coalesce(cp.age_max, 99)
     and (c.approx_location is null or me.approx_location is null
          or st_distance(c.approx_location, me.approx_location) / 1000.0 <= least(me.max_km, coalesce(cp.max_distance_km, 25)))
     and (p_max_km is null or c.approx_location is null or me.approx_location is null
          or st_distance(c.approx_location, me.approx_location) / 1000.0 <= p_max_km)
     and (p_interest is null or lower(btrim(p_interest)) = any (select lower(x) from unnest(c.interests) x))
     and (not p_available_tonight or cm.availability = 'available_tonight')
   order by cardinality(array(select unnest(c.interests) intersect select unnest(me.interests))) desc,
            (cm.availability = 'available_tonight') desc,
            st_distance(c.approx_location, me.approx_location) asc nulls last,
            c.id
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.discover_people(text, int, int, text, int, boolean) from public, anon;
grant execute on function public.discover_people(text, int, int, text, int, boolean) to authenticated;

-- ===== Likes, passes, undo ===========================================================================
create or replace function public.send_like(p_to uuid, p_mode text, p_kind like_kind default 'like')
returns table (matched boolean, match_id uuid)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if uid = p_to then raise exception 'cannot like yourself' using errcode = '22023'; end if;
  if not public.account_ok() or not public.in_mode(uid, p_mode) or not public.in_mode(p_to, p_mode) or public.blocked_between(uid, p_to) then
    raise exception 'unavailable' using errcode = '42501';   -- generic: never reveals blocks or hidden modes
  end if;
  insert into likes (from_user, to_user, mode_id, kind) values (uid, p_to, p_mode, p_kind)
  on conflict (from_user, to_user, mode_id) do update set kind = case when excluded.kind = 'spark' then 'spark'::like_kind else likes.kind end;
  delete from passes where from_user = uid and to_user = p_to and mode_id = p_mode;
  select m.id into mid from matches m
   where m.user_a = least(uid, p_to) and m.user_b = greatest(uid, p_to) and m.mode_id = p_mode and m.unmatched_at is null;
  return query select (mid is not null), mid;
end $$;

-- Rewind a like only while it has not become a match (a match involves another person's choice).
create or replace function public.undo_like(p_to uuid, p_mode text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from matches m where m.user_a = least(uid, p_to) and m.user_b = greatest(uid, p_to) and m.mode_id = p_mode and m.unmatched_at is null) then
    return false;
  end if;
  delete from likes where from_user = uid and to_user = p_to and mode_id = p_mode;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.pass_person(p_to uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if uid = p_to or not public.account_ok() or not public.in_mode(uid, p_mode) then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into passes (from_user, to_user, mode_id) values (uid, p_to, p_mode)
  on conflict (from_user, to_user, mode_id) do update set undone_at = null, created_at = now();
end $$;

create or replace function public.undo_pass(p_to uuid, p_mode text) returns void
language sql security definer set search_path = public as $$
  update passes set undone_at = now() where from_user = auth.uid() and to_user = p_to and mode_id = p_mode $$;

-- ===== Likes & Visitors lists (free, unlimited, never blurred) =======================================
create or replace function public.likes_received(p_mode text, p_limit int default 50, p_offset int default 0)
returns table (user_id uuid, display_name text, age int, headline text, kind like_kind, liked_at timestamptz,
               i_liked_back boolean, matched boolean, verified boolean)
language sql stable security definer set search_path = public as $$
  select l.from_user, p.display_name, date_part('year', age(p.date_of_birth))::int, msp.headline, l.kind, l.created_at,
         exists (select 1 from likes b where b.from_user = auth.uid() and b.to_user = l.from_user and b.mode_id = p_mode),
         exists (select 1 from matches m where m.user_a = least(auth.uid(), l.from_user) and m.user_b = greatest(auth.uid(), l.from_user)
                   and m.mode_id = p_mode and m.unmatched_at is null),
         coalesce(v.identity_verified, false)
    from likes l
    join profiles p on p.id = l.from_user and p.state = 'active'
    left join verification_status v on v.user_id = p.id
    left join mode_specific_profiles msp on msp.user_id = p.id and msp.mode_id = p_mode
   where l.to_user = auth.uid() and l.mode_id = p_mode
     and public.in_mode(auth.uid(), p_mode) and public.in_mode(l.from_user, p_mode)
     and not public.blocked_between(auth.uid(), l.from_user)
   order by l.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0) $$;

-- Visitors are people who looked at you in this vibe in the last 30 days, excluding anyone browsing incognito.
-- A visit is not a like: both are listed separately, with what the visitor actually looked at.
create or replace function public.visitors_list(p_mode text, p_limit int default 50, p_offset int default 0)
returns table (user_id uuid, display_name text, age int, last_visit_at timestamptz, visits int,
               looked_at_photos boolean, looked_at_prompts boolean, they_liked_you boolean, verified boolean)
language sql stable security definer set search_path = public as $$
  select v.viewer_id, p.display_name, date_part('year', age(p.date_of_birth))::int, max(v.created_at), count(*)::int,
         coalesce(bool_or(v.kind = 'photo_tap'), false), coalesce(bool_or(v.kind = 'prompt_tap'), false),
         exists (select 1 from likes l where l.from_user = v.viewer_id and l.to_user = auth.uid() and l.mode_id = p_mode),
         coalesce(bool_or(vs.identity_verified), false)
    from profile_views v
    join profiles p on p.id = v.viewer_id and p.state = 'active'
    left join verification_status vs on vs.user_id = p.id
   where v.viewed_id = auth.uid() and v.mode_id = p_mode and not v.incognito and v.created_at > now() - interval '30 days'
     and public.in_mode(auth.uid(), p_mode) and public.in_mode(v.viewer_id, p_mode)
     and not public.blocked_between(auth.uid(), v.viewer_id)
   group by v.viewer_id, p.display_name, p.date_of_birth
   order by max(v.created_at) desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0) $$;

create or replace function public.my_matches(p_mode text, p_limit int default 50, p_offset int default 0)
returns table (match_id uuid, user_id uuid, display_name text, age int, matched_at timestamptz, verified boolean, conversation_id uuid)
language sql stable security definer set search_path = public as $$
  select m.id, o.id, o.display_name, date_part('year', age(o.date_of_birth))::int, m.created_at,
         coalesce(v.identity_verified, false), (select c.id from conversations c where c.match_id = m.id limit 1)
    from matches m
    join profiles o on o.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end and o.state = 'active'
    left join verification_status v on v.user_id = o.id
   where auth.uid() in (m.user_a, m.user_b) and m.mode_id = p_mode and m.unmatched_at is null
     and public.in_mode(auth.uid(), p_mode) and public.in_mode(o.id, p_mode)
     and not public.blocked_between(auth.uid(), o.id)
   order by m.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0) $$;

-- Records "looked at photos" / "read a prompt" (at most once per day per item). Same privacy rules as view_profile().
create or replace function public.record_interaction(p_viewed uuid, p_mode text, p_kind view_kind, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_incognito boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_kind = 'view' or uid = p_viewed or not public.account_ok() or not public.in_mode(uid, p_mode) or not public.in_mode(p_viewed, p_mode)
     or public.blocked_between(uid, p_viewed) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  select (p.incognito or not m.appear_in_visitor_lists) into v_incognito
    from profiles p join user_active_modes m on m.user_id = p.id and m.mode_id = p_mode where p.id = uid;
  insert into profile_views (viewer_id, viewed_id, mode_id, kind, ref, incognito)
  select uid, p_viewed, p_mode, p_kind, left(p_ref, 80), coalesce(v_incognito, true)
   where not exists (select 1 from profile_views x where x.viewer_id = uid and x.viewed_id = p_viewed and x.mode_id = p_mode
                       and x.kind = p_kind and coalesce(x.ref, '') = coalesce(left(p_ref, 80), '') and x.created_at > now() - interval '1 day');
end $$;

revoke execute on function public.send_like(uuid, text, like_kind), public.undo_like(uuid, text), public.pass_person(uuid, text),
  public.undo_pass(uuid, text), public.likes_received(text, int, int), public.visitors_list(text, int, int),
  public.my_matches(text, int, int), public.record_interaction(uuid, text, view_kind, text) from public, anon;
grant execute on function public.send_like(uuid, text, like_kind), public.undo_like(uuid, text), public.pass_person(uuid, text),
  public.undo_pass(uuid, text), public.likes_received(text, int, int), public.visitors_list(text, int, int),
  public.my_matches(text, int, int), public.record_interaction(uuid, text, view_kind, text) to authenticated;
