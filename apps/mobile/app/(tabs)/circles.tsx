import { useState } from 'react';
import { AppText, Screen, Segmented, Spacer } from '@/design/ui';
import { CirclesPanel, DoubleDatesPanel, RoulettePanel } from '@/features/CirclesPanels';
import { NotInVibe } from '@/features/NotInVibe';
import { useFeature } from '@/lib/theme';

type Tab = 'circles' | 'roulette' | 'double';
export default function CirclesTab() {
  const [tab, setTab] = useState<Tab>('circles');
  const hasCircles = useFeature('circles'), hasRoulette = useFeature('roulette'), hasDouble = useFeature('double_dates');
  // Only the panels this vibe has. A vibe with none of them never shows this tab; this covers a link that lands here anyway.
  const options: { id: Tab; label: string }[] = [
    ...(hasCircles ? [{ id: 'circles' as const, label: 'Circles' }] : []),
    ...(hasRoulette ? [{ id: 'roulette' as const, label: 'Social Roulette' }] : []),
    ...(hasDouble ? [{ id: 'double' as const, label: 'Double dates' }] : []),
  ];
  const shown = options.find((o) => o.id === tab)?.id ?? options[0]?.id;
  if (!shown) return <NotInVibe feature="circles" />;
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Circles</AppText>
      <Spacer h={12} />
      {options.length > 1 ? <><Segmented<Tab> options={options} value={shown} onChange={setTab} /><Spacer h={16} /></> : null}
      {shown === 'circles' ? <CirclesPanel /> : shown === 'roulette' ? <RoulettePanel /> : <DoubleDatesPanel />}
    </Screen>
  );
}
