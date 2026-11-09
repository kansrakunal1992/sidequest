import { View } from 'react-native';
import { ALWAYS_ON, MODES, modeFeatureList, themeFor } from '@sidequest/shared';
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
      {state.modes.map((id) => {
        const features = modeFeatureList(id);
        return (
          <Card key={id} style={{ marginBottom: 10 }}>
            <AppText variant="title">{MODES[id].label} · {themeFor(id).name}</AppText>
            <AppText muted variant="caption">{themeFor(id).mood}</AppText>
            <AppText variant="caption" style={{ marginTop: 6 }}>{features.length ? `Includes: ${features.map((f) => f.title).join(', ')}.` : 'Keeps it simple: people and plans, with no extras.'}</AppText>
          </Card>
        );
      })}
      <AppText muted variant="caption" style={{ marginBottom: 10 }}>In every vibe: {ALWAYS_ON.join('; ').toLowerCase()}.</AppText>
      <Card><AppText variant="caption">You only appear in the vibes you choose, and only people in the same vibe can see you there. Nothing you do in one vibe shows up in another.</AppText></Card>
    </StepFrame>
  );
}
