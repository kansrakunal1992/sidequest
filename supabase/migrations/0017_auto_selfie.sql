-- Waypoint part 17: automatic selfie verification (no human review).
-- A provider (Didit) checks that a live person is present and that their face matches the person's approved profile photo.
-- We reuse photo_verifications from 0015: one row per attempt. No selfie is ever stored by us (selfie_path stays null).
-- The API (database-owner role) writes these rows; clients cannot (0015 already revoked all client access to the table).
-- STATUS: written and checked by scripts/check-sql.mjs; not run on a hosted Supabase project.

alter table public.photo_verifications
  add column provider text,
  add column provider_session_id text,
  add column consent_at timestamptz;

-- One provider session belongs to one attempt, so a repeated webhook can never decide two attempts.
create unique index photo_verifications_provider_session on public.photo_verifications (provider_session_id) where provider_session_id is not null;
-- Attempt counting (per person and across everyone) ignores rows where the provider was never reached.
create index photo_verifications_attempts_idx on public.photo_verifications (created_at, user_id) where provider_session_id is not null;

-- The human-review queue (0015) must not show automatic attempts: they have no selfie for a moderator to look at.
create or replace function public.mod_verification_queue(p_limit int default 30)
returns table (verification_id uuid, submitted_at timestamptz, pose text, approved_photos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select v.id, v.submitted_at, v.pose, (select count(*)::int from profile_photos ph where ph.user_id = v.user_id and ph.moderation_status = 'approved')
    from photo_verifications v join profiles p on p.id = v.user_id and p.state in ('active', 'paused')
   where v.status = 'pending' and v.selfie_path is not null order by v.submitted_at limit least(greatest(p_limit, 1), 100);
end $$;
