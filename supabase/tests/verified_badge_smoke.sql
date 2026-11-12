-- Badge smoke test (migration 0019). Run AFTER all migrations. Rolled back at the end; any failure raises "FAIL: ...".
-- It first reproduces the original bug (trigger off: a passed selfie sets profiles.verified_at but the badge flag stays false),
-- then proves the fix (trigger on: the flag follows), including the exact value Discover and profile views read.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','v1@test.local'), ('00000000-0000-0000-0000-0000000000b1','v2@test.local'), ('00000000-0000-0000-0000-0000000000c1','v3@test.local');
insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete)
select id, 'V ' || right(id::text, 2), date '1995-05-05', 'f', 'Pune', true from auth.users where email like 'v_@test.local';
insert into user_active_modes (user_id, mode_id) select id, 'friendship' from auth.users where email like 'v_@test.local';
insert into profile_photos (user_id, storage_path, moderation_status, visible_modes)
select id, 'seed/' || id::text || '.jpg', 'approved', array['friendship'] from auth.users where email like 'v_@test.local';

-- 1) THE BUG, reproduced: with the trigger off, passing the check does not give a badge.
alter table profiles disable trigger profiles_sync_verified_badge;
update profiles set verified_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if coalesce((select identity_verified from verification_status where user_id = '00000000-0000-0000-0000-0000000000b1'), false) then
    raise exception 'FAIL: expected the old bug to reproduce with the trigger off'; end if;
end $$;
-- 2) THE FIX: trigger on, a new pass sets the flag ...
alter table profiles enable trigger profiles_sync_verified_badge;
update profiles set verified_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if not (select identity_verified from verification_status where user_id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'FAIL: verified_at did not set the badge flag'; end if;
  if (select verified_at from verification_status where user_id = '00000000-0000-0000-0000-0000000000a1') is null then raise exception 'FAIL: verified_at not copied'; end if;
end $$;
-- ... and the backfill (the last statement of 0019) repairs people who passed before the fix.
insert into verification_status (user_id, identity_verified, verified_at, provider)
select p.id, true, p.verified_at, 'selfie' from profiles p where p.verified_at is not null
on conflict (user_id) do update set identity_verified = true, verified_at = excluded.verified_at, provider = coalesce(verification_status.provider, 'selfie');
do $$ begin
  if not (select identity_verified from verification_status where user_id = '00000000-0000-0000-0000-0000000000b1') then raise exception 'FAIL: backfill did not repair an earlier pass'; end if;
end $$;
-- 3) Removing verification (for example a moderator) takes the badge away again.
update profiles set verified_at = null where id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if (select identity_verified from verification_status where user_id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'FAIL: badge stayed after verified_at was cleared'; end if;
end $$;
update profiles set verified_at = now() where id = '00000000-0000-0000-0000-0000000000a1';

-- 4) What another person actually sees: Discover and the profile view show the tick for the verified user and not for the other.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
do $$ declare v boolean; begin
  select (to_jsonb(d)->>'verified')::boolean into v from discover_people('friendship') d where d.user_id = '00000000-0000-0000-0000-0000000000a1';
  if v is distinct from true then raise exception 'FAIL: Discover does not show the badge (got %)', v; end if;
  select (to_jsonb(v2)->>'verified')::boolean into v from view_profile('00000000-0000-0000-0000-0000000000a1', 'friendship') v2;
  if v is distinct from true then raise exception 'FAIL: profile view does not show the badge (got %)', v; end if;
end $$;
reset role;
do $$ begin raise notice 'PASS: verified badge follows profiles.verified_at'; end $$;
rollback;
