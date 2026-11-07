import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { gradients, spacing } from '@/design/theme';
import { Logo } from '@/design/Logo';
import { AppText, Button, Pill, Spacer } from '@/design/ui';

export default function Welcome() {
  const router = useRouter();
  return (
    <LinearGradient colors={gradients.sunset} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: spacing.xl, justifyContent: 'space-between' }}>
        <View style={{ marginTop: spacing.xxl }}>
          <Logo size={72} />
          <Spacer h={spacing.md} />
          <AppText variant="display" accessibilityRole="header">SideQuest</AppText>
          <AppText variant="title" muted>People, plans, possibilities.</AppText>
          <Spacer h={spacing.xl} />
          <AppText>The social playground for adults: for dating, hookups, friendships and everything in between.</AppText>
          <Spacer h={spacing.lg} />
          <Pill label="100% Free. Forever." />
        </View>
        <View>
          <Button label="Get started" onPress={() => router.push('/(auth)/sign-in')} />
          <Spacer h={spacing.md} />
          <AppText variant="caption" style={{ textAlign: 'center' }}>For adults aged 18 and over. Your plans and your privacy stay yours.</AppText>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
