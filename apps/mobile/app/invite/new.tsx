import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { FIRST_MEET_TIPS, MEET_ACTIVITIES, PLACE_MAX, isMeetActivity, meetActivity } from '@sidequest/shared';
import { friendlyError } from '@/core/api-client';
import { DURATIONS, FORMATS, FORMAT_ICONS, FORMAT_LABELS, IN_PERSON_DURATIONS, NOTE_MAX, buildInvitePayload } from '@/core/invite-ui';
import type { Format } from '@/core/invite-ui';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { TimePicker } from '@/features/TimePicker';
import { api } from '@/lib/api';

/**
 * A friendly, structured way to say hi or make a plan: choose how and when, add a note. For "Meet in person" they also see what, where
 * and the neighbourhood. They can accept, suggest another time, decline, or say it is too new. `kind=in_person` opens it on the meetup
 * option, and `idea` pre-selects one of their Date Ideas.
 */
export default function NewInvite() {
  const { to, mode, name, kind, idea } = useLocalSearchParams<{ to: string; mode: string; name?: string; kind?: string; idea?: string }>();
  const router = useRouter();
  const startActivity = isMeetActivity(idea) ? idea : null;
  const startInPerson = kind === 'in_person' || !!startActivity;
  const [format, setFormat] = useState<Format>(startInPerson ? 'in_person' : 'virtual_coffee');
  const [when, setWhen] = useState<Date | null>(null);
  const [duration, setDuration] = useState<number>(startActivity ? meetActivity(startActivity)!.minutes : startInPerson ? 60 : 20);
  const [activity, setActivity] = useState<string | null>(startActivity);
  const [venue, setVenue] = useState('');
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inPerson = format === 'in_person';

  function chooseFormat(f: Format) {
    setFormat(f);
    // keep the length sensible for the kind of plan
    if (f === 'in_person' && !(IN_PERSON_DURATIONS as readonly number[]).includes(duration)) setDuration(activity ? meetActivity(activity)?.minutes ?? 60 : 60);
    if (f !== 'in_person' && !(DURATIONS as readonly number[]).includes(duration)) setDuration(20);
  }
  function chooseActivity(id: string) { setActivity(id); const m = meetActivity(id)?.minutes; if (m && (IN_PERSON_DURATIONS as readonly number[]).includes(m)) setDuration(m); }

  async function send() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const built = buildInvitePayload({ recipientId: String(to), modeId: String(mode), format, startsAt: when, durationMinutes: duration, note, activity, venueName: venue, areaLabel: area }, tz, new Date());
    if (!built.ok) { setError(built.error); return; }
    setBusy(true); setError(null);
    try { const inv = await api.createInvite(built.body); router.replace(`/invite/${inv.id}` as never); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Row style={{ marginBottom: spacing.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <AppText variant="headline" accessibilityRole="header">{inPerson ? `Make a plan with ${name ?? 'them'}` : `Invite ${name ?? 'them'}`}</AppText>
      </Row>
      <Card><AppText variant="caption">Starting a conversation can feel awkward, so this makes it easy. They can say yes, suggest another time, decline without giving a reason, or say it is too new to say hi. Any answer is fine.</AppText></Card>
      <Spacer />
      <AppText variant="title">How?</AppText><Spacer h={8} />
      <Wrap>{FORMATS.map((f) => <Chip key={f} label={FORMAT_LABELS[f]} selected={format === f} onPress={() => chooseFormat(f)} />)}</Wrap>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <Ionicons name={FORMAT_ICONS[format] as never} size={16} color={colors.textMuted} />
        <AppText variant="caption">{inPerson ? 'Meet at a public place. You choose the place and they can suggest another time.' : format === 'text' || format === 'intro_chat' ? 'Happens in a Waypoint chat at the agreed time.' : 'You will meet at the agreed time. In-app calling arrives in a later update, so you can chat in Waypoint until then.'}</AppText>
      </View>

      {inPerson ? (
        <>
          <Spacer />
          <AppText variant="title">What would you like to do?</AppText><Spacer h={8} />
          <Wrap>{MEET_ACTIVITIES.map((a) => <Chip key={a.id} label={a.label} selected={activity === a.id} onPress={() => chooseActivity(a.id)} />)}</Wrap>
          <Spacer />
          <AppText variant="title">Where?</AppText><Spacer h={8} />
          <TextField label="Place" value={venue} onChangeText={setVenue} maxLength={PLACE_MAX} placeholder="For example, a cafe or a market" />
          <TextField label="Neighbourhood or area" value={area} onChangeText={setArea} maxLength={PLACE_MAX} placeholder="For example, Khan Market" hint="No exact address needed. Please keep phone numbers and links out." />
          <Card>
            <AppText variant="caption" style={{ fontWeight: '800', marginBottom: 4 }}>For a first meeting</AppText>
            {FIRST_MEET_TIPS.map((t) => <AppText key={t} variant="caption">{`\u2022 ${t}`}</AppText>)}
          </Card>
        </>
      ) : null}

      <Spacer />
      <AppText variant="title">When?</AppText><Spacer h={8} />
      <TimePicker value={when} onChange={setWhen} />
      <Spacer />
      <AppText variant="title">How long?</AppText><Spacer h={8} />
      <Wrap>{(inPerson ? IN_PERSON_DURATIONS : DURATIONS).map((d) => <Chip key={d} label={`${d} min`} selected={duration === d} onPress={() => setDuration(d)} />)}</Wrap>
      <Spacer />
      <TextField label="A short note (optional)" value={note} onChangeText={setNote} multiline maxLength={NOTE_MAX} style={{ minHeight: 70, textAlignVertical: 'top' }} hint={`${note.length}/${NOTE_MAX}. Please keep contact details out of it.`} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer h={8} /><Button label={inPerson ? 'Send plan' : 'Send invitation'} onPress={send} loading={busy} />
    </Screen>
  );
}
