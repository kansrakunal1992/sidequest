import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CIRCLE_CATEGORIES, canCancelRoulette, circleAction, doubleDateStatus, isFullTeam, rouletteStatus, VISIBILITY_LABEL } from '@/core/social-core';
import type { DoubleDateRow, RouletteRow } from '@/core/db-types';
import { AppText, Button, Card, Chip, EmptyState, ErrorText, Pill, Row, Segmented, Spacer, TextField, Wrap } from '@/design/ui';
import { MODES } from '@/design/theme';
import { db } from '@/lib/db';
import { useModes } from '@/lib/modes';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

function Loading({ loading, error, onRetry, hasData }: { loading: boolean; error: string | null; onRetry: () => void; hasData: boolean }) {
  if (error) return <View><ErrorText>{error}</ErrorText><Spacer h={8} /><Button kind="secondary" label="Try again" onPress={onRetry} /></View>;
  if (loading && !hasData) return <AppText muted>Loading...</AppText>;
  return null;
}

// ------------------------------------------------------------------ Circles
export function CirclesPanel() {
  const router = useRouter();
  const [scope, setScope] = useState<'browse' | 'mine'>('browse');
  const [category, setCategory] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => db.circlesFeed(scope, category), [scope, category]);
  return (
    <View>
      <Button label="Start a circle" onPress={() => router.push('/circle/new' as never)} />
      <Spacer h={12} />
      <Segmented options={[{ id: 'browse', label: 'Discover' }, { id: 'mine', label: 'My circles' }]} value={scope} onChange={setScope} />
      <Spacer h={12} />
      <Wrap>{CIRCLE_CATEGORIES.map((c) => <Chip key={c.id} label={c.label} selected={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />)}</Wrap>
      <Spacer h={12} />
      <Loading loading={loading} error={error} onRetry={() => void reload()} hasData={!!data} />
      {data && data.length === 0 ? <EmptyState title={scope === 'mine' ? 'You are not in any circles yet' : 'No circles here yet'} body={scope === 'mine' ? 'Join one from Discover, or start your own.' : 'Be the first to start one for this interest.'} /> : null}
      {(data ?? []).map((c) => {
        const a = circleAction(c);
        return (
          <Card key={c.id} style={{ marginBottom: 10 }}>
            <AppText variant="title">{c.name}</AppText>
            <AppText muted variant="caption">{c.member_count} {c.member_count === 1 ? 'person' : 'people'} - {VISIBILITY_LABEL[c.visibility]}{c.owner_name ? ` - run by ${c.owner_name}` : ''}</AppText>
            {c.description ? <><Spacer h={6} /><AppText numberOfLines={3}>{c.description}</AppText></> : null}
            <Spacer h={10} />
            <Button kind={a.kind === 'join' || a.kind === 'request' ? 'primary' : 'secondary'} label={a.label} disabled={a.kind === 'none' || a.kind === 'pending'} onPress={() => router.push(`/circle/${c.id}` as never)} />
          </Card>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Social Roulette
function RouletteCard({ r, reload }: { r: RouletteRow; reload: () => void }) {
  const router = useRouter();
  const { run, busy, error } = useAction();
  const [venue, setVenue] = useState('');
  const st = rouletteStatus(r);
  const label = (MODES as Record<string, { label: string } | undefined>)[r.mode_id]?.label ?? r.mode_id;
  return (
    <Card style={{ marginBottom: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}><AppText variant="title">{r.activity}</AppText><Pill label={label} /></Row>
      <AppText muted variant="caption">{fmtWhen(r.slot_start)} - {r.area_label} - table of {r.group_size}</AppText>
      <Spacer h={6} /><AppText>{st.text}</AppText>
      {r.status === 'grouped' && r.members?.length ? <AppText muted variant="caption">At your table: {r.members.join(', ')}</AppText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer h={8} />
      {r.group_id && r.conversation_id ? <Button label="Open group chat" onPress={() => router.push(`/chat/${r.conversation_id}` as never)} /> : null}
      {r.group_id && r.is_host && !r.venue ? (
        <View><Spacer h={8} /><TextField label="Choose a public place to meet" value={venue} onChangeText={setVenue} placeholder="A cafe, restaurant or park" maxLength={80} />
          <Button kind="secondary" label="Save the place" disabled={venue.trim().length < 2} loading={busy} onPress={() => void run(async () => { await db.setRouletteVenue(r.group_id!, venue.trim()); reload(); })} /></View>) : null}
      {r.group_id && r.status === 'grouped' ? <><Spacer h={8} /><Button kind="secondary" label="I am coming" loading={busy} onPress={() => void run(async () => { await db.confirmRoulette(r.group_id!); reload(); })} /></> : null}
      {canCancelRoulette(r) ? <><Spacer h={8} /><Button kind="ghost" label="Cancel my spot" loading={busy} onPress={() => Alert.alert('Cancel your spot?', 'You will leave this table.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel my spot', style: 'destructive', onPress: () => void run(async () => { await db.cancelRoulette(r.signup_id); reload(); }) }])} /></> : null}
    </Card>
  );
}
export function RoulettePanel() {
  const router = useRouter();
  const { data, error, loading, reload } = useAsync(() => db.myRoulette(), []);
  return (
    <View>
      <Card style={{ marginBottom: 12 }}>
        <AppText variant="title">Social Roulette</AppText>
        <AppText muted>Tell us what you fancy doing, when and where. Shortly before, we seat you with a small group who want the same, in a public place, with a group chat. We never put people together who have blocked each other.</AppText>
        <Spacer h={10} /><Button label="Join a table" onPress={() => router.push('/roulette/new' as never)} />
      </Card>
      <Loading loading={loading} error={error} onRetry={() => void reload()} hasData={!!data} />
      {data && data.length === 0 ? <EmptyState title="Nothing booked" body="Join a table and we will do the matching." /> : null}
      {(data ?? []).map((r) => <RouletteCard key={r.signup_id} r={r} reload={() => void reload()} />)}
    </View>
  );
}

// ------------------------------------------------------------------ Double dates
function DoubleDateCard({ d, myTeams, reload }: { d: DoubleDateRow; myTeams: { team_id: string; name: string | null; members: { status: string }[]; is_creator: boolean }[]; reload: () => void }) {
  const router = useRouter();
  const { run, busy, error } = useAction();
  const fullTeams = myTeams.filter((t) => isFullTeam(t.members));
  return (
    <Card style={{ marginBottom: 10 }}>
      <AppText variant="title">{d.team_a_names.join(' and ')}</AppText>
      {d.team_b_names?.length ? <AppText muted>with {d.team_b_names.join(' and ')}</AppText> : null}
      <AppText muted variant="caption">{fmtWhen(d.starts_at)}{d.venue ? ` - ${d.venue}` : ''}</AppText>
      <Spacer h={6} /><Pill label={doubleDateStatus(d)} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer h={8} />
      {d.can_request ? (fullTeams.length ? <Button label={fullTeams.length === 1 ? 'Ask to join as a pair' : 'Ask to join with my first team'} loading={busy} onPress={() => void run(async () => { await db.requestDoubleDate(d.id, fullTeams[0]!.team_id); reload(); })} />
        : <Button kind="secondary" label="Set up a pair first" onPress={() => router.push('/teams' as never)} />) : null}
      {d.is_mine && d.state === 'proposed' ? <Row style={{ gap: 8 }}><View style={{ flex: 1 }}><Button label="Accept" loading={busy} onPress={() => void run(async () => { await db.respondDoubleDate(d.id, true); reload(); })} /></View><View style={{ flex: 1 }}><Button kind="secondary" label="Decline" loading={busy} onPress={() => void run(async () => { await db.respondDoubleDate(d.id, false); reload(); })} /></View></Row> : null}
      {d.is_mine && ['looking', 'proposed', 'accepted', 'scheduled'].includes(d.state) ? <><Spacer h={8} /><Button kind="ghost" label="Cancel" loading={busy} onPress={() => Alert.alert('Cancel this double date?', 'The other pair will be told.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel it', style: 'destructive', onPress: () => void run(async () => { await db.cancelDoubleDate(d.id); reload(); }) }])} /></> : null}
    </Card>
  );
}
export function DoubleDatesPanel() {
  const router = useRouter();
  const { current } = useModes();
  const [scope, setScope] = useState<'browse' | 'mine'>('browse');
  const feed = useAsync(() => (current ? db.doubleDatesFeed(current, scope) : Promise.resolve([] as DoubleDateRow[])), [current, scope]);
  const teams = useAsync(() => db.myTeams(), []);
  const myTeams = (teams.data ?? []).filter((t) => t.my_status === 'accepted');
  return (
    <View>
      <Row style={{ gap: 8 }}>
        <View style={{ flex: 1 }}><Button label="Post a double date" onPress={() => router.push('/double-date/new' as never)} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" label="My pairs" onPress={() => router.push('/teams' as never)} /></View>
      </Row>
      <Spacer h={12} />
      <Segmented options={[{ id: 'browse', label: 'Find a pair' }, { id: 'mine', label: 'Mine' }]} value={scope} onChange={setScope} />
      <Spacer h={12} />
      {!current ? <EmptyState title="Choose a vibe first" body="Double dates are matched within the vibe you are in." /> : null}
      <Loading loading={feed.loading} error={feed.error} onRetry={() => void feed.reload()} hasData={!!feed.data} />
      {current && feed.data && feed.data.length === 0 ? <EmptyState title="No double dates yet" body={scope === 'mine' ? 'Post one with a friend, or ask to join someone else.' : 'Nothing posted for this vibe right now.'} /> : null}
      {(feed.data ?? []).map((d) => <DoubleDateCard key={d.id} d={d} myTeams={myTeams} reload={() => void feed.reload()} />)}
    </View>
  );
}
