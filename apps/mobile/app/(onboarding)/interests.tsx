import { useState } from 'react';
import { View } from 'react-native';
import { LIMITS, SUGGESTED_INTERESTS } from '@/core/onboarding';
import { AppText, Button, Chip, Row, Spacer, TextField, Wrap } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';

export default function Interests() {
  const { state, dispatch } = useOnboarding();
  const [custom, setCustom] = useState('');
  const extra = state.interests.filter((i) => !SUGGESTED_INTERESTS.some((s) => s.toLowerCase() === i.toLowerCase()));
  const add = () => { if (custom.trim()) { dispatch({ type: 'toggleInterest', interest: custom }); setCustom(''); } };
  return (
    <StepFrame step="interests" title="What are you into?" subtitle={`Pick ${LIMITS.interestsMin} to ${LIMITS.interestsMax}. They help us explain why you might click with someone.`}>
      <Wrap>
        {[...SUGGESTED_INTERESTS, ...extra].map((i) => <Chip key={i} label={i} selected={state.interests.some((x) => x.toLowerCase() === i.toLowerCase())} onPress={() => dispatch({ type: 'toggleInterest', interest: i })} />)}
      </Wrap>
      <Spacer />
      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1, marginRight: 8 }}><TextField label="Add your own" value={custom} onChangeText={setCustom} onSubmitEditing={add} maxLength={LIMITS.interestMax} /></View>
        <Button kind="secondary" label="Add" onPress={add} />
      </Row>
      <TextField label="A little about you (optional)" value={state.bio} onChangeText={(t) => dispatch({ type: 'set', patch: { bio: t } })} multiline numberOfLines={4} maxLength={LIMITS.bioMax}
        style={{ minHeight: 100, textAlignVertical: 'top' }} hint={`${state.bio.length}/${LIMITS.bioMax}. You can write a different intro for each vibe later.`} />
      <AppText variant="caption">{state.interests.length}/{LIMITS.interestsMax} chosen</AppText>
    </StepFrame>
  );
}
