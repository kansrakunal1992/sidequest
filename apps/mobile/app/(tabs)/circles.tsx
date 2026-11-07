import { useState } from 'react';
import { AppText, Screen, Segmented, Spacer } from '@/design/ui';
import { CirclesPanel, DoubleDatesPanel, RoulettePanel } from '@/features/CirclesPanels';

type Tab = 'circles' | 'roulette' | 'double';
export default function CirclesTab() {
  const [tab, setTab] = useState<Tab>('circles');
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Circles</AppText>
      <Spacer h={12} />
      <Segmented<Tab> options={[{ id: 'circles', label: 'Circles' }, { id: 'roulette', label: 'Social Roulette' }, { id: 'double', label: 'Double dates' }]} value={tab} onChange={setTab} />
      <Spacer h={16} />
      {tab === 'circles' ? <CirclesPanel /> : tab === 'roulette' ? <RoulettePanel /> : <DoubleDatesPanel />}
    </Screen>
  );
}
