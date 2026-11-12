-- Waypoint part 19: the photo-verified badge actually shows up.
--
-- THE BUG: a passed selfie check sets profiles.verified_at (0015 / 0017, written by the API). But every screen that draws the badge
-- (Discover cards, profile view, matches, likes, visitors, chat list, open calls...) reads verification_status.identity_verified,
-- and nothing ever set that column. So a person could pass the check, see "You are photo verified", and still never get a tick
-- on their card. Only the chat trust card (which reads verified_at) was correct.
--
-- THE FIX: keep the two in step with a trigger, instead of rewriting a dozen read functions. profiles.verified_at stays the single
-- source of truth; verification_status.identity_verified follows it. Existing verified people are backfilled below.
--
-- Note on wording: "identity_verified" is an old column name. It means "a live selfie matched the profile photo" and nothing more.
-- The app says "Photo verified" and must never imply an ID or background check.
-- STATUS: written; run on a local Postgres 16 with stand-ins for Supabase (see docs/CHANGES_v18.md); not on a hosted project.

create or replace function public.sync_verified_badge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into verification_status (user_id, identity_verified, verified_at, provider)
  values (new.id, new.verified_at is not null, new.verified_at, case when new.verified_at is not null then 'selfie' else null end)
  on conflict (user_id) do update
    set identity_verified = excluded.identity_verified,
        verified_at = excluded.verified_at,
        provider = coalesce(excluded.provider, verification_status.provider);
  return new;
end $$;
revoke execute on function public.sync_verified_badge() from public, anon, authenticated;

drop trigger if exists profiles_sync_verified_badge on public.profiles;
create trigger profiles_sync_verified_badge
  after insert or update of verified_at on public.profiles
  for each row execute function public.sync_verified_badge();

-- Backfill: everyone who already passed a check gets their badge now.
insert into verification_status (user_id, identity_verified, verified_at, provider)
select p.id, true, p.verified_at, 'selfie' from profiles p where p.verified_at is not null
on conflict (user_id) do update
  set identity_verified = true, verified_at = excluded.verified_at, provider = coalesce(verification_status.provider, 'selfie');
