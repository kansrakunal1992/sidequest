import { Stack } from 'expo-router';
import { colors } from '@/design/theme';
import { OnboardingProvider } from '@/lib/onboarding-context';

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
    </OnboardingProvider>
  );
}
