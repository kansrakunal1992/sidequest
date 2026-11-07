-- SideQuest part 3 of 3: Row Level Security, helper functions, RPCs, storage policies.
-- Principles:
--   * Clients can read/write only their own rows, plus narrow shared rows (conversations they are in, etc.).
--   * Other people's profiles are served ONLY through discover_people() / view_profile(), which apply mode rules.
--   * Anything with a state machine or rate limit (invites, calendar, notifications, matches) is written by the API (service role), not by clients.
--   * Wingpersons have NO path to conversations or messages. Post-meet feedback is never readable by the person it is about.
-- STATUS: written but NOT yet executed against a real Postgres. Run supabase/tests/rls_smoke.sql after applying.

-- ===== Privileges =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ===== Enable RLS on every table in public (so none can be forgotten) =========================
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ===== Helper functions (security definer so policies do not recurse) =========================
create or replace function public.has_role(r app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and (role = r or role = 'admin')) $$;

create or replace function public.account_ok() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select state = 'active' from profiles where id = auth.uid()), false) $$;

create or replace function public.in_mode(u uuid, m text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_active_modes where user_id = u and mode_id = m and not paused) $$;

create or replace function public.blocked_between(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;

create or replace function public.is_conversation_member(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = c and user_id = auth.uid()) $$;

create or replace function public.conversation_has_block(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members m where m.conversation_id = c and m.user_id <> auth.uid()
                   and public.blocked_between(auth.uid(), m.user_id)) $$;

create or replace function public.is_circle_member(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members where circle_id = c and user_id = auth.uid() and status = 'active') $$;
create or replace function public.is_circle_admin(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members where circle_id = c and user_id = auth.uid() and status = 'active' and role in ('owner','host')) $$;
create or replace function public.circle_visibility_of(c uuid) returns circle_visibility language sql stable security definer set search_path = public as $$
  select visibility from circles where id = c $$;

create or replace function public.is_event_host(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from events where id = e and host_id = auth.uid()) $$;
create or replace function public.is_event_participant(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_participants where event_id = e and user_id = auth.uid()) $$;

create or replace function public.open_call_host(c uuid) returns uuid language sql stable security definer set search_path = public as $$
  select host_id from open_calls where id = c $$;
create or replace function public.is_open_call_participant(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from open_call_participants where open_call_id = c and user_id = auth.uid()) $$;

create or replace function public.is_team_member(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid() and status in ('invited','accepted')) $$;
create or replace function public.is_chem_player(s uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from chemistry_players where session_id = s and user_id = auth.uid()) $$;
create or replace function public.is_roulette_member(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from roulette_group_members where group_id = g and user_id = auth.uid()) $$;
create or replace function public.is_plan_member(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from date_plan_members where plan_id = p and user_id = auth.uid()) $$;
create or replace function public.is_couple_partner(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from couple_links where id = c and auth.uid() in (partner_a, partner_b)) $$;

create or replace function public.is_grant_owner(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from wingperson_grants where id = g and owner_id = auth.uid()) $$;
create or replace function public.wing_can(g uuid, perm text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from wingperson_grants
                  where id = g and wing_id = auth.uid() and status = 'active' and revoked_at is null
                    and (expires_at is null or expires_at > now()) and perm = any (permissions)) $$;

-- ===== Triggers that keep invariants ==========================================================
create or replace function public.messages_guard() returns trigger language plpgsql as $$
begin
  if new.sender_id <> old.sender_id or new.conversation_id <> old.conversation_id or new.created_at <> old.created_at
     or new.body is distinct from old.body or new.media_path is distinct from old.media_path
     or new.media_kind is distinct from old.media_kind then
    raise exception 'Messages are immutable except deletion' using errcode = '42501';
  end if;
  if auth.uid() = old.sender_id and new.media_revealed_by is distinct from old.media_revealed_by then
    raise exception 'Only the recipient can reveal media' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger messages_guard_trg before update on public.messages for each row execute function public.messages_guard();

create or replace function public.circles_add_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into circle_members (circle_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active'); return new; end $$;
create trigger circles_owner_member after insert on public.circles for each row execute function public.circles_add_owner();

create or replace function public.date_plans_add_creator() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into date_plan_members (plan_id, user_id) values (new.id, new.created_by); return new; end $$;
create trigger date_plans_creator_member after insert on public.date_plans for each row execute function public.date_plans_add_creator();

-- Moderator decisions change account state and close the report. Only moderators can insert (see policy).
create or replace function public.apply_moderation_action() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.action = 'suspend' then update profiles set state = 'suspended' where id = new.target_user_id;
  elsif new.action = 'ban' then update profiles set state = 'banned' where id = new.target_user_id;
  elsif new.action = 'restore' then update profiles set state = 'active' where id = new.target_user_id;
  end if;
  if new.report_id is not null then
    update reports set status = case when new.action = 'dismiss' then 'dismissed'::report_status else 'actioned'::report_status end
     where id = new.report_id;
  end if;
  return new;
end $$;
create trigger moderation_apply after insert on public.moderation_actions for each row execute function public.apply_moderation_action();

-- ===== Policies: identity =====================================================================
create policy intent_modes_read on public.intent_modes for select to authenticated using (true);

create policy profiles_own_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy roles_own_select on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy verification_own_select on public.verification_status for select to authenticated using (user_id = auth.uid());

create policy photos_own_all on public.profile_photos for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy active_modes_own_all on public.user_active_modes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mode_profiles_own_all on public.mode_specific_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy preferences_own_all on public.preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Policies: discovery ====================================================================
create policy likes_select on public.likes for select to authenticated using (
  from_user = auth.uid()
  or (to_user = auth.uid() and public.in_mode(auth.uid(), mode_id) and not public.blocked_between(from_user, to_user)));
create policy likes_insert on public.likes for insert to authenticated with check (
  from_user = auth.uid() and public.account_ok() and public.in_mode(auth.uid(), mode_id)
  and public.in_mode(to_user, mode_id) and not public.blocked_between(from_user, to_user));
create policy likes_delete on public.likes for delete to authenticated using (from_user = auth.uid());

create policy passes_own_all on public.passes for all to authenticated using (from_user = auth.uid()) with check (from_user = auth.uid());

-- Visitors: you see people who visited YOU (never incognito ones) in modes you are in; you see your own browsing history.
-- Inserts happen only inside view_profile().
create policy views_select on public.profile_views for select to authenticated using (
  viewer_id = auth.uid()
  or (viewed_id = auth.uid() and not incognito and public.in_mode(auth.uid(), mode_id) and not public.blocked_between(viewer_id, viewed_id)));

create policy collections_own_all on public.saved_collections for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saves_own_all on public.saves for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy matches_select on public.matches for select to authenticated using (
  auth.uid() in (user_a, user_b) and unmatched_at is null and public.in_mode(auth.uid(), mode_id) and not public.blocked_between(user_a, user_b));

create policy blocks_own_all on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- ===== Policies: chat =========================================================================
create policy conversations_member_select on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy conv_members_select on public.conversation_members for select to authenticated using (user_id = auth.uid() or public.is_conversation_member(conversation_id));
create policy conv_members_update_own on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy messages_select on public.messages for select to authenticated using (public.is_conversation_member(conversation_id) and deleted_at is null);
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.account_ok() and public.is_conversation_member(conversation_id)
  and not public.conversation_has_block(conversation_id));
create policy messages_sender_update on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- ===== Policies: invites and calendar (read-only for clients; API owns the state machine) ======
create policy invites_select on public.conversation_invites for select to authenticated using (auth.uid() in (sender_id, recipient_id));
create policy invite_proposals_select on public.invite_time_proposals for select to authenticated using (
  exists (select 1 from conversation_invites i where i.id = invite_id and auth.uid() in (i.sender_id, i.recipient_id)));
create policy calendar_own_select on public.calendar_entries for select to authenticated using (user_id = auth.uid());

-- ===== Policies: Open Calls ===================================================================
create policy open_calls_select on public.open_calls for select to authenticated using (
  host_id = auth.uid() or public.is_open_call_participant(id)
  or (status in ('open','full') and expires_at > now() and public.in_mode(auth.uid(), mode_id) and not public.blocked_between(host_id, auth.uid())));
create policy open_calls_insert on public.open_calls for insert to authenticated with check (
  host_id = auth.uid() and public.account_ok() and public.in_mode(auth.uid(), mode_id) and expires_at > now());
create policy open_calls_host_update on public.open_calls for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy open_calls_host_delete on public.open_calls for delete to authenticated using (host_id = auth.uid());

create policy oc_part_select on public.open_call_participants for select to authenticated using (user_id = auth.uid() or public.open_call_host(open_call_id) = auth.uid());
create policy oc_part_insert on public.open_call_participants for insert to authenticated with check (
  user_id = auth.uid() and status = 'interested' and public.account_ok()
  and public.open_call_host(open_call_id) is not null and public.open_call_host(open_call_id) <> auth.uid()
  and not public.blocked_between(public.open_call_host(open_call_id), auth.uid()));
create policy oc_part_self_update on public.open_call_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('interested','withdrawn'));
create policy oc_part_host_update on public.open_call_participants for update to authenticated using (public.open_call_host(open_call_id) = auth.uid()) with check (public.open_call_host(open_call_id) = auth.uid());

-- ===== Policies: circles and events ===========================================================
create policy circles_select on public.circles for select to authenticated using (visibility in ('public','request_to_join') or public.is_circle_member(id));
create policy circles_insert on public.circles for insert to authenticated with check (owner_id = auth.uid() and public.account_ok());
create policy circles_owner_update on public.circles for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy circles_owner_delete on public.circles for delete to authenticated using (owner_id = auth.uid());

create policy circle_members_select on public.circle_members for select to authenticated using (user_id = auth.uid() or public.is_circle_member(circle_id));
create policy circle_members_self_join on public.circle_members for insert to authenticated with check (
  user_id = auth.uid() and role = 'member' and public.account_ok() and (
    (status = 'active' and public.circle_visibility_of(circle_id) = 'public')
    or (status = 'requested' and public.circle_visibility_of(circle_id) = 'request_to_join')));
create policy circle_members_admin_all on public.circle_members for all to authenticated using (public.is_circle_admin(circle_id)) with check (public.is_circle_admin(circle_id));
create policy circle_members_leave on public.circle_members for delete to authenticated using (user_id = auth.uid());

create policy events_select on public.events for select to authenticated using (
  (is_public_listing and kind in ('activity','circle_event') and status = 'scheduled')
  or host_id = auth.uid() or public.is_event_participant(id)
  or (circle_id is not null and public.is_circle_member(circle_id)));
create policy events_insert on public.events for insert to authenticated with check (host_id = auth.uid() and public.account_ok());
create policy events_host_update on public.events for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy events_host_delete on public.events for delete to authenticated using (host_id = auth.uid());
create policy event_part_select on public.event_participants for select to authenticated using (user_id = auth.uid() or public.is_event_host(event_id));
create policy event_part_insert on public.event_participants for insert to authenticated with check (
  user_id = auth.uid() and status = 'interested' and public.account_ok()
  and exists (select 1 from events e where e.id = event_id));
create policy event_part_self_update on public.event_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('interested','withdrawn'));
create policy event_part_host_update on public.event_participants for update to authenticated using (public.is_event_host(event_id)) with check (public.is_event_host(event_id));
create policy event_part_delete_self on public.event_participants for delete to authenticated using (user_id = auth.uid());

-- ===== Policies: notifications ================================================================
create policy notifications_own_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_prefs_own_all on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_own_all on public.push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Policies: safety and moderation ========================================================
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid() and reporter_id <> coalesce(reported_user_id, '00000000-0000-0000-0000-000000000000'));
create policy reports_select on public.reports for select to authenticated using (reporter_id = auth.uid() or public.has_role('moderator'));
create policy reports_mod_update on public.reports for update to authenticated using (public.has_role('moderator')) with check (public.has_role('moderator'));
create policy mod_actions_select on public.moderation_actions for select to authenticated using (public.has_role('moderator'));
create policy mod_actions_insert on public.moderation_actions for insert to authenticated with check (
  moderator_id = auth.uid() and public.has_role('moderator')
  and (action in ('warn','remove_content','suspend','dismiss') or public.has_role('admin')));
create policy appeals_own_insert on public.appeals for insert to authenticated with check (user_id = auth.uid());
create policy appeals_select on public.appeals for select to authenticated using (user_id = auth.uid() or public.has_role('moderator'));
create policy appeals_mod_update on public.appeals for update to authenticated using (public.has_role('moderator')) with check (public.has_role('moderator'));
create policy data_requests_own_insert on public.data_requests for insert to authenticated with check (user_id = auth.uid());
create policy data_requests_own_select on public.data_requests for select to authenticated using (user_id = auth.uid());

-- Private feedback: the author can see their own submissions; the person it is about can NEVER read it.
create policy post_meet_insert on public.post_meet_feedback for insert to authenticated with check (from_user = auth.uid());
create policy post_meet_select on public.post_meet_feedback for select to authenticated using (from_user = auth.uid() or public.has_role('moderator'));
create policy trusted_contacts_own_all on public.trusted_contacts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy checkins_own_all on public.meeting_checkins for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy connection_stages_own_all on public.connection_stages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Policies: Wingperson ===================================================================
create policy wing_grants_owner_all on public.wingperson_grants for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy wing_grants_wing_select on public.wingperson_grants for select to authenticated using (wing_id = auth.uid());
create policy wing_grants_wing_respond on public.wingperson_grants for update to authenticated using (wing_id = auth.uid()) with check (wing_id = auth.uid() and status in ('active','revoked'));
create policy wing_sugg_select on public.wing_suggestions for select to authenticated using (public.is_grant_owner(grant_id) or public.wing_can(grant_id, 'suggest_profiles') or public.wing_can(grant_id, 'suggest_openers'));
create policy wing_sugg_insert on public.wing_suggestions for insert to authenticated with check (
  (kind = 'person' and public.wing_can(grant_id, 'suggest_profiles'))
  or (kind = 'opener' and public.wing_can(grant_id, 'suggest_openers'))
  or (kind = 'open_call' and public.wing_can(grant_id, 'suggest_profiles')));
create policy wing_sugg_owner_update on public.wing_suggestions for update to authenticated using (public.is_grant_owner(grant_id)) with check (public.is_grant_owner(grant_id));

-- ===== Policies: teams, double dates, couples =================================================
create policy teams_select on public.teams for select to authenticated using (created_by = auth.uid() or public.is_team_member(id));
create policy teams_insert on public.teams for insert to authenticated with check (created_by = auth.uid() and public.account_ok());
create policy teams_creator_update on public.teams for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy teams_creator_delete on public.teams for delete to authenticated using (created_by = auth.uid());
create policy team_members_select on public.team_members for select to authenticated using (user_id = auth.uid() or public.is_team_member(team_id));
create policy team_members_creator_insert on public.team_members for insert to authenticated with check (
  exists (select 1 from teams t where t.id = team_id and t.created_by = auth.uid()) and not public.blocked_between(user_id, auth.uid()));
create policy team_members_self_respond on public.team_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('accepted','left'));
create policy team_members_creator_delete on public.team_members for delete to authenticated using (exists (select 1 from teams t where t.id = team_id and t.created_by = auth.uid()));

create policy double_dates_select on public.double_dates for select to authenticated using (public.is_team_member(team_a) or (team_b is not null and public.is_team_member(team_b)));
create policy double_dates_insert on public.double_dates for insert to authenticated with check (created_by = auth.uid() and public.account_ok() and public.is_team_member(team_a));
create policy double_dates_update on public.double_dates for update to authenticated using (public.is_team_member(team_a) or (team_b is not null and public.is_team_member(team_b)))
  with check (public.is_team_member(team_a) or (team_b is not null and public.is_team_member(team_b)));

create policy couple_links_select on public.couple_links for select to authenticated using (auth.uid() in (partner_a, partner_b));
create policy couple_links_insert on public.couple_links for insert to authenticated with check (
  not public.blocked_between(partner_a, partner_b) and (
    (auth.uid() = partner_a and not b_link and not b_shared_profile and not b_discovery and not b_withdrawn)
    or (auth.uid() = partner_b and not a_link and not a_shared_profile and not a_discovery and not a_withdrawn)));
create policy couple_links_update on public.couple_links for update to authenticated using (auth.uid() in (partner_a, partner_b)) with check (auth.uid() in (partner_a, partner_b));
create policy couple_links_delete on public.couple_links for delete to authenticated using (auth.uid() in (partner_a, partner_b));
create policy couple_profiles_partner_all on public.couple_profiles for all to authenticated using (public.is_couple_partner(couple_id)) with check (public.is_couple_partner(couple_id));

-- ===== Policies: games, roulette, quests, planner =============================================
create policy chem_sessions_select on public.chemistry_sessions for select to authenticated using (created_by = auth.uid() or public.is_chem_player(id));
create policy chem_sessions_insert on public.chemistry_sessions for insert to authenticated with check (created_by = auth.uid() and public.account_ok() and public.in_mode(auth.uid(), mode_id));
create policy chem_sessions_update on public.chemistry_sessions for update to authenticated using (created_by = auth.uid() or public.is_chem_player(id)) with check (created_by = auth.uid() or public.is_chem_player(id));
create policy chem_players_select on public.chemistry_players for select to authenticated using (user_id = auth.uid() or public.is_chem_player(session_id));
create policy chem_players_insert on public.chemistry_players for insert to authenticated with check (
  exists (select 1 from chemistry_sessions s where s.id = session_id and s.created_by = auth.uid()) and not public.blocked_between(user_id, auth.uid()));
create policy chem_players_respond on public.chemistry_players for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chem_responses_select on public.chemistry_responses for select to authenticated using (public.is_chem_player(session_id));
create policy chem_responses_insert on public.chemistry_responses for insert to authenticated with check (user_id = auth.uid() and public.is_chem_player(session_id));

create policy roulette_signups_own_select on public.roulette_signups for select to authenticated using (user_id = auth.uid());
create policy roulette_signups_own_insert on public.roulette_signups for insert to authenticated with check (user_id = auth.uid() and public.account_ok() and public.in_mode(auth.uid(), mode_id));
create policy roulette_signups_own_update on public.roulette_signups for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status = 'cancelled');
create policy roulette_groups_select on public.roulette_groups for select to authenticated using (public.is_roulette_member(id));
create policy roulette_members_select on public.roulette_group_members for select to authenticated using (user_id = auth.uid() or public.is_roulette_member(group_id));
create policy roulette_members_confirm on public.roulette_group_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy quests_select on public.quests for select to authenticated using (active);
create policy quest_progress_own_select on public.quest_progress for select to authenticated using (user_id = auth.uid());
create policy passport_own_select on public.passport_entries for select to authenticated using (user_id = auth.uid());
create policy passport_own_delete on public.passport_entries for delete to authenticated using (user_id = auth.uid());

create policy plans_select on public.date_plans for select to authenticated using (public.is_plan_member(id));
create policy plans_insert on public.date_plans for insert to authenticated with check (created_by = auth.uid() and public.account_ok());
create policy plans_update on public.date_plans for update to authenticated using (public.is_plan_member(id)) with check (public.is_plan_member(id));
create policy plan_members_select on public.date_plan_members for select to authenticated using (public.is_plan_member(plan_id));
create policy plan_members_insert on public.date_plan_members for insert to authenticated with check (
  exists (select 1 from date_plans p where p.id = plan_id and p.created_by = auth.uid()) and not public.blocked_between(user_id, auth.uid()));
create policy plan_members_leave on public.date_plan_members for delete to authenticated using (user_id = auth.uid());
create policy plan_votes_select on public.date_plan_votes for select to authenticated using (public.is_plan_member(plan_id));
create policy plan_votes_own_write on public.date_plan_votes for all to authenticated using (user_id = auth.uid() and public.is_plan_member(plan_id)) with check (user_id = auth.uid() and public.is_plan_member(plan_id));

-- ===== RPC: discovery (mode rules mirror packages/shared/src/compat.ts) =======================
create or replace function public.discover_people(p_mode text, p_limit int default 30, p_offset int default 0)
returns table (user_id uuid, display_name text, age int, headline text, area text, distance_km numeric,
               availability availability_status, shared_interests text[], verified boolean)
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
  select c.id, c.display_name, ca.age, msp.headline,
         coalesce(c.neighborhood, c.city),
         round((st_distance(c.approx_location, me.approx_location) / 1000.0)::numeric, 1),
         cm.availability,
         array(select unnest(c.interests) intersect select unnest(me.interests)),
         coalesce(v.identity_verified, false)
    from me
    join profiles c on c.id <> me.id and c.state = 'active' and c.onboarding_complete
    join user_active_modes cm on cm.user_id = c.id and cm.mode_id = p_mode and not cm.paused and cm.discoverable
         and cm.availability not in ('taking_a_break','not_available')
    left join preferences cp on cp.user_id = c.id and cp.mode_id = p_mode
    left join mode_specific_profiles msp on msp.user_id = c.id and msp.mode_id = p_mode
    left join verification_status v on v.user_id = c.id
    cross join lateral (select date_part('year', age(c.date_of_birth))::int as age) ca
   where not exists (select 1 from blocks b where (b.blocker_id = me.id and b.blocked_id = c.id) or (b.blocker_id = c.id and b.blocked_id = me.id))
     and not exists (select 1 from likes l where l.from_user = me.id and l.to_user = c.id and l.mode_id = p_mode)
     and not exists (select 1 from passes ps where ps.from_user = me.id and ps.to_user = c.id and ps.mode_id = p_mode and ps.undone_at is null)
     and (cardinality(me.seeking) = 0 or c.gender = any (me.seeking))
     and (cardinality(coalesce(cp.seeking_genders, '{}')) = 0 or me.gender = any (cp.seeking_genders))
     and ca.age between me.age_min and me.age_max
     and me.age between coalesce(cp.age_min, 18) and coalesce(cp.age_max, 99)
     and (c.approx_location is null or me.approx_location is null
          or st_distance(c.approx_location, me.approx_location) / 1000.0 <= least(me.max_km, coalesce(cp.max_distance_km, 25)))
   order by cardinality(array(select unnest(c.interests) intersect select unnest(me.interests))) desc,
            (cm.availability = 'available_tonight') desc,
            st_distance(c.approx_location, me.approx_location) asc nulls last,
            c.id
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- ===== RPC: view a profile through one mode lens, recording the visit =========================
create or replace function public.view_profile(p_viewed uuid, p_mode text, p_kind view_kind default 'view', p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); v_incognito boolean; result jsonb;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if uid = p_viewed then raise exception 'cannot view yourself' using errcode = '22023'; end if;
  if not public.account_ok() or not public.in_mode(uid, p_mode) or not public.in_mode(p_viewed, p_mode)
     or public.blocked_between(uid, p_viewed)
     or not exists (select 1 from profiles where id = p_viewed and state = 'active') then
    raise exception 'profile unavailable' using errcode = '42501';  -- generic: never reveals blocks
  end if;
  select (p.incognito or not m.appear_in_visitor_lists) into v_incognito
    from profiles p join user_active_modes m on m.user_id = p.id and m.mode_id = p_mode where p.id = uid;
  insert into profile_views (viewer_id, viewed_id, mode_id, kind, ref, incognito)
  values (uid, p_viewed, p_mode, p_kind, p_ref, coalesce(v_incognito, true));
  select jsonb_build_object(
      'user_id', c.id, 'display_name', c.display_name,
      'age', date_part('year', age(c.date_of_birth))::int,
      'area', coalesce(c.neighborhood, c.city),
      'headline', msp.headline, 'bio', coalesce(msp.bio, c.bio),
      'prompts', coalesce(msp.prompts, '[]'::jsonb), 'interests', to_jsonb(c.interests),
      'availability', cm.availability, 'verified', coalesce(v.identity_verified, false),
      'photo_paths', (select coalesce(jsonb_agg(ph.storage_path order by ph.position), '[]'::jsonb)
                        from profile_photos ph
                       where ph.user_id = c.id and ph.moderation_status = 'approved'
                         and ((cardinality(coalesce(msp.visible_photo_ids, '{}')) > 0 and ph.id = any (msp.visible_photo_ids))
                           or (cardinality(coalesce(msp.visible_photo_ids, '{}')) = 0 and p_mode = any (ph.visible_modes)))))
    into result
    from profiles c
    join user_active_modes cm on cm.user_id = c.id and cm.mode_id = p_mode
    left join mode_specific_profiles msp on msp.user_id = c.id and msp.mode_id = p_mode
    left join verification_status v on v.user_id = c.id
   where c.id = p_viewed;
  return result;
end $$;

create or replace function public.unmatch(p_match uuid) returns void language sql security definer set search_path = public as $$
  update matches set unmatched_at = now() where id = p_match and auth.uid() in (user_a, user_b) and unmatched_at is null $$;

create or replace function public.reveal_media(p_message uuid) returns void language sql security definer set search_path = public as $$
  update messages set media_revealed_by = array_append(media_revealed_by, auth.uid())
   where id = p_message and public.is_conversation_member(conversation_id)
     and sender_id <> auth.uid() and not (auth.uid() = any (media_revealed_by)) $$;

-- Moderators get the minimum context needed, never DOB, location or contact data.
create or replace function public.moderation_report_context(p_report uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reports; out jsonb;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from reports where id = p_report;
  if not found then return null; end if;
  select jsonb_build_object(
    'report', to_jsonb(r),
    'reported_user', (select jsonb_build_object('display_name', p.display_name, 'state', p.state, 'member_since', p.created_at,
                        'prior_reports', (select count(*) from reports x where x.reported_user_id = p.id and x.id <> r.id),
                        'prior_actions', (select count(*) from moderation_actions a where a.target_user_id = p.id))
                       from profiles p where p.id = r.reported_user_id),
    'message_excerpt', case when r.content_type = 'message' then (select left(m.body, 500) from messages m where m.id = r.content_id) end
  ) into out;
  return out;
end $$;

revoke execute on all functions in schema public from public;
grant execute on function public.discover_people(text,int,int), public.view_profile(uuid,text,view_kind,text),
  public.unmatch(uuid), public.reveal_media(uuid), public.moderation_report_context(uuid) to authenticated;
-- Helper functions used inside policies must also be callable by the policy evaluator (authenticated).
grant execute on function public.has_role(app_role), public.account_ok(), public.in_mode(uuid,text), public.blocked_between(uuid,uuid),
  public.is_conversation_member(uuid), public.conversation_has_block(uuid), public.is_circle_member(uuid), public.is_circle_admin(uuid),
  public.circle_visibility_of(uuid), public.is_event_host(uuid), public.is_event_participant(uuid), public.open_call_host(uuid),
  public.is_open_call_participant(uuid), public.is_team_member(uuid), public.is_chem_player(uuid), public.is_roulette_member(uuid),
  public.is_plan_member(uuid), public.is_couple_partner(uuid), public.is_grant_owner(uuid), public.wing_can(uuid,text) to authenticated;

-- ===== Storage buckets (all private; other people's photos are served as signed URLs by the API) ==
insert into storage.buckets (id, name, public) values
  ('profile-photos','profile-photos',false), ('chat-media','chat-media',false), ('voice-intros','voice-intros',false)
on conflict (id) do nothing;

create policy storage_own_folder_select on storage.objects for select to authenticated
  using (bucket_id in ('profile-photos','chat-media','voice-intros') and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_own_folder_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('profile-photos','chat-media','voice-intros') and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_own_folder_update on storage.objects for update to authenticated
  using (bucket_id in ('profile-photos','chat-media','voice-intros') and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_own_folder_delete on storage.objects for delete to authenticated
  using (bucket_id in ('profile-photos','chat-media','voice-intros') and (storage.foldername(name))[1] = auth.uid()::text);
