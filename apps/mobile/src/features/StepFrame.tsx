import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { STEPS, nextStep, validateStep } from '@/core/onboarding';
import type { Step } from '@/core/onboarding';
import { colors } from '@/design/theme';
import { AppText, Button, ErrorText, ProgressBar, Row, Screen, Spacer } from '@/design/ui';
import { useOnboarding } from '@/lib/onboarding-context';

/** Shared frame for every onboarding step: progress, validation, back and continue. */
export function StepFrame({ step, title, subtitle, children, nextLabel = 'Continue', onNext, footerExtra, optional }:
  { step: Step; title: string; subtitle?: string; children: ReactNode; nextLabel?: string; onNext?: () => Promise<void>; footerExtra?: ReactNode; optional?: boolean }) {
  const router = useRouter();
  const { state } = useOnboarding();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateStep(step, state, new Date());
  const idx = STEPS.indexOf(step);

  async function go() {
    setTried(true); setFailure(null);
    if (errors.length) return;
    setBusy(true);
    try {
      if (onNext) await onNext();
      const n = nextStep(step);
      if (n) router.push(`/(onboarding)/${n}` as never);
    } catch (e) { setFailure((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Screen footer={<>{tried && errors.map((e) => <ErrorText key={e}>{e}</ErrorText>)}{failure ? <ErrorText>{failure}</ErrorText> : null}
      <Button label={nextLabel} onPress={go} loading={busy} />{footerExtra}</>}>
      <Row style={{ marginBottom: 12 }}>
        {idx > 0 ? <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable> : null}
        <AppText muted variant="caption">{`Step ${idx + 1} of ${STEPS.length}`}{optional ? ' · optional' : ''}</AppText>
      </Row>
      <ProgressBar step={idx + 1} total={STEPS.length} />
      <AppText variant="headline" accessibilityRole="header">{title}</AppText>
      {subtitle ? <><Spacer h={8} /><AppText muted>{subtitle}</AppText></> : null}
      <Spacer h={24} />
      {children}
    </Screen>
  );
}
