-- Checks that the test profiles really appear in Discover. Safe: everything runs inside a transaction that is rolled back.
--   psql "$DATABASE_URL" -f scripts/seed/verify.sql
begin;
\echo '--- 1. What is in the database'
select count(*) as test_profiles,
       count(*) filter (where p.verified_at is not null) as verified_by_flag,
       (select count(*) from verification_status v join auth.users u on u.id = v.user_id where u.email like '%@seed.waypoint.test' and v.identity_verified) as verified_badge_shown
  from profiles p join auth.users u on u.id = p.id where u.email like '%@seed.waypoint.test';
select count(*) as photo_rows_approved from profile_photos pp join auth.users u on u.id = pp.user_id where u.email like '%@seed.waypoint.test' and pp.moderation_status = 'approved';

-- A tester who stands in each region's main city, open to everyone, in every vibe.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'tester@verify.local');
insert into profiles (id, display_name, date_of_birth, gender, city, onboarding_complete) values ('00000000-0000-0000-0000-0000000000f1', 'Tester', date '1996-01-01', 'woman', 'Test', true);
insert into user_active_modes (user_id, mode_id) select '00000000-0000-0000-0000-0000000000f1', id from intent_modes;
insert into preferences (user_id, mode_id, seeking_genders, age_min, age_max, max_distance_km) select '00000000-0000-0000-0000-0000000000f1', id, '{}', 18, 99, 25 from intent_modes;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);

\echo '--- 2. What a tester standing in each region sees in Discover (25 km, open to everyone)'
create temp table seen (region text, mode text, n int);
do $$ declare r record; m record; n int; begin
  for r in select regexp_replace(split_part(u.email, '@', 1), '^seed-([a-z]+)-.*$', '\1') as code, round(avg(st_y(p.approx_location::geometry))::numeric, 2) lat, round(avg(st_x(p.approx_location::geometry))::numeric, 2) lng
           from profiles p join auth.users u on u.id = p.id where u.email like '%@seed.waypoint.test' group by 1 order by 1 loop
    update profiles set approx_location = st_setsrid(st_makepoint(r.lng, r.lat), 4326)::geography where id = '00000000-0000-0000-0000-0000000000f1';
    for m in select id from intent_modes order by id loop
      select count(*) into n from discover_people(m.id, 100);
      insert into seen values (upper(r.code), m.id, n);
    end loop;
  end loop;
end $$;
select mode, min(n) as fewest_in_a_region, round(avg(n)) as average, max(n) as most from seen group by mode order by mode;
select region, n as friendship_visible from seen where mode = 'friendship' order by n limit 5;
\echo '--- 3. A tester with no location sees people from everywhere (up to 100 per page)'
update profiles set approx_location = null where id = '00000000-0000-0000-0000-0000000000f1';
select count(*) as visible_with_no_location, count(distinct area) as different_areas from discover_people('friendship', 100);
rollback;
