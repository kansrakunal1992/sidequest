import { useEffect, useState } from 'react';
import { AppText, Button, Card, ErrorText, Screen, Spacer } from '@/design/ui';
import { DeviceStatus } from '@/features/DeviceStatus';
import { ToggleRow } from '@/features/SafetyBits';
import { db } from '@/lib/db';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useAction } from '@/lib/use-async';

type Col = 'incognito' | 'read_receipts' | 'accepts_intro_invites';
export default function Privacy() {
  const { session, profile, refreshProfile } = useSession();
  const uid = session?.user.id;
  const [flags, setFlags] = useState<Record<Col, boolean>>({ incognito: false, read_receipts: true, accepts_intro_invites: true });
  const [loaded, setLoaded] = useState(false);
  const { run, busy, error } = useAction();
  useEffect(() => {
    if (!uid) return;
    void supabase.from('profiles').select('incognito, read_receipts, accepts_intro_invites').eq('id', uid).single().then(({ data }) => {
      if (data) setFlags({ incognito: !!data.incognito, read_receipts: !!data.read_receipts, accepts_intro_invites: !!data.accepts_intro_invites });
      setLoaded(true);
    });
  }, [uid]);
  const setFlag = (col: Col, v: boolean) => {
    const before = flags[col]; setFlags({ ...flags, [col]: v });
    void run(async () => { const { error: e } = await supabase.from('profiles').update({ [col]: v }).eq('id', uid!); if (e) { setFlags((f) => ({ ...f, [col]: before })); throw e; } });
  };
  const paused = profile?.state === 'paused';
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Privacy and pause</AppText>
      <Spacer h={12} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Card>
        <ToggleRow title="Browse incognito" hint="People you look at will not see that you visited." value={flags.incognito} disabled={!loaded || busy} onChange={(v) => setFlag('incognito', v)} />
        <ToggleRow title="Read receipts" hint="Let people see when you have read their messages." value={flags.read_receipts} disabled={!loaded || busy} onChange={(v) => setFlag('read_receipts', v)} />
        <ToggleRow title="Allow invitations before matching" hint="People can invite you to a plan before you have matched." value={flags.accepts_intro_invites} disabled={!loaded || busy} onChange={(v) => setFlag('accepts_intro_invites', v)} />
      </Card>
      <Spacer />
      <Card>
        <AppText variant="title">{paused ? 'Your account is paused' : 'Take a break'}</AppText>
        <AppText muted>{paused ? 'You are hidden from discovery and cannot receive new invitations. Your chats and plans stay as they are.' : 'Pausing hides you from discovery and new invitations. Nothing is deleted, and you can come back whenever you like.'}</AppText>
        <Spacer h={10} />
        <Button label={paused ? 'Resume my account' : 'Pause my account'} kind={paused ? 'primary' : 'secondary'} loading={busy} onPress={() => void run(async () => { if (paused) await db.resumeAccount(); else await db.pauseAccount(); await refreshProfile(); })} />
      </Card>
      <Spacer />
      <DeviceStatus />
    </Screen>
  );
}
