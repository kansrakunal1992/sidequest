import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ACTIVITY_CATEGORIES } from '@sidequest/shared';
import { formatWhen } from '@/core/invite-ui';
import { activityBadge, canJoinActivity, goingLabel, planErrorMessage } from '@/core/plans';
import type { ActivityItem } from '@/core/plans';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Row, Spacer } from '@/design/ui';
import { activityPeople, cancelActivity, findActivity, joinActivity, leaveActivity, reportContent } from '@/lib/plans';
import type { PlanPerson } from '@/lib/plans';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function ActivityDetail() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession(); const router = useRouter(); const me = session?.user.id ?? '';
  const [a, setA] = useState<ActivityItem | null>(null);
  const [people, setPeople] = useState<PlanPerson[]>([]);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const item = await findActivity(id); setA(item);
      if (item && (item.isMine || item.myStatus === 'accepted')) setPeople(await activityPeople(id).catch(() => [])); else setPeople([]);
      if (!item) setError('This activity is not available.');
    } catch { setError('We could not load this. Check your connection.'); } finally { setRefreshing(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(planErrorMessage((e as { code?: string }).code)); await load(); } finally { setBusy(false); } }
  const ask = (t: string, m: string, ok: string, fn: () => void) => Alert.alert(t, m, [{ text: 'Not now', style: 'cancel' }, { text: ok, onPress: fn }]);

  if (!a) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.xl }}>{error ? <><AppText style={{ textAlign: 'center' }}>{error}</AppText><Spacer /><Button kind="secondary" label="Go back" onPress={() => router.back()} /></> : <ActivityIndicator color={th.highlight} size="large" />}</SafeAreaView>;
  const cat = ACTIVITY_CATEGORIES.find((c) => c.id === a.category); const badge = activityBadge(a);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={th.highlight} />}>
        <Row style={{ marginBottom: spacing.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
          <AppText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>Activity</AppText>
        </Row>
        <Card>
          <Row><Ionicons name={(cat?.icon ?? 'sparkles') as never} size={18} color={th.highlight} /><Text style={{ color: th.highlight, fontWeight: '700' }}>{cat?.label ?? a.category}</Text></Row>
          <AppText variant="title" style={{ marginTop: 4 }}>{a.title}</AppText>
          {badge ? <Text style={{ color: badge.tone === 'good' ? colors.cyan : th.highlight, fontWeight: '700', marginTop: 4 }}>{badge.label}</Text> : null}
          <Spacer h={10} /><AppText>{formatWhen(a.startsAt)}</AppText>
          <AppText muted variant="caption">{a.areaLabel}{a.venue ? ` · ${a.venue}` : ''}</AppText>
          <AppText muted variant="caption">{a.isMine ? 'Hosted by you' : `Hosted by ${a.hostName}`} · {goingLabel(a)}</AppText>
          {a.description ? <><Spacer h={10} /><AppText>{a.description}</AppText></> : null}
        </Card>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Spacer />
        {canJoinActivity(a) ? <Button label="I'm in" loading={busy} onPress={() => void run(() => joinActivity(a.id))} /> : null}
        {!a.isMine && (a.myStatus === 'accepted' || a.myStatus === 'waitlisted') && a.status === 'scheduled' ? <Button kind="secondary" label="I can't make it" onPress={() => ask('Leave this activity?', 'Your place goes to the next person on the waitlist.', 'Leave', () => void run(() => leaveActivity(a.id)))} /> : null}
        {people.length ? <><Spacer /><AppText variant="title">Who is going</AppText><AppText variant="caption">Only people who are going can see this list.</AppText><Spacer h={8} />
          {people.map((p) => (
            <Row key={p.userId} style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
              <AppText>{p.displayName}, {p.age}{p.verified ? '  ✓' : ''}{p.isHost ? '  (host)' : ''}</AppText>
              {p.canInvite ? <Button kind="secondary" label="Invite to chat" onPress={() => router.push({ pathname: '/invite/new', params: { to: p.userId, mode: 'adventures', name: p.displayName } } as never)} /> : null}
            </Row>))}</> : null}
        {a.isMine && a.status === 'scheduled' ? <><Spacer /><Button kind="ghost" label="Cancel this activity" onPress={() => ask('Cancel it?', 'Everyone who joined will be told.', 'Cancel it', () => void run(() => cancelActivity(a.id)))} /></> : null}
        {!a.isMine ? <><Spacer /><Button kind="ghost" label="Report this activity" onPress={() => ask('Report this activity?', 'Our team will take a look. The host is not told who reported it.', 'Report', () => void run(() => reportContent(me, 'event', a.id, a.hostId, 'Reported from an activity')).then(() => Alert.alert('Thank you', 'We will review it.')))} /></> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
