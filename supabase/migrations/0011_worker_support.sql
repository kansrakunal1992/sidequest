-- SideQuest part 11: worker support (check-ins, data requests, roulette) and closing direct-write holes on safety tables.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.

-- ===== 1. Safety tables: functions only =====================================================================
-- Migration 0010 added checked functions for these tables but left the old direct-write policies in place, which let a client
--   * insert a finished export request pointing at someone else's file,
--   * name ANY user as a trusted contact without a friend code (so a missed check-in would push to a stranger),
--   * rewrite or invent check-ins.
-- Clients now reach them only through request_export / request_deletion / my_data_requests / add_trusted_contact / schedule_checkin / confirm_checkin.
drop policy data_requests_own_insert on public.data_requests;
drop policy data_requests_own_select on public.data_requests;
drop policy trusted_contacts_own_all on public.trusted_contacts;
drop policy checkins_own_all on public.meeting_checkins;
revoke all on public.data_requests, public.trusted_contacts, public.meeting_checkins from anon, authenticated;

-- ===== 2. Data requests: retry bookkeeping, and an export can only ever point into its owner's folder =======
alter table public.data_requests add column attempts int not null default 0;
alter table public.data_requests add column claimed_at timestamptz;
alter table public.data_requests add column last_error text;
alter table public.data_requests add constraint data_requests_result_path_own check (result_path is null or result_path like user_id::text || '/%');
create index data_requests_queue_idx on public.data_requests (kind, requested_at) where status in ('queued', 'processing');

-- Private bucket for finished exports. No storage policy names it, so clients cannot read it; the API hands out short-lived signed links.
insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do nothing;

-- A moderator's own account must be deletable: keep their past decisions, detach the name.
alter table public.moderation_actions alter column moderator_id drop not null;
alter table public.moderation_actions drop constraint moderation_actions_moderator_id_fkey;
alter table public.moderation_actions add constraint moderation_actions_moderator_id_fkey foreign key (moderator_id) references auth.users(id) on delete set null;

-- ===== 3. Check-ins ==========================================================================================
create index checkins_prompted_idx on public.meeting_checkins (prompted_at) where status = 'prompted';

-- A person who was reported "missed" can still say they are fine; their trusted contact is told, so nobody is left worrying.
create or replace function public.confirm_checkin(p_id uuid, p_safe boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c meeting_checkins%rowtype; was text; contact uuid;
begin
  select * into c from meeting_checkins where id = p_id and user_id = auth.uid() and status in ('scheduled', 'prompted', 'missed') for update;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  was := c.status;
  update meeting_checkins set status = case when p_safe then 'confirmed_safe' else 'needs_help' end where id = p_id;
  select contact_user_id into contact from trusted_contacts where id = c.trusted_contact_id;
  if contact is null then return; end if;
  if not p_safe then
    perform public.notify_db(contact, 'checkin_help', jsonb_build_object('checkinId', p_id::text, 'name', (select display_name from profiles where id = c.user_id)), 'cih:' || p_id);
  elsif was = 'missed' then
    perform public.notify_db(contact, 'checkin_safe', jsonb_build_object('checkinId', p_id::text, 'name', (select display_name from profiles where id = c.user_id)), 'cis:' || p_id);
  end if;
end $$;
revoke execute on function public.confirm_checkin(uuid, boolean) from public, anon;
grant execute on function public.confirm_checkin(uuid, boolean) to authenticated;

-- ===== 4. Social Roulette: only form a table from signups that are still valid ===============================
-- The matcher reads signups, then asks for a table a moment later. In between someone may have cancelled, been blocked, paused or suspended.
-- Returns the new group id, or null when anything changed (the matcher simply tries again on its next run).
create or replace function public.form_roulette_group(p_members uuid[], p_signups uuid[], p_mode text, p_activity text, p_slot timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; cid uuid; u uuid; still int;
begin
  if coalesce(cardinality(p_members), 0) < 2 or cardinality(p_members) <> cardinality(p_signups)
     or (select count(distinct x) from unnest(p_members) x) <> cardinality(p_members) then return null; end if;
  select count(*) into still from (
    select s.id from roulette_signups s join profiles p on p.id = s.user_id
     where s.id = any (p_signups) and s.user_id = any (p_members) and s.status in ('waiting', 'waitlisted')
       and s.mode_id = p_mode and s.activity = p_activity and s.slot_start = p_slot and p.state = 'active'
       and exists (select 1 from user_active_modes a where a.user_id = s.user_id and a.mode_id = p_mode and not a.paused)
       for update of s) t;
  if still <> cardinality(p_members) then return null; end if;
  if exists (select 1 from blocks b where b.blocker_id = any (p_members) and b.blocked_id = any (p_members)) then return null; end if;

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
