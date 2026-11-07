-- SideQuest part 13: functions the app screens need that 0009/0010 did not provide.
-- STATUS: run on a local Postgres 16 with stand-ins for Supabase (docs/LOCAL_POSTGRES.md); not on a hosted project.

-- The blocked list. A person cannot read the profile of someone they blocked (hidden both ways), so the names come from here.
create or replace function public.my_blocks() returns table (user_id uuid, display_name text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, p.display_name, b.created_at from blocks b left join profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid() order by b.created_at desc $$;

-- Together (couples). Until now the invited partner had no way to say yes (create_couple_link returns the existing row without touching their side),
-- and nobody could change sharing afterwards. Each person only ever changes THEIR OWN side; sharing needs their own link consent;
-- withdrawing switches all of their sharing off at once. Either partner can pause.
create or replace function public.set_couple_consent(p_couple uuid, p_link boolean, p_shared_profile boolean, p_discovery boolean, p_paused boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare l couple_links%rowtype; uid uuid := auth.uid();
begin
  select * into l from couple_links where id = p_couple and unlinked_at is null and uid in (partner_a, partner_b) for update;
  if not found or public.blocked_between(l.partner_a, l.partner_b) or not public.account_ok() then raise exception 'unavailable' using errcode = '42501'; end if;
  if l.partner_a = uid then
    update couple_links set a_link = p_link, a_shared_profile = p_link and p_shared_profile, a_discovery = p_link and p_discovery, a_withdrawn = not p_link,
           paused = coalesce(p_paused, paused) where id = p_couple;
  else
    update couple_links set b_link = p_link, b_shared_profile = p_link and p_shared_profile, b_discovery = p_link and p_discovery, b_withdrawn = not p_link,
           paused = coalesce(p_paused, paused) where id = p_couple;
  end if;
end $$;

revoke execute on function public.my_blocks(), public.set_couple_consent(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.my_blocks(), public.set_couple_consent(uuid, boolean, boolean, boolean, boolean) to authenticated;
