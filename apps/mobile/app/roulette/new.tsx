import { useState } from 'react';
import { useRouter } from 'expo-router';
import type { Energy } from '@sidequest/shared';
import { ROULETTE, validateRoulette } from '@/core/social-core';
import { AppText, Button, Chip, ErrorText, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { MODES } from '@/design/theme';
import { TimePicker } from '@/features/TimePicker';
import { db } from '@/lib/db';
import { useModes } from '@/lib/modes';
import { useAction } from '@/lib/use-async';
import { withFeature } from '@/features/NotInVibe';

const ENERGY_LABEL: Record<Energy, string> = { chill: 'Chill', flirty: 'Flirty', adventurous: 'Adventurous', social: 'Social' };
function NewRoulette() {
  const router = useRouter();
  const { active, current } = useModes();
  const [modeId, setModeId] = useState<string | null>(current ?? null);
  const [activity, setActivity] = useState(''); const [area, setArea] = useState('');
  const [when, setWhen] = useState<Date | null>(null); const [size, setSize] = useState<number>(ROULETTE.defaultSize); const [energy, setEnergy] = useState<Energy | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  async function submit() {
    const v = validateRoulette({ modeId, activity, area, slotStart: when, groupSize: size, energy }, new Date());
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    if (await run(async () => { await db.joinRoulette(v.value); })) router.back();
  }
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Join a table</AppText>
      <AppText muted>We will seat you with a few people who want the same thing, in the same area, around then. You can cancel any time.</AppText>
      <Spacer />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Which vibe</AppText>
      <Wrap>{active.map((a) => <Chip key={a.modeId} label={(MODES as Record<string, { label: string } | undefined>)[a.modeId]?.label ?? a.modeId} selected={modeId === a.modeId} onPress={() => setModeId(a.modeId)} />)}</Wrap>
      {errors.modeId ? <ErrorText>{errors.modeId}</ErrorText> : null}
      <Spacer />
      <TextField label="What would you like to do?" value={activity} onChangeText={setActivity} maxLength={40} error={errors.activity} placeholder="Dinner, bowling, a walk..." />
      <TextField label="Area" value={area} onChangeText={setArea} error={errors.area} hint="People are only seated with others who typed the same area, so use the common name." placeholder="Soho" />
      <AppText variant="caption" style={{ marginBottom: 6 }}>When</AppText>
      <TimePicker value={when} onChange={setWhen} />{errors.slotStart ? <ErrorText>{errors.slotStart}</ErrorText> : null}
      <Spacer />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Table size</AppText>
      <Wrap>{[2, 3, 4, 5, 6, 8].map((n) => <Chip key={n} label={String(n)} selected={size === n} onPress={() => setSize(n)} />)}</Wrap>
      {errors.groupSize ? <ErrorText>{errors.groupSize}</ErrorText> : null}
      <Spacer />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Energy</AppText>
      <Wrap>{ROULETTE.energies.map((e) => <Chip key={e} label={ENERGY_LABEL[e]} selected={energy === e} onPress={() => setEnergy(e)} />)}</Wrap>
      {errors.energy ? <ErrorText>{errors.energy}</ErrorText> : null}
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Join" loading={busy} onPress={() => void submit()} />
      <Spacer h={8} /><Button kind="ghost" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}
export default withFeature('roulette', NewRoulette);
