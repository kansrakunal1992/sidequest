import { useState } from 'react';
import { useRouter } from 'expo-router';
import { isFullTeam, validateDoubleDate } from '@/core/social-core';
import { AppText, Button, Chip, EmptyState, ErrorText, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { MODES } from '@/design/theme';
import { TimePicker } from '@/features/TimePicker';
import { db } from '@/lib/db';
import { useModes } from '@/lib/modes';
import { useAction, useAsync } from '@/lib/use-async';
import { withFeature } from '@/features/NotInVibe';

function NewDoubleDate() {
  const router = useRouter();
  const { active, current } = useModes();
  const teams = useAsync(() => db.myTeams(), []);
  const mine = (teams.data ?? []).filter((t) => t.my_status === 'accepted' && t.is_creator);
  const [teamId, setTeamId] = useState<string | null>(null); const [modeId, setModeId] = useState<string | null>(current ?? null);
  const [when, setWhen] = useState<Date | null>(null); const [venue, setVenue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  async function submit() {
    const team = mine.find((t) => t.team_id === teamId) ?? null;
    const v = validateDoubleDate({ teamId, modeId, startsAt: when, venue }, team, new Date());
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    if (await run(async () => { await db.postDoubleDate(v.value.p_team, v.value.p_mode, v.value.p_starts, v.value.p_venue); })) router.back();
  }
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Post a double date</AppText>
      <AppText muted>Other pairs in the same vibe can ask to join. You both agree before anything is confirmed.</AppText>
      <Spacer />
      {teams.data && mine.length === 0 ? <EmptyState title="You need a pair first" body="A double date is two pairs. Create yours and wait for your teammate to accept." /> : null}
      {mine.length ? <><AppText variant="caption" style={{ marginBottom: 6 }}>Your pair</AppText>
        <Wrap>{mine.map((t) => <Chip key={t.team_id} label={`${t.members.map((m) => m.name).join(' + ')}${isFullTeam(t.members) ? '' : ' (waiting)'}`} selected={teamId === t.team_id} onPress={() => setTeamId(t.team_id)} />)}</Wrap>
        {errors.teamId ? <ErrorText>{errors.teamId}</ErrorText> : null}<Spacer />
        <AppText variant="caption" style={{ marginBottom: 6 }}>Which vibe</AppText>
        <Wrap>{active.map((a) => <Chip key={a.modeId} label={(MODES as Record<string, { label: string } | undefined>)[a.modeId]?.label ?? a.modeId} selected={modeId === a.modeId} onPress={() => setModeId(a.modeId)} />)}</Wrap>
        {errors.modeId ? <ErrorText>{errors.modeId}</ErrorText> : null}<Spacer />
        <AppText variant="caption" style={{ marginBottom: 6 }}>When</AppText><TimePicker value={when} onChange={setWhen} />{errors.startsAt ? <ErrorText>{errors.startsAt}</ErrorText> : null}<Spacer />
        <TextField label="Public place (optional)" value={venue} onChangeText={setVenue} maxLength={80} error={errors.venue} hint="Always a public place for a first meeting." />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label="Post" loading={busy} onPress={() => void submit()} /></> : null}
      <Spacer h={8} /><Button kind="ghost" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}
export default withFeature('double_dates', NewDoubleDate);
