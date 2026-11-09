import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/design/theme';
import { useFeature, useTheme } from '@/lib/theme';
import { useUnread } from '@/lib/unread';

const icon = (name: string) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name as never} size={size} color={color} />;

export default function TabsLayout() {
  const { total } = useUnread();
  const t = useTheme();
  // The Circles tab holds circles, Social Roulette and double dates. A vibe with none of the three has nothing to put there, so the tab is hidden (href: null keeps the route valid for deep links, which then show a friendly message).
  const hasCircles = [useFeature('circles'), useFeature('roulette'), useFeature('double_dates')].some(Boolean);
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: t.highlight, tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border }, tabBarLabelStyle: { fontSize: 11 },
    }}>
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="circles" options={{ title: 'Circles', tabBarIcon: icon('people-circle'), href: hasCircles ? undefined : null }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: icon('chatbubbles'), tabBarBadge: total > 0 ? (total > 99 ? '99+' : total) : undefined }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
