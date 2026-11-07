import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isFullTeam, TEAM_KINDS, teamNameOk } from '@/core/social-core';
import { isFriendCode, normalizeFriendCode } from '@/core/safety-core';
import { AppText, Button, Card, Chip, EmptyState, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { db } from '@/lib/db';
import { useAction, useAsync } from '@/lib/use-async';

export default function Teams() {
  const router = useRouter();
  const teams = useAsync(() => db.myTeams(), []);
  const { run, busy, error, setError } = useAction();
  const [kind, setKind] = useState<string>('friends'); const [name, setName] = useState('');
  const [codeFor, setCodeFor] = useState<string | null>(null); const [code, setCode] = useState('');
  const invites = (teams.data ?? []).filter((t) => t.my_status === 'invited');
  const mine = (teams.data ?? []).filter((t) => t.my_status === 'accepted');
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">My pairs</AppText>
      <AppText muted>A pair is you and one other person (a friend, your partner, or another single) going on a double date together. Both of you have to say yes.</AppText>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {teams.error ? <ErrorText>{teams.error}</ErrorText> : null}
      {invites.length ? <><AppText variant="title">Invitations</AppText>{invites.map((t) => (
        <Card key={t.team_id} style={{ marginTop: 8 }}><AppText>{t.name ?? 'A pair'}</AppText><AppText muted variant="caption">{TEAM_KINDS.find((k) => k.id === t.kind)?.label ?? t.kind}</AppText><Spacer h={8} />
          <Row style={{ gap: 8 }}><View style={{ flex: 1 }}><Button label="Accept" loading={busy} onPress={() => void run(async () => { await db.respondTeamInvite(t.team_id, true); void teams.reload(); })} /></View><View style={{ flex: 1 }}><Button kind="secondary" label="Decline" loading={busy} onPress={() => void run(async () => { await db.respondTeamInvite(t.team_id, false); void teams.reload(); })} /></View></Row></Card>))}<Spacer /></> : null}
      {mine.length === 0 && !teams.loading ? <EmptyState title="No pairs yet" body="Create one below, then invite your pair with their friend code." /> : null}
      {mine.map((t) => (
        <Card key={t.team_id} style={{ marginBottom: 10 }}>
          <AppText variant="title">{t.name ?? TEAM_KINDS.find((k) => k.id === t.kind)?.label ?? 'Pair'}</AppText>
          <AppText muted variant="caption">{t.members.map((m) => `${m.name}${m.status === 'invited' ? ' (invited)' : ''}`).join(' and ')}</AppText>
          <Spacer h={8} />
          {t.is_creator && !isFullTeam(t.members) && !t.members.some((m) => m.status === 'invited') ? (codeFor === t.team_id ? (
            <View><TextField label="Their friend code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={12} placeholder="ABCD 1234" />
              <Button label="Send invitation" loading={busy} disabled={!isFriendCode(code)} onPress={() => void run(async () => { await db.inviteToTeam(t.team_id, normalizeFriendCode(code)); setCode(''); setCodeFor(null); void teams.reload(); })} /></View>
          ) : <Button kind="secondary" label="Invite my pair" onPress={() => setCodeFor(t.team_id)} />) : null}
          {isFullTeam(t.members) ? <Button label="Plan a double date" onPress={() => router.push('/double-date/new' as never)} /> : null}
          <Spacer h={8} /><Button kind="ghost" label="Leave this pair" onPress={() => Alert.alert('Leave this pair?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void run(async () => { await db.leaveTeam(t.team_id); void teams.reload(); }) }])} />
        </Card>
      ))}
      <Spacer />
      <AppText variant="title">Create a pair</AppText>
      <Spacer h={8} />
      <Wrap>{TEAM_KINDS.map((k) => <Chip key={k.id} label={k.label} selected={kind === k.id} onPress={() => setKind(k.id)} />)}</Wrap>
      <TextField label="Name (optional)" value={name} onChangeText={setName} maxLength={60} />
      <Button label="Create" loading={busy} disabled={!teamNameOk(name)} onPress={() => { setError(null); void run(async () => { await db.createTeam(kind, name.trim()); setName(''); void teams.reload(); }); }} />
    </Screen>
  );
}
