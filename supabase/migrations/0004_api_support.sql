-- SideQuest part 4: support for the Railway API and worker, plus the Likes & Visitors header counts.
-- STATUS: written but NOT yet executed against a real Postgres.

-- Notifications can be de-duplicated (reminders, one-off prompts) so reruns of jobs never double-send.
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- At most one open (pending) invite from a person to another person at a time, enforced by the database.
create unique index invites_one_pending_per_pair on public.conversation_invites (sender_id, recipient_id) where state = 'pending';

-- Counts for the Likes & Visitors header. Free, unlimited, never blurred; incognito visits excluded.
create or replace function public.likes_visitors_summary(p_mode text)
returns table (likes int, matches int, visitors int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from likes l where l.to_user = auth.uid() and l.mode_id = p_mode
        and not public.blocked_between(l.from_user, l.to_user)),
    (select count(*)::int from matches m where auth.uid() in (m.user_a, m.user_b) and m.mode_id = p_mode
        and m.unmatched_at is null and not public.blocked_between(m.user_a, m.user_b)),
    (select count(distinct v.viewer_id)::int from profile_views v where v.viewed_id = auth.uid() and v.mode_id = p_mode
        and not v.incognito and not public.blocked_between(v.viewer_id, v.viewed_id))
  where public.in_mode(auth.uid(), p_mode)
$$;
revoke execute on function public.likes_visitors_summary(text) from public, anon;
grant execute on function public.likes_visitors_summary(text) to authenticated;
