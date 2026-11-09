import { Switch, View } from 'react-native';
import { GENDERS } from '@/core/onboarding';
import type { Gender } from '@/core/onboarding';
import { colors } from '@/design/theme';
import { AppText, Button, Card, Chip, Row, Spacer, Wrap } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { finishOnboarding } from '@/lib/finish-onboarding';
import { enablePush } from '@/lib/push';
import { useOnboarding } from '@/lib/onboarding-context';
import { useSession } from '@/lib/session';
import { useState } from 'react';

const LABEL: Record<Gender, string> = { woman: 'Women', man: 'Men', non_binary: 'Non-binary people', other: 'Others' };

function Stepper({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit?: string; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <AppText>{label}</AppText>
      <Row>
        <Button kind="secondary" label="−" onPress={() => onChange(Math.max(min, value - step))} />
        <AppText style={{ minWidth: 64, textAlign: 'center' }}>{value}{unit ?? ''}</AppText>
        <Button kind="secondary" label="+" onPress={() => onChange(Math.min(max, value + step))} />
      </Row>
    </Row>
  );
}
function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, paddingRight: 12 }}><AppText>{label}</AppText><AppText variant="caption">{hint}</AppText></View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel={label} />
    </Row>
  );
}

export default function Preferences() {
  const { state, dispatch } = useOnboarding();
  const { session, refreshProfile } = useSession();
  const [progress, setProgress] = useState<string | null>(null);
  const set = (patch: object) => dispatch({ type: 'set', patch });
  async function finish() {
    if (!session) throw new Error('Please sign in again.');
    try { await finishOnboarding(state, session.user.id, setProgress); }
    finally { setProgress(null); }
    // The right moment to ask for notifications: the profile is saved, and the next thing people want is to hear when someone replies.
    // enablePush never throws, and saying no here changes nothing; the Privacy screen explains how to turn them on later.
    await enablePush(session.user.id, true).catch(() => 'denied');
    await refreshProfile();   // the Gate then moves you into the app
  }
  return (
    <StepFrame step="preferences" title="Who and how" nextLabel={progress ?? 'Finish'} onNext={finish}>
      <AppText variant="caption" style={{ marginBottom: 6 }}>Show me (leave empty for everyone)</AppText>
      <Wrap>{GENDERS.map((g) => <Chip key={g} label={LABEL[g]} selected={state.seeking.includes(g)} onPress={() => dispatch({ type: 'toggleSeeking', gender: g })} />)}</Wrap>
      <Spacer h={24} />
      <Stepper label="Youngest" value={state.ageMin} min={18} max={99} step={1} onChange={(n) => set({ ageMin: n, ageMax: Math.max(state.ageMax, n) })} />
      <Stepper label="Oldest" value={state.ageMax} min={18} max={99} step={1} onChange={(n) => set({ ageMax: n, ageMin: Math.min(state.ageMin, n) })} />
      <Stepper label="Within" value={state.maxDistanceKm} unit=" km" min={1} max={200} step={5} onChange={(n) => set({ maxDistanceKm: n })} />
      <Spacer />
      <Card>
        <Toggle label="Show me in discovery" hint="Turn off to browse without appearing to others." value={state.discoverable} onChange={(v) => set({ discoverable: v })} />
        <Toggle label="Appear in visitor lists" hint="When off, people you view will not see that you visited." value={state.appearInVisitorLists} onChange={(v) => set({ appearInVisitorLists: v })} />
        <Toggle label="Browse incognito" hint="Free for everyone. Your visits are never shown." value={state.incognito} onChange={(v) => set({ incognito: v })} />
        <Toggle label="Allow invitations before matching" hint="Lets people send a friendly invite to chat. You choose whether to reply." value={state.acceptsIntros} onChange={(v) => set({ acceptsIntros: v })} />
      </Card>
    </StepFrame>
  );
}
