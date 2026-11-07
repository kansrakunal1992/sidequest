-- SideQuest part 10: moderation, appeals, account pause/deletion/export, trusted contacts and meeting check-ins.
-- Moderators never get raw table access: they use these functions, each of which checks the moderator role and returns only what is needed.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.
-- Make someone a moderator (run in the SQL editor as the project owner):
--   insert into user_roles (user_id, role) values ('<auth user id>', 'moderator') on conflict (user_id) do update set role = 'moderator';

alter table public.data_requests drop constraint data_requests_status_check;
alter table public.data_requests add constraint data_requests_status_check check (status in ('queued', 'processing', 'done', 'failed', 'cancelled'));
alter table public.data_requests add column result_path text;
alter table public.meeting_checkins drop constraint meeting_checkins_status_check;
alter table public.meeting_checkins add constraint meeting_checkins_status_check check (status in ('scheduled', 'prompted', 'confirmed_safe', 'missed', 'needs_help', 'cancelled'));
alter table public.meeting_checkins add column prompted_at timestamptz;

-- Hashes of emails belonging to banned accounts, so a ban cannot be dodged by simply registering again.
create table public.banned_identifiers (email_hash text primary key, created_at timestamptz not null default now());
alter table public.banned_identifiers enable row level security;   -- service only: no client policies

create or replace function public.profiles_ban_check() returns trigger
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if exists (select 1 from banned_identifiers b join auth.users u on u.id = new.id where b.email_hash = encode(digest(lower(u.email), 'sha256'), 'hex')) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_ban_check_trg before insert on public.profiles for each row execute function public.profiles_ban_check();

-- Moderation decisions now also remember a banned email's hash.
create or replace function public.apply_moderation_action() returns trigger
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if new.action = 'suspend' then update profiles set state = 'suspended' where id = new.target_user_id;
  elsif new.action = 'ban' then
    update profiles set state = 'banned' where id = new.target_user_id;
    insert into banned_identifiers (email_hash) select encode(digest(lower(u.email), 'sha256'), 'hex') from auth.users u where u.id = new.target_user_id and u.email is not null on conflict do nothing;
  elsif new.action = 'restore' then
    update profiles set state = 'active' where id = new.target_user_id;
    delete from banned_identifiers where email_hash in (select encode(digest(lower(u.email), 'sha256'), 'hex') from auth.users u where u.id = new.target_user_id);
  end if;
  if new.report_id is not null then
    update reports set status = case when new.action = 'dismiss' then 'dismissed'::report_status else 'actioned'::report_status end where id = new.report_id;
  end if;
  return new;
end $$;

-- ===== Moderator functions ===================================================================================
drop policy appeals_own_insert on public.appeals;
drop policy appeals_mod_update on public.appeals;
drop policy mod_actions_insert on public.moderation_actions;
drop policy reports_mod_update on public.reports;

-- The queue puts people reported by several different reporters in the past week first. Mass reporting alone never acts on anyone: a human decides.
create or replace function public.mod_queue(p_status text default 'open', p_limit int default 50)
returns table (report_id uuid, created_at timestamptz, reason text, content_type text, reported_user_id uuid, reported_name text, reported_state account_state,
               reporters_7d int, total_reports int, prior_actions int, status report_status)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.id, r.created_at, r.reason, r.content_type, r.reported_user_id, p.display_name, p.state,
           (select count(distinct x.reporter_id)::int from reports x where x.reported_user_id = r.reported_user_id and x.created_at > now() - interval '7 days'),
           (select count(*)::int from reports x where x.reported_user_id = r.reported_user_id),
           (select count(*)::int from moderation_actions a where a.target_user_id = r.reported_user_id), r.status
      from reports r left join profiles p on p.id = r.reported_user_id
     where r.status = p_status::report_status
     order by 8 desc, r.created_at asc limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.mod_take_action(p_report uuid, p_target uuid, p_action text, p_notes text, p_days int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r reports%rowtype; aid uuid;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action not in ('warn', 'remove_content', 'suspend', 'ban', 'restore', 'dismiss') then raise exception 'unknown action' using errcode = '22023'; end if;
  if p_action in ('ban', 'restore') and not public.has_role('admin') then raise exception 'only an admin can ban or restore' using errcode = '42501'; end if;
  if p_report is not null then select * into r from reports where id = p_report; end if;
  if p_action = 'remove_content' and r.id is not null then
    if r.content_type = 'message' then update messages set deleted_at = now() where id = r.content_id;
    elsif r.content_type = 'photo' then update profile_photos set moderation_status = 'rejected' where id = r.content_id;
    elsif r.content_type = 'open_call' then update open_calls set status = 'cancelled' where id = r.content_id and status in ('open', 'full');
    elsif r.content_type = 'event' then update events set status = 'cancelled' where id = r.content_id and status = 'scheduled';
    end if;
  end if;
  insert into moderation_actions (report_id, moderator_id, target_user_id, action, notes, until)
  values (p_report, uid, p_target, p_action, left(p_notes, 1000), case when p_action = 'suspend' and p_days is not null then now() + make_interval(days => p_days) end) returning id into aid;
  if p_action in ('warn', 'suspend', 'ban') and p_target is not null then
    perform public.notify_db(p_target, 'moderation_notice', '{}'::jsonb, 'mod:' || aid);
  end if;
  return aid;
end $$;

create or replace function public.submit_appeal(p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); aid uuid; act uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 1000 then raise exception 'please explain in a few sentences' using errcode = '22023'; end if;
  if exists (select 1 from appeals where user_id = uid and status = 'open') then raise exception 'you already have an open appeal' using errcode = '22023'; end if;
  select id into act from moderation_actions where target_user_id = uid and action in ('suspend', 'ban', 'warn') order by created_at desc limit 1;
  insert into appeals (user_id, moderation_action_id, message) values (uid, act, btrim(p_message)) returning id into aid;
  return aid;
end $$;

create or replace function public.mod_appeals_queue()
returns table (appeal_id uuid, created_at timestamptz, user_id uuid, user_name text, user_state account_state, message text, last_action text, last_action_notes text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select a.id, a.created_at, a.user_id, p.display_name, p.state, a.message, m.action, m.notes
    from appeals a join profiles p on p.id = a.user_id left join moderation_actions m on m.id = a.moderation_action_id
   where a.status = 'open' order by a.created_at;
end $$;

create or replace function public.mod_resolve_appeal(p_appeal uuid, p_overturn boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a appeals%rowtype;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into a from appeals where id = p_appeal and status = 'open';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  if p_overturn then
    -- lifting a ban needs an admin; lifting a suspension does not
    if (select state from profiles where id = a.user_id) = 'banned' and not public.has_role('admin') then raise exception 'only an admin can overturn a ban' using errcode = '42501'; end if;
    insert into moderation_actions (moderator_id, target_user_id, action, notes) values (auth.uid(), a.user_id, 'restore', 'Appeal overturned');
  end if;
  update appeals set status = case when p_overturn then 'overturned' else 'upheld' end where id = p_appeal;
  perform public.notify_db(a.user_id, 'moderation_notice', '{}'::jsonb, 'appeal:' || p_appeal);
end $$;

-- Suspensions with an end date lift themselves (called by the worker).
create or replace function public.lift_expired_suspensions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update profiles p set state = 'active'
   where p.state = 'suspended' and exists (select 1 from moderation_actions m where m.target_user_id = p.id and m.action = 'suspend' and m.until is not null and m.until < now()
          and not exists (select 1 from moderation_actions m2 where m2.target_user_id = p.id and m2.created_at > m.created_at and m2.action in ('suspend', 'ban')));
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.lift_expired_suspensions() from public, anon, authenticated;

-- ===== Pause, delete, export ==================================================================================
create or replace function public.pause_account() returns void language sql security definer set search_path = public as $$
  update profiles set state = 'paused' where id = auth.uid() and state = 'active' $$;
create or replace function public.resume_account() returns void language sql security definer set search_path = public as $$
  update profiles set state = 'active' where id = auth.uid() and state = 'paused' $$;

create or replace function public.request_export() returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from data_requests where user_id = auth.uid() and kind = 'export' and requested_at > now() - interval '1 day') then raise exception 'slow_down' using errcode = 'SQ429'; end if;
  insert into data_requests (user_id, kind) values (auth.uid(), 'export') returning id into rid; return rid;
end $$;

-- Deleting hides the account at once and removes the data after 7 days, so a mistake can be undone.
create or replace function public.request_deletion() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); at timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select requested_at into at from data_requests where user_id = uid and kind = 'deletion' and status in ('queued', 'processing') order by requested_at desc limit 1;
  if at is null then
    insert into data_requests (user_id, kind) values (uid, 'deletion') returning requested_at into at;
    update profiles set state = 'deleted' where id = uid and state in ('active', 'paused');
    update open_calls set status = 'cancelled' where host_id = uid and status in ('open', 'full');
    update events set status = 'cancelled' where host_id = uid and status = 'scheduled';
    update calendar_entries set status = 'cancelled' where user_id = uid and status in ('confirmed', 'tentative');
  end if;
  return at + interval '7 days';
end $$;

create or replace function public.cancel_deletion() returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  update data_requests set status = 'cancelled' where user_id = uid and kind = 'deletion' and status = 'queued';
  if not found then return false; end if;
  update profiles set state = 'active' where id = uid and state = 'deleted';
  return true;
end $$;

create or replace function public.my_data_requests() returns table (id uuid, kind text, status text, requested_at timestamptz, completed_at timestamptz, ready boolean)
language sql stable security definer set search_path = public as $$
  select id, kind, status, requested_at, completed_at, result_path is not null from data_requests where user_id = auth.uid() order by requested_at desc limit 20 $$;

-- Service only: a complete copy of what SideQuest holds about one person, for their data export.
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
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('role', case when sender_id = p_user then 'sender' else 'recipient' end, 'format', format, 'state', state, 'starts_at', starts_at, 'vibe', mode_id, 'created', created_at)), '[]') from conversation_invites where p_user in (sender_id, recipient_id)),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', starts_at, 'status', status, 'kind', source_type)), '[]') from calendar_entries where user_id = p_user),
    'open_calls_hosted', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'starts_at', starts_at, 'status', status, 'area', area_label)), '[]') from open_calls where host_id = p_user),
    'activities_hosted', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'category', category, 'starts_at', starts_at, 'status', status)), '[]') from events where host_id = p_user),
    'circles', (select coalesce(jsonb_agg(jsonb_build_object('circle', c.name, 'role', m.role, 'status', m.status)), '[]') from circle_members m join circles c on c.id = m.circle_id where m.user_id = p_user),
    'blocks_count', (select count(*) from blocks where blocker_id = p_user),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'about', content_type, 'at', created_at)), '[]') from reports where reporter_id = p_user),
    'post_meeting_feedback_written', (select coalesce(jsonb_agg(jsonb_build_object('comfortable', comfortable, 'boundaries_respected', boundaries_respected, 'showed_up', showed_up, 'would_interact_again', would_interact_again, 'concern', concern, 'at', created_at)), '[]') from post_meet_feedback where from_user = p_user),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'at', created_at, 'read_at', read_at)), '[]') from notifications where user_id = p_user),
    'trusted_contacts', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'added', created_at)), '[]') from trusted_contacts where user_id = p_user),
    'data_requests', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'at', requested_at)), '[]') from data_requests where user_id = p_user)
  ) $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;

-- ===== Trusted contacts and meeting check-ins ===============================================================
-- A trusted contact is another SideQuest member (by friend code). They are told when you add them and can step down at any time.
create or replace function public.add_trusted_contact(p_code text, p_label text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid; tid uuid;
begin
  other := public.resolve_friend_code(p_code);
  if other is null then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select count(*) from trusted_contacts where user_id = uid) >= 5 then raise exception 'too_many_open_calls' using errcode = 'SQ431'; end if;
  insert into trusted_contacts (user_id, label, contact_user_id) values (uid, left(btrim(coalesce(nullif(p_label, ''), 'Trusted friend')), 40), other) returning id into tid;
  perform public.notify_db(other, 'trusted_added', jsonb_build_object('contactId', tid::text), 'tc:' || tid);
  return tid;
end $$;

create or replace function public.my_trusted_contacts() returns table (id uuid, label text, contact_name text, direction text)
language sql stable security definer set search_path = public as $$
  select t.id, t.label, p.display_name, 'mine' from trusted_contacts t join profiles p on p.id = t.contact_user_id where t.user_id = auth.uid()
  union all
  select t.id, t.label, p.display_name, 'for_me' from trusted_contacts t join profiles p on p.id = t.user_id where t.contact_user_id = auth.uid() $$;

create or replace function public.remove_trusted_contact(p_id uuid) returns void language sql security definer set search_path = public as $$
  delete from trusted_contacts where id = p_id and auth.uid() in (user_id, contact_user_id) $$;

create or replace function public.schedule_checkin(p_source_type text, p_source_id uuid, p_at timestamptz, p_contact uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid uuid;
begin
  if not exists (select 1 from trusted_contacts where id = p_contact and user_id = uid)
     or not exists (select 1 from calendar_entries where user_id = uid and source_type = p_source_type and source_id = p_source_id and status in ('confirmed', 'tentative')) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  if p_at is null or p_at < now() or p_at > now() + interval '30 days' then raise exception 'time out of range' using errcode = '22023'; end if;
  insert into meeting_checkins (user_id, source_type, source_id, trusted_contact_id, check_in_at) values (uid, p_source_type, p_source_id, p_contact, p_at) returning id into cid;
  return cid;
end $$;

create or replace function public.my_checkins() returns table (id uuid, source_type text, source_id uuid, check_in_at timestamptz, status text, contact_label text)
language sql stable security definer set search_path = public as $$
  select c.id, c.source_type, c.source_id, c.check_in_at, c.status, t.label from meeting_checkins c left join trusted_contacts t on t.id = c.trusted_contact_id
   where c.user_id = auth.uid() and c.check_in_at > now() - interval '2 days' order by c.check_in_at $$;

create or replace function public.confirm_checkin(p_id uuid, p_safe boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c meeting_checkins%rowtype; contact uuid;
begin
  update meeting_checkins set status = case when p_safe then 'confirmed_safe' else 'needs_help' end where id = p_id and user_id = auth.uid() and status in ('scheduled', 'prompted') returning * into c;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  if not p_safe then
    select contact_user_id into contact from trusted_contacts where id = c.trusted_contact_id;
    if contact is not null then perform public.notify_db(contact, 'checkin_help', jsonb_build_object('checkinId', p_id::text, 'name', (select display_name from profiles where id = c.user_id)), 'cih:' || p_id); end if;
  end if;
end $$;

revoke execute on function public.mod_queue(text, int), public.mod_take_action(uuid, uuid, text, text, int), public.submit_appeal(text), public.mod_appeals_queue(), public.mod_resolve_appeal(uuid, boolean),
  public.pause_account(), public.resume_account(), public.request_export(), public.request_deletion(), public.cancel_deletion(), public.my_data_requests(),
  public.add_trusted_contact(text, text), public.my_trusted_contacts(), public.remove_trusted_contact(uuid), public.schedule_checkin(text, uuid, timestamptz, uuid),
  public.my_checkins(), public.confirm_checkin(uuid, boolean) from public, anon;
grant execute on function public.mod_queue(text, int), public.mod_take_action(uuid, uuid, text, text, int), public.submit_appeal(text), public.mod_appeals_queue(), public.mod_resolve_appeal(uuid, boolean),
  public.pause_account(), public.resume_account(), public.request_export(), public.request_deletion(), public.cancel_deletion(), public.my_data_requests(),
  public.add_trusted_contact(text, text), public.my_trusted_contacts(), public.remove_trusted_contact(uuid), public.schedule_checkin(text, uuid, timestamptz, uuid),
  public.my_checkins(), public.confirm_checkin(uuid, boolean) to authenticated;
