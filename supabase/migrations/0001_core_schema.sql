-- SideQuest core schema (part 1 of 3). Part 2 = Wingperson/teams/couples/games/roulette/quests/safety extras.
-- Part 3 = Row Level Security policies. NOTE: RLS is enabled in part 3; do not expose this DB to clients before it is applied.
-- STATUS: written carefully but NOT yet executed against a real Postgres (no database in the authoring sandbox).

create extension if not exists postgis with schema extensions;

-- ===== Enums ==================================================================================
create type invite_state as enum ('pending','accepted','declined','reschedule_requested','rescheduled','too_new','cancelled','completed','expired');
create type invite_format as enum ('text','voice','video','virtual_coffee','intro_chat');
create type like_kind as enum ('like','spark','interest');
create type view_kind as enum ('view','photo_tap','prompt_tap');
create type availability_status as enum ('available_tonight','open_to_chat','meet_this_weekend','virtual_coffee','taking_a_break','not_available');
create type account_state as enum ('active','paused','suspended','banned','deleted');
create type app_role as enum ('user','moderator','admin');
create type conversation_kind as enum ('direct','group','open_call','circle');
create type open_call_status as enum ('open','full','cancelled','completed','expired');
create type participant_status as enum ('interested','accepted','rejected','waitlisted','withdrawn');
create type group_format as enum ('one_to_one','group');
create type meet_style as enum ('chat_first','direct_meet');
create type event_kind as enum ('activity','circle_event','meetup','roulette','double_date');
create type calendar_status as enum ('confirmed','tentative','cancelled','completed');
create type circle_visibility as enum ('public','request_to_join','private');
create type report_status as enum ('open','in_review','actioned','dismissed');

-- ===== Helpers ================================================================================
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ===== Identity ===============================================================================
create table public.intent_modes (
  id text primary key,
  label text not null,
  tagline text not null,
  romantic_allowed boolean not null,
  sort_order int not null
);
insert into public.intent_modes (id,label,tagline,romantic_allowed,sort_order) values
 ('serious_dating','Dating','Something meaningful',true,1),
 ('hookups','Hookups','No strings',true,2),
 ('friendship','Friendship','Meet awesome people',false,3),
 ('post_marital','Post-Marital','Continue the journey',true,4),
 ('experimentation','Experiment','Explore freely',true,5),
 ('adventures','Adventures','Do more together',false,6);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  date_of_birth date not null,
  gender text,
  city text,
  neighborhood text,
  -- API snaps coordinates to a ~1 km grid before writing. Exact home/work locations are never stored.
  approx_location extensions.geography(Point,4326),
  bio text check (char_length(bio) <= 600),
  interests text[] not null default '{}',
  lifestyle jsonb not null default '{}',
  conversation_prefs jsonb not null default '{}',
  voice_intro_path text,
  timezone text not null default 'UTC',
  accepts_intro_invites boolean not null default true,
  allow_light_chat_after_too_new boolean not null default true,
  incognito boolean not null default false,
  state account_state not null default 'active',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_location_idx on public.profiles using gist (approx_location);
create index profiles_interests_idx on public.profiles using gin (interests);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Strict 18+ gate at the database level (defence in depth; the API checks too).
create or replace function public.enforce_adult() returns trigger language plpgsql as $$
begin
  if new.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'SideQuest is for adults (18+) only' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger profiles_adult_only before insert or update of date_of_birth on public.profiles
  for each row execute function public.enforce_adult();

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'user'
);

create table public.verification_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age_verified boolean not null default false,
  identity_verified boolean not null default false,
  provider text,
  verified_at timestamptz
  -- Identity verification is NOT a background check; the UI must never imply otherwise.
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
  visible_modes text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index profile_photos_user_idx on public.profile_photos (user_id, position);

-- ===== Modes ==================================================================================
create table public.user_active_modes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  paused boolean not null default false,
  availability availability_status not null default 'open_to_chat',
  discoverable boolean not null default true,
  appear_in_visitor_lists boolean not null default true,
  activity_visible boolean not null default false,
  activated_at timestamptz not null default now(),
  primary key (user_id, mode_id)
);
create index user_active_modes_mode_idx on public.user_active_modes (mode_id) where not paused and discoverable;

create table public.mode_specific_profiles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  headline text check (char_length(headline) <= 120),
  bio text check (char_length(bio) <= 600),
  prompts jsonb not null default '[]',
  visible_photo_ids uuid[] not null default '{}',
  visible_fields jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, mode_id)
);

create table public.preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  seeking_genders text[] not null default '{}',
  age_min int not null default 18 check (age_min >= 18),
  age_max int not null default 99 check (age_max >= age_min),
  max_distance_km int not null default 25 check (max_distance_km > 0),
  extra jsonb not null default '{}',
  primary key (user_id, mode_id)
);

-- ===== Discovery ==============================================================================
create table public.likes (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  kind like_kind not null default 'like',
  created_at timestamptz not null default now(),
  check (from_user <> to_user),
  unique (from_user, to_user, mode_id)
);
create index likes_to_idx on public.likes (to_user, mode_id, created_at desc);

create table public.passes (
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user, mode_id)
);

create table public.profile_views (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  kind view_kind not null default 'view',
  ref text,
  -- Set server-side from the viewer's incognito setting at write time. Incognito rows must never be exposed to the viewed user.
  incognito boolean not null default false,
  created_at timestamptz not null default now(),
  check (viewer_id <> viewed_id)
);
create index profile_views_viewed_idx on public.profile_views (viewed_id, mode_id, created_at desc) where not incognito;

create table public.saved_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null
);
create table public.saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('person','open_call','event','circle')),
  target_id uuid not null,
  collection_id uuid references public.saved_collections(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  unmatched_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b, mode_id)
);
create index matches_a_idx on public.matches (user_a);
create index matches_b_idx on public.matches (user_b);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- A mutual like creates a match in that mode, unless either side blocked the other.
create or replace function public.handle_mutual_like() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.likes l where l.from_user = new.to_user and l.to_user = new.from_user and l.mode_id = new.mode_id)
     and not exists (select 1 from public.blocks b
                     where (b.blocker_id = new.from_user and b.blocked_id = new.to_user)
                        or (b.blocker_id = new.to_user and b.blocked_id = new.from_user)) then
    insert into public.matches (user_a, user_b, mode_id)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user), new.mode_id)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger likes_make_match after insert on public.likes for each row execute function public.handle_mutual_like();

-- ===== Chat ===================================================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind conversation_kind not null default 'direct',
  mode_id text references public.intent_modes(id),
  match_id uuid references public.matches(id) on delete set null,
  title text,
  created_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text check (char_length(body) <= 4000),
  media_path text,
  media_kind text check (media_kind in ('image','voice')),
  -- Sensitive media requires explicit recipient consent before it is revealed.
  media_revealed_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (body is not null or media_path is not null)
);
create index messages_conv_idx on public.messages (conversation_id, created_at desc);

-- ===== Conversation Invites ===================================================================
create table public.conversation_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  format invite_format not null,
  state invite_state not null default 'pending',
  proposed_by text check (proposed_by in ('sender','recipient')),
  starts_at timestamptz not null,
  timezone text not null,
  duration_minutes int not null check (duration_minutes between 5 and 240),
  note text check (char_length(note) <= 280),
  sequence int not null default 0,
  expires_at timestamptz not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index invites_recipient_idx on public.conversation_invites (recipient_id, state, starts_at);
create index invites_sender_idx on public.conversation_invites (sender_id, state, starts_at);
create index invites_expiry_idx on public.conversation_invites (expires_at) where state in ('pending','reschedule_requested');
create trigger invites_touch before update on public.conversation_invites for each row execute function public.touch_updated_at();

create table public.invite_time_proposals (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.conversation_invites(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 5 and 240),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index invite_proposals_invite_idx on public.invite_time_proposals (invite_id, created_at);

-- ===== Open Calls, events, calendar ===========================================================
create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text,
  visibility circle_visibility not null default 'public',
  category text,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','host','member')),
  status text not null default 'active' check (status in ('active','requested','invited','removed')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index circle_members_user_idx on public.circle_members (user_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  kind event_kind not null default 'activity',
  host_id uuid references public.profiles(id) on delete set null,
  circle_id uuid references public.circles(id) on delete cascade,
  category text not null,
  title text not null check (char_length(title) between 2 and 120),
  description text,
  area_label text,
  approx_location extensions.geography(Point,4326),
  public_venue_name text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity int check (capacity is null or capacity >= 2),
  is_public_listing boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  created_at timestamptz not null default now()
);
create index events_start_idx on public.events (starts_at) where status = 'scheduled';
create index events_loc_idx on public.events using gist (approx_location);
create table public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status participant_status not null default 'interested',
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.open_calls (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  mode_id text not null references public.intent_modes(id),
  title text not null check (char_length(title) between 2 and 120),
  description text check (char_length(description) <= 1000),
  starts_at timestamptz not null,
  area_label text not null,
  approx_location extensions.geography(Point,4326),
  public_venue_name text,
  capacity int not null default 2 check (capacity between 2 and 50),
  format group_format not null default 'one_to_one',
  budget_note text,
  meet_style meet_style not null default 'chat_first',
  recurrence_rule text,
  status open_call_status not null default 'open',
  expires_at timestamptz not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index open_calls_feed_idx on public.open_calls (mode_id, starts_at) where status = 'open';
create index open_calls_loc_idx on public.open_calls using gist (approx_location);
create index open_calls_expiry_idx on public.open_calls (expires_at) where status in ('open','full');
create trigger open_calls_touch before update on public.open_calls for each row execute function public.touch_updated_at();
create table public.open_call_participants (
  open_call_id uuid not null references public.open_calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status participant_status not null default 'interested',
  created_at timestamptz not null default now(),
  primary key (open_call_id, user_id)
);

-- Per-user calendar projection (fast reads, one row per person per commitment).
create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('invite','open_call','event','double_date','roulette')),
  source_id uuid not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status calendar_status not null default 'confirmed',
  sequence int not null default 0,
  unique (user_id, source_type, source_id)
);
create index calendar_user_idx on public.calendar_entries (user_id, starts_at);

-- ===== Notifications ==========================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  push boolean not null default true,
  quiet_start time,
  quiet_end time,
  primary key (user_id, kind)
);
create table public.push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android','ios')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- ===== Safety and moderation ==================================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  content_type text check (content_type in ('profile','photo','message','open_call','circle','event')),
  content_id uuid,
  reason text not null,
  details text check (char_length(details) <= 2000),
  status report_status not null default 'open',
  created_at timestamptz not null default now()
);
create index reports_queue_idx on public.reports (status, created_at);
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  moderator_id uuid not null references auth.users(id),
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('warn','remove_content','suspend','ban','restore','dismiss')),
  notes text,
  until timestamptz,
  created_at timestamptz not null default now()
);
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  moderation_action_id uuid references public.moderation_actions(id) on delete set null,
  message text not null,
  status text not null default 'open' check (status in ('open','upheld','overturned')),
  created_at timestamptz not null default now()
);
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('export','deletion')),
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
