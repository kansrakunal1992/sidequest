import { useState } from 'react';
import { Alert } from 'react-native';
import { isFriendCode, normalizeFriendCode } from '@/core/safety-core';
import { AppText, Button, Card, ErrorText, Screen, Spacer, TextField } from '@/design/ui';
import { ToggleRow } from '@/features/SafetyBits';
import { db } from '@/lib/db';
import { useAction, useAsync } from '@/lib/use-async';
import { withFeature } from '@/features/NotInVibe';

function Together() {
  const couple = useAsync(async () => (await db.myCouple())[0] ?? null, []);
  const { run, busy, error } = useAction();
  const [code, setCode] = useState('');
  const c = couple.data;
  const mine = c ? (c.i_am_a ? { link: c.a_link, shared: c.a_shared_profile, discovery: c.a_discovery } : { link: c.b_link, shared: c.b_shared_profile, discovery: c.b_discovery }) : null;
  const theirs = c ? (c.i_am_a ? { link: c.b_link } : { link: c.a_link }) : null;
  const set = (patch: Partial<{ link: boolean; shared: boolean; discovery: boolean; paused: boolean }>) => c && mine && void run(async () => {
    const next = { ...mine, paused: c.paused, ...patch };
    await db.setCoupleConsent(c.couple_id, next.link, next.link && next.shared, next.link && next.discovery, next.paused);
    void couple.reload();
  });
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Together</AppText>
      <AppText muted>Link with your partner. Nothing is shared unless you both agree, and each of you chooses your own settings. You can switch everything off, pause, or unlink at any time.</AppText>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}{couple.error ? <ErrorText>{couple.error}</ErrorText> : null}
      {!c && !couple.loading ? (
        <Card>
          <TextField label="Your partner's friend code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={12} placeholder="ABCD 1234" />
          <Button label="Send link request" loading={busy} disabled={!isFriendCode(code)} onPress={() => void run(async () => { await db.createCoupleLink(normalizeFriendCode(code)); setCode(''); void couple.reload(); })} />
          <Spacer h={8} /><AppText muted variant="caption">If they already sent you a request, enter their code to find it.</AppText>
        </Card>) : null}
      {c && mine && theirs ? (
        <Card>
          <AppText variant="title">You and {c.partner_name}</AppText>
          <AppText muted variant="caption">{mine.link && theirs.link ? 'You are both linked.' : mine.link ? `Waiting for ${c.partner_name} to say yes.` : `${c.partner_name} asked to link. Switch on below to agree.`}</AppText>
          <Spacer />
          <ToggleRow title="I want to link" hint="Turning this off also switches off everything below." value={mine.link} disabled={busy} onChange={(v) => set({ link: v })} />
          <ToggleRow title="Share my profile with my partner's" hint="Your partner's profile can show a link to yours." value={mine.link && mine.shared} disabled={busy || !mine.link} onChange={(v) => set({ shared: v })} />
          <ToggleRow title="Appear in couple discovery" hint="Only works when you both turn this on." value={mine.link && mine.discovery} disabled={busy || !mine.link} onChange={(v) => set({ discovery: v })} />
          <ToggleRow title="Pause" hint="Either of you can pause. Nothing is shown while paused." value={c.paused} disabled={busy} onChange={(v) => set({ paused: v })} />
          <Button kind="ghost" label="Unlink" loading={busy} onPress={() => Alert.alert('Unlink?', 'Everything shared between you stops.', [{ text: 'Keep', style: 'cancel' }, { text: 'Unlink', style: 'destructive', onPress: () => void run(async () => { await db.unlinkCouple(c.couple_id); void couple.reload(); }) }])} />
        </Card>) : null}
    </Screen>
  );
}
export default withFeature('together', Together);
