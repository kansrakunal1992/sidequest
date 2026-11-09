-- Waypoint part 15: trust you can SEE.
--  * Selfie verification: a random pose, a person compares the selfie with the profile photos, the selfie is deleted after the decision.
--  * Photo rejections come with a reason the owner can read.
--  * Other people can see "Photo verified" (and nothing else about how it went).
--  * chat_trust: plain facts about the other person's account (verified, how new it is, copy-paste messaging) so the app can show them openly.
-- STATUS: run on a local Postgres 16 with stand-ins for Supabase; not on a hosted project.

alter table public.profiles add column verified_at timestamptz;          -- not in the client-writable column list: only mod_review_verification sets it
alter table public.profile_photos add column rejection_reason text;

alter table public.moderator_audit drop constraint moderator_audit_kind_check;
alter table public.moderator_audit add constraint moderator_audit_kind_check
  check (kind in ('opened_report', 'photo_approved', 'photo_rejected', 'verification_approved', 'verification_rejected'));

create table public.photo_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pose text not null,
  status text not null default 'started' check (status in ('started', 'pending', 'approved', 'rejected', 'expired')),
  selfie_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  reject_reason text
);
alter table public.photo_verifications enable row level security;
revoke all on public.photo_verifications from anon, authenticated;
create unique index photo_verifications_one_open on public.photo_verifications (user_id) where status in ('started', 'pending');
create index photo_verifications_queue_idx on public.photo_verifications (submitted_at) where status = 'pending';
create index photo_verifications_purge_idx on public.photo_verifications (decided_at) where selfie_path is not null;

-- Selfies are private: a person can add one to their own folder and can never read, replace or list anything. Moderators view them through the API.
insert into storage.buckets (id, name, public) values ('verification-selfies', 'verification-selfies', false) on conflict (id) do nothing;
create policy storage_selfie_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-selfies' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.start_verification() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v photo_verifications%rowtype;
  poses text[] := array['Hold up two fingers next to your face', 'Touch your nose with one finger', 'Give a thumbs up', 'Hold up three fingers next to your face', 'Tilt your head and smile', 'Cover one eye with your hand'];
begin
  if uid is null or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if (select verified_at from profiles where id = uid) is not null then raise exception 'you are already verified' using errcode = '22023'; end if;
  if not exists (select 1 from profile_photos where user_id = uid and moderation_status = 'approved') then raise exception 'add a profile photo and wait for it to be approved first' using errcode = '22023'; end if;
  update photo_verifications set status = 'expired' where user_id = uid and status = 'started' and expires_at < now();
  select * into v from photo_verifications where user_id = uid and status in ('started', 'pending');
  if found then
    if v.status = 'pending' then raise exception 'your selfie is already being reviewed' using errcode = '22023'; end if;
    return jsonb_build_object('id', v.id, 'pose', v.pose, 'expires_at', v.expires_at);
  end if;
  if (select count(*) from photo_verifications where user_id = uid and created_at > now() - interval '24 hours') >= 3 then raise exception 'too many tries today, please try again tomorrow' using errcode = 'SQ431'; end if;
  insert into photo_verifications (user_id, pose, expires_at) values (uid, poses[1 + floor(random() * array_length(poses, 1))::int], now() + interval '30 minutes') returning * into v;
  return jsonb_build_object('id', v.id, 'pose', v.pose, 'expires_at', v.expires_at);
end $$;

create or replace function public.submit_verification(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  update photo_verifications set status = 'pending', selfie_path = p_path, submitted_at = now()
   where id = p_id and user_id = uid and status = 'started' and expires_at > now() and p_path like uid::text || '/%' and char_length(p_path) < 200;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
end $$;

create or replace function public.my_verification() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('verified', p.verified_at is not null, 'verified_at', p.verified_at,
    'latest', (select jsonb_build_object('id', v.id, 'status', v.status, 'pose', v.pose, 'reject_reason', v.reject_reason, 'expires_at', v.expires_at)
                 from photo_verifications v where v.user_id = auth.uid() order by v.created_at desc limit 1))
    from profiles p where p.id = auth.uid() $$;

-- Which of these people are photo verified? Blocked people, and people who are not active, are never reported.
create or replace function public.verified_flags(p_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p where p.id = any (p_ids[1:100]) and p.verified_at is not null and p.state = 'active' and not public.blocked_between(auth.uid(), p.id) $$;

-- The other person in a one-to-one chat, as facts the app shows openly.
create or replace function public.chat_trust(p_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid; blast int;
begin
  select om.user_id into other from conversations c
    join conversation_members me on me.conversation_id = c.id and me.user_id = uid
    join conversation_members om on om.conversation_id = c.id and om.user_id <> uid
   where c.id = p_conv and c.kind = 'direct';
  if other is null or public.blocked_between(uid, other) then raise exception 'unavailable' using errcode = '42501'; end if;
  select coalesce(max(n), 0) into blast from (
    select count(distinct conversation_id) n from messages
     where sender_id = other and created_at > now() - interval '24 hours' and deleted_at is null and body is not null and char_length(btrim(body)) >= 15
     group by lower(btrim(body))) t;
  return jsonb_build_object('verified', (select verified_at is not null from profiles where id = other),
    'account_age_days', (select greatest(0, floor(extract(epoch from now() - created_at) / 86400))::int from profiles where id = other),
    'repeated_message_to', blast);
end $$;

-- My photos that are waiting or were not approved, with the reason in plain words.
create or replace function public.my_photo_issues() returns table (photo_id uuid, status text, reason text)
language sql stable security definer set search_path = public as $$
  select id, moderation_status::text, rejection_reason from profile_photos
   where user_id = auth.uid() and moderation_status::text in ('pending', 'rejected') order by created_at desc $$;

-- Photo rejection now keeps its reason for the owner.
create or replace function public.mod_review_photo(p_photo uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not p_approve and char_length(btrim(coalesce(p_notes, ''))) < 3 then raise exception 'please say why the photo is not approved' using errcode = '22023'; end if;
  update profile_photos set moderation_status = case when p_approve then 'approved' else 'rejected' end,
         rejection_reason = case when p_approve then null else left(btrim(p_notes), 200) end
   where id = p_photo and moderation_status = 'pending' returning user_id into owner;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  insert into moderator_audit (moderator_id, kind, subject_id) values (auth.uid(), case when p_approve then 'photo_approved' else 'photo_rejected' end, p_photo);
  if not p_approve then
    insert into moderation_actions (moderator_id, target_user_id, action, notes) values (auth.uid(), owner, 'remove_content', left(btrim(p_notes), 1000));
  end if;
end $$;

create or replace function public.mod_verification_queue(p_limit int default 30)
returns table (verification_id uuid, submitted_at timestamptz, pose text, approved_photos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select v.id, v.submitted_at, v.pose, (select count(*)::int from profile_photos ph where ph.user_id = v.user_id and ph.moderation_status = 'approved')
    from photo_verifications v join profiles p on p.id = v.user_id and p.state in ('active', 'paused')
   where v.status = 'pending' order by v.submitted_at limit least(greatest(p_limit, 1), 100);
end $$;

-- What a person needs to judge ONE verification: the pose that was asked for, and which approved profile photos to compare with.
create or replace function public.mod_verification_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v photo_verifications%rowtype;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from photo_verifications where id = p_id and status = 'pending';
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  return jsonb_build_object('id', v.id, 'pose', v.pose, 'submitted_at', v.submitted_at,
    'photo_ids', coalesce((select jsonb_agg(ph.id order by ph.position) from profile_photos ph where ph.user_id = v.user_id and ph.moderation_status = 'approved'), '[]'::jsonb));
end $$;

create or replace function public.mod_review_verification(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not p_approve and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'please say why it was not verified' using errcode = '22023'; end if;
  update photo_verifications set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid(),
         reject_reason = case when p_approve then null else left(btrim(p_reason), 200) end
   where id = p_id and status = 'pending' returning user_id into owner;
  if not found then raise exception 'unavailable' using errcode = '42501'; end if;
  if p_approve then update profiles set verified_at = now() where id = owner; end if;
  insert into moderator_audit (moderator_id, kind, subject_id) values (auth.uid(), case when p_approve then 'verification_approved' else 'verification_rejected' end, p_id);
  perform public.notify_db(owner, 'verification_result', jsonb_build_object('approved', p_approve), 'ver:' || p_id);
end $$;

revoke execute on function public.start_verification(), public.submit_verification(uuid, text), public.my_verification(), public.verified_flags(uuid[]), public.chat_trust(uuid),
  public.my_photo_issues(), public.mod_review_photo(uuid, boolean, text), public.mod_verification_queue(int), public.mod_verification_context(uuid), public.mod_review_verification(uuid, boolean, text) from public, anon;
grant execute on function public.start_verification(), public.submit_verification(uuid, text), public.my_verification(), public.verified_flags(uuid[]), public.chat_trust(uuid),
  public.my_photo_issues(), public.mod_review_photo(uuid, boolean, text), public.mod_verification_queue(int), public.mod_verification_context(uuid), public.mod_review_verification(uuid, boolean, text) to authenticated;
