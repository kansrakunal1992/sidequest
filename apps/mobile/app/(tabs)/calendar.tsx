import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { splitCalendar } from '@/core/calendar-core';
import type { CalendarItem, DaySection } from '@/core/calendar-core';
import { formatWhen } from '@/core/invite-ui';
import { colors, spacing } from '@/design/theme';
import { AppText, Card, EmptyState, ErrorText, Screen, Spacer } from '@/design/ui';
import { listCalendar } from '@/lib/invites';

const STATUS: Record<CalendarItem['status'], { label: string; color: string }> = {
  confirmed: { label: 'Confirmed', color: colors.cyan }, tentative: { label: 'Tentative', color: colors.violet },
  cancelled: { label: 'Cancelled', color: colors.coral }, completed: { label: 'Done', color: colors.textMuted },
};

export default function CalendarTab() {
  const router = useRouter();
  const [data, setData] = useState<{ upcoming: DaySection[]; past: CalendarItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    listCalendar().then((items) => { setData(splitCalendar(items, new Date())); setError(null); }).catch(() => setError('We could not load your plans. Check your connection.'));
  }, []));

  const Item = ({ it }: { it: CalendarItem }) => (
    <Pressable onPress={() => router.push((it.sourceType === 'invite' ? `/invite/${it.sourceId}` : it.sourceType === 'open_call' ? `/open-call/${it.sourceId}` : it.sourceType === 'event' ? `/activity/${it.sourceId}` : '/(tabs)/calendar') as never)} accessibilityRole="button" accessibilityLabel={`${it.title}. ${formatWhen(it.startsAt)}. ${STATUS[it.status].label}`}>
      <Card style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="calendar" size={20} color={STATUS[it.status].color} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, textDecorationLine: it.status === 'cancelled' ? 'line-through' : 'none' }}>{it.title}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{formatWhen(it.startsAt)}</Text>
          </View>
          <Text style={{ color: STATUS[it.status].color, fontSize: 12, fontWeight: '700' }}>{STATUS[it.status].label}</Text>
        </View>
      </Card>
    </Pressable>
  );

  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Calendar</AppText>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!data && !error ? <ActivityIndicator color={colors.violet} style={{ marginTop: 40 }} /> : null}
      {data && data.upcoming.length === 0 && data.past.length === 0 ? <EmptyState title="Nothing planned yet" body="Accepted invitations and plans appear here, with reminders before they start." /> : null}
      {data?.upcoming.map((s) => <View key={s.key}><AppText variant="title" style={{ marginBottom: 8 }}>{s.label}</AppText>{s.items.map((it) => <Item key={it.id} it={it} />)}<Spacer h={8} /></View>)}
      {data && data.past.length ? <><AppText variant="title" muted style={{ marginBottom: 8 }}>Earlier</AppText>{data.past.slice(0, 20).map((it) => <Item key={it.id} it={it} />)}</> : null}
    </Screen>
  );
}
