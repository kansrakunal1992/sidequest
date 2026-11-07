-- SideQuest part 7: chat. Conversations from matches, inbox and thread helpers, realtime, and anti-harassment guards.
-- Guards, not just reports: a stranger cannot flood someone, and the person being contacted is never put under pressure.
-- STATUS: written but NOT yet executed against a real Postgres. supabase/tests/rls_smoke.sql covers it.

-- Realtime: new messages and read receipts stream to members (row level security still decides who receives what).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end $$;

-- Read receipts can be switched off by the reader.
alter table public.profiles add column read_receipts boolean not null default true;
grant update (read_receipts) on public.profiles to authenticated;

create unique index conversations_match_unique on public.conversations (match_id) where match_id is not null;

-- ===== Open (or reuse) the conversation for a match =====================================================
create or replace function public.ensure_match_conversation(p_match uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m matches%rowtype; cid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from matches where id = p_match and unmatched_at is null and uid in (user_a, user_b);
  if not found or not public.account_ok() or public.blocked_between(m.user_a, m.user_b)
     or not public.in_mode(m.user_a, m.mode_id) or not public.in_mode(m.user_b, m.mode_id) then
    raise exception 'unavailable' using errcode = '42501';
  end if;
  select id into cid from conversations where match_id = p_match limit 1;
  if cid is null then
    begin
      insert into conversations (kind, mode_id, match_id) values ('direct', m.mode_id, p_match) returning id into cid;
      insert into conversation_members (conversation_id, user_id) values (cid, m.user_a), (cid, m.user_b);
    exception when unique_violation then
      select id into cid from conversations where match_id = p_match limit 1;   -- lost a race with the other person
    end;
  end if;
  return cid;
end $$;

-- ===== Inbox: one row per conversation in this vibe, newest first ========================================
create or replace function public.my_conversations(p_mode text)
returns table (conversation_id uuid, user_id uuid, display_name text, age int, verified boolean, last_body text,
               last_media_kind text, last_at timestamptz, last_from_me boolean, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, o.id, o.display_name, date_part('year', age(o.date_of_birth))::int, coalesce(v.identity_verified, false),
         lm.body, lm.media_kind, coalesce(lm.created_at, c.created_at), (lm.sender_id = auth.uid()),
         (select count(*)::int from messages x where x.conversation_id = c.id and x.sender_id <> auth.uid()
             and x.deleted_at is null and x.created_at > me.last_read_at)
    from conversation_members me
    join conversations c on c.id = me.conversation_id and c.kind = 'direct' and c.mode_id = p_mode
    join conversation_members om on om.conversation_id = c.id and om.user_id <> auth.uid()
    join profiles o on o.id = om.user_id and o.state = 'active'
    left join verification_status v on v.user_id = o.id
    left join lateral (select m.body, m.media_kind, m.created_at, m.sender_id from messages m
                        where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) lm on true
   where me.user_id = auth.uid() and public.in_mode(auth.uid(), p_mode) and public.in_mode(o.id, p_mode)
     and not public.blocked_between(auth.uid(), o.id)
   order by coalesce(lm.created_at, c.created_at) desc $$;

-- ===== Header and starters for one conversation ===========================================================
-- other_last_read_at is only shared if the other person has read receipts switched on.
create or replace function public.conversation_info(p_conv uuid)
returns table (user_id uuid, display_name text, age int, verified boolean, mode_id text, shared_interests text[],
               other_last_read_at timestamptz, my_last_read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.display_name, date_part('year', age(o.date_of_birth))::int, coalesce(v.identity_verified, false), c.mode_id,
         array(select unnest(o.interests) intersect select unnest(mp.interests)),
         case when o.read_receipts then om.last_read_at end, me.last_read_at
    from conversations c
    join conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
    join conversation_members om on om.conversation_id = c.id and om.user_id <> auth.uid()
    join profiles o on o.id = om.user_id and o.state = 'active'
    join profiles mp on mp.id = auth.uid()
    left join verification_status v on v.user_id = o.id
   where c.id = p_conv and not public.blocked_between(auth.uid(), o.id) $$;

-- Names for the people on your invitations (and nobody else).
create or replace function public.invite_counterparts(p_ids uuid[])
returns table (user_id uuid, display_name text, age int, verified boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, date_part('year', age(p.date_of_birth))::int, coalesce(v.identity_verified, false)
    from profiles p left join verification_status v on v.user_id = p.id
   where p.id = any (p_ids) and p.state = 'active' and not public.blocked_between(auth.uid(), p.id)
     and exists (select 1 from conversation_invites i
                  where (i.sender_id = auth.uid() and i.recipient_id = p.id) or (i.recipient_id = auth.uid() and i.sender_id = p.id)) $$;

revoke execute on function public.ensure_match_conversation(uuid), public.my_conversations(text),
  public.conversation_info(uuid), public.invite_counterparts(uuid[]) from public, anon;
grant execute on function public.ensure_match_conversation(uuid), public.my_conversations(text),
  public.conversation_info(uuid), public.invite_counterparts(uuid[]) to authenticated;

-- ===== Anti-harassment guards on sending ==========================================================================
--  1. Nobody can send more than 30 messages a minute (SQ429).
--  2. Until the other person has replied, a sender can send at most 3 messages in that conversation (SQ430).
--     This stops a match from being flooded and keeps first contact respectful. A single reply lifts the limit.
create or replace function public.messages_insert_guard() returns trigger language plpgsql as $$
declare other_replied boolean; mine int;
begin
  if auth.uid() is null then return new; end if;   -- service role (system messages)
  if (select count(*) from public.messages m where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'slow_down' using errcode = 'SQ429';
  end if;
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.kind = 'direct') then
    select exists (select 1 from public.messages m where m.conversation_id = new.conversation_id and m.sender_id <> new.sender_id) into other_replied;
    if not other_replied then
      select count(*) into mine from public.messages m where m.conversation_id = new.conversation_id and m.sender_id = new.sender_id;
      if mine >= 3 then raise exception 'wait_for_reply' using errcode = 'SQ430'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger messages_insert_guard_trg before insert on public.messages for each row execute function public.messages_insert_guard();

-- ===== Read receipts really are optional ===========================================================================
-- Without this, the other person's "last read" time could be read straight from conversation_members even after they
-- switched receipts off. Members may now only see each other's row when that person has receipts on.
create or replace function public.read_receipts_on(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_receipts from profiles where id = u), false) $$;
revoke execute on function public.read_receipts_on(uuid) from public, anon;
grant execute on function public.read_receipts_on(uuid) to authenticated;

drop policy conv_members_select on public.conversation_members;
create policy conv_members_select on public.conversation_members for select to authenticated
  using (user_id = auth.uid() or (public.is_conversation_member(conversation_id) and public.read_receipts_on(user_id)));
