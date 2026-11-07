-- SideQuest part 5: server-side onboarding, and column-level hardening of client-writable tables.
-- Why hardening: RLS policies decide WHICH rows a user may touch, not WHICH COLUMNS. Without this section a user could
-- reactivate their own suspended account, change their date of birth, approve their own photos, move their membership into
-- someone else's conversation, or (as a wingperson) widen their own permissions.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers these cases.

-- ===== Profiles: created only through save_onboarding(); only safe columns are client-editable ======
revoke insert on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, gender, city, neighborhood, bio, interests, lifestyle, conversation_prefs, voice_intro_path,
              timezone, accepts_intro_invites, allow_light_chat_after_too_new, incognito)
  on public.profiles to authenticated;

-- Approximate location is snapped to a ~1 km grid on the server; clients never write exact coordinates.
create or replace function public.set_approx_location(p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  update profiles set approx_location = st_setsrid(st_makepoint(round(p_lng, 2), round(p_lat, 2)), 4326)::geography where id = auth.uid();
end $$;

create or replace function public.save_onboarding(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  v_interests text[];
  v_lat numeric; v_lng numeric;
  m jsonb;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p->'modes') is distinct from 'array' or jsonb_array_length(p->'modes') < 1 then
    raise exception 'choose at least one mode' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct left(btrim(x), 30)), '{}') into v_interests
    from jsonb_array_elements_text(coalesce(p->'interests', '[]'::jsonb)) x where btrim(x) <> '';
  if cardinality(v_interests) < 3 or cardinality(v_interests) > 12 then
    raise exception 'choose 3 to 12 interests' using errcode = '22023';
  end if;
  v_lat := nullif(p->>'lat', '')::numeric; v_lng := nullif(p->>'lng', '')::numeric;

  -- date_of_birth is written once. The adult-only trigger rejects under-18s with errcode 23514.
  insert into profiles (id, display_name, date_of_birth, gender, city, neighborhood, bio, interests, lifestyle, timezone,
                        accepts_intro_invites, incognito, approx_location)
  values (uid, left(btrim(p->>'display_name'), 60), (p->>'date_of_birth')::date, nullif(p->>'gender', ''),
          nullif(left(btrim(coalesce(p->>'city', '')), 80), ''), nullif(left(btrim(coalesce(p->>'neighborhood', '')), 80), ''),
          nullif(left(btrim(coalesce(p->>'bio', '')), 600), ''), v_interests, coalesce(p->'lifestyle', '{}'::jsonb),
          coalesce(nullif(p->>'timezone', ''), 'UTC'), coalesce((p->>'accepts_intro_invites')::boolean, true),
          coalesce((p->>'incognito')::boolean, false),
          case when v_lat is not null and v_lng is not null and v_lat between -90 and 90 and v_lng between -180 and 180
               then st_setsrid(st_makepoint(round(v_lng, 2), round(v_lat, 2)), 4326)::geography end)
  on conflict (id) do update set
    display_name = excluded.display_name, gender = excluded.gender, city = excluded.city, neighborhood = excluded.neighborhood,
    bio = excluded.bio, interests = excluded.interests, lifestyle = excluded.lifestyle, timezone = excluded.timezone,
    accepts_intro_invites = excluded.accepts_intro_invites, incognito = excluded.incognito,
    approx_location = coalesce(excluded.approx_location, profiles.approx_location);

  for m in select * from jsonb_array_elements(p->'modes') loop
    insert into user_active_modes (user_id, mode_id, discoverable, appear_in_visitor_lists)
    values (uid, m->>'mode_id', coalesce((m->>'discoverable')::boolean, true), coalesce((m->>'appear_in_visitor_lists')::boolean, true))
    on conflict (user_id, mode_id) do update set paused = false, discoverable = excluded.discoverable,
      appear_in_visitor_lists = excluded.appear_in_visitor_lists;
    insert into preferences (user_id, mode_id, seeking_genders, age_min, age_max, max_distance_km)
    values (uid, m->>'mode_id', coalesce(array(select jsonb_array_elements_text(m->'seeking_genders')), '{}'),
            coalesce((m->>'age_min')::int, 18), coalesce((m->>'age_max')::int, 99), coalesce((m->>'max_distance_km')::int, 25))
    on conflict (user_id, mode_id) do update set seeking_genders = excluded.seeking_genders, age_min = excluded.age_min,
      age_max = excluded.age_max, max_distance_km = excluded.max_distance_km;
    insert into mode_specific_profiles (user_id, mode_id) values (uid, m->>'mode_id') on conflict do nothing;
  end loop;
  insert into verification_status (user_id) values (uid) on conflict do nothing;
end $$;

-- The server, not the app, decides when onboarding is complete.
create or replace function public.finish_onboarding() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from profile_photos where user_id = auth.uid()) then raise exception 'add at least one photo' using errcode = '22023'; end if;
  if not exists (select 1 from user_active_modes where user_id = auth.uid()) then raise exception 'choose at least one mode' using errcode = '22023'; end if;
  update profiles set onboarding_complete = true where id = auth.uid();
end $$;

revoke execute on function public.save_onboarding(jsonb), public.finish_onboarding(), public.set_approx_location(numeric, numeric) from public, anon;
grant execute on function public.save_onboarding(jsonb), public.finish_onboarding(), public.set_approx_location(numeric, numeric) to authenticated;

-- ===== Photos: moderation status is never client-controlled =========================================
revoke insert on public.profile_photos from authenticated;
grant insert (user_id, storage_path, position, visible_modes) on public.profile_photos to authenticated;
revoke update on public.profile_photos from authenticated;
grant update (position, visible_modes) on public.profile_photos to authenticated;
create or replace function public.photos_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.profile_photos where user_id = new.user_id) >= 6 then
    raise exception 'at most 6 photos' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger profile_photos_limit before insert on public.profile_photos for each row execute function public.photos_limit();

-- ===== Column-level update/insert grants (policies already restrict rows) ===========================
revoke update on public.conversation_members, public.notifications, public.event_participants, public.open_call_participants,
                 public.team_members, public.chemistry_players, public.chemistry_sessions, public.roulette_group_members,
                 public.roulette_signups, public.double_dates, public.date_plans, public.teams, public.circles, public.events,
                 public.open_calls, public.reports, public.appeals, public.wing_suggestions, public.messages from authenticated;
grant update (last_read_at, muted) on public.conversation_members to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (status) on public.event_participants to authenticated;
grant update (status) on public.open_call_participants to authenticated;
grant update (status) on public.team_members to authenticated;
grant update (accepted) on public.chemistry_players to authenticated;
grant update (state) on public.chemistry_sessions to authenticated;
grant update (confirmed) on public.roulette_group_members to authenticated;
grant update (status) on public.roulette_signups to authenticated;
grant update (state, starts_at, public_venue_name) on public.double_dates to authenticated;
grant update (title, itinerary, split_note, status) on public.date_plans to authenticated;
grant update (name) on public.teams to authenticated;
grant update (name, description, visibility, category) on public.circles to authenticated;
grant update (category, title, description, area_label, approx_location, public_venue_name, starts_at, ends_at, capacity, is_public_listing, status)
  on public.events to authenticated;
grant update (title, description, starts_at, area_label, approx_location, public_venue_name, capacity, format, budget_note,
              meet_style, recurrence_rule, status, expires_at) on public.open_calls to authenticated;
grant update (status) on public.reports to authenticated;
grant update (status) on public.appeals to authenticated;
grant update (status) on public.wing_suggestions to authenticated;
grant update (deleted_at) on public.messages to authenticated;

-- Messages cannot be backdated or flagged by the sender; reports cannot be pre-resolved.
revoke insert on public.messages, public.reports from authenticated;
grant insert (conversation_id, sender_id, body, media_path, media_kind) on public.messages to authenticated;
grant insert (reporter_id, reported_user_id, content_type, content_id, reason, details) on public.reports to authenticated;

-- ===== Triggers for tables with two kinds of actors =================================================
-- A wingperson may only accept or leave; only the owner can change what a wingperson is allowed to do.
create or replace function public.wing_grant_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() = old.wing_id and auth.uid() <> old.owner_id then
    if new.owner_id <> old.owner_id or new.wing_id <> old.wing_id or new.permissions <> old.permissions
       or new.expires_at is distinct from old.expires_at then
      raise exception 'Only the owner can change a wingperson''s permissions' using errcode = '42501';
    end if;
  end if;
  if new.status = 'revoked' and old.status <> 'revoked' then new.revoked_at = coalesce(new.revoked_at, now()); end if;
  return new;
end $$;
create trigger wing_grants_guard before update on public.wingperson_grants for each row execute function public.wing_grant_guard();

-- Only a circle owner can grant or remove the owner role (a host cannot promote themselves).
create or replace function public.circle_role_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.role = 'owner') is distinct from (old.role = 'owner') then
    if not exists (select 1 from circle_members c where c.circle_id = old.circle_id and c.user_id = auth.uid() and c.role = 'owner' and c.status = 'active') then
      raise exception 'Only an owner can change the owner role' using errcode = '42501';
    end if;
  end if;
  if new.circle_id <> old.circle_id or new.user_id <> old.user_id then
    raise exception 'Membership rows cannot be moved' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger circle_members_role_guard before update on public.circle_members for each row execute function public.circle_role_guard();
