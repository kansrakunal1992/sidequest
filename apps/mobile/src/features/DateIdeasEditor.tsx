import { useEffect, useState } from 'react';
import { MEET_ACTIVITIES, FREE_WINDOWS, DATE_IDEA_LIMIT } from '@sidequest/shared';
import type { FreeWindowId, MeetActivityId } from '@sidequest/shared';
import { EMPTY_IDEAS, isFull, mapDateIdeas, toggleIdea } from '@/core/date-ideas';
import { spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Spacer, Wrap } from '@/design/ui';
import { db } from '@/lib/db';

/** Up to three things you would enjoy doing, and when you are usually free. Shown on your profile so a plan is easy to suggest. */
export function DateIdeasEditor() {
  const [ideas, setIdeas] = useState<MeetActivityId[]>(EMPTY_IDEAS.ideas);
  const [win, setWin] = useState<FreeWindowId | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    db.myDateIdeas().then((r) => { if (!alive) return; const d = mapDateIdeas(r); setIdeas(d.ideas); setWin(d.freeWindow); setState('ready'); })
      .catch(() => { if (alive) setState('unavailable'); });   // function missing (migration 0018 not run yet): the section just stays out of the way
    return () => { alive = false; };
  }, []);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try { await db.setDateIdeas(ideas, win); setMsg('Saved'); setTimeout(() => setMsg(null), 2500); }
    catch { setErr('That did not save. Please try again.'); } finally { setBusy(false); }
  }
  if (state === 'unavailable') return null;
  return (
    <Card>
      <AppText variant="title">Date ideas</AppText>
      <AppText variant="caption">Pick up to {DATE_IDEA_LIMIT} things you would enjoy. People you match with can tap one to suggest a plan. Skip this if you would rather not.</AppText>
      <Spacer h={spacing.md} />
      <Wrap>{MEET_ACTIVITIES.map((a) => {
        const on = ideas.includes(a.id);
        return <Chip key={a.id} label={a.label} selected={on} onPress={() => { if (!on && isFull(ideas)) { setErr(`You can pick up to ${DATE_IDEA_LIMIT}. Tap one to swap it out.`); return; } setErr(null); setIdeas(toggleIdea(ideas, a.id)); }} />;
      })}</Wrap>
      <Spacer h={spacing.md} />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Usually free</AppText>
      <Wrap>{FREE_WINDOWS.map((w) => <Chip key={w.id} label={w.label} selected={win === w.id} onPress={() => setWin(win === w.id ? null : w.id)} />)}</Wrap>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {msg ? <AppText variant="caption">{msg}</AppText> : null}
      <Spacer /><Button label="Save date ideas" onPress={save} loading={busy || state === 'loading'} />
    </Card>
  );
}
