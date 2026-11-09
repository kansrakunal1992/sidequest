import { useState } from 'react';
import { locationAdvice } from '@/core/location-core';
import type { LocationAction } from '@/core/location-core';
import { GENDERS } from '@/core/onboarding';
import type { Gender } from '@/core/onboarding';
import { AppText, Button, Chip, Spacer, TextField, Wrap } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { getApproxLocation, locateTypedCity } from '@/lib/location';
import { useOnboarding } from '@/lib/onboarding-context';
import { openAppSettings } from '@/lib/push';

const LABEL: Record<Gender, string> = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary', other: 'Another way' };

export default function Basics() {
  const { state, dispatch } = useOnboarding();
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [action, setAction] = useState<LocationAction>('none');

  async function useApprox() {
    setLocating(true); setNote(null); setAction('none');
    try {
      const o = await getApproxLocation({ ask: true });
      if (o.reason === 'granted') {
        dispatch({ type: 'set', patch: { lat: o.lat, lng: o.lng } });
        if (o.city && !state.city.trim()) dispatch({ type: 'set', patch: { city: o.city } });
        setNote(locationAdvice('granted').message);
      } else { const a = locationAdvice(o.reason); setNote(a.message); setAction(a.action); }
    } finally { setLocating(false); }
  }

  /** The manual fallback: no permission needed, works from the city the person typed. */
  async function useTypedCity() {
    setLocating(true); setNote(null); setAction('none');
    try {
      const o = await locateTypedCity(state.city);
      if (o.reason === 'granted') { dispatch({ type: 'set', patch: { lat: o.lat, lng: o.lng } }); setNote('Done. We use the middle of your city, about 1 km wide.'); }
      else { const a = locationAdvice(o.reason); setNote(a.message); setAction(a.action); }
    } finally { setLocating(false); }
  }

  return (
    <StepFrame step="basics" title="The basics" subtitle="This is what people see first.">
      <TextField label="First name or nickname" value={state.displayName} onChangeText={(t) => dispatch({ type: 'set', patch: { displayName: t } })} autoCapitalize="words" maxLength={40} hint="Please leave out phone numbers, emails and social handles." />
      <AppText variant="caption" style={{ marginBottom: 6 }}>I am a</AppText>
      <Wrap>{GENDERS.map((g) => <Chip key={g} label={LABEL[g]} selected={state.gender === g} onPress={() => dispatch({ type: 'set', patch: { gender: g } })} />)}</Wrap>
      <Spacer h={24} />
      <TextField label="City" value={state.city} onChangeText={(t) => dispatch({ type: 'set', patch: { city: t } })} autoCapitalize="words" maxLength={80} />
      <TextField label="Neighbourhood (optional)" value={state.neighborhood} onChangeText={(t) => dispatch({ type: 'set', patch: { neighborhood: t } })} autoCapitalize="words" maxLength={80} />
      <Button kind="secondary" label={state.lat != null ? 'Location added' : 'Use my approximate location'} onPress={useApprox} loading={locating} />
      {note ? <AppText variant="caption" style={{ marginTop: 8 }}>{note}</AppText> : null}
      {action === 'open_settings' ? <Button kind="ghost" label="Open Settings" onPress={openAppSettings} /> : null}
      {state.lat == null && state.city.trim().length >= 2 ? <Button kind="ghost" label="Use the city I typed instead" onPress={useTypedCity} loading={locating} /> : null}
      <AppText variant="caption" style={{ marginTop: 8 }}>Used to show people and plans nearby. Exact home or work locations are never shown to anyone.</AppText>
    </StepFrame>
  );
}
