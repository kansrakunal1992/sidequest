import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { circleAction, joinOutcomeMessage, validateCircleEvent, VISIBILITY_LABEL } from '@/core/social-core';
import { AppText, Button, Card, EmptyState, ErrorText, Pill, Row, Screen, Spacer, TextField } from '@/design/ui';
import { TimePicker } from '@/features/TimePicker';
import { db } from '@/lib/db';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

export default function CircleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const circles = useAsync(async () => (await db.circlesFeed('browse')).concat(await db.circlesFeed('mine')).find((c) => c.id === id) ?? null, [id]);
  const c = circles.data;
  const joined = c?.my_status === 'active';
  const isAdmin = c?.my_role === 'owner' || c?.my_role === 'host';
  const people = useAsync(async () => (joined ? db.circlePeople(id!) : []), [id, joined]);
  const events = useAsync(async () => (joined ? db.circleEvents(id!) : []), [id, joined]);
  const { run, busy, error } = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ title: '', area: '', venue: '', capacity: '', description: '' });
  const [when, setWhen] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!c) return <Screen><AppText muted>{circles.loading ? 'Loading...' : circles.error ?? 'This circle is not available.'}</AppText><Spacer /><Button kind="secondary" label="Back" onPress={() => router.back()} /></Screen>;
  const a = circleAction(c);
  const requests = (people.data ?? []).filter((p) => p.status === 'requested');
  const members = (people.data ?? []).filter((p) => p.status === 'active');

  async function postEvent() {
    const v = validateCircleEvent({ ...f, startsAt: when }, new Date());
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    if (await run(async () => { await db.postCircleEvent(id!, v.value); })) { setShowForm(false); setF({ title: '', area: '', venue: '', capacity: '', description: '' }); setWhen(null); void events.reload(); }
  }
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">{c.name}</AppText>
      <AppText muted variant="caption">{c.member_count} {c.member_count === 1 ? 'person' : 'people'} - {VISIBILITY_LABEL[c.visibility]}{c.owner_name ? ` - run by ${c.owner_name}` : ''}</AppText>
      {c.description ? <><Spacer h={8} /><AppText>{c.description}</AppText></> : null}
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {note ? <AppText>{note}</AppText> : null}
      {a.kind === 'join' || a.kind === 'request' ? <Button label={a.label} loading={busy} onPress={() => void run(async () => { setNote(joinOutcomeMessage(await db.joinCircle(c.id))); void circles.reload(); })} /> : null}
      {a.kind === 'pending' ? <Pill label="Request sent" /> : null}
      {a.kind === 'none' ? <AppText muted>This circle is not available to join.</AppText> : null}
      {joined && c.conversation_id ? <Button label="Open circle chat" onPress={() => router.push(`/chat/${c.conversation_id}` as never)} /> : null}

      {joined ? (
        <View>
          <Spacer />
          <AppText variant="title">Coming up</AppText>
          {events.data && events.data.length === 0 ? <EmptyState title="No plans yet" body={isAdmin ? 'Post the first plan below.' : 'The organiser has not posted any plans.'} /> : null}
          {(events.data ?? []).map((e) => (
            <Card key={e.id} style={{ marginTop: 8 }}>
              <AppText variant="title">{e.title}</AppText>
              <AppText muted variant="caption">{fmtWhen(e.starts_at)} - {e.public_venue_name ? `${e.public_venue_name}, ` : ''}{e.area_label}</AppText>
              <AppText muted variant="caption">{e.going} going{e.capacity ? ` of ${e.capacity}` : ''}</AppText>
              {e.status === 'scheduled' ? (e.my_status === 'accepted' || e.my_status === 'waitlisted' ? <Pill label={e.my_status === 'accepted' ? 'You are going' : 'Waitlisted'} /> : <><Spacer h={8} /><Button kind="secondary" label="I am going" loading={busy} onPress={() => void run(async () => { await db.joinActivity(e.id); void events.reload(); })} /></>) : <Pill label="Cancelled" />}
            </Card>
          ))}
          {isAdmin ? (
            <View>
              <Spacer />
              {showForm ? (
                <Card>
                  <TextField label="Title" value={f.title} onChangeText={(t) => setF({ ...f, title: t })} maxLength={120} error={errors.title} />
                  <TextField label="Area" value={f.area} onChangeText={(t) => setF({ ...f, area: t })} error={errors.area} placeholder="Neighbourhood" />
                  <TextField label="Public place (optional)" value={f.venue} onChangeText={(t) => setF({ ...f, venue: t })} />
                  <TextField label="Capacity (optional)" value={f.capacity} onChangeText={(t) => setF({ ...f, capacity: t.replace(/\D/g, '') })} keyboardType="number-pad" error={errors.capacity} />
                  <TextField label="Details (optional)" value={f.description} onChangeText={(t) => setF({ ...f, description: t })} multiline />
                  <TimePicker value={when} onChange={setWhen} />{errors.startsAt ? <ErrorText>{errors.startsAt}</ErrorText> : null}
                  <Spacer /><Button label="Post plan" loading={busy} onPress={() => void postEvent()} /><Spacer h={8} /><Button kind="ghost" label="Cancel" onPress={() => setShowForm(false)} />
                </Card>
              ) : <Button kind="secondary" label="Post a plan" onPress={() => setShowForm(true)} />}
              {requests.length ? <><Spacer /><AppText variant="title">Requests to join</AppText>{requests.map((p) => (
                <Row key={p.user_id} style={{ justifyContent: 'space-between', marginTop: 8 }}><AppText>{p.display_name}</AppText>
                  <Row style={{ gap: 8 }}><Button label="Accept" onPress={() => void run(async () => { await db.decideCircleMember(c.id, p.user_id, true); void people.reload(); })} /><Button kind="secondary" label="Decline" onPress={() => void run(async () => { await db.decideCircleMember(c.id, p.user_id, false); void people.reload(); })} /></Row></Row>))}</> : null}
            </View>
          ) : null}
          <Spacer />
          <AppText variant="title">People ({members.length})</AppText>
          {members.map((p) => (
            <Row key={p.user_id} style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <AppText>{p.display_name}{p.role !== 'member' ? ` (${p.role})` : ''}</AppText>
              {isAdmin && p.role === 'member' ? <Button kind="ghost" label="Remove" onPress={() => Alert.alert(`Remove ${p.display_name}?`, 'They will leave the circle and its chat.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(async () => { await db.removeCircleMember(c.id, p.user_id); void people.reload(); }) }])} /> : null}
            </Row>
          ))}
          <Spacer />
          {c.my_role === 'owner'
            ? <Button kind="ghost" label="Delete circle" onPress={() => Alert.alert('Delete this circle?', 'Its chat and plans go away for everyone.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void run(async () => { await db.deleteCircle(c.id); router.replace('/(tabs)/circles' as never); }) }])} />
            : <Button kind="ghost" label="Leave circle" onPress={() => Alert.alert('Leave this circle?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void run(async () => { await db.leaveCircle(c.id); router.replace('/(tabs)/circles' as never); }) }])} />}
        </View>
      ) : null}
    </Screen>
  );
}
