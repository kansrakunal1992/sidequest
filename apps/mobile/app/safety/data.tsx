import { Alert, Linking } from 'react-native';
import { countdown, exportStateText, summarizeData } from '@/core/safety-core';
import { AppText, Button, Card, ErrorText, Screen, Spacer } from '@/design/ui';
import { api } from '@/lib/api';
import { db } from '@/lib/db';
import { useSession } from '@/lib/session';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

export default function YourData() {
  const { refreshProfile } = useSession();
  const reqs = useAsync(() => db.myDataRequests(), []);
  const { run, busy, error } = useAction();
  const s = summarizeData(reqs.data ?? [], new Date());
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Your data</AppText>
      <Spacer h={12} />
      {error || reqs.error ? <ErrorText>{error ?? reqs.error}</ErrorText> : null}
      <Card>
        <AppText variant="title">Download a copy</AppText>
        <AppText muted>{exportStateText[s.exportState]}</AppText>
        {s.exportRequest ? <AppText muted variant="caption">Asked for {fmtWhen(s.exportRequest.requested_at)}</AppText> : null}
        <Spacer h={10} />
        {s.exportState === 'ready' ? <Button label="Download" loading={busy} onPress={() => void run(async () => { const r = await api.dataExportUrl(s.exportRequest!.id); await Linking.openURL(r.url); })} /> : null}
        {s.exportState === 'preparing' ? <Button kind="secondary" label="Check again" onPress={() => void reqs.reload()} /> : null}
        {s.exportState === 'none' || s.exportState === 'failed' || s.exportState === 'expired' ? <Button label="Request my data" loading={busy} onPress={() => void run(async () => { await db.requestExport(); void reqs.reload(); })} /> : null}
        <AppText muted variant="caption">You can ask for one copy a day.</AppText>
      </Card>
      <Spacer />
      <Card>
        <AppText variant="title">Delete my account</AppText>
        {s.deletion ? (
          <><AppText>Deletion is scheduled in {countdown(s.deletesAt!, new Date())}.</AppText>
            <Button label="Cancel deletion" loading={busy} onPress={() => void run(async () => { await db.cancelDeletion(); await refreshProfile(); void reqs.reload(); })} /></>
        ) : (
          <><AppText muted>Your profile is hidden straight away. After 7 days your account, photos, messages and everything else are permanently deleted. Until then you can sign in and cancel.</AppText>
            <Spacer h={10} />
            <Button kind="secondary" label="Delete my account" loading={busy} onPress={() => Alert.alert('Delete your account?', 'Your profile is hidden now and everything is permanently deleted in 7 days. You can cancel before then.', [{ text: 'Keep my account', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void run(async () => { await db.requestDeletion(); await refreshProfile(); }) }])} /></>
        )}
      </Card>
    </Screen>
  );
}
