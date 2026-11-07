import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ModeId } from '@sidequest/shared';
import { formatWhen } from '@/core/invite-ui';
import { buildOpenCallPayload, callBadge, canExpressInterest, meetStyleLabel, planErrorMessage, slotsLeft } from '@/core/plans';
import type { OpenCallItem } from '@/core/plans';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Row, Spacer } from '@/design/ui';
import { OpenCallFormView } from '@/features/OpenCallForm';
import { useModes } from '@/lib/modes';
import { cancelOpenCall, completeOpenCall, decideParticipant, expressInterest, findOpenCall, openCallPeople, reportContent, updateOpenCall, withdrawInterest } from '@/lib/plans';
import type { PlanPerson } from '@/lib/plans';
import { useSession } from '@/lib/session';

export default function OpenCallDetail() {
  const { id, mode: modeParam } = useLocalSearchParams<{ id: string; mode?: string }>();
  const { current } = useModes(); const { session } = useSession(); const router = useRouter();
  const me = session?.user.id ?? ''; const mode = ((modeParam as ModeId | undefined) ?? current) as ModeId | null;
  const [c, setC] = useState<OpenCallItem | null>(null);
  const [people, setPeople] = useState<PlanPerson[]>([]);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false); const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id || !mode) return;
    try {
      const item = await findOpenCall(mode, id); setC(item);
      if (item && (item.isMine || item.myStatus === 'accepted')) setPeople(await openCallPeople(id).catch(() => [])); else setPeople([]);
      if (!item) setError('This Open Call is not available.');
    } catch { setError('We could not load this. Check your connection.'); } finally { setRefreshing(false); }
  }, [id, mode]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(planErrorMessage((e as { code?: string }).code)); await load(); } finally { setBusy(false); } }
  const ask = (t: string, m: string, ok: string, fn: () => void) => Alert.alert(t, m, [{ text: 'Not now', style: 'cancel' }, { text: ok, onPress: fn }]);

  if (!c) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.xl }}>{error ? <><AppText style={{ textAlign: 'center' }}>{error}</AppText><Spacer /><Button kind="secondary" label="Go back" onPress={() => router.back()} /></> : <ActivityIndicator color={colors.violet} size="large" />}</SafeAreaView>;
  const badge = callBadge(c); const open = c.status === 'open' || c.status === 'full'; const started = c.startsAt.getTime() <= Date.now();
  const requests = people.filter((p) => p.status === 'interested' || p.status === 'waitlisted'); const going = people.filter((p) => p.status === 'accepted');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.violet} />}>
        <Row style={{ marginBottom: spacing.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
          <AppText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>Open Call</AppText>
        </Row>
        {editing ? (
          <Card><OpenCallFormView initial={{ title: c.title, description: c.description ?? '', startsAt: c.startsAt, area: c.areaLabel, venue: c.venue ?? '', capacity: c.capacity, budget: c.budgetNote ?? '', meetStyle: c.meetStyle }}
            submitLabel="Save changes" showArea={false} showTemplates={false} busy={busy} error={error}
            onSubmit={(f) => { const b = buildOpenCallPayload(f, String(mode), new Date(), null); if (!b.ok) { setError(b.error); return; }
              const { mode_id, area_label, lat, lng, ...edit } = b.body; void run(async () => { await updateOpenCall(c.id, edit); setEditing(false); }); }} />
            <Button kind="ghost" label="Never mind" onPress={() => setEditing(false)} /></Card>
        ) : (
          <>
            <Card>
              <AppText variant="title">{c.title}</AppText>
              {badge ? <Text style={{ color: badge.tone === 'good' ? colors.cyan : badge.tone === 'wait' ? colors.violet : colors.textMuted, fontWeight: '700', marginTop: 4 }}>{badge.label}</Text> : null}
              <Spacer h={10} />
              <AppText>{formatWhen(c.startsAt)}</AppText>
              <AppText muted variant="caption">{c.areaLabel}{c.venue ? ` · ${c.venue}` : ''}</AppText>
              <AppText muted variant="caption">{c.isMine ? 'Hosted by you' : `Hosted by ${c.hostName}, ${c.hostAge}${c.hostVerified ? ' (verified)' : ''}`}</AppText>
              <AppText muted variant="caption">{c.capacity === 2 ? 'One-to-one' : `Group of ${c.capacity}`} · {meetStyleLabel(c.meetStyle)}{c.budgetNote ? ` · ${c.budgetNote}` : ''} · {open ? `${slotsLeft(c)} place${slotsLeft(c) === 1 ? '' : 's'} left` : c.status}</AppText>
              {c.description ? <><Spacer h={10} /><AppText>{c.description}</AppText></> : null}
            </Card>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Spacer />
            {canExpressInterest(c) ? <Button label={c.status === 'full' ? 'Join the waitlist' : "I'm interested"} loading={busy} onPress={() => void run(() => expressInterest(c.id))} /> : null}
            {!c.isMine && (c.myStatus === 'interested' || c.myStatus === 'waitlisted' || c.myStatus === 'accepted') && open
              ? <><Spacer h={10} /><Button kind="secondary" label={c.myStatus === 'accepted' ? 'Leave this plan' : 'Withdraw my request'} onPress={() => ask('Withdraw?', 'The host will be told if you were already in.', 'Withdraw', () => void run(() => withdrawInterest(c.id)))} /></> : null}
            {c.conversationId ? <><Spacer h={10} /><Button label="Open the group chat" onPress={() => router.push(`/chat/${c.conversationId}` as never)} /></> : null}

            {c.isMine && requests.length ? <><Spacer /><AppText variant="title">Requests</AppText><AppText variant="caption">You decide who joins. Declining is private and kind: they just see it is not available.</AppText><Spacer h={8} />
              {requests.map((p) => (
                <Card key={p.userId} style={{ marginBottom: 8 }}>
                  <Row style={{ justifyContent: 'space-between' }}><AppText>{p.displayName}, {p.age}{p.verified ? '  ✓' : ''}{p.status === 'waitlisted' ? ' · waitlist' : ''}</AppText></Row>
                  <Row style={{ marginTop: 8 }}><View style={{ flex: 1 }}><Button kind="secondary" label="Decline" onPress={() => void run(() => decideParticipant(c.id, p.userId, false))} /></View><View style={{ flex: 1 }}><Button label="Accept" disabled={slotsLeft(c) === 0} onPress={() => void run(() => decideParticipant(c.id, p.userId, true))} /></View></Row>
                </Card>))}</> : null}
            {going.length ? <><Spacer /><AppText variant="title">Going</AppText><Spacer h={6} />{going.map((p) => <AppText key={p.userId}>{p.displayName}, {p.age}{p.verified ? '  ✓' : ''}</AppText>)}</> : null}

            {c.isMine && open ? <><Spacer /><Button kind="secondary" label="Edit" onPress={() => setEditing(true)} />
              {started ? <><Spacer h={10} /><Button kind="secondary" label="Mark as done" onPress={() => void run(() => completeOpenCall(c.id))} /></> : null}
              <Spacer h={10} /><Button kind="ghost" label="Cancel this Open Call" onPress={() => ask('Cancel it?', 'Everyone who asked to join will be told.', 'Cancel it', () => void run(() => cancelOpenCall(c.id)))} /></> : null}
            {!c.isMine ? <><Spacer /><Button kind="ghost" label="Report this Open Call" onPress={() => ask('Report this Open Call?', 'Our team will take a look. The host is not told who reported it.', 'Report', () => void run(() => reportContent(me, 'open_call', c.id, c.hostId, 'Reported from an Open Call')).then(() => Alert.alert('Thank you', 'We will review it.')))} /></> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
