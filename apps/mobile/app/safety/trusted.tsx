import { useState } from 'react';
import { Alert, View } from 'react-native';
import { checkinOptions, checkinsNeedingAnswer, CHECKIN_STATUS_TEXT, isFriendCode, normalizeFriendCode, splitContacts, upcomingCheckins, validateContactLabel } from '@/core/safety-core';
import { AppText, Button, Card, Chip, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { db } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

interface Plan { source_type: string; source_id: string; title: string; starts_at: string; ends_at: string | null }
export default function Trusted() {
  const contacts = useAsync(() => db.myTrustedContacts(), []);
  const checkins = useAsync(() => db.myCheckins(), []);
  const plans = useAsync(async (): Promise<Plan[]> => {
    const { data, error } = await supabase.from('calendar_entries').select('source_type, source_id, title, starts_at, ends_at').in('status', ['confirmed', 'tentative']).gte('starts_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).order('starts_at').limit(20);
    if (error) throw error;
    return (data ?? []) as Plan[];
  }, []);
  const { run, busy, error, setError } = useAction();
  const [code, setCode] = useState(''); const [label, setLabel] = useState('');
  const [open, setOpen] = useState<string | null>(null); const [contactId, setContactId] = useState<string | null>(null);
  const { mine, forMe } = splitContacts(contacts.data ?? []);
  const answer = checkinsNeedingAnswer(checkins.data ?? []);
  const upcoming = upcomingCheckins(checkins.data ?? []);
  const labelCheck = validateContactLabel(label);
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Trusted contacts and check-ins</AppText>
      <AppText muted>Pick someone on Waypoint you trust. After a meet-up, we ask you to confirm you are okay. If you do not answer within 30 minutes, we let them know so they can reach out. They only learn this when it happens, never where you are.</AppText>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {answer.length ? <><AppText variant="title">Please answer</AppText>{answer.map((c) => (
        <Card key={c.id} style={{ marginTop: 8 }}>
          <AppText>{c.status === 'missed' ? 'We could not reach you, so your contact was told. Let them know you are fine:' : 'Are you okay?'}</AppText>
          <AppText muted variant="caption">Check-in for {fmtWhen(c.check_in_at)}</AppText><Spacer h={8} />
          <Row style={{ gap: 8 }}><View style={{ flex: 1 }}><Button label="I am safe" loading={busy} onPress={() => void run(async () => { await db.confirmCheckin(c.id, true); void checkins.reload(); })} /></View>
            <View style={{ flex: 1 }}><Button kind="secondary" label="I need help" loading={busy} onPress={() => Alert.alert('Ask your contact for help?', 'They will be told right away.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Ask for help', style: 'destructive', onPress: () => void run(async () => { await db.confirmCheckin(c.id, false); void checkins.reload(); }) }])} /></View></Row>
        </Card>))}<Spacer /></> : null}

      <AppText variant="title">People I trust</AppText>
      {mine.length === 0 ? <AppText muted>No one yet.</AppText> : mine.map((c) => (
        <Row key={c.id} style={{ justifyContent: 'space-between', marginTop: 8 }}><AppText>{c.label}{c.contact_name ? ` (${c.contact_name})` : ''}</AppText>
          <Button kind="ghost" label="Remove" onPress={() => Alert.alert(`Remove ${c.label}?`, 'Check-ins that name them will stop alerting anyone.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(async () => { await db.removeTrustedContact(c.id); void contacts.reload(); }) }])} /></Row>))}
      {mine.length < 5 ? (
        <Card style={{ marginTop: 10 }}>
          <TextField label="Their friend code" value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={12} placeholder="ABCD 1234" />
          <TextField label="What do you call them?" value={label} onChangeText={setLabel} maxLength={40} placeholder="Sister, flatmate..." />
          <Button label="Add trusted contact" loading={busy} disabled={!isFriendCode(code) || !labelCheck.ok} onPress={() => void run(async () => { await db.addTrustedContact(normalizeFriendCode(code), label.trim()); setCode(''); setLabel(''); void contacts.reload(); })} />
        </Card>) : <AppText muted variant="caption">You have the maximum of 5.</AppText>}
      {forMe.length ? <><Spacer /><AppText variant="title">People who trust me</AppText>{forMe.map((c) => <AppText key={c.id} style={{ marginTop: 6 }}>{c.contact_name ?? 'Someone'} chose you. If they miss a check-in you will get an alert. You can step down by asking them to remove you.</AppText>)}</> : null}

      <Spacer />
      <AppText variant="title">Schedule a check-in</AppText>
      {mine.length === 0 ? <AppText muted>Add a trusted contact first.</AppText> : (plans.data ?? []).length === 0 ? <AppText muted>No upcoming plans on your calendar.</AppText> : (plans.data ?? []).map((p) => {
        const key = `${p.source_type}:${p.source_id}`;
        const opts = checkinOptions(new Date(p.starts_at), p.ends_at ? new Date(p.ends_at) : null, new Date());
        return (
          <Card key={key} style={{ marginTop: 8 }}>
            <AppText variant="title">{p.title}</AppText><AppText muted variant="caption">{fmtWhen(p.starts_at)}</AppText>
            {open === key ? (
              <View><Spacer h={8} /><AppText variant="caption">Tell</AppText>
                <Wrap>{mine.map((c) => <Chip key={c.id} label={c.label} selected={contactId === c.id} onPress={() => setContactId(c.id)} />)}</Wrap>
                <Spacer h={8} /><AppText variant="caption">Check in</AppText>
                {opts.length === 0 ? <AppText muted variant="caption">Too late or too far ahead for a check-in.</AppText> : <Wrap>{opts.map((o) => (
                  <Chip key={o.label} label={`${o.label} (${fmtWhen(o.at)})`} onPress={() => { if (!contactId) { setError('Choose who to tell first.'); return; } void run(async () => { await db.scheduleCheckin(p.source_type, p.source_id, o.at.toISOString(), contactId); setOpen(null); void checkins.reload(); }); }} />))}</Wrap>}
              </View>
            ) : <><Spacer h={8} /><Button kind="secondary" label="Set up a check-in" onPress={() => { setOpen(key); setContactId(mine.length === 1 ? mine[0]!.id : null); }} /></>}
          </Card>);
      })}
      {upcoming.length ? <><Spacer /><AppText variant="title">Scheduled</AppText>{upcoming.map((c) => <AppText key={c.id} style={{ marginTop: 6 }}>{fmtWhen(c.check_in_at)} - {c.contact_label ?? 'contact'} ({CHECKIN_STATUS_TEXT[c.status] ?? c.status})</AppText>)}</> : null}
    </Screen>
  );
}
