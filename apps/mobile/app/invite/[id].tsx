import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { friendlyError } from '@/core/api-client';
import type { ApiInvite } from '@/core/api-client';
import { FORMAT_ICONS, FORMAT_LABELS, availableActions, formatWhen, myParty, otherId, stateSummary } from '@/core/invite-ui';
import type { Format, InviteAction } from '@/core/invite-ui';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Row, Spacer } from '@/design/ui';
import { PostMeetSheet } from '@/features/PostMeetSheet';
import { TimePicker } from '@/features/TimePicker';
import { api } from '@/lib/api';
import { addToDeviceCalendar, counterparts, hasPostMeetFeedback } from '@/lib/invites';
import type { Counterpart } from '@/lib/invites';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function InviteDetail() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const [inv, setInv] = useState<ApiInvite | null>(null);
  const [who, setWho] = useState<Counterpart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<InviteAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [newTime, setNewTime] = useState<Date | null>(null);
  const [feedback, setFeedback] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const i = await api.getInvite(id); setInv(i);
      const c = await counterparts([otherId(i, me)]).catch(() => ({})); setWho((c as Record<string, Counterpart>)[otherId(i, me)] ?? null);
      if (i.state === 'completed') setFeedbackDone(await hasPostMeetFeedback(me, i.id)); setError(null);
    } catch (e) { setError(friendlyError(e)); } finally { setRefreshing(false); }
  }, [id, me]);
  useEffect(() => { void load(); }, [load]);

  const actions = useMemo(() => (inv ? availableActions(inv, me, new Date()) : []), [inv, me]);
  const name = who?.displayName ?? 'them';

  async function run(a: InviteAction, fn: () => Promise<ApiInvite | void>) {
    setBusy(a); setError(null);
    try { const r = await fn(); if (r) setInv(r); await load(); if (a === 'complete') setFeedback(true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(null); }
  }
  const confirm = (title: string, message: string, ok: string, fn: () => void) => Alert.alert(title, message, [{ text: 'Not now', style: 'cancel' }, { text: ok, onPress: fn }]);
  if (!inv) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.xl }}>{error ? <><AppText style={{ textAlign: 'center' }}>{error}</AppText><Spacer /><Button kind="secondary" label="Go back" onPress={() => router.back()} /></> : <ActivityIndicator color={th.highlight} size="large" />}</SafeAreaView>;

  const s = stateSummary(inv, me);
  const confirmed = inv.state === 'accepted' || inv.state === 'rescheduled';
  const isCall = inv.format === 'voice' || inv.format === 'video' || inv.format === 'virtual_coffee';
  const party = myParty(inv, me);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={th.highlight} />}>
        <Row style={{ marginBottom: spacing.md }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
          <AppText variant="headline" accessibilityRole="header">{FORMAT_LABELS[inv.format as Format]}</AppText>
        </Row>
        <Card>
          <Row><Ionicons name={FORMAT_ICONS[inv.format as Format] as never} size={20} color={th.highlight} /><Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{party === 'sender' ? `With ${name}` : `From ${name}`}</Text>{who?.verified ? <Ionicons name="checkmark-circle" size={16} color={colors.cyan} /> : null}</Row>
          <Spacer h={8} /><AppText variant="title">{formatWhen(inv.startsAt)}</AppText>
          <AppText muted variant="caption">{inv.durationMinutes} minutes · shown in your time zone</AppText>
          {inv.note ? <><Spacer h={10} /><AppText>"{inv.note}"</AppText></> : null}
          <Spacer h={10} /><Text style={{ color: s.tone === 'good' ? colors.cyan : s.tone === 'wait' ? th.highlight : colors.textMuted, fontWeight: '700' }}>{s.label}</Text>
        </Card>
        {error ? <ErrorText>{error}</ErrorText> : null}

        {inv.state === 'too_new' && party === 'sender' ? <><Spacer /><Card><AppText>{name} is not ready to schedule something yet, but may be open to getting to know you. There is nothing you need to do. If they would like to say hello, they will.</AppText></Card></> : null}
        {inv.state === 'too_new' && party === 'recipient' ? <><Spacer /><Card><AppText variant="caption">You told them you are not ready to schedule yet. You can say hello when you feel like it, or suggest a time.</AppText></Card></> : null}
        {confirmed && isCall ? <><Spacer /><Card><AppText variant="caption">This is a {FORMAT_LABELS[inv.format as Format].toLowerCase()}. In-app calling arrives in a later update. Until then, chat in Waypoint at the agreed time.</AppText></Card></> : null}

        <Spacer />
        {actions.includes('accept') ? <><Button label="Accept" loading={busy === 'accept'} onPress={() => void run('accept', () => api.accept(inv.id))} /><Spacer h={10} /></> : null}
        {actions.includes('accept_reschedule') ? <><Button label="Accept the new time" loading={busy === 'accept_reschedule'} onPress={() => void run('accept_reschedule', () => api.acceptReschedule(inv.id))} /><Spacer h={10} /></> : null}
        {actions.includes('reschedule') ? (picking ? (
          <Card><AppText variant="title">Suggest another time</AppText><Spacer h={8} /><TimePicker value={newTime} onChange={setNewTime} /><Spacer />
            <Button label="Send new time" loading={busy === 'reschedule'} disabled={!newTime} onPress={() => void run('reschedule', async () => { const r = await api.reschedule(inv.id, { startsAt: newTime!.toISOString(), durationMinutes: inv.durationMinutes }); setPicking(false); return r; })} />
            <Button kind="ghost" label="Never mind" onPress={() => setPicking(false)} /></Card>
        ) : <><Button kind="secondary" label="Suggest another time" onPress={() => setPicking(true)} /><Spacer h={10} /></>) : null}
        {actions.includes('decline') ? <><Button kind="secondary" label="Decline" onPress={() => confirm('Decline politely?', 'They will be told it is not a yes this time. You do not need to give a reason.', 'Decline', () => void run('decline', () => api.decline(inv.id)))} /><Spacer h={10} /></> : null}
        {actions.includes('too_new') ? (
          <><Button kind="secondary" label="Too new to say hi" onPress={() => confirm('Too new to say hi', 'We will let them know: "I am not ready to schedule something yet, but I may be open to getting to know you." No pressure, and no reason needed.', 'Send gently', () => void run('too_new', () => api.tooNew(inv.id)))} />
            <AppText variant="caption" style={{ textAlign: 'center', marginTop: 4 }}>Not ready to schedule? Let them know, kindly.</AppText><Spacer h={10} /></>) : null}
        {actions.includes('light_chat') ? <><Button label="Say hello" loading={busy === 'light_chat'} onPress={async () => { setBusy('light_chat'); try { const r = await api.startLightChat(inv.id); router.push(`/chat/${r.conversationId}` as never); } catch (e) { setError(friendlyError(e)); } finally { setBusy(null); } }} /><Spacer h={10} /></> : null}

        {confirmed && inv.conversationId ? <><Button kind="secondary" label="Open chat" onPress={() => router.push(`/chat/${inv.conversationId}` as never)} /><Spacer h={10} /></> : null}
        {confirmed ? <><Button kind="secondary" label="Add to my calendar" onPress={() => void addToDeviceCalendar(inv, name).catch(() => setError('Could not open your calendar app.'))} />
          <AppText variant="caption" style={{ textAlign: 'center', marginTop: 4 }}>If the time changes later, update your calendar entry too.</AppText><Spacer h={10} /></> : null}
        {actions.includes('complete') ? <><Button kind="secondary" label="Mark as done" loading={busy === 'complete'} onPress={() => void run('complete', () => api.complete(inv.id))} /><Spacer h={10} /></> : null}
        {inv.state === 'completed' && !feedbackDone ? <Button kind="secondary" label="How did it go? (private)" onPress={() => setFeedback(true)} /> : null}
        {actions.includes('cancel') ? <Button kind="ghost" label="Cancel this" onPress={() => confirm('Cancel?', `${name} will be told it was cancelled.`, 'Cancel it', () => void run('cancel', () => api.cancel(inv.id)))} /> : null}
      </ScrollView>
      {who ? <PostMeetSheet visible={feedback} me={me} about={who.userId} inviteId={inv.id} onClose={(done) => { setFeedback(false); if (done) setFeedbackDone(true); }} /> : null}
    </SafeAreaView>
  );
}
