import { useState } from 'react';
import { countdown, restrictedView, validateAppeal } from '@/core/safety-core';
import { AppText, Button, Card, ErrorText, Screen, Spacer, TextField } from '@/design/ui';
import { db } from '@/lib/db';
import { useSession } from '@/lib/session';
import { useAction, useAsync } from '@/lib/use-async';

export default function AccountRestricted() {
  const { signOut, profile, refreshProfile } = useSession();
  const reqs = useAsync(() => db.myDataRequests(), []);
  const { run, busy, error } = useAction();
  const [message, setMessage] = useState(''); const [sent, setSent] = useState(false); const [formError, setFormError] = useState<string | null>(null);
  const v = restrictedView(profile?.state ?? 'suspended', reqs.data ?? []);
  async function appeal() {
    const a = validateAppeal(message);
    if (!a.ok) { setFormError(a.error); return; }
    setFormError(null);
    if (await run(async () => { await db.submitAppeal(a.value); })) { setSent(true); setMessage(''); }
  }
  return (
    <Screen>
      <Spacer h={48} />
      <AppText variant="headline">{v.headline}</AppText>
      <Spacer h={12} />
      <Card><AppText>{v.body}</AppText>{v.deletesAt ? <><Spacer h={8} /><AppText variant="title">Deletion in {countdown(v.deletesAt, new Date())}</AppText></> : null}</Card>
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {v.canCancelDeletion ? <Button label="Keep my account" loading={busy} onPress={() => void run(async () => { await db.cancelDeletion(); await refreshProfile(); })} /> : null}
      {v.canAppeal ? (sent ? <Card><AppText>Thank you. We have your message and a person will read it. You do not need to send it again.</AppText></Card> : (
        <Card>
          <AppText variant="title">Ask for a review</AppText>
          <TextField label="What would you like us to know?" value={message} onChangeText={setMessage} multiline maxLength={1000} error={formError} hint="A few sentences is plenty." />
          <Button label="Send" loading={busy} onPress={() => void appeal()} />
        </Card>)) : null}
      <Spacer h={24} />
      <Button kind="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
