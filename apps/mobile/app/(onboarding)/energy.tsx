import { useRouter } from 'expo-router';
import { ENERGIES } from '@/core/onboarding';
import { ENERGY_LABELS } from '@/core/modes-ui';
import { Button, Chip, Spacer, Wrap } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';

export default function Energy() {
  const { state, dispatch } = useOnboarding();
  const router = useRouter();
  return (
    <StepFrame step="energy" optional title="Your social energy tonight?" subtitle="A mood, not a commitment. You can change it whenever you like."
      footerExtra={<Button kind="ghost" label="Skip for now" onPress={() => { dispatch({ type: 'set', patch: { energy: null } }); router.push('/(onboarding)/interests'); }} />}>
      <Wrap>{ENERGIES.map((e) => <Chip key={e} label={ENERGY_LABELS[e]} selected={state.energy === e} onPress={() => dispatch({ type: 'set', patch: { energy: state.energy === e ? null : e } })} />)}</Wrap>
      <Spacer />
    </StepFrame>
  );
}
