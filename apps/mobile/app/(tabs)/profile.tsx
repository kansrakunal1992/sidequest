import { LegalLinks } from '@/features/LegalLinks';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Switch, Text, View } from 'react-native';
import { MODE_TILES } from '@/core/modes-ui';
import { MODES, colors, spacing } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Row, Screen, Spacer } from '@/design/ui';
import { useModes } from '@/lib/modes';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Profile() {
  const th = useTheme();
  const { active, togglePause, addMode } = useModes();
  const { signOut, session } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [incognito, setIncognito] = useState(false);
  const [intros, setIntros] = useState(true);
  const [receipts, setReceipts] = useState(true);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('incognito, accepts_intro_invites, read_receipts').eq('id', uid).single().then(({ data }) => { if (data) { setIncognito(!!data.incognito); setIntros(!!data.accepts_intro_invites); setReceipts(data.read_receipts !== false); } });
  }, [uid]);
  async function setFlag(col: 'incognito' | 'accepts_intro_invites' | 'read_receipts', v: boolean, set: (b: boolean) => void) {
    set(v); setError(null);
    const { error: e } = await supabase.from('profiles').update({ [col]: v }).eq('id', uid!);
    if (e) { set(!v); setError('That did not save. Check your connection and try again.'); }
  }

  async function flip(id: (typeof MODE_TILES)[number]['id'], on: boolean) {
    setError(null);
    try {
      const existing = active.find((a) => a.modeId === id);
      if (!existing) { if (on) await addMode(id); } else await togglePause(id, !on);
    } catch { setError('That did not save. Check your connection and try again.'); }
  }

  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Profile</AppText>
      <AppText muted variant="caption">{session?.user.email}</AppText>
      <Spacer h={spacing.md} />
      <Button label="Edit profile" onPress={() => router.push('/edit-profile' as never)} />
      <Spacer h={spacing.md} />
      <Button kind="secondary" label="Notifications" onPress={() => router.push('/notifications' as never)} />
      <Spacer h={spacing.md} />
      <Button kind="secondary" label="Safety and privacy" onPress={() => router.push('/safety' as never)} />
      <Spacer />
      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <View style={{ flex: 1, paddingRight: 12 }}><Text style={{ color: colors.text, fontWeight: '700' }}>Browse incognito</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>Free for everyone. People you view will not see your visit.</Text></View>
          <Switch value={incognito} onValueChange={(v) => void setFlag('incognito', v, setIncognito)} trackColor={{ true: th.accent, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel="Browse incognito" />
        </Row>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <View style={{ flex: 1, paddingRight: 12 }}><Text style={{ color: colors.text, fontWeight: '700' }}>Read receipts</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>Let people see when you have read their message. Turn off for no pressure.</Text></View>
          <Switch value={receipts} onValueChange={(v) => void setFlag('read_receipts', v, setReceipts)} trackColor={{ true: th.accent, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel="Read receipts" />
        </Row>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 12 }}><Text style={{ color: colors.text, fontWeight: '700' }}>Allow invitations before matching</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>Lets people send a friendly invite to chat. You choose whether to reply.</Text></View>
          <Switch value={intros} onValueChange={(v) => void setFlag('accepts_intro_invites', v, setIntros)} trackColor={{ true: th.accent, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel="Allow invitations before matching" />
        </Row>
      </Card>
      <Spacer />
      <AppText variant="title">Your vibes</AppText>
      <AppText muted variant="caption">Turn a vibe off to pause it. Your matches and plans are kept. Nothing is deleted.</AppText>
      <Spacer h={spacing.md} />
      <Card>
        {MODE_TILES.map((t, i) => {
          const mode = MODES[t.id];
          const row = active.find((a) => a.modeId === t.id);
          const on = !!row && !row.paused;
          return (
            <Row key={t.id} style={{ justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: '#2F2750' }}>
              <Row style={{ flex: 1 }}>
                <Ionicons name={t.icon as never} size={22} color={mode.accent} />
                <View><Text style={{ color: colors.text, fontWeight: '700' }}>{mode.label}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>{!row ? 'Not added' : row.paused ? 'Paused' : 'On'}</Text></View>
              </Row>
              <Switch value={on} onValueChange={(v) => void flip(t.id, v)} trackColor={{ true: th.accent, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel={`${mode.label} vibe`} />
            </Row>
          );
        })}
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer />
      <Card><LegalLinks /></Card>
      <Spacer />
      <Button kind="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
