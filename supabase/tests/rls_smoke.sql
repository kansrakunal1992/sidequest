-- RLS smoke tests. Run AFTER applying migrations 0001-0003, in the Supabase SQL editor or `psql`.
-- Everything runs inside a transaction that is rolled back. Any failure raises an exception named FAIL: ...
-- STATUS: written but NOT yet executed (no Postgres in the authoring sandbox). Report any error to the developer.
begin;

-- ---- Setup as superuser ----------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','a@test.local'), ('00000000-0000-0000-0000-00000000000b','b@test.local'),
  ('00000000-0000-0000-0000-00000000000c','c@test.local'), ('00000000-0000-0000-0000-00000000000d','d@test.local'),
  ('00000000-0000-0000-0000-00000000000e','e@test.local');
insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete)
select id, 'User ' || right(id::text, 1), date '1995-05-05', 'f', 'Pune', true from auth.users where email like '%@test.local';
insert into user_active_modes (user_id, mode_id)
select id, 'serious_dating' from auth.users where email like '%@test.local' and right(id::text,1) <> 'c';
insert into user_active_modes (user_id, mode_id) values ('00000000-0000-0000-0000-00000000000c','hookups');
update profiles set incognito = true where id = '00000000-0000-0000-0000-00000000000b';
insert into profile_photos (user_id, storage_path, moderation_status, visible_modes)
select id, 'seed/' || id::text || '.jpg', 'approved', array['serious_dating'] from auth.users
 where email like '%@test.local' and right(id::text, 1) in ('a','b','d','e');

-- T6 (superuser): the database itself refuses under-18 profiles
do $$ begin
  begin
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff','kid@test.local');
    insert into profiles (id, display_name, date_of_birth) values ('00000000-0000-0000-0000-0000000000ff','Kid', (current_date - interval '17 years')::date);
    raise exception 'FAIL: under-18 profile was accepted';
  exception when sqlstate '23514' then null; end;
end $$;

-- ---- As user A -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

do $$ begin  -- T1: cannot read anyone else's profile row
  if (select count(*) from profiles where id <> auth.uid()) <> 0 then raise exception 'FAIL: profiles of others are readable'; end if;
end $$;
do $$ begin  -- T7: clients cannot write invites directly (API owns the state machine)
  begin
    insert into conversation_invites (sender_id, recipient_id, mode_id, format, starts_at, timezone, duration_minutes, expires_at)
    values (auth.uid(), '00000000-0000-0000-0000-00000000000d', 'serious_dating', 'text', now() + interval '1 day', 'UTC', 15, now() + interval '2 days');
    raise exception 'FAIL: client inserted an invite';
  exception when sqlstate '42501' then null; end;
end $$;
do $$ begin  -- T4: cannot like someone who is not in the same mode
  begin
    insert into likes (from_user, to_user, mode_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000c', 'serious_dating');
    raise exception 'FAIL: cross-mode like accepted';
  exception when sqlstate '42501' then null; end;
end $$;
do $$ begin  -- T4b: cannot view a profile outside the shared mode
  begin
    perform view_profile('00000000-0000-0000-0000-00000000000c', 'serious_dating');
    raise exception 'FAIL: cross-mode profile view allowed';
  exception when sqlstate '42501' then null; end;
end $$;
do $$ begin  -- A likes D (used for match + discovery exclusion tests)
  insert into likes (from_user, to_user, mode_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000d', 'serious_dating');
end $$;
-- A blocks B
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b');
do $$ declare ids uuid[]; begin  -- T9: discovery excludes blocked (B), already-liked (D), other-mode (C), self; includes E
  select array_agg(user_id) into ids from discover_people('serious_dating');
  if ids is null or not ('00000000-0000-0000-0000-00000000000e' = any (ids)) then raise exception 'FAIL: E missing from discovery'; end if;
  if '00000000-0000-0000-0000-00000000000b' = any (ids) then raise exception 'FAIL: blocked user in discovery'; end if;
  if '00000000-0000-0000-0000-00000000000d' = any (ids) then raise exception 'FAIL: already-liked user in discovery'; end if;
  if '00000000-0000-0000-0000-00000000000c' = any (ids) then raise exception 'FAIL: other-mode user in discovery'; end if;
  if '00000000-0000-0000-0000-00000000000a' = any (ids) then raise exception 'FAIL: self in discovery'; end if;
end $$;
-- A writes private feedback about E and a couple link where only A has consented
insert into post_meet_feedback (from_user, about_user, comfortable) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000e', false);
reset role;
-- (seeded as superuser: clients can no longer insert couple links directly, only through create_couple_link; see the direct-insert check further down)
insert into couple_links (partner_a, partner_b, a_link) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000e', true);

-- ---- As user B (incognito, blocked by A) -----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin  -- T3: a blocked user cannot view or like, and gets a generic error
  begin perform view_profile('00000000-0000-0000-0000-00000000000a','serious_dating'); raise exception 'FAIL: blocked view allowed';
  exception when sqlstate '42501' then null; end;
  begin insert into likes (from_user, to_user, mode_id) values (auth.uid(),'00000000-0000-0000-0000-00000000000a','serious_dating'); raise exception 'FAIL: blocked like allowed';
  exception when sqlstate '42501' then null; end;
end $$;
do $$ begin  -- T3b: A's block row is invisible to B
  if (select count(*) from blocks) <> 0 then raise exception 'FAIL: block list visible to blocked user'; end if;
end $$;
-- B (incognito) views E
do $$ begin perform view_profile('00000000-0000-0000-0000-00000000000e','serious_dating'); end $$;
reset role;

-- ---- As user E (visited by incognito B; subject of A's feedback; partner in A's couple link) ---
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin  -- T2: incognito visits are never visible to the visited person
  if (select count(*) from profile_views where viewed_id = auth.uid()) <> 0 then raise exception 'FAIL: incognito visit leaked'; end if;
end $$;
do $$ begin  -- T8: the subject can never read feedback about them
  if (select count(*) from post_meet_feedback) <> 0 then raise exception 'FAIL: subject can read private feedback'; end if;
end $$;
do $$ begin  -- T11: partner E cannot flip A's consent, but can set their own
  begin update couple_links set a_discovery = true; raise exception 'FAIL: changed partner consent';
  exception when sqlstate '42501' then null; end;
  update couple_links set b_link = true;
  if (select count(*) from couple_links where a_link and b_link and not a_discovery) <> 1 then raise exception 'FAIL: own consent not recorded'; end if;
end $$;
reset role;

-- ---- T2b: once B is no longer incognito, the visit becomes visible to E -----------------------
update profiles set incognito = false where id = '00000000-0000-0000-0000-00000000000b';
-- (B has been blocked by A only; E is unaffected)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin perform view_profile('00000000-0000-0000-0000-00000000000e','serious_dating'); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if (select count(*) from profile_views where viewed_id = auth.uid()) <> 1 then raise exception 'FAIL: non-incognito visit not visible'; end if;
end $$;
reset role;

-- ---- As user D: mutual like -> match; messages are immutable ----------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  insert into likes (from_user, to_user, mode_id) values (auth.uid(),'00000000-0000-0000-0000-00000000000a','serious_dating');  -- T5
  if (select count(*) from matches) <> 1 then raise exception 'FAIL: mutual like did not create a match'; end if;
end $$;
reset role;
-- The tests below were written before vibes had different features. Keep the REAL matrix aside, let every vibe have every feature for them,
-- and put the real matrix back in the "Migration 0014" section, which tests the enforcement itself.
create temp table real_mode_features as select * from public.mode_features;
insert into public.mode_features (mode_id, feature)
  select m, f from (values ('serious_dating'), ('hookups'), ('friendship'), ('post_marital'), ('experimentation'), ('adventures')) a(m)
  cross join (values ('open_calls'), ('activities'), ('circles'), ('roulette'), ('double_dates'), ('games'), ('wingperson'), ('together')) b(f) on conflict do nothing;
insert into conversations (id, kind, mode_id) values ('00000000-0000-0000-0000-0000000000c1','direct','serious_dating');
insert into conversation_members (conversation_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000d');
set local role authenticated;
do $$ declare mid uuid; begin  -- T10: members can message; sender cannot rewrite history; outsiders cannot read
  insert into messages (conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c1', auth.uid(), 'hi') returning id into mid;
  begin update messages set body = 'edited' where id = mid; raise exception 'FAIL: message edit allowed';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if (select count(*) from messages) <> 0 then raise exception 'FAIL: non-member can read messages'; end if;
end $$;
reset role;


-- =====================================================================================================
-- Column-level hardening and onboarding (migration 0005)
-- =====================================================================================================
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1','f1@test.local'), ('00000000-0000-0000-0000-0000000000f2','f2@test.local');
insert into wingperson_grants (owner_id, wing_id, permissions, status) values
  ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b', array['shortlist'], 'invited');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin  -- T12: a user cannot reactivate themselves or edit protected profile columns
  begin update profiles set state = 'active'; raise exception 'FAIL: user could change own account state';
  exception when sqlstate '42501' then null; end;
  begin update profiles set date_of_birth = date '1990-01-01'; raise exception 'FAIL: user could change date of birth';
  exception when sqlstate '42501' then null; end;
  begin update profiles set onboarding_complete = true; raise exception 'FAIL: user could self-complete onboarding';
  exception when sqlstate '42501' then null; end;
  begin insert into profiles (id, display_name, date_of_birth) values (gen_random_uuid(), 'x', date '1990-01-01'); raise exception 'FAIL: direct profile insert allowed';
  exception when sqlstate '42501' then null; end;
  update profiles set bio = 'allowed edit';   -- safe columns still work
end $$;
do $$ begin  -- T14: photos cannot be self-approved
  begin insert into profile_photos (user_id, storage_path, moderation_status) values (auth.uid(), 'x/y.jpg', 'approved'); raise exception 'FAIL: self-approved photo';
  exception when sqlstate '42501' then null; end;
  insert into profile_photos (user_id, storage_path) values (auth.uid(), auth.uid()::text || '/a.jpg');
  begin update profile_photos set moderation_status = 'approved'; raise exception 'FAIL: photo status editable';
  exception when sqlstate '42501' then null; end;
  if (select moderation_status from profile_photos where user_id = auth.uid() and storage_path = auth.uid()::text || '/a.jpg') <> 'pending' then raise exception 'FAIL: new photo not pending'; end if;
end $$;
do $$ begin  -- T15: membership cannot be moved into another conversation
  begin update conversation_members set conversation_id = gen_random_uuid() where user_id = auth.uid(); raise exception 'FAIL: membership moved';
  exception when sqlstate '42501' then null; end;
end $$;
do $$ begin  -- messages cannot be backdated
  begin insert into messages (conversation_id, sender_id, body, created_at) values ('00000000-0000-0000-0000-0000000000c1', auth.uid(), 'x', now() - interval '3 years'); raise exception 'FAIL: backdated message';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ declare n int; begin  -- T16: a wingperson cannot widen their own permissions or activate themselves (no direct writes at all since 0009: zero rows or a privilege error are both fine)
  begin update wingperson_grants set permissions = array['suggest_profiles','join_double_date']; get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: wingperson widened permissions'; end if;
  exception when sqlstate '42501' then null; end;
  begin update wingperson_grants set status = 'active'; get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: wingperson self-activated'; end if;
  exception when sqlstate '42501' then null; end;
  if (select permissions from wingperson_grants limit 1) <> array['shortlist'] then raise exception 'FAIL: permissions changed'; end if;
end $$;
reset role;

-- T17: onboarding through save_onboarding / finish_onboarding
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
set local role authenticated;
do $$ begin
  begin perform save_onboarding('{"display_name":"Fi","date_of_birth":"1995-01-01","interests":["a","b"],"modes":[{"mode_id":"friendship"}]}'::jsonb); raise exception 'FAIL: 2 interests accepted';
  exception when sqlstate '22023' then null; end;
  begin perform save_onboarding('{"display_name":"Fi","date_of_birth":"1995-01-01","interests":["a","b","c"],"modes":[]}'::jsonb); raise exception 'FAIL: no modes accepted';
  exception when sqlstate '22023' then null; end;
  perform save_onboarding(jsonb_build_object('display_name','Fiona','date_of_birth','1995-01-01','gender','woman','city','Pune',
    'interests', jsonb_build_array('food','trekking','music'), 'lat', 18.5204, 'lng', 73.8567,
    'modes', jsonb_build_array(jsonb_build_object('mode_id','friendship','seeking_genders',jsonb_build_array('woman'),'age_min',21,'age_max',40,'max_distance_km',30))));
  if (select onboarding_complete from profiles where id = auth.uid()) then raise exception 'FAIL: onboarding complete before photos'; end if;
  begin perform finish_onboarding(); raise exception 'FAIL: finished without a photo';
  exception when sqlstate '22023' then null; end;
  insert into profile_photos (user_id, storage_path) values (auth.uid(), auth.uid()::text || '/p.jpg');
  perform finish_onboarding();
  if not (select onboarding_complete from profiles where id = auth.uid()) then raise exception 'FAIL: onboarding not completed'; end if;
  if (select count(*) from preferences where user_id = auth.uid() and mode_id = 'friendship' and age_min = 21 and max_distance_km = 30) <> 1 then raise exception 'FAIL: preferences not saved'; end if;
end $$;
reset role;
do $$ begin  -- location was snapped to ~1 km on the server
  if (select round(st_x(approx_location::geometry)::numeric, 4) from profiles where id = '00000000-0000-0000-0000-0000000000f1') <> 73.86
     or (select round(st_y(approx_location::geometry)::numeric, 4) from profiles where id = '00000000-0000-0000-0000-0000000000f1') <> 18.52 then
    raise exception 'FAIL: location not snapped';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
set local role authenticated;
do $$ begin  -- under-18 rejected by the database even through the RPC
  begin
    perform save_onboarding(jsonb_build_object('display_name','Kid','date_of_birth',(current_date - interval '16 years')::date,
      'interests', jsonb_build_array('a','b','c'), 'modes', jsonb_build_array(jsonb_build_object('mode_id','friendship'))));
    raise exception 'FAIL: under-18 onboarding accepted';
  exception when sqlstate '23514' then null; end;
end $$;
reset role;


-- =====================================================================================================
-- Discovery, likes, visitors, matches (migration 0006)
-- =====================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ declare r record; begin
  -- visitors: only the non-incognito visit by B is listed, with a visit count of 1
  select * into r from visitors_list('serious_dating');
  if r.user_id is distinct from '00000000-0000-0000-0000-00000000000b'::uuid or r.visits <> 1 then raise exception 'FAIL: visitors list wrong'; end if;
  -- like someone who has not liked back: no match; undo works; a second undo reports nothing to undo
  select * into r from send_like('00000000-0000-0000-0000-00000000000d', 'serious_dating', 'spark');
  if r.matched then raise exception 'FAIL: one-sided like matched'; end if;
  if not undo_like('00000000-0000-0000-0000-00000000000d', 'serious_dating') then raise exception 'FAIL: undo_like'; end if;
  if undo_like('00000000-0000-0000-0000-00000000000d', 'serious_dating') then raise exception 'FAIL: undo_like twice'; end if;
  -- pass and undo pass: person disappears from discovery then returns
  perform pass_person('00000000-0000-0000-0000-00000000000d', 'serious_dating');
  if exists (select 1 from discover_people('serious_dating') x where x.user_id = '00000000-0000-0000-0000-00000000000d') then raise exception 'FAIL: passed person still shown'; end if;
  perform undo_pass('00000000-0000-0000-0000-00000000000d', 'serious_dating');
  if not exists (select 1 from discover_people('serious_dating') x where x.user_id = '00000000-0000-0000-0000-00000000000d') then raise exception 'FAIL: undo pass did not restore'; end if;
  -- filters
  if exists (select 1 from discover_people('serious_dating', 30, 0, 'no-such-interest')) then raise exception 'FAIL: interest filter'; end if;
  -- cross-mode like is refused generically
  begin perform send_like('00000000-0000-0000-0000-00000000000c', 'serious_dating'); raise exception 'FAIL: cross-mode send_like';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare r record; begin
  -- A and D matched earlier: D appears in likes_received (D liked A) and my_matches; undo_like refuses once matched
  if (select count(*) from likes_received('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000d' and matched and i_liked_back) <> 1 then raise exception 'FAIL: likes_received'; end if;
  if (select count(*) from my_matches('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000d') <> 1 then raise exception 'FAIL: my_matches'; end if;
  if undo_like('00000000-0000-0000-0000-00000000000d', 'serious_dating') then raise exception 'FAIL: matched like was undone'; end if;
  -- A blocked B earlier: B never appears in A's lists
  if exists (select 1 from likes_received('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000b') or exists (select 1 from visitors_list('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000b') then raise exception 'FAIL: blocked user listed'; end if;
  -- summary counts agree with the lists
  select * into r from likes_visitors_summary('serious_dating');
  if r.matches <> 1 then raise exception 'FAIL: summary matches'; end if;
end $$;
reset role;

-- A person paused in a vibe disappears from other people's Likes lists in that vibe (pause hides, nothing is deleted)
update user_active_modes set paused = true where user_id = '00000000-0000-0000-0000-00000000000d' and mode_id = 'serious_dating';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from likes_received('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000d') or exists (select 1 from my_matches('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000d') then raise exception 'FAIL: paused person still listed'; end if;
end $$;
reset role;
update user_active_modes set paused = false where user_id = '00000000-0000-0000-0000-00000000000d' and mode_id = 'serious_dating';


-- =====================================================================================================
-- Chat (migration 0007)
-- =====================================================================================================
insert into conversations (id, kind, mode_id) values ('00000000-0000-0000-0000-0000000000c2','direct','serious_dating');
insert into conversation_members (conversation_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000e');
update conversation_members set last_read_at = now() - interval '1 hour' where conversation_id = '00000000-0000-0000-0000-0000000000c1' and user_id = '00000000-0000-0000-0000-00000000000a';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare r record; cid1 uuid; cid2 uuid; mid uuid; begin
  -- first contact is limited to 3 messages until the other person replies (SQ430)
  for i in 1..3 loop insert into messages (conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c2', auth.uid(), 'hello ' || i); end loop;
  begin insert into messages (conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c2', auth.uid(), 'hello 4'); raise exception 'FAIL: 4th unanswered message allowed';
  exception when sqlstate 'SQ430' then null; end;
  -- a match opens exactly one conversation, however many times it is asked for
  select id into mid from matches where user_a = least(auth.uid(), '00000000-0000-0000-0000-00000000000d') and user_b = greatest(auth.uid(), '00000000-0000-0000-0000-00000000000d') and mode_id = 'serious_dating';
  cid1 := ensure_match_conversation(mid); cid2 := ensure_match_conversation(mid);
  if cid1 is null or cid1 <> cid2 then raise exception 'FAIL: ensure_match_conversation not idempotent'; end if;
  -- inbox: unread counts the other person's messages after my last read; blocked people never appear
  select * into r from my_conversations('serious_dating') where conversation_id = '00000000-0000-0000-0000-0000000000c1';
  if r.unread <> 1 or r.user_id <> '00000000-0000-0000-0000-00000000000d'::uuid then raise exception 'FAIL: inbox unread/user'; end if;
  if exists (select 1 from my_conversations('serious_dating') where user_id = '00000000-0000-0000-0000-00000000000b') then raise exception 'FAIL: blocked person in inbox'; end if;
  if (select count(*) from conversation_info(cid1)) <> 1 then raise exception 'FAIL: conversation_info'; end if;
  -- invite counterparts only reveals people you share an invitation with
  if exists (select 1 from invite_counterparts(array['00000000-0000-0000-0000-00000000000d'::uuid])) then raise exception 'FAIL: counterpart without an invitation'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin  -- one reply lifts the limit for the person who wrote first
  insert into messages (conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c2', auth.uid(), 'hi back');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  insert into messages (conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c2', auth.uid(), 'great, 4th message after a reply');
end $$;
reset role;
-- read receipts are only shared when the other person allows them
update profiles set read_receipts = false where id = '00000000-0000-0000-0000-00000000000e';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  if (select other_last_read_at from conversation_info('00000000-0000-0000-0000-0000000000c2')) is not null then raise exception 'FAIL: read receipt leaked'; end if;
  -- and the raw table does not leak it either
  if exists (select 1 from conversation_members where conversation_id = '00000000-0000-0000-0000-0000000000c2' and user_id = '00000000-0000-0000-0000-00000000000e') then raise exception 'FAIL: read time readable from table'; end if;
end $$;
reset role;


-- =====================================================================================================
-- Open Calls, Activities, group chat (migration 0008)
-- =====================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare cid uuid; begin
  cid := create_open_call(jsonb_build_object('mode_id','serious_dating','title','Coffee tonight','area_label','Koregaon Park','starts_at', now() + interval '2 days','capacity',2,'lat',18.5204,'lng',73.8567));
  if cid is null then raise exception 'FAIL: create_open_call'; end if;
  begin perform create_open_call(jsonb_build_object('mode_id','serious_dating','title','Too small','area_label','Pune','starts_at', now() + interval '2 days','capacity',1)); raise exception 'FAIL: capacity 1 accepted';
  exception when sqlstate '22023' then null; end;
  begin perform create_open_call(jsonb_build_object('mode_id','serious_dating','title','Too soon','area_label','Pune','starts_at', now() + interval '5 minutes','capacity',2)); raise exception 'FAIL: start in 5 minutes accepted';
  exception when sqlstate '22023' then null; end;
  begin perform create_open_call(jsonb_build_object('mode_id','hookups','title','Wrong vibe','area_label','Pune','starts_at', now() + interval '2 days','capacity',2)); raise exception 'FAIL: call in a vibe the host is not in';
  exception when sqlstate '42501' then null; end;
  begin insert into open_calls (host_id, mode_id, title, area_label, starts_at, expires_at) values (auth.uid(), 'serious_dating', 'Direct', 'Pune', now() + interval '1 day', now() + interval '1 day'); raise exception 'FAIL: direct open_calls insert';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('t.call', (select id::text from open_calls where title = 'Coffee tonight'), true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ declare n_upd int; begin
  if express_interest(current_setting('t.call')::uuid) <> 'interested' then raise exception 'FAIL: express_interest'; end if;
  begin insert into open_call_participants (open_call_id, user_id, status) values (current_setting('t.call')::uuid, auth.uid(), 'accepted'); raise exception 'FAIL: direct participant insert';
  exception when sqlstate '42501' then null; end;
  update open_call_participants set status = 'accepted';   -- no update policy exists: this must change nothing (and not raise)
  get diagnostics n_upd = row_count;
  if n_upd <> 0 then raise exception 'FAIL: self-accepted'; end if;
  if not exists (select 1 from open_calls_feed('serious_dating') where id = current_setting('t.call')::uuid and my_status = 'interested') then raise exception 'FAIL: call missing from feed'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin   -- A blocked B: cannot see or join
  if exists (select 1 from open_calls_feed('serious_dating') where id = current_setting('t.call')::uuid) then raise exception 'FAIL: blocked person sees the call'; end if;
  begin perform express_interest(current_setting('t.call')::uuid); raise exception 'FAIL: blocked person joined';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin if express_interest(current_setting('t.call')::uuid) <> 'interested' then raise exception 'FAIL: D interest'; end if; end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare cid uuid; begin
  perform decide_participant(current_setting('t.call')::uuid, '00000000-0000-0000-0000-00000000000e', true);
  if (select status from open_calls where id = current_setting('t.call')::uuid) <> 'full' then raise exception 'FAIL: call not full after accepting'; end if;
  begin perform decide_participant(current_setting('t.call')::uuid, '00000000-0000-0000-0000-00000000000d', true); raise exception 'FAIL: accepted beyond capacity';
  exception when sqlstate 'SQ432' then null; end;
  if (select count(*) from open_call_people(current_setting('t.call')::uuid)) <> 2 then raise exception 'FAIL: host should see E and D'; end if;
  select conversation_id into cid from open_calls where id = current_setting('t.call')::uuid;
  if cid is null or not exists (select 1 from thread_info(cid) where kind = 'open_call' and member_count = 2 and user_id is null) then raise exception 'FAIL: group thread_info'; end if;
  if not exists (select 1 from calendar_entries where user_id = auth.uid() and source_type = 'open_call' and status = 'confirmed') then raise exception 'FAIL: host calendar not confirmed'; end if;
  begin perform update_open_call(current_setting('t.call')::uuid, jsonb_build_object('capacity', 1)); raise exception 'FAIL: capacity lowered below attendance';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('t.conv', (select conversation_id::text from open_calls where id = current_setting('t.call')::uuid), true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from calendar_entries where user_id = auth.uid() and source_type = 'open_call' and source_id = current_setting('t.call')::uuid and status = 'confirmed') then raise exception 'FAIL: E calendar'; end if;
  insert into messages (conversation_id, sender_id, body) values (current_setting('t.conv')::uuid, auth.uid(), 'See you there');   -- group chat: no first-contact cap
  insert into messages (conversation_id, sender_id, body) values (current_setting('t.conv')::uuid, auth.uid(), 'Second');
  insert into messages (conversation_id, sender_id, body) values (current_setting('t.conv')::uuid, auth.uid(), 'Third');
  insert into messages (conversation_id, sender_id, body) values (current_setting('t.conv')::uuid, auth.uid(), 'Fourth');
  if (select count(*) from thread_members(current_setting('t.conv')::uuid)) <> 1 then raise exception 'FAIL: thread_members'; end if;
  perform withdraw_interest(current_setting('t.call')::uuid);
  if (select status from open_calls where id = current_setting('t.call')::uuid) <> 'open' then raise exception 'FAIL: slot not freed'; end if;
  if exists (select 1 from thread_info(current_setting('t.conv')::uuid)) then raise exception 'FAIL: withdrawn person still in group'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin   -- the call is open again; D is still 'interested'. Withdraw then re-apply while it is open.
  perform withdraw_interest(current_setting('t.call')::uuid);
  if express_interest(current_setting('t.call')::uuid) <> 'interested' then raise exception 'FAIL: re-apply after withdraw'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform decide_participant(current_setting('t.call')::uuid, '00000000-0000-0000-0000-00000000000d', false);
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  begin perform express_interest(current_setting('t.call')::uuid); raise exception 'FAIL: rejected person re-applied';
  exception when sqlstate '42501' then null; end;
  perform withdraw_interest(current_setting('t.call')::uuid);   -- a rejection stays a rejection
end $$;
reset role;
do $$ begin
  if (select status from open_call_participants where open_call_id = current_setting('t.call')::uuid and user_id = '00000000-0000-0000-0000-00000000000d') <> 'rejected' then raise exception 'FAIL: rejection was undone'; end if;
  if (select count(*) from notifications where origin = 'db' and kind = 'open_call_interest') < 2 then raise exception 'FAIL: host not notified of interest'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform update_open_call(current_setting('t.call')::uuid, jsonb_build_object('title', 'Coffee tonight (updated)'));
  perform cancel_open_call(current_setting('t.call')::uuid);
  if (select status from open_calls where id = current_setting('t.call')::uuid) <> 'cancelled' then raise exception 'FAIL: cancel'; end if;
  if exists (select 1 from calendar_entries where source_type = 'open_call' and source_id = current_setting('t.call')::uuid and status <> 'cancelled') then raise exception 'FAIL: calendar not cancelled'; end if;
  -- Activities
  perform create_activity(jsonb_build_object('category','bowling','title','Bowling night','area_label','Pune','starts_at', now() + interval '3 days','capacity',3));
  begin perform create_activity(jsonb_build_object('category','nightclub','title','Nope','area_label','Pune','starts_at', now() + interval '3 days')); raise exception 'FAIL: unknown category accepted';
  exception when sqlstate '22023' then null; end;
  begin insert into events (kind, host_id, category, title, starts_at) values ('activity', auth.uid(), 'bowling', 'Direct', now() + interval '3 days'); raise exception 'FAIL: direct events insert';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('t.act', (select id::text from events where title = 'Bowling night'), true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin if join_activity(current_setting('t.act')::uuid) <> 'accepted' then raise exception 'FAIL: E join'; end if; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin if join_activity(current_setting('t.act')::uuid) <> 'accepted' then raise exception 'FAIL: D join'; end if; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin begin perform join_activity(current_setting('t.act')::uuid); raise exception 'FAIL: blocked person joined activity'; exception when sqlstate '42501' then null; end; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$ begin   -- capacity 3 = host + 2: the third person waits
  if join_activity(current_setting('t.act')::uuid) <> 'waitlisted' then raise exception 'FAIL: waitlist'; end if;
  if exists (select 1 from activity_people(current_setting('t.act')::uuid)) then raise exception 'FAIL: waitlisted person sees attendees'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if (select count(*) from activity_people(current_setting('t.act')::uuid)) <> 2 then raise exception 'FAIL: attendees list (host and D expected)'; end if;
  if (select going from activities_feed(null, 'joined') where id = current_setting('t.act')::uuid) <> 3 then raise exception 'FAIL: going count'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin perform leave_activity(current_setting('t.act')::uuid); end $$;   -- frees a place: C is promoted
reset role;
do $$ begin
  if (select status from event_participants where event_id = current_setting('t.act')::uuid and user_id = '00000000-0000-0000-0000-00000000000c') <> 'accepted' then raise exception 'FAIL: waitlist promotion'; end if;
  if not exists (select 1 from notifications where origin = 'db' and kind = 'activity_update' and user_id = '00000000-0000-0000-0000-00000000000c') then raise exception 'FAIL: promoted person not notified'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform cancel_activity(current_setting('t.act')::uuid);
  if exists (select 1 from calendar_entries where source_type = 'event' and source_id = current_setting('t.act')::uuid and status <> 'cancelled') then raise exception 'FAIL: activity calendar not cancelled'; end if;
end $$;
reset role;


-- =====================================================================================================
-- Wingperson, Double Dates, Roulette, Circles, games, plans, couples (migration 0009)
-- =====================================================================================================
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','g@test.local'), ('00000000-0000-0000-0000-0000000000a2','h@test.local');
insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete) values ('00000000-0000-0000-0000-0000000000a1','User G', date '1995-05-05','f','Pune',true), ('00000000-0000-0000-0000-0000000000a2','User H', date '1995-05-05','f','Pune',true);
insert into user_active_modes (user_id, mode_id) values ('00000000-0000-0000-0000-0000000000a1','serious_dating'), ('00000000-0000-0000-0000-0000000000a2','serious_dating');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin perform my_friend_code(); end $$;
reset role;
select set_config('t.codeE', (select friend_code from profiles where id = '00000000-0000-0000-0000-00000000000e'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin perform my_friend_code(); end $$;
reset role;
select set_config('t.codeD', (select friend_code from profiles where id = '00000000-0000-0000-0000-00000000000d'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ begin perform my_friend_code(); end $$;
reset role;
select set_config('t.codeH', (select friend_code from profiles where id = '00000000-0000-0000-0000-0000000000a2'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin perform my_friend_code(); end $$;
reset role;
select set_config('t.codeG', (select friend_code from profiles where id = '00000000-0000-0000-0000-0000000000a1'), true);

-- ---- Wingperson
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare gid uuid; begin
  begin perform invite_wingperson('NOSUCHCODE', array['view_shared_profile']); raise exception 'FAIL: unknown friend code accepted';
  exception when sqlstate '42501' then null; end;
  gid := invite_wingperson(current_setting('t.codeE'), array['view_shared_profile']);
  if gid is null then raise exception 'FAIL: invite_wingperson'; end if;
  begin insert into wingperson_grants (owner_id, wing_id, permissions, status) values (auth.uid(), '00000000-0000-0000-0000-00000000000d', array['shortlist'], 'active'); raise exception 'FAIL: direct grant insert';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('t.grant', (select id::text from wingperson_grants where owner_id = '00000000-0000-0000-0000-00000000000a' and wing_id = '00000000-0000-0000-0000-00000000000e'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ declare n_upd int; v jsonb; begin
  perform respond_wing_invite(current_setting('t.grant')::uuid, true);
  v := wing_owner_view(current_setting('t.grant')::uuid, 'serious_dating');
  if v is null or v->>'display_name' is null then raise exception 'FAIL: wing cannot see the shared profile'; end if;
  begin perform wing_suggest(current_setting('t.grant')::uuid, 'activity', jsonb_build_object('event_id', gen_random_uuid())); raise exception 'FAIL: suggestion without permission';
  exception when sqlstate '42501' then null; end;
  perform wing_suggest(current_setting('t.grant')::uuid, 'profile_text', jsonb_build_object('mode_id', 'serious_dating', 'headline', 'Warm and curious'));
  if exists (select 1 from messages where sender_id = '00000000-0000-0000-0000-00000000000a' and conversation_id not in (select conversation_id from conversation_members where user_id = auth.uid())) then raise exception 'FAIL: wing can read the owner''s chats'; end if;
  update wingperson_grants set permissions = array['view_shared_profile','suggest_profiles','join_double_date'];
  get diagnostics n_upd = row_count;
  if n_upd <> 0 then raise exception 'FAIL: wing widened own permissions'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare sid uuid; begin
  select id into sid from my_wing_suggestions() limit 1;
  if sid is null then raise exception 'FAIL: owner sees no suggestion'; end if;
  perform resolve_wing_suggestion(sid, true);
  if (select headline from mode_specific_profiles where user_id = auth.uid() and mode_id = 'serious_dating') is distinct from 'Warm and curious' then raise exception 'FAIL: accepted suggestion not applied'; end if;
  perform revoke_wing(current_setting('t.grant')::uuid);
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if wing_owner_view(current_setting('t.grant')::uuid, 'serious_dating') is not null then raise exception 'FAIL: revoked wing still sees profile'; end if;
end $$;
reset role;

-- ---- Teams and Double Dates
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare t1 uuid; begin
  t1 := create_team('friends', 'D and E'); perform invite_to_team(t1, current_setting('t.codeE'));
  begin insert into teams (kind, created_by) values ('friends', auth.uid()); raise exception 'FAIL: direct team insert';
  exception when sqlstate '42501' then null; end;
  begin perform post_double_date(create_team('singles', 'solo'), 'serious_dating', now() + interval '3 days', 'x'); raise exception 'FAIL: double date without a pair';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('t.t1', (select id::text from teams where created_by = '00000000-0000-0000-0000-00000000000d' and name = 'D and E'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin perform respond_team_invite(current_setting('t.t1')::uuid, true); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ declare t2 uuid; begin t2 := create_team('friends', 'G and H'); perform invite_to_team(t2, current_setting('t.codeH')); end $$;
reset role;
select set_config('t.t2', (select id::text from teams where created_by = '00000000-0000-0000-0000-0000000000a1'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ begin perform respond_team_invite(current_setting('t.t2')::uuid, true); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare dd uuid; begin dd := post_double_date(current_setting('t.t1')::uuid, 'serious_dating', now() + interval '3 days', 'Cafe X'); end $$;
reset role;
select set_config('t.dd', (select id::text from double_dates where created_by = '00000000-0000-0000-0000-00000000000d'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from double_dates_feed('serious_dating') where id = current_setting('t.dd')::uuid and can_request) then raise exception 'FAIL: double date not in the other pair''s feed'; end if;
  perform request_double_date(current_setting('t.dd')::uuid, current_setting('t.t2')::uuid);
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin perform respond_double_date(current_setting('t.dd')::uuid, true); end $$;
reset role;
do $$ begin
  if (select state from double_dates where id = current_setting('t.dd')::uuid) <> 'scheduled' then raise exception 'FAIL: double date not scheduled'; end if;
  if (select count(*) from calendar_entries where source_type = 'double_date' and source_id = current_setting('t.dd')::uuid and status = 'confirmed') <> 4 then raise exception 'FAIL: double date calendars'; end if;
  if (select count(*) from conversation_members where conversation_id = (select conversation_id from double_dates where id = current_setting('t.dd')::uuid)) <> 4 then raise exception 'FAIL: double date chat members'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin perform cancel_double_date(current_setting('t.dd')::uuid); end $$;
reset role;
do $$ begin if exists (select 1 from calendar_entries where source_type = 'double_date' and source_id = current_setting('t.dd')::uuid and status <> 'cancelled') then raise exception 'FAIL: double date calendar not cancelled'; end if; end $$;

-- ---- Social Roulette
select set_config('t.slot', (now() + interval '3 days')::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin perform join_roulette(jsonb_build_object('mode_id','serious_dating','activity','Dinner','slot_start', current_setting('t.slot'),'energy','social','group_size',4,'area_label','Pune')); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin perform join_roulette(jsonb_build_object('mode_id','serious_dating','activity','Dinner','slot_start', current_setting('t.slot'),'energy','social','group_size',4,'area_label','Pune')); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin perform join_roulette(jsonb_build_object('mode_id','serious_dating','activity','Dinner','slot_start', current_setting('t.slot'),'energy','social','group_size',4,'area_label','Pune')); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ begin perform join_roulette(jsonb_build_object('mode_id','serious_dating','activity','Dinner','slot_start', current_setting('t.slot'),'energy','social','group_size',4,'area_label','Pune')); end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  begin insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label) values (auth.uid(), 'serious_dating', 'x', now() + interval '2 days', 'chill', 4, 'Pune'); raise exception 'FAIL: direct roulette insert';
  exception when sqlstate '42501' then null; end;
  begin perform join_roulette(jsonb_build_object('mode_id','serious_dating','activity','Dinner','slot_start', current_setting('t.slot'),'energy','social','group_size',4,'area_label','Pune')); raise exception 'FAIL: duplicate signup';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('t.rg', form_roulette_group(array['00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2']::uuid[], array(select id from roulette_signups where user_id in ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2') and activity = 'dinner'), 'serious_dating', 'dinner', current_setting('t.slot')::timestamptz)::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  if (select count(*) from my_roulette() where status = 'grouped' and conversation_id is not null and is_host and cardinality(members) = 3) <> 1 then raise exception 'FAIL: my_roulette for the host'; end if;
  perform set_roulette_venue(current_setting('t.rg')::uuid, 'Cafe X');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin begin perform set_roulette_venue(current_setting('t.rg')::uuid, 'My flat'); raise exception 'FAIL: non-host set the venue'; exception when sqlstate '42501' then null; end; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ declare sid uuid; begin
  select signup_id into sid from my_roulette() limit 1; perform cancel_roulette(sid);
  if exists (select 1 from conversation_members where conversation_id = (select conversation_id from roulette_groups where id = current_setting('t.rg')::uuid) and user_id = auth.uid()) then raise exception 'FAIL: cancelled member still in the group chat'; end if;
end $$;
reset role;

-- ---- Circles
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare c1 uuid; c2 uuid; begin
  c1 := create_circle(jsonb_build_object('name','Trek club','visibility','public')); c2 := create_circle(jsonb_build_object('name','Book club','visibility','request_to_join'));
  begin insert into circles (owner_id, name) values (auth.uid(), 'Direct'); raise exception 'FAIL: direct circle insert'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('t.c1', (select id::text from circles where name = 'Trek club'), true), set_config('t.c2', (select id::text from circles where name = 'Book club'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin if join_circle(current_setting('t.c1')::uuid) <> 'active' then raise exception 'FAIL: public circle join'; end if; end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  if join_circle(current_setting('t.c2')::uuid) <> 'requested' then raise exception 'FAIL: request to join'; end if;
  if exists (select 1 from circle_people(current_setting('t.c2')::uuid)) then raise exception 'FAIL: requester can list members'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform decide_circle_member(current_setting('t.c2')::uuid, '00000000-0000-0000-0000-00000000000d', true);
  if (select count(*) from circle_people(current_setting('t.c2')::uuid)) <> 2 then raise exception 'FAIL: circle people'; end if;
  perform remove_circle_member(current_setting('t.c2')::uuid, '00000000-0000-0000-0000-00000000000d');
  perform post_circle_event(current_setting('t.c1')::uuid, jsonb_build_object('title','Sunday trek','area_label','Sinhagad','starts_at', now() + interval '4 days'));
end $$;
reset role;
select set_config('t.cevent', (select id::text from events where title = 'Sunday trek'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  begin perform join_circle(current_setting('t.c2')::uuid); raise exception 'FAIL: removed member rejoined'; exception when sqlstate '42501' then null; end;
  begin perform join_activity(current_setting('t.cevent')::uuid); raise exception 'FAIL: non-member joined a circle event'; exception when sqlstate '42501' then null; end;
  if exists (select 1 from circle_events(current_setting('t.c1')::uuid)) then raise exception 'FAIL: non-member sees circle events'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if join_activity(current_setting('t.cevent')::uuid) <> 'accepted' then raise exception 'FAIL: member joined circle event'; end if;
  if (select count(*) from circle_events(current_setting('t.c1')::uuid)) <> 1 then raise exception 'FAIL: circle events'; end if;
end $$;
reset role;

-- ---- Chemistry games (answers stay hidden until you have answered)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare sid uuid; begin
  sid := start_game('00000000-0000-0000-0000-0000000000c1', 'rapid_fire');
  begin perform start_game('00000000-0000-0000-0000-0000000000c1', 'finish_sentence'); raise exception 'FAIL: two games at once'; exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('t.game', (select id::text from chemistry_sessions where created_by = '00000000-0000-0000-0000-00000000000a'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin perform respond_game(current_setting('t.game')::uuid, true); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform submit_answer(current_setting('t.game')::uuid, 0, '"hello"'::jsonb);
  begin insert into chemistry_responses (session_id, user_id, round, answer) values (current_setting('t.game')::uuid, auth.uid(), 1, '"direct"'::jsonb); raise exception 'FAIL: direct answer insert'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  if (select count(*) from chemistry_responses where session_id = current_setting('t.game')::uuid) <> 0 then raise exception 'FAIL: answers visible before answering'; end if;
  perform submit_answer(current_setting('t.game')::uuid, 0, '"hi"'::jsonb);
  if (select count(*) from chemistry_responses where session_id = current_setting('t.game')::uuid) <> 2 then raise exception 'FAIL: answers hidden after answering'; end if;
end $$;
reset role;

-- ---- Date plan and Together
insert into conversation_invites (id, sender_id, recipient_id, mode_id, format, state, starts_at, timezone, duration_minutes, expires_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'serious_dating', 'virtual_coffee', 'accepted', now() + interval '2 days', 'UTC', 20, now() + interval '2 days');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare pid uuid; begin
  pid := create_date_plan('00000000-0000-0000-0000-0000000000f1', 'Coffee plan');
  if pid is distinct from create_date_plan('00000000-0000-0000-0000-0000000000f1', 'again') then raise exception 'FAIL: plan not idempotent'; end if;
  perform create_couple_link(current_setting('t.codeD'));
  begin insert into couple_links (partner_a, partner_b, a_link) values (least(auth.uid(), '00000000-0000-0000-0000-00000000000e'::uuid), greatest(auth.uid(), '00000000-0000-0000-0000-00000000000e'::uuid), true); raise exception 'FAIL: direct couple link insert'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  if (select count(*) from date_plans) <> 1 then raise exception 'FAIL: partner cannot see the plan'; end if;
  if (select count(*) from my_couple() where partner_id = '00000000-0000-0000-0000-00000000000a') <> 1 then raise exception 'FAIL: partner cannot see the link'; end if;
end $$;
reset role;

-- =====================================================================================================
-- Moderation, appeals, deletion, export, trusted contacts (migration 0010)
-- =====================================================================================================
insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000d', 'moderator') on conflict (user_id) do update set role = 'moderator';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  insert into reports (reporter_id, reported_user_id, content_type, content_id, reason) values (auth.uid(), '00000000-0000-0000-0000-00000000000e', 'profile', '00000000-0000-0000-0000-00000000000e', 'test report');
  begin perform mod_queue(); raise exception 'FAIL: a normal user used the moderator queue'; exception when sqlstate '42501' then null; end;
  begin insert into moderation_actions (moderator_id, action) values (auth.uid(), 'ban'); raise exception 'FAIL: direct moderation insert'; exception when sqlstate '42501' then null; end;
  perform add_trusted_contact(current_setting('t.codeD'), 'Sis');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare rid uuid; begin
  select report_id into rid from mod_queue() limit 1;
  if rid is null then raise exception 'FAIL: moderator sees no report'; end if;
  perform mod_take_action(rid, '00000000-0000-0000-0000-00000000000e', 'warn', 'first warning');
  begin perform mod_take_action(null, '00000000-0000-0000-0000-00000000000e', 'ban', 'x'); raise exception 'FAIL: non-admin banned'; exception when sqlstate '42501' then null; end;
  perform mod_take_action(null, '00000000-0000-0000-0000-00000000000e', 'suspend', 'cooling off', 7);
  if (select count(*) from my_trusted_contacts() where direction = 'for_me') <> 1 then raise exception 'FAIL: trusted contact cannot see being listed'; end if;
end $$;
reset role;
do $$ begin
  if (select status from reports where reason = 'test report') <> 'actioned' then raise exception 'FAIL: report not closed'; end if;
  if (select state from profiles where id = '00000000-0000-0000-0000-00000000000e') <> 'suspended' then raise exception 'FAIL: suspend did not apply'; end if;
  if lift_expired_suspensions() <> 0 then raise exception 'FAIL: a running suspension was lifted'; end if;
  if not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000e' and kind = 'moderation_notice' and origin = 'db') then raise exception 'FAIL: no notice'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ declare n int; begin
  perform submit_appeal('I believe this was a misunderstanding, please review it.');
  begin perform submit_appeal('A second appeal while one is open, please.'); raise exception 'FAIL: two open appeals'; exception when sqlstate '22023' then null; end;
  begin insert into appeals (user_id, message) values (auth.uid(), 'direct'); raise exception 'FAIL: direct appeal insert'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare aid uuid; begin
  select appeal_id into aid from mod_appeals_queue() limit 1;
  if aid is null then raise exception 'FAIL: appeal not in queue'; end if;
  perform mod_resolve_appeal(aid, true);
end $$;
reset role;
do $$ begin if (select state from profiles where id = '00000000-0000-0000-0000-00000000000e') <> 'active' then raise exception 'FAIL: overturned appeal did not restore'; end if; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin
  perform request_deletion();
end $$;
reset role;
do $$ begin
  if (select state from profiles where id = '00000000-0000-0000-0000-0000000000a1') <> 'deleted' then raise exception 'FAIL: deletion did not hide the account'; end if;
  if (select count(*) from data_requests where user_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'deletion' and status = 'queued') <> 1 then raise exception 'FAIL: deletion request'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin if not cancel_deletion() then raise exception 'FAIL: cancel_deletion'; end if; end $$;
reset role;
do $$ begin if (select state from profiles where id = '00000000-0000-0000-0000-0000000000a1') <> 'active' then raise exception 'FAIL: cancel did not restore'; end if; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ begin perform pause_account(); end $$;
reset role;
do $$ begin if (select state from profiles where id = '00000000-0000-0000-0000-0000000000a2') <> 'paused' then raise exception 'FAIL: pause'; end if; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$ begin perform resume_account(); perform request_export(); begin perform request_export(); raise exception 'FAIL: two exports a day'; exception when sqlstate 'SQ429' then null; end; end $$;
reset role;
do $$ declare j jsonb; begin
  j := export_user_data('00000000-0000-0000-0000-00000000000a');
  if j->'profile' is null or (j->'profile') ? 'friend_code' or (j->'profile') ? 'approx_location' then raise exception 'FAIL: export content'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare cid uuid; begin
  select id into cid from my_trusted_contacts() where direction = 'mine' limit 1;
  perform confirm_checkin(schedule_checkin('event', current_setting('t.cevent')::uuid, now() + interval '1 day', cid), false);
end $$;
reset role;
do $$ begin if not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000d' and kind = 'checkin_help' and origin = 'db') then raise exception 'FAIL: trusted contact not told'; end if; end $$;
reset role;
-- =====================================================================================================
-- Migration 0011: safety tables are function-only; guarded roulette formation; check-in reassurance
-- =====================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare n int; begin
  -- a client cannot forge a finished export that points at someone else's file, nor any export row at all
  begin insert into data_requests (user_id, kind, status, result_path) values (auth.uid(), 'export', 'done', '00000000-0000-0000-0000-00000000000b/x.json'); raise exception 'FAIL: forged export row';
  exception when sqlstate '42501' then null; end;
  -- nor read the table directly (my_data_requests is the way)
  begin perform 1 from data_requests; raise exception 'FAIL: data_requests readable';
  exception when sqlstate '42501' then null; end;
  -- a client cannot name an arbitrary user as a trusted contact (it must go through a friend code)
  begin insert into trusted_contacts (user_id, label, contact_user_id) values (auth.uid(), 'x', '00000000-0000-0000-0000-00000000000c'); raise exception 'FAIL: direct trusted contact';
  exception when sqlstate '42501' then null; end;
  begin insert into meeting_checkins (user_id, source_type, source_id, check_in_at) values (auth.uid(), 'event', gen_random_uuid(), now()); raise exception 'FAIL: direct check-in';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;
do $$ begin
  -- the database also refuses an export path outside its owner's folder, even for the service role
  begin insert into data_requests (user_id, kind, status, result_path) values ('00000000-0000-0000-0000-00000000000a', 'export', 'done', '00000000-0000-0000-0000-00000000000b/x.json'); raise exception 'FAIL: path constraint';
  exception when check_violation then null; end;
end $$;

-- A person reported "missed" can still say they are fine, and their trusted contact is told.
do $$ declare cid uuid; tc uuid; begin
  select id into tc from trusted_contacts where user_id = '00000000-0000-0000-0000-00000000000a' limit 1;
  insert into meeting_checkins (user_id, source_type, source_id, trusted_contact_id, check_in_at, status, prompted_at)
  values ('00000000-0000-0000-0000-00000000000a', 'event', current_setting('t.cevent')::uuid, tc, now() - interval '2 hours', 'missed', now() - interval '90 minutes') returning id into cid;
  perform set_config('t.missed', cid::text, true);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin perform confirm_checkin(current_setting('t.missed')::uuid, true); end $$;
reset role;
do $$ begin
  if (select status from meeting_checkins where id = current_setting('t.missed')::uuid) <> 'confirmed_safe' then raise exception 'FAIL: missed check-in could not be confirmed'; end if;
  if not exists (select 1 from notifications where kind = 'checkin_safe' and origin = 'db' and user_id = '00000000-0000-0000-0000-00000000000d') then raise exception 'FAIL: contact not told the friend is safe'; end if;
end $$;

-- Roulette: form_roulette_group refuses stale signups and blocked pairs, and seats valid ones
do $$ declare s1 uuid; s2 uuid; g uuid; slot timestamptz := date_trunc('hour', now() + interval '2 days'); begin
  insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label) values ('00000000-0000-0000-0000-00000000000a', 'serious_dating', 'dinner', slot, 'social', 2, 'soho') returning id into s1;
  insert into roulette_signups (user_id, mode_id, activity, slot_start, energy, group_size, area_label) values ('00000000-0000-0000-0000-00000000000d', 'serious_dating', 'dinner', slot, 'social', 2, 'soho') returning id into s2;
  -- someone cancelled in between: refused, nothing created
  update roulette_signups set status = 'cancelled' where id = s2;
  if form_roulette_group(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d']::uuid[], array[s1, s2], 'serious_dating', 'dinner', slot) is not null then raise exception 'FAIL: formed a table with a cancelled signup'; end if;
  if exists (select 1 from roulette_groups where activity = 'dinner' and slot_start = slot) then raise exception 'FAIL: group row left behind'; end if;
  update roulette_signups set status = 'waiting' where id = s2;
  -- a suspended person is not seated
  update profiles set state = 'suspended' where id = '00000000-0000-0000-0000-00000000000d';
  if form_roulette_group(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d']::uuid[], array[s1, s2], 'serious_dating', 'dinner', slot) is not null then raise exception 'FAIL: seated a suspended person'; end if;
  update profiles set state = 'active' where id = '00000000-0000-0000-0000-00000000000d';
  -- duplicated member, or mismatched lists
  if form_roulette_group(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a']::uuid[], array[s1, s1], 'serious_dating', 'dinner', slot) is not null then raise exception 'FAIL: duplicate member seated'; end if;
  -- valid: seated, grouped, calendar entries made
  g := form_roulette_group(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d']::uuid[], array[s1, s2], 'serious_dating', 'dinner', slot);
  if g is null then raise exception 'FAIL: valid table refused'; end if;
  if (select count(*) from roulette_signups where id in (s1, s2) and status = 'grouped') <> 2 then raise exception 'FAIL: signups not grouped'; end if;
  if (select count(*) from calendar_entries where source_type = 'roulette' and source_id = g) <> 2 then raise exception 'FAIL: calendar entries'; end if;
  -- the same signups cannot be seated twice
  if form_roulette_group(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d']::uuid[], array[s1, s2], 'serious_dating', 'dinner', slot) is not null then raise exception 'FAIL: seated twice'; end if;
end $$;
do $$ begin
  -- clients cannot call the service-only function
  set local role authenticated;
  begin perform form_roulette_group(array[]::uuid[], array[]::uuid[], 'serious_dating', 'x', now()); raise exception 'FAIL: client called form_roulette_group';
  exception when sqlstate '42501' then null; end;
  reset role;
end $$;
-- the exports bucket exists and is private
do $$ begin if not exists (select 1 from storage.buckets where id = 'exports' and not public) then raise exception 'FAIL: exports bucket'; end if; end $$;
-- a moderator's own account can be deleted (their past decisions stay, with the name detached)
do $$ begin
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ab', 'mod2@test.local');
  insert into moderation_actions (moderator_id, target_user_id, action) values ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000000e', 'warn');
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000ab';
  if not exists (select 1 from moderation_actions where moderator_id is null and notes is null and action = 'warn') then raise exception 'FAIL: moderation history lost or blocked deletion'; end if;
end $$;

-- =====================================================================================================
-- Migration 0012: moderator context, photo review queue, audit trail
-- =====================================================================================================
do $$ declare cid uuid; mid uuid; rid uuid; begin
  insert into conversations (kind, mode_id) values ('direct', 'friendship') returning id into cid;
  insert into messages (conversation_id, sender_id, body, created_at) values (cid, '00000000-0000-0000-0000-00000000000a', 'hello there', now() - interval '5 minutes');
  insert into messages (conversation_id, sender_id, body, created_at) values (cid, '00000000-0000-0000-0000-00000000000e', 'something rude <img src=x onerror=alert(1)>', now() - interval '4 minutes') returning id into mid;
  insert into messages (conversation_id, sender_id, body, created_at) values (cid, '00000000-0000-0000-0000-00000000000a', 'please stop', now() - interval '3 minutes');
  insert into reports (reporter_id, reported_user_id, content_type, content_id, reason) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e', 'message', mid, 'harassment') returning id into rid;
  perform set_config('t.msgreport', rid::text, true);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  begin perform mod_report_context(current_setting('t.msgreport')::uuid); raise exception 'FAIL: normal user read report context'; exception when sqlstate '42501' then null; end;
  begin perform * from mod_photo_queue(); raise exception 'FAIL: normal user read photo queue'; exception when sqlstate '42501' then null; end;
  begin perform mod_review_photo(gen_random_uuid(), true); raise exception 'FAIL: normal user reviewed a photo'; exception when sqlstate '42501' then null; end;
  begin perform 1 from moderator_audit; raise exception 'FAIL: audit readable by clients'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare ctx jsonb; pid uuid; pid2 uuid; begin
  ctx := mod_report_context(current_setting('t.msgreport')::uuid);
  if jsonb_array_length(ctx->'content'->'messages') <> 3 then raise exception 'FAIL: message window size %', jsonb_array_length(ctx->'content'->'messages'); end if;
  if (select count(*) from jsonb_array_elements(ctx->'content'->'messages') m where (m->>'is_reported')::boolean) <> 1 then raise exception 'FAIL: reported message not flagged'; end if;
  if ctx::text like '%Person%' and ctx::text like '%00000000-0000-0000-0000-00000000000a%' then raise exception 'FAIL: other party identified'; end if;
  if (ctx->'reported'->>'id') <> '00000000-0000-0000-0000-00000000000e' then raise exception 'FAIL: reported person missing'; end if;
  -- photo review: the pending photo is queued, rejecting records the decision, a second review of the same photo is refused
  select photo_id into pid from mod_photo_queue() limit 1;
  if pid is null then raise exception 'FAIL: pending photo not in queue'; end if;
  perform mod_review_photo(pid, false, 'not a clear face photo');
  begin perform mod_review_photo(pid, true); raise exception 'FAIL: reviewed a photo twice'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from moderator_audit where kind = 'opened_report' and subject_id = current_setting('t.msgreport')::uuid and moderator_id = '00000000-0000-0000-0000-00000000000d') then raise exception 'FAIL: opening a report left no trace'; end if;
  if not exists (select 1 from moderator_audit where kind = 'photo_rejected') then raise exception 'FAIL: photo decision not audited'; end if;
  if not exists (select 1 from moderation_actions where action = 'remove_content' and notes = 'not a clear face photo') then raise exception 'FAIL: rejection not recorded as an action'; end if;
  if not public.is_moderator('00000000-0000-0000-0000-00000000000d') or public.is_moderator('00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: is_moderator'; end if;
end $$;

-- =====================================================================================================
-- Migration 0013: blocked list with names, and Together consent from both sides
-- =====================================================================================================
do $$ declare lid uuid; begin
  delete from couple_links; delete from blocks;
  insert into couple_links (partner_a, partner_b, a_link) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000e', true) returning id into lid;
  perform set_config('t.couple', lid::text, true);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ declare c record; begin
  -- the invited partner can now say yes, sharing only what they choose; the other side is untouched
  perform set_couple_consent(current_setting('t.couple')::uuid, true, true, false);
  select * into c from my_couple();
  if not (c.b_link and c.b_shared_profile and not c.b_discovery and c.a_link and not c.a_shared_profile) then raise exception 'FAIL: invited partner could not consent / other side changed'; end if;
  -- withdrawing switches all of this person's sharing off at once
  perform set_couple_consent(current_setting('t.couple')::uuid, false, true, true);
  select * into c from my_couple();
  if c.b_link or c.b_shared_profile or c.b_discovery then raise exception 'FAIL: withdrawing left sharing on'; end if;
  -- sharing without their own link consent is impossible
  perform set_couple_consent(current_setting('t.couple')::uuid, false, true, true);
  select * into c from my_couple(); if c.b_shared_profile then raise exception 'FAIL: shared without linking'; end if;
  perform set_couple_consent(current_setting('t.couple')::uuid, true, false, false, true);
  if not (select paused from my_couple()) then raise exception 'FAIL: pause'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin
  begin perform set_couple_consent(current_setting('t.couple')::uuid, true, true, true); raise exception 'FAIL: a stranger changed someone else''s couple'; exception when sqlstate '42501' then null; end;
  -- blocked list: names are visible to the blocker (even though the blocked profile is otherwise hidden), and only my own blocks
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000e');
  if (select count(*) from my_blocks() where display_name is not null) <> 1 then raise exception 'FAIL: blocked list'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin if (select count(*) from my_blocks()) <> 0 then raise exception 'FAIL: blocked person sees the blocker''s list'; end if; end $$;
reset role;

-- =====================================================================================================
-- Migration 0014: not every vibe has every feature (enforced by the database)
-- =====================================================================================================
reset role;
delete from public.mode_features; insert into public.mode_features select * from real_mode_features;   -- the real matrix is back from here on
do $$ declare cf uuid; ch uuid; begin
  update profiles set state = 'active' where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e');
  insert into user_active_modes (user_id, mode_id) values ('00000000-0000-0000-0000-00000000000a', 'hookups'), ('00000000-0000-0000-0000-00000000000a', 'friendship'), ('00000000-0000-0000-0000-00000000000e', 'hookups'), ('00000000-0000-0000-0000-00000000000e', 'friendship') on conflict do nothing;
  delete from blocks;
  insert into conversations (kind, mode_id) values ('direct', 'friendship') returning id into cf;
  insert into conversation_members (conversation_id, user_id) values (cf, '00000000-0000-0000-0000-00000000000a'), (cf, '00000000-0000-0000-0000-00000000000e');
  insert into conversations (kind, mode_id) values ('direct', 'hookups') returning id into ch;
  insert into conversation_members (conversation_id, user_id) values (ch, '00000000-0000-0000-0000-00000000000a'), (ch, '00000000-0000-0000-0000-00000000000e');
  perform set_config('t.conv_friend', cf::text, true); perform set_config('t.conv_hook', ch::text, true);
  if (select count(*) from mode_features) <> 25 then raise exception 'FAIL: mode feature rows'; end if;
  if not (mode_has('friendship', 'roulette') and not mode_has('hookups', 'roulette') and not mode_has('adventures', 'double_dates') and mode_has('experimentation', 'games')) then raise exception 'FAIL: mode_has'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare slot timestamptz := date_trunc('hour', now() + interval '3 days'); r uuid; begin
  begin perform join_roulette(jsonb_build_object('mode_id','hookups','activity','dinner','slot_start',slot,'group_size',4,'energy','social','area_label','soho')); raise exception 'FAIL: roulette in hookups'; exception when sqlstate '42501' then null; end;
  r := join_roulette(jsonb_build_object('mode_id','friendship','activity','dinner','slot_start',slot,'group_size',4,'energy','social','area_label','soho'));
  if r is null then raise exception 'FAIL: roulette in friendship refused'; end if;
  begin perform create_open_call(jsonb_build_object('mode_id','hookups','title','Drinks','area_label','soho','starts_at', now() + interval '2 days')); raise exception 'FAIL: open call in hookups'; exception when sqlstate '42501' then null; end;
  begin perform post_double_date(gen_random_uuid(), 'hookups', now() + interval '3 days', null); raise exception 'FAIL: double date in hookups'; exception when sqlstate '42501' then null; end;
  begin perform start_game(current_setting('t.conv_hook')::uuid, 'would_you_rather'); raise exception 'FAIL: game in hookups'; exception when sqlstate '42501' then null; end;
  if start_game(current_setting('t.conv_friend')::uuid, 'would_you_rather') is null then raise exception 'FAIL: game in friendship refused'; end if;
end $$;
reset role;

-- =====================================================================================================
-- Migration 0015: trust you can see
-- =====================================================================================================
do $$ begin
  delete from photo_verifications; delete from profile_photos where user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e');
  insert into profile_photos (user_id, storage_path, moderation_status, visible_modes, position) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a' || '/ver.jpg', 'approved', array['friendship'], 0);
  insert into profile_photos (user_id, storage_path, moderation_status, visible_modes, position, rejection_reason) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a' || '/bad.jpg', 'rejected', array['friendship'], 1, 'Not a photo of you');
  insert into profile_photos (user_id, storage_path, moderation_status, visible_modes, position) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a' || '/wait.jpg', 'pending', array['friendship'], 2);
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare v jsonb; v2 jsonb; pending_id uuid; begin
  v := start_verification(); v2 := start_verification();
  if v->>'id' <> v2->>'id' or (v->>'pose') is null then raise exception 'FAIL: starting twice should return the same challenge'; end if;
  begin perform submit_verification((v->>'id')::uuid, '00000000-0000-0000-0000-00000000000b' || '/stolen.jpg'); raise exception 'FAIL: submitted a path in someone else''s folder'; exception when sqlstate '42501' then null; end;
  perform submit_verification((v->>'id')::uuid, '00000000-0000-0000-0000-00000000000a' || '/' || (v->>'id') || '.jpg');
  begin perform start_verification(); raise exception 'FAIL: could start while pending'; exception when sqlstate '22023' then null; end;
  if (my_verification()->'latest'->>'status') <> 'pending' or (my_verification()->>'verified')::boolean then raise exception 'FAIL: my_verification while pending'; end if;
  begin update profiles set verified_at = now() where id = auth.uid(); raise exception 'FAIL: wrote my own verified badge'; exception when sqlstate '42501' then null; end;
  if (select count(*) from my_photo_issues() where reason = 'Not a photo of you' and status = 'rejected') <> 1 or (select count(*) from my_photo_issues() where status = 'pending') <> 1 then raise exception 'FAIL: my_photo_issues'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin
  begin perform * from mod_verification_queue(); raise exception 'FAIL: normal user read verification queue'; exception when sqlstate '42501' then null; end;
  begin perform mod_review_verification(gen_random_uuid(), true); raise exception 'FAIL: normal user approved'; exception when sqlstate '42501' then null; end;
  begin perform 1 from photo_verifications; raise exception 'FAIL: verification table readable'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare q record; c jsonb; begin
  select * into q from mod_verification_queue() limit 1;
  if q.verification_id is null or q.approved_photos < 1 or q.pose is null then raise exception 'FAIL: moderator queue'; end if;
  c := mod_verification_context(q.verification_id);
  if jsonb_array_length(c->'photo_ids') < 1 or (c->>'pose') is null then raise exception 'FAIL: moderator context'; end if;
  begin perform mod_review_verification(q.verification_id, false, ' '); raise exception 'FAIL: rejected without a reason'; exception when sqlstate '22023' then null; end;
  perform mod_review_verification(q.verification_id, false, 'The pose was not shown');
  begin perform mod_review_verification(q.verification_id, true); raise exception 'FAIL: decided twice'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare v jsonb; begin
  if (my_verification()->'latest'->>'status') <> 'rejected' or (my_verification()->'latest'->>'reject_reason') <> 'The pose was not shown' then raise exception 'FAIL: user cannot see why it was rejected'; end if;
  v := start_verification();
  perform submit_verification((v->>'id')::uuid, '00000000-0000-0000-0000-00000000000a' || '/' || (v->>'id') || '.jpg');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ declare q record; begin
  select * into q from mod_verification_queue() limit 1;
  perform mod_review_verification(q.verification_id, true);
end $$;
reset role;
do $$ begin
  if (select verified_at from profiles where id = '00000000-0000-0000-0000-00000000000a') is null then raise exception 'FAIL: approval did not set the badge'; end if;
  if not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'verification_result' and (payload->>'approved')::boolean) then raise exception 'FAIL: user not told'; end if;
  if (select count(*) from moderator_audit where kind in ('verification_approved', 'verification_rejected')) <> 2 then raise exception 'FAIL: verification decisions not audited'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from verified_flags(array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']::uuid[]) f where f = '00000000-0000-0000-0000-00000000000a') then raise exception 'FAIL: verified flag not shown'; end if;
  if exists (select 1 from verified_flags(array['00000000-0000-0000-0000-00000000000b']::uuid[])) then raise exception 'FAIL: unverified shown as verified'; end if;
end $$;
reset role;
-- chat trust: facts about the other person, including copy-paste messaging to several people
do $$ declare c1 uuid := current_setting('t.conv_friend')::uuid; c2 uuid; c3 uuid; c4 uuid; begin
  insert into conversations (kind, mode_id) values ('direct', 'friendship') returning id into c2; insert into conversation_members values (c2, '00000000-0000-0000-0000-00000000000e'), (c2, '00000000-0000-0000-0000-00000000000b');
  insert into conversations (kind, mode_id) values ('direct', 'friendship') returning id into c3; insert into conversation_members values (c3, '00000000-0000-0000-0000-00000000000e'), (c3, '00000000-0000-0000-0000-00000000000c');
  insert into conversations (kind, mode_id) values ('direct', 'friendship') returning id into c4; insert into conversation_members values (c4, '00000000-0000-0000-0000-00000000000e'), (c4, '00000000-0000-0000-0000-00000000000d');
  insert into messages (conversation_id, sender_id, body) select x, '00000000-0000-0000-0000-00000000000e', 'Hey beautiful, I am new here, can we chat on another app?' from unnest(array[c1, c2, c3, c4]) x;
  insert into messages (conversation_id, sender_id, body) values (c1, '00000000-0000-0000-0000-00000000000e', 'short');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare t jsonb; begin
  t := chat_trust(current_setting('t.conv_friend')::uuid);
  if (t->>'repeated_message_to')::int <> 4 or (t->>'verified')::boolean or (t->>'account_age_days')::int > 1 then raise exception 'FAIL: chat_trust facts: %', t; end if;
  begin perform chat_trust(gen_random_uuid()); raise exception 'FAIL: chat_trust on a stranger conversation'; exception when sqlstate '42501' then null; end;
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000e');
  begin perform chat_trust(current_setting('t.conv_friend')::uuid); raise exception 'FAIL: chat_trust through a block'; exception when sqlstate '42501' then null; end;
end $$;
reset role;
delete from blocks;

-- =====================================================================================================
-- Migration 0018: in-person plans and Date Ideas
-- =====================================================================================================
reset role;
do $$ declare s1 uuid := '00000000-0000-0000-0000-00000000000a'; r1 uuid := '00000000-0000-0000-0000-00000000000e'; begin
  -- an in-person plan must name an activity, a place and an area (database constraint, in addition to the API)
  begin
    insert into conversation_invites (sender_id, recipient_id, mode_id, format, starts_at, timezone, duration_minutes, expires_at)
    values (s1, r1, 'friendship', 'in_person', now() + interval '2 days', 'Asia/Kolkata', 60, now() + interval '2 days');
    raise exception 'FAIL: in-person plan without a place was stored';
  exception when check_violation then null; end;
  insert into conversation_invites (sender_id, recipient_id, mode_id, format, starts_at, timezone, duration_minutes, expires_at, activity, venue_name, area_label)
  values (s1, r1, 'friendship', 'in_person', now() + interval '2 days', 'Asia/Kolkata', 60, now() + interval '2 days', 'chai_coffee', 'Blue Tokai', 'Khan Market');
  begin
    insert into conversation_invites (sender_id, recipient_id, mode_id, format, starts_at, timezone, duration_minutes, expires_at, activity, venue_name, area_label)
    values (s1, r1, 'friendship', 'in_person', now() + interval '2 days', 'Asia/Kolkata', 60, now() + interval '2 days', 'x', 'Blue Tokai', 'Khan Market');
    raise exception 'FAIL: one-character activity stored';
  exception when check_violation then null; end;
  delete from conversation_invites where format::text = 'in_person';
end $$;

-- Date Ideas: written only through the function, validated, and seen only through the profile rules
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin
  perform set_date_ideas(array['walk', 'chai_coffee', 'walk'], 'weekends');
  if (select ideas from my_date_ideas()) <> array['walk', 'chai_coffee'] then raise exception 'FAIL: ideas not de-duplicated in order: %', (select ideas from my_date_ideas()); end if;
  begin perform set_date_ideas(array['walk', 'chai_coffee', 'movie', 'meal'], null); raise exception 'FAIL: four ideas accepted'; exception when sqlstate '22023' then null; end;
  begin perform set_date_ideas(array['skydiving'], null); raise exception 'FAIL: unknown idea accepted'; exception when sqlstate '22023' then null; end;
  begin perform set_date_ideas(array['walk'], 'midnight'); raise exception 'FAIL: unknown window accepted'; exception when sqlstate '22023' then null; end;
  if (select ideas from my_date_ideas()) <> array['walk', 'chai_coffee'] then raise exception 'FAIL: a refused write changed the ideas'; end if;
  begin insert into date_ideas (user_id, ideas) values ('00000000-0000-0000-0000-00000000000e', '{walk}') on conflict (user_id) do update set ideas = '{movie}'; raise exception 'FAIL: direct write to date_ideas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare e uuid := '00000000-0000-0000-0000-00000000000e'; begin
  if (select count(*) from date_ideas) <> 0 then raise exception 'FAIL: another person''s Date Ideas readable from the table'; end if;
  if not exists (select 1 from date_ideas_for(array[e], 'friendship') d where d.ideas = array['walk', 'chai_coffee'] and d.free_window = 'weekends') then raise exception 'FAIL: Date Ideas not shown in a shared vibe'; end if;
  if exists (select 1 from date_ideas_for(array[e], 'adventures')) then raise exception 'FAIL: Date Ideas shown in a vibe the viewer is not in'; end if;
  if exists (select 1 from date_ideas_for(array[auth.uid()], 'friendship')) then raise exception 'FAIL: own row listed as someone else'; end if;
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), e);
  if exists (select 1 from date_ideas_for(array[e], 'friendship')) then raise exception 'FAIL: Date Ideas shown through a block'; end if;
end $$;
reset role;
delete from blocks;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from date_ideas_for(array['00000000-0000-0000-0000-00000000000e']::uuid[], 'friendship')) then raise exception 'FAIL: Date Ideas shown to someone who is not in that vibe'; end if;
end $$;
reset role;
do $$ declare x jsonb; begin
  x := export_user_data('00000000-0000-0000-0000-00000000000e');
  if (x->'date_ideas'->>'free_window') <> 'weekends' then raise exception 'FAIL: export misses Date Ideas: %', x->'date_ideas'; end if;
  if not (x ? 'invitations') then raise exception 'FAIL: export lost invitations'; end if;
end $$;
-- clearing both ideas and the window removes the row
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
do $$ begin perform set_date_ideas(array[]::text[], null); if exists (select 1 from my_date_ideas()) then raise exception 'FAIL: empty Date Ideas kept a row'; end if; end $$;
reset role;

-- a banned person cannot simply register again with the same email
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'banned@test.local');
insert into banned_identifiers (email_hash) values (encode(extensions.digest(lower('banned@test.local'), 'sha256'), 'hex'));
do $$ begin
  begin insert into profiles (id, display_name, date_of_birth) values ('00000000-0000-0000-0000-0000000000ee', 'Again', date '1990-01-01'); raise exception 'FAIL: banned email re-registered';
  exception when sqlstate '42501' then null; end;
end $$;

select 'ALL RLS SMOKE TESTS PASSED' as result;
rollback;
