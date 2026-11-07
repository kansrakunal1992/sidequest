-- SideQuest part 12: what the moderation page needs beyond the queue: report context, a human photo-review queue, and an audit trail.
-- Moderators still get no raw table access. Everything is a role-checked function that returns the minimum needed.
-- STATUS: run on a local Postgres 16 with stand-ins for Supabase (see docs/LOCAL_POSTGRES.md); not on a hosted project.

-- Who looked at what, and what they decided about photos. Function-only: no client policy.
create table public.moderator_audit (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('opened_report', 'photo_approved', 'photo_rejected')),
  subject_id uuid,
  created_at timestamptz not null default now()
);
alter table public.moderator_audit enable row level security;
create index moderator_audit_idx on public.moderator_audit (created_at desc);

-- Everything a moderator needs to decide ONE report, and no more:
--  * the report, the reported person's standing and history, other reports about them;
--  * for a reported message: that message and the few around it, labelled only "reported" / "other" (the other person's name is not shown);
--  * for a photo, an open call, an activity or a circle: its title and status (a photo itself is shown through the API, which checks the role again).
-- Opening it is written to moderator_audit, so reading private chat context always leaves a trace.
create or replace function public.mod_report_context(p_report uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reports%rowtype; ref timestamptz; conv uuid; content jsonb := '{}'::jsonb;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from reports where id = p_report;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into moderator_audit (moderator_id, kind, subject_id) values (auth.uid(), 'opened_report', p_report);

  if r.content_type = 'message' and r.content_id is not null then
    select created_at, conversation_id into ref, conv from messages where id = r.content_id;
    if conv is not null then
      content := jsonb_build_object('messages', coalesce((
        select jsonb_agg(jsonb_build_object('who', case when w.sender_id = r.reported_user_id then 'reported' else 'other' end,
                                            'text', w.body, 'media', w.media_kind, 'at', w.created_at, 'is_reported', w.id = r.content_id) order by w.created_at)
          from (select m.* from messages m where m.conversation_id = conv and m.deleted_at is null
                 order by abs(extract(epoch from m.created_at - ref)) limit 7) w), '[]'::jsonb));
    end if;
  elsif r.content_type = 'photo' then
    content := (select jsonb_build_object('photo_id', id, 'photo_status', moderation_status, 'visible_modes', visible_modes) from profile_photos where id = r.content_id);
  elsif r.content_type = 'open_call' then
    content := (select jsonb_build_object('title', title, 'description', description, 'status', status) from open_calls where id = r.content_id);
  elsif r.content_type = 'event' then
    content := (select jsonb_build_object('title', title, 'description', description, 'status', status) from events where id = r.content_id);
  elsif r.content_type = 'circle' then
    content := (select jsonb_build_object('title', name, 'description', description) from circles where id = r.content_id);
  end if;

  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'content_type', r.content_type, 'status', r.status, 'created_at', r.created_at),
    'reported', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'state', p.state, 'joined', p.created_at, 'age', extract(year from age(p.date_of_birth))::int)
                   from profiles p where p.id = r.reported_user_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'notes', a.notes, 'at', a.created_at, 'until', a.until) order by a.created_at desc)
                           from (select * from moderation_actions where target_user_id = r.reported_user_id order by created_at desc limit 10) a), '[]'::jsonb),
    'other_reports', coalesce((select jsonb_agg(jsonb_build_object('reason', x.reason, 'content_type', x.content_type, 'status', x.status, 'at', x.created_at) order by x.created_at desc)
                                 from (select * from reports where reported_user_id = r.reported_user_id and id <> r.id order by created_at desc limit 10) x), '[]'::jsonb),
    'content', coalesce(content, '{}'::jsonb));
end $$;

-- Photos wait for a person or a provider (fail closed). This is the person's queue: oldest first, with only what is needed to judge the picture.
create or replace function public.mod_photo_queue(p_limit int default 30)
returns table (photo_id uuid, created_at timestamptz, visible_modes text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select ph.id, ph.created_at, ph.visible_modes from profile_photos ph
   join profiles p on p.id = ph.user_id and p.state in ('active', 'paused')
   where ph.moderation_status = 'pending' order by ph.created_at limit least(greatest(p_limit, 1), 100);
end $$;

create or replace function public.mod_review_photo(p_photo uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  update profile_photos set moderation_status = case when p_approve then 'approved' else 'rejected' end
   where id = p_photo and moderation_status = 'pending' returning user_id into owner;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into moderator_audit (moderator_id, kind, subject_id) values (auth.uid(), case when p_approve then 'photo_approved' else 'photo_rejected' end, p_photo);
  if not p_approve then
    insert into moderation_actions (moderator_id, target_user_id, action, notes) values (auth.uid(), owner, 'remove_content', left(coalesce(nullif(btrim(p_notes), ''), 'Photo not approved'), 1000));
  end if;
end $$;

-- The API checks this (with the service role) before it signs a photo link for a moderator.
create or replace function public.is_moderator(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = p_user and role in ('moderator', 'admin')) $$;

revoke execute on function public.mod_report_context(uuid), public.mod_photo_queue(int), public.mod_review_photo(uuid, boolean, text), public.is_moderator(uuid) from public, anon;
grant execute on function public.mod_report_context(uuid), public.mod_photo_queue(int), public.mod_review_photo(uuid, boolean, text) to authenticated;
revoke execute on function public.is_moderator(uuid) from authenticated;

-- Function-only, like the other safety tables: no table privileges at all for clients.
revoke all on public.moderator_audit from anon, authenticated;
