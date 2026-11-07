import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { GAME_LABELS, GAME_ROUNDS } from '@sidequest/shared';
import type { GameKind } from '@sidequest/shared';
import { answerValid, buildAnswer, gameView, isGameKind, partnerProgress } from '@/core/game-core';
import type { GamePlayerRow, GameResponseRow, GameSessionRow } from '@/core/db-types';
import { AppText, Button, Card, Chip, ErrorText, ProgressBar, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { db } from '@/lib/db';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useAction, useAsync } from '@/lib/use-async';

export default function Game() {
  const { id } = useLocalSearchParams<{ id: string; conversationId?: string }>();
  const router = useRouter();
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const g = useAsync(async () => {
    const [s, p, r] = await Promise.all([
      supabase.from('chemistry_sessions').select('id, kind, state, created_by, conversation_id').eq('id', id!).maybeSingle(),
      supabase.from('chemistry_players').select('user_id, accepted').eq('session_id', id!),
      supabase.from('chemistry_responses').select('user_id, round, answer').eq('session_id', id!),
    ]);
    if (s.error) throw s.error;
    return { session: (s.data as GameSessionRow | null), players: (p.data ?? []) as GamePlayerRow[], responses: (r.data ?? []) as GameResponseRow[] };
  }, [id]);
  const { run, busy, error } = useAction();
  const [choice, setChoice] = useState<number | undefined>(undefined); const [text, setText] = useState('');
  const reload = g.reload;
  const phase = g.data?.session ? gameView(g.data.session, g.data.players, g.data.responses, me).phase : null;
  useEffect(() => { if (phase === 'finished' || phase === 'declined' || phase === 'unknown' || !phase) return; const t = setInterval(() => void reload(), 5000); return () => clearInterval(t); }, [phase, reload]);

  if (!g.data?.session) return <Screen><AppText muted>{g.loading ? 'Loading...' : g.error ?? 'This game is not available.'}</AppText><Spacer /><Button kind="secondary" label="Back" onPress={() => router.back()} /></Screen>;
  const s = g.data.session;
  const v = gameView(s, g.data.players, g.data.responses, me);
  const label = isGameKind(s.kind) ? GAME_LABELS[s.kind as GameKind].title : 'Game';
  const current = v.rounds[v.round];
  const submit = () => current && run(async () => { await db.submitAnswer(s.id, v.round, buildAnswer(current, current.choices ? { choice } : { text })); setChoice(undefined); setText(''); await g.reload(); });
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">{label}</AppText>
      <Spacer h={8} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {v.phase === 'respond' ? <Card><AppText>You have been invited to play.</AppText><Spacer h={8} /><View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button label="Play" loading={busy} onPress={() => void run(async () => { await db.respondGame(s.id, true); await g.reload(); })} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" label="Not now" loading={busy} onPress={() => void run(async () => { await db.respondGame(s.id, false); router.back(); })} /></View></View></Card> : null}
      {v.phase === 'waiting_accept' ? <Card><AppText>Waiting for them to accept.</AppText></Card> : null}
      {v.phase === 'declined' ? <Card><AppText>They did not want to play this time.</AppText></Card> : null}
      {v.phase === 'unknown' ? <Card><AppText>This game needs a newer version of SideQuest.</AppText></Card> : null}
      {v.phase === 'play' && current ? (
        <Card>
          <ProgressBar step={v.round + 1} total={GAME_ROUNDS} />
          <Spacer h={12} /><AppText variant="title">{current.prompt}</AppText><Spacer h={10} />
          {current.choices ? <Wrap>{current.choices.map((c, i) => <Chip key={c} label={c} selected={choice === i} onPress={() => setChoice(i)} />)}</Wrap> : <TextField label="Your answer" value={text} onChangeText={setText} maxLength={200} />}
          <Spacer h={10} /><Button label={v.round + 1 === GAME_ROUNDS ? 'Finish' : 'Next'} loading={busy} disabled={!answerValid(current, current.choices ? { choice } : { text })} onPress={() => void submit()} />
          <AppText muted variant="caption">Their answer appears after you answer.</AppText>
        </Card>) : null}
      {v.phase === 'waiting_partner' ? <Card><AppText>You are done. Waiting for them to finish ({Math.min(partnerProgress(g.data.responses, me), GAME_ROUNDS)} of {GAME_ROUNDS} answered).</AppText></Card> : null}
      {v.revealed.length ? <><Spacer /><AppText variant="title">{v.phase === 'finished' ? 'Results' : 'So far'}</AppText>
        {v.matches !== null && v.compared > 0 ? <AppText muted>You matched on {v.matches} of {v.compared}.</AppText> : null}
        {v.revealed.map((r) => (
          <Card key={r.round} style={{ marginTop: 8 }}><AppText muted variant="caption">{r.prompt}</AppText>
            <AppText>You: {r.mine}</AppText><AppText>{r.theirs === null ? 'Them: waiting...' : `Them: ${r.theirs}`}</AppText></Card>))}</> : null}
      <Spacer /><Button kind="ghost" label="Back to chat" onPress={() => (s.conversation_id ? router.replace(`/chat/${s.conversation_id}` as never) : router.back())} />
    </Screen>
  );
}
