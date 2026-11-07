import { useState } from 'react';
import { Alert, View } from 'react-native';
import type { WingPermission } from '@sidequest/shared';
import { isFriendCode, normalizeFriendCode } from '@/core/safety-core';
import { toggleWingPermission, WING_PERMISSION_INFO, wingPermissionList, wingStatusLabel } from '@/core/social-core';
import { AppText, Button, Card, ErrorText, Row, Screen, Spacer, TextField } from '@/design/ui';
import { ToggleRow } from '@/features/SafetyBits';
import { db } from '@/lib/db';
import { useModes } from '@/lib/modes';
import { useAction, useAsync } from '@/lib/use-async';

export default function Wing() {
  const { current } = useModes();
  const grants = useAsync(() => db.myWingGrants(), []);
  const suggestions = useAsync(() => db.myWingSuggestions(), []);
  const { run, busy, error } = useAction();
  const [code, setCode] = useState(''); const [perms, setPerms] = useState<WingPermission[]>(['view_shared_profile']);
  const [suggestFor, setSuggestFor] = useState<string | null>(null); const [headline, setHeadline] = useState(''); const [bio, setBio] = useState(''); const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const reloadAll = () => { void grants.reload(); void suggestions.reload(); };
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Wingperson</AppText>
      <AppText muted>A wingperson is a friend who helps you with your profile and plans. They can never read your chats, see your matches or likes, or message anyone as you. You choose what they can do and can end it any time.</AppText>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}{grants.error ? <ErrorText>{grants.error}</ErrorText> : null}
      {(suggestions.data ?? []).length ? <><AppText variant="title">Suggestions for you</AppText>{(suggestions.data ?? []).map((s) => (
        <Card key={s.id} style={{ marginTop: 8 }}>
          <AppText muted variant="caption">From {s.from_name}</AppText>
          {typeof s.payload.headline === 'string' && s.payload.headline ? <AppText>Headline: {s.payload.headline}</AppText> : null}
          {typeof s.payload.bio === 'string' && s.payload.bio ? <AppText>About: {s.payload.bio}</AppText> : null}
          {s.note ? <AppText muted>{s.note}</AppText> : null}
          <Spacer h={8} /><Row style={{ gap: 8 }}><View style={{ flex: 1 }}><Button label="Use it" loading={busy} onPress={() => void run(async () => { await db.resolveWingSuggestion(s.id, true); reloadAll(); })} /></View><View style={{ flex: 1 }}><Button kind="secondary" label="No thanks" loading={busy} onPress={() => void run(async () => { await db.resolveWingSuggestion(s.id, false); reloadAll(); })} /></View></Row>
        </Card>))}<Spacer /></> : null}

      <AppText variant="title">Your wingpeople and the people you help</AppText>
      {(grants.data ?? []).length === 0 ? <AppText muted>Nobody yet.</AppText> : (grants.data ?? []).map((g) => (
        <Card key={g.grant_id} style={{ marginTop: 8 }}>
          <AppText variant="title">{g.role === 'owner' ? `${g.other_name} is your wingperson` : `You are ${g.other_name}'s wingperson`}</AppText>
          <AppText muted variant="caption">{wingStatusLabel(g.status, g.role)}{g.status === 'active' ? ` - ${g.permissions.map((p) => WING_PERMISSION_INFO[p as WingPermission]?.label ?? p).join(', ')}` : ''}</AppText>
          <Spacer h={8} />
          {g.role === 'wing' && g.status === 'invited' ? <Row style={{ gap: 8 }}><View style={{ flex: 1 }}><Button label="Accept" loading={busy} onPress={() => void run(async () => { await db.respondWingInvite(g.grant_id, true); reloadAll(); })} /></View><View style={{ flex: 1 }}><Button kind="secondary" label="Decline" loading={busy} onPress={() => void run(async () => { await db.respondWingInvite(g.grant_id, false); reloadAll(); })} /></View></Row> : null}
          {g.role === 'wing' && g.status === 'active' && g.permissions.includes('view_shared_profile') && current ? (suggestFor === g.grant_id ? (
            <View>
              <TextField label="Suggested headline" value={headline} onChangeText={setHeadline} maxLength={120} />
              <TextField label="Suggested about text" value={bio} onChangeText={setBio} multiline maxLength={600} />
              <TextField label="A note for them (optional)" value={note} onChangeText={setNote} maxLength={280} />
              <Button label="Send suggestion" loading={busy} disabled={!headline.trim() && !bio.trim()} onPress={() => void run(async () => { await db.wingSuggest(g.grant_id, 'profile_text', { mode_id: current, headline: headline.trim(), bio: bio.trim() }, note.trim() || null); setSuggestFor(null); setHeadline(''); setBio(''); setNote(''); setSent('Sent. They decide whether to use it.'); })} />
            </View>) : <Button kind="secondary" label="Suggest profile wording" onPress={() => { setSuggestFor(g.grant_id); setSent(null); }} />) : null}
          {g.status !== 'revoked' && !(g.role === 'wing' && g.status === 'invited') ? <><Spacer h={8} /><Button kind="ghost" label={g.role === 'owner' ? 'End this' : 'Stop being their wingperson'} loading={busy} onPress={() => Alert.alert('End this wingperson link?', 'Their access stops straight away.', [{ text: 'Keep', style: 'cancel' }, { text: 'End it', style: 'destructive', onPress: () => void run(async () => { await db.revokeWing(g.grant_id); reloadAll(); }) }])} /></> : null}
        </Card>))}
      {sent ? <AppText>{sent}</AppText> : null}

      <Spacer />
      <AppText variant="title">Ask a friend to be your wingperson</AppText>
      <Spacer h={8} />
      <TextField label="Their friend code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={12} placeholder="ABCD 1234" />
      {wingPermissionList().map((p) => <ToggleRow key={p} title={WING_PERMISSION_INFO[p].label} hint={WING_PERMISSION_INFO[p].hint} value={perms.includes(p)} onChange={() => setPerms(toggleWingPermission(perms, p))} />)}
      <Button label="Send request" loading={busy} disabled={!isFriendCode(code) || perms.length === 0} onPress={() => void run(async () => { await db.inviteWingperson(normalizeFriendCode(code), perms); setCode(''); reloadAll(); })} />
    </Screen>
  );
}
