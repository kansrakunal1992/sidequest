import { useState } from 'react';
import type { ComponentType } from 'react';
import { useRouter } from 'expo-router';
import { FEATURE_LABEL, MODES, modeHas } from '@sidequest/shared';
import type { Feature } from '@sidequest/shared';
import { AppText, Button, Card, Screen, Spacer } from '@/design/ui';
import { ModeSheet } from '@/features/ModeSheet';
import { useModes } from '@/lib/modes';

/** Shown when a link or notification lands on something the current vibe does not include. Plain and kind: nothing is wrong, and nothing is lost. */
export function NotInVibe({ feature }: { feature: Feature }) {
  const { current } = useModes();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const label = current ? MODES[current].label : 'this';
  return (
    <Screen>
      <Spacer h={24} />
      <Card>
        <AppText variant="title" accessibilityRole="header">{FEATURE_LABEL[feature].title} is not part of the {label} vibe</AppText>
        <Spacer h={6} />
        <AppText muted>Each vibe has its own set of features. Switch vibe to use this, or head back.</AppText>
        <Spacer h={12} />
        <Button label="Switch vibe" onPress={() => setSheet(true)} />
        <Button kind="ghost" label="Go back" onPress={() => router.back()} />
      </Card>
      <ModeSheet visible={sheet} onClose={() => setSheet(false)} />
    </Screen>
  );
}

/**
 * Wraps a screen so it only opens in a vibe that has the feature. The database already refuses the actions it knows about;
 * this stops people reaching a screen that could only end in an error. With no vibe selected (all paused) the screen opens and the database decides.
 */
export function withFeature(feature: Feature, Inner: ComponentType): ComponentType {
  return function Guarded() {
    const { current } = useModes();
    return current === null || modeHas(current, feature) ? <Inner /> : <NotInVibe feature={feature} />;
  };
}
