import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { allowedSegments, decideRoute } from '@/core/routing';
import { colors } from '@/design/theme';
import { AppText, Button, Spacer } from '@/design/ui';
import { ModeProvider } from '@/lib/modes';
import { enablePush, setupPush, useNotificationRouting } from '@/lib/push';
import { UnreadProvider } from '@/lib/unread';
import { SessionProvider, useSession } from '@/lib/session';

function Gate() {
  const { sessionLoaded, session, profile, profileError, refreshProfile } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const route = decideRoute({ sessionLoaded, signedIn: !!session, profile });
  const inApp = route === '/(tabs)/discover';
  useNotificationRouting(inApp);
  useEffect(() => { void setupPush(); }, []);
  useEffect(() => { if (inApp && session) void enablePush(session.user.id, false); }, [inApp, session]);   // refresh the token quietly if permission was already given

  useEffect(() => {
    if (route === 'loading') return;
    if (!allowedSegments(route).includes(segments[0] ?? '')) router.replace(route as never);
  }, [route, segments, router]);

  if (profileError && session) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}>
        <AppText variant="title" style={{ textAlign: 'center' }}>Can't reach Waypoint</AppText>
        <Spacer h={8} /><AppText muted style={{ textAlign: 'center' }}>Check your connection and try again.</AppText>
        <Spacer h={16} /><Button label="Try again" onPress={() => void refreshProfile()} />
      </View>
    );
  }
  if (route === 'loading') {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.violet} size="large" /></View>;
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider><ModeProvider><UnreadProvider><Gate /></UnreadProvider></ModeProvider></SessionProvider>
    </SafeAreaProvider>
  );
}
