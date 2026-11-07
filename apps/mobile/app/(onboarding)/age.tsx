import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Spacer, TextField } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';
import { useSession } from '@/lib/session';

const pad = (s: string) => s.padStart(2, '0');

export default function Age() {
  const { dispatch } = useOnboarding();
  const { signOut } = useSession();
  const [d, setD] = useState(''); const [m, setM] = useState(''); const [y, setY] = useState('');
  function update(nd: string, nm: string, ny: string) {
    setD(nd); setM(nm); setY(ny);
    const ok = /^\d{1,2}$/.test(nd) && /^\d{1,2}$/.test(nm) && /^\d{4}$/.test(ny);
    dispatch({ type: 'set', patch: { dob: ok ? `${ny}-${pad(nm)}-${pad(nd)}` : '' } });
  }
  return (
    <StepFrame step="age" title="When's your birthday?" subtitle="SideQuest is for adults aged 18 and over."
      footerExtra={<Button kind="ghost" label="Sign out" onPress={() => void signOut()} />}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><TextField label="Day" value={d} onChangeText={(t) => update(t.replace(/\D/g, ''), m, y)} keyboardType="number-pad" maxLength={2} placeholder="DD" /></View>
        <View style={{ flex: 1 }}><TextField label="Month" value={m} onChangeText={(t) => update(d, t.replace(/\D/g, ''), y)} keyboardType="number-pad" maxLength={2} placeholder="MM" /></View>
        <View style={{ flex: 1.5 }}><TextField label="Year" value={y} onChangeText={(t) => update(d, m, t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} placeholder="YYYY" /></View>
      </View>
      <Card>
        <AppText variant="caption">Your age is shown on your profile; your birthday is not. This is a self-declaration, not identity verification. Verified badges come from a separate check you can choose to do later.</AppText>
      </Card>
      <Spacer />
    </StepFrame>
  );
}
