import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Button, ErrorText, Spacer, TextField } from '@/design/ui';
import { REPORT_REASONS, blockUser, reportUser } from '@/lib/discovery';

type Step = 'menu' | 'report' | 'done-report' | 'confirm-block';

/** Block and report, reachable from any profile. Blocking is silent: the other person is never told. */
export function SafetyMenu({ visible, me, other, name, onClose, onBlocked }: { visible: boolean; me: string; other: string; name: string; onClose: () => void; onBlocked: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setStep('menu'); setReason(null); setDetails(''); setError(null); onClose(); };

  async function run(fn: () => Promise<void>, next?: Step) {
    setBusy(true); setError(null);
    try { await fn(); if (next) setStep(next); } catch { setError('That did not go through. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={close}>
      <Pressable style={st.backdrop} onPress={close} accessibilityLabel="Close" />
      <View style={st.sheet}>
        {step === 'menu' ? (
          <>
            <AppText variant="title">{name}</AppText><Spacer h={spacing.md} />
            <Button kind="secondary" label="Report" onPress={() => setStep('report')} /><Spacer h={spacing.sm} />
            <Button kind="secondary" label="Block" onPress={() => setStep('confirm-block')} /><Spacer h={spacing.sm} />
            <Button kind="ghost" label="Cancel" onPress={close} />
          </>
        ) : null}
        {step === 'confirm-block' ? (
          <>
            <AppText variant="title">Block {name}?</AppText><Spacer h={8} />
            <AppText muted>You will not see each other anywhere in SideQuest, and they cannot contact you. They are not told that you blocked them.</AppText>
            {error ? <ErrorText>{error}</ErrorText> : null}<Spacer />
            <Button label="Block" loading={busy} onPress={() => void run(async () => { await blockUser(me, other); close(); onBlocked(); })} /><Spacer h={8} />
            <Button kind="ghost" label="Cancel" onPress={() => setStep('menu')} />
          </>
        ) : null}
        {step === 'report' ? (
          <>
            <AppText variant="title">What is wrong?</AppText><Spacer h={8} />
            {REPORT_REASONS.map((r) => <View key={r} style={{ marginBottom: 8 }}><Button kind={reason === r ? 'primary' : 'secondary'} label={r} onPress={() => setReason(r)} /></View>)}
            <TextField label="Anything else we should know? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ minHeight: 70, textAlignVertical: 'top' }} />
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button label="Send report" disabled={!reason} loading={busy} onPress={() => void run(() => reportUser(me, other, reason!, details), 'done-report')} />
          </>
        ) : null}
        {step === 'done-report' ? (
          <>
            <AppText variant="title">Thank you</AppText><Spacer h={8} />
            <AppText muted>Our team will take a look. Your report is private and {name} is not told who sent it. You can also block them now.</AppText><Spacer />
            <Button kind="secondary" label="Block as well" onPress={() => setStep('confirm-block')} /><Spacer h={8} />
            <Button kind="ghost" label="Done" onPress={close} />
          </>
        ) : null}
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.xxl },
});
