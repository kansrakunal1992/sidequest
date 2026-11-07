import { View } from 'react-native';
import { MODE_TILES } from '@/core/modes-ui';
import { ModeTile } from '@/design/ModeTile';
import { AppText, Card, Spacer } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';

export default function Vibe() {
  const { state, dispatch } = useOnboarding();
  return (
    <StepFrame step="vibe" title="What's your vibe?" subtitle="Choose one or more. Switch or add more any time.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
        {MODE_TILES.map((t) => <ModeTile key={t.id} mode={t.id} icon={t.icon} selected={state.modes.includes(t.id)} onPress={() => dispatch({ type: 'toggleMode', mode: t.id })} />)}
      </View>
      <Spacer />
      <Card><AppText variant="caption">You only appear in the vibes you choose, and only people in the same vibe can see you there. Nothing you do in one vibe shows up in another.</AppText></Card>
    </StepFrame>
  );
}
