import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { friendlyError } from '@/core/api-client';
import { DURATIONS, FORMATS, FORMAT_ICONS, FORMAT_LABELS, NOTE_MAX, buildInvitePayload } from '@/core/invite-ui';
import type { Format } from '@/core/invite-ui';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { TimePicker } from '@/features/TimePicker';
import { api } from '@/lib/api';

/** A friendly, structured way to say hi: choose how and when, add a note. They can accept, suggest another time, decline, or say it is too new. */
export default function NewInvite() {
  const { to, mode, name } = useLocalSearchParams<{ to: string; mode: string; name?: string }>();
  const router = useRouter();
  const [format, setFormat] = useState<Format>('virtual_coffee');
  const [when, setWhen] = useState<Date | null>(null);
  const [duration, setDuration] = useState<number>(20);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const built = buildInvitePayload({ recipientId: String(to), modeId: String(mode), format, startsAt: when, durationMinutes: duration, note }, tz, new Date());
    if (!built.ok) { setError(built.error); return; }
    setBusy(true); setError(null);
    try { const inv = await api.createInvite(built.body); router.replace(`/invite/${inv.id}` as never); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Row style={{ marginBottom: spacing.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <AppText variant="headline" accessibilityRole="header">Invite {name ?? 'them'}</AppText>
      </Row>
      <Card><AppText variant="caption">Starting a conversation can feel awkward, so this makes it easy. They can say yes, suggest another time, decline without giving a reason, or say it is too new to say hi. Any answer is fine.</AppText></Card>
      <Spacer />
      <AppText variant="title">How?</AppText><Spacer h={8} />
      <Wrap>{FORMATS.map((f) => <Chip key={f} label={FORMAT_LABELS[f]} selected={format === f} onPress={() => setFormat(f)} />)}</Wrap>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}><Ionicons name={FORMAT_ICONS[format] as never} size={16} color={colors.textMuted} /><AppText variant="caption">{format === 'text' || format === 'intro_chat' ? 'Happens in a SideQuest chat at the agreed time.' : 'You will meet at the agreed time. In-app calling arrives in a later update, so you can chat in SideQuest until then.'}</AppText></View>
      <Spacer />
      <AppText variant="title">When?</AppText><Spacer h={8} />
      <TimePicker value={when} onChange={setWhen} />
      <Spacer />
      <AppText variant="title">How long?</AppText><Spacer h={8} />
      <Wrap>{DURATIONS.map((d) => <Chip key={d} label={`${d} min`} selected={duration === d} onPress={() => setDuration(d)} />)}</Wrap>
      <Spacer />
      <TextField label="A short note (optional)" value={note} onChangeText={setNote} multiline maxLength={NOTE_MAX} style={{ minHeight: 70, textAlignVertical: 'top' }} hint={`${note.length}/${NOTE_MAX}. Please keep contact details out of it.`} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer h={8} /><Button label="Send invitation" onPress={send} loading={busy} />
    </Screen>
  );
}
