-- SideQuest part 2 of 3: Wingperson, teams/double dates, couples, chemistry games, Roulette,
-- quests/passport, date planner, private post-meet safety, trusted contacts, connection timeline.
-- STATUS: written but NOT yet executed against a real Postgres.

-- ===== Wingperson =============================================================================
create table public.wingperson_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  wing_id uuid not null references public.profiles(id) on delete cascade,
  permissions text[] not null default '{}'
    check (permissions <@ array['view_shared_profile','suggest_profiles','suggest_openers','shortlist','co_host_open_call','join_double_date']),
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (owner_id <> wing_id),
  unique (owner_id, wing_id)
);
create index wing_grants_wing_idx on public.wingperson_grants (wing_id) where status = 'active';
-- There is intentionally NO permission for chats: wingpersons can never read or send messages as the owner.

create table public.wing_suggestions (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.wingperson_grants(id) on delete cascade,
  kind text not null check (kind in ('person','opener','open_call')),
  suggested_user_id uuid references public.profiles(id) on delete cascade,
  suggested_open_call_id uuid references public.open_calls(id) on delete cascade,
  note text check (char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at timestamptz not null default now()
);
create index wing_suggestions_grant_idx on public.wing_suggestions (grant_id, status);

-- ===== Teams and double dates =================================================================
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('friends','couple','singles')),
  name text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','accepted','left')),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

create table public.double_dates (
  id uuid primary key default gen_random_uuid(),
  team_a uuid not null references public.teams(id) on delete cascade,
  team_b uuid references public.teams(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  state text not null default 'looking' check (state in ('looking','proposed','accepted','declined','scheduled','completed','cancelled')),
  starts_at timestamptz,
  public_venue_name text,
  conversation_id uuid references public.conversations(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (team_b is null or team_a <> team_b)
);
create index double_dates_open_idx on public.double_dates (mode_id, created_at) where state = 'looking';

-- ===== Linked couples: each partner consents independently ====================================
create table public.couple_links (
  id uuid primary key default gen_random_uuid(),
  partner_a uuid not null references public.profiles(id) on delete cascade,
  partner_b uuid not null references public.profiles(id) on delete cascade,
  a_link boolean not null default false,
  a_shared_profile boolean not null default false,
  a_discovery boolean not null default false,
  a_withdrawn boolean not null default false,
  b_link boolean not null default false,
  b_shared_profile boolean not null default false,
  b_discovery boolean not null default false,
  b_withdrawn boolean not null default false,
  paused boolean not null default false,
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  check (partner_a < partner_b),
  unique (partner_a, partner_b)
);
create table public.couple_profiles (
  couple_id uuid primary key references public.couple_links(id) on delete cascade,
  display_name text,
  bio text check (char_length(bio) <= 600),
  photo_paths text[] not null default '{}',
  seeking jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Each partner may change only their own consent columns. Either may pause or unlink.
-- Unlinking never deletes either individual account.
create or replace function public.couple_consent_guard() returns trigger language plpgsql as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if; -- service role / migrations
  if uid = old.partner_a then
    if (new.b_link, new.b_shared_profile, new.b_discovery, new.b_withdrawn) is distinct from
       (old.b_link, old.b_shared_profile, old.b_discovery, old.b_withdrawn) then
      raise exception 'You can only change your own consent' using errcode = '42501';
    end if;
  elsif uid = old.partner_b then
    if (new.a_link, new.a_shared_profile, new.a_discovery, new.a_withdrawn) is distinct from
       (old.a_link, old.a_shared_profile, old.a_discovery, old.a_withdrawn) then
      raise exception 'You can only change your own consent' using errcode = '42501';
    end if;
  else
    raise exception 'Not a partner in this link' using errcode = '42501';
  end if;
  if new.partner_a <> old.partner_a or new.partner_b <> old.partner_b then
    raise exception 'Partners cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger couple_links_guard before update on public.couple_links for each row execute function public.couple_consent_guard();

-- ===== Chemistry games ========================================================================
create table public.chemistry_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('two_truths','would_you_rather','guess_my_answer','rapid_fire','finish_sentence','compatibility')),
  mode_id text not null references public.intent_modes(id),
  state text not null default 'invited' check (state in ('invited','active','finished','declined','cancelled')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.chemistry_players (
  session_id uuid not null references public.chemistry_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  accepted boolean not null default false,
  primary key (session_id, user_id)
);
create index chemistry_players_user_idx on public.chemistry_players (user_id);
create table public.chemistry_responses (
  session_id uuid not null references public.chemistry_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round int not null check (round >= 0),
  answer jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id, round)
);

-- ===== Social Roulette ========================================================================
create table public.roulette_signups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  activity text not null,
  slot_start timestamptz not null,
  energy text not null check (energy in ('chill','flirty','adventurous','social')),
  group_size int not null check (group_size between 2 and 8),
  area_label text not null,
  status text not null default 'waiting' check (status in ('waiting','grouped','waitlisted','cancelled')),
  created_at timestamptz not null default now(),
  unique (user_id, mode_id, activity, slot_start)
);
create index roulette_signups_bucket_idx on public.roulette_signups (mode_id, activity, slot_start) where status in ('waiting','waitlisted');
create table public.roulette_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  public_venue_name text,
  host_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.roulette_group_members (
  group_id uuid not null references public.roulette_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  confirmed boolean not null default false,
  primary key (group_id, user_id)
);
create index roulette_members_user_idx on public.roulette_group_members (user_id);

-- ===== Quests and Passport (never grant dating visibility or ranking) =========================
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  city text,
  criteria jsonb not null default '{}',
  -- Rewards unlock experiences or badges only. Enforced by this check.
  reward_kind text not null default 'badge' check (reward_kind in ('badge','experience','community')),
  sponsor_label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.quest_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_id uuid not null references public.quests(id) on delete cascade,
  progress jsonb not null default '{}',
  completed_at timestamptz,
  primary key (user_id, quest_id)
);
create table public.passport_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('event','activity','circle','quest','roulette')),
  ref_id uuid,
  label text not null,
  created_at timestamptz not null default now()
);
create index passport_user_idx on public.passport_entries (user_id, created_at desc);

-- ===== Date planner ===========================================================================
create table public.date_plans (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  source_type text check (source_type in ('invite','match','open_call','double_date')),
  source_id uuid,
  title text not null,
  itinerary jsonb not null default '[]',
  split_note text,
  status text not null default 'planning' check (status in ('planning','agreed','done','cancelled')),
  created_at timestamptz not null default now()
);
create table public.date_plan_members (
  plan_id uuid not null references public.date_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (plan_id, user_id)
);
create index date_plan_members_user_idx on public.date_plan_members (user_id);
create table public.date_plan_votes (
  plan_id uuid not null references public.date_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_key text not null,
  vote boolean not null default true,
  primary key (plan_id, user_id, option_key)
);

-- ===== Safety extras ==========================================================================
-- Private. Never readable by the person it is about; used only for safety and moderation signals.
create table public.post_meet_feedback (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  about_user uuid not null references public.profiles(id) on delete cascade,
  source_type text check (source_type in ('invite','open_call','double_date','roulette','event')),
  source_id uuid,
  comfortable boolean,
  boundaries_respected boolean,
  showed_up boolean,
  would_interact_again boolean,
  concern text check (char_length(concern) <= 1000),
  created_at timestamptz not null default now(),
  check (from_user <> about_user)
);
create index post_meet_concern_idx on public.post_meet_feedback (created_at) where concern is not null or boundaries_respected = false;

create table public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  -- Either another SideQuest user, or an externally-delivered contact stored encrypted by the API (never plaintext).
  contact_user_id uuid references public.profiles(id) on delete cascade,
  contact_encrypted text,
  created_at timestamptz not null default now(),
  check (contact_user_id is not null or contact_encrypted is not null)
);
create table public.meeting_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('invite','open_call','double_date','roulette','event')),
  source_id uuid not null,
  trusted_contact_id uuid references public.trusted_contacts(id) on delete set null,
  check_in_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed_safe','missed','needs_help','cancelled')),
  created_at timestamptz not null default now()
);
create index checkins_due_idx on public.meeting_checkins (check_in_at) where status = 'scheduled';

-- ===== Private connection timeline (never public, never a score) ==============================
create table public.connection_stages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  other_user_id uuid not null references public.profiles(id) on delete cascade,
  stage text not null check (stage in ('discovered','interested','curious','getting_to_know','virtual_conversation','met_in_person','continuing','friendship','dating','moved_on')),
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id),
  check (user_id <> other_user_id)
);
