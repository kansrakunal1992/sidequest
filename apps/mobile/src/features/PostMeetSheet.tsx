import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Button, Chip, ErrorText, Row, Spacer, TextField } from '@/design/ui';
import { submitPostMeet } from '@/lib/invites';
import type { PostMeetAnswers } from '@/lib/invites';

const Q: { key: keyof Omit<PostMeetAnswers, 'concern'>; text: string }[] = [
  { key: 'comfortable', text: 'Did you feel comfortable?' }, { key: 'boundariesRespected', text: 'Were your boundaries respected?' },
  { key: 'showedUp', text: 'Did the person show up?' }, { key: 'wouldInteractAgain', text: 'Would you like to connect again?' },
];

/** Private. Only the person answering and our safety team ever see this. It is never shown to the other person and is not a rating. */
export function PostMeetSheet({ visible, me, about, inviteId, onClose }: { visible: boolean; me: string; about: string; inviteId: string; onClose: (submitted: boolean) => void }) {
  const [a, setA] = useState<PostMeetAnswers>({ comfortable: null, boundariesRespected: null, showedUp: null, wouldInteractAgain: null, concern: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    try { await submitPostMeet(me, about, inviteId, a); onClose(true); } catch { setErr('That did not send. Please try again.'); } finally { setBusy(false); }
  }
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={() => onClose(false)}>
      <Pressable style={st.backdrop} onPress={() => onClose(false)} accessibilityLabel="Close" />
      <View style={st.sheet}><ScrollView>
        <AppText variant="title">How did it go?</AppText>
        <AppText variant="caption">Private and quick. This is not a public rating. It helps us keep everyone safe.</AppText>
        <Spacer h={spacing.md} />
        {Q.map((q) => (
          <View key={q.key} style={{ marginBottom: spacing.md }}>
            <AppText>{q.text}</AppText>
            <Row style={{ marginTop: 6 }}><Chip label="Yes" selected={a[q.key] === true} onPress={() => setA({ ...a, [q.key]: true })} /><Chip label="No" selected={a[q.key] === false} onPress={() => setA({ ...a, [q.key]: false })} /></Row>
          </View>
        ))}
        <TextField label="Anything concerning? (optional)" value={a.concern} onChangeText={(t) => setA({ ...a, concern: t })} multiline maxLength={1000} style={{ minHeight: 70, textAlignVertical: 'top' }} />
        {err ? <ErrorText>{err}</ErrorText> : null}
        <Button label="Send privately" onPress={send} loading={busy} disabled={Object.values({ c: a.comfortable, b: a.boundariesRespected, s: a.showedUp, w: a.wouldInteractAgain }).every((v) => v === null)} />
        <Button kind="ghost" label="Not now" onPress={() => onClose(false)} />
      </ScrollView></View>
    </Modal>
  );
}
const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
});
