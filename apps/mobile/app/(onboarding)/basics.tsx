import { useState } from 'react';
import * as Location from 'expo-location';
import { GENDERS } from '@/core/onboarding';
import type { Gender } from '@/core/onboarding';
import { AppText, Button, Chip, Spacer, TextField, Wrap } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';

const LABEL: Record<Gender, string> = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary', other: 'Another way' };

export default function Basics() {
  const { state, dispatch } = useOnboarding();
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  async function useApprox() {
    setLocating(true); setNote(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setNote('No problem. Type your city instead.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      dispatch({ type: 'set', patch: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        const city = place?.city ?? place?.subregion;
        if (city && !state.city.trim()) dispatch({ type: 'set', patch: { city } });
      } catch { /* city can be typed */ }
      setNote('Got it. We keep an area about 1 km wide, never your exact spot.');
    } catch { setNote('Could not get your location. Type your city instead.'); }
    finally { setLocating(false); }
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
      <AppText variant="caption" style={{ marginTop: 8 }}>Used to show people and plans nearby. Exact home or work locations are never shown to anyone.</AppText>
    </StepFrame>
  );
}
