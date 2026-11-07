import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/design/theme';
import { useUnread } from '@/lib/unread';

const icon = (name: string) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name as never} size={size} color={color} />;

export default function TabsLayout() {
  const { total } = useUnread();
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: colors.violet, tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: '#2F2750' }, tabBarLabelStyle: { fontSize: 11 },
    }}>
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="circles" options={{ title: 'Circles', tabBarIcon: icon('people-circle') }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: icon('chatbubbles'), tabBarBadge: total > 0 ? (total > 99 ? '99+' : total) : undefined }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
