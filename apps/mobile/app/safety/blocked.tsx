import { Alert } from 'react-native';
import { AppText, Button, Card, EmptyState, ErrorText, Row, Screen, Spacer } from '@/design/ui';
import { db } from '@/lib/db';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

export default function Blocked() {
  const { session } = useSession();
  const blocks = useAsync(() => db.myBlocks(), []);
  const { run, busy, error } = useAction();
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Blocked people</AppText>
      <AppText muted>People you block cannot see you, message you or invite you, and you cannot see them. They are not told. If you unblock someone, they are not told either.</AppText>
      <Spacer />
      {error || blocks.error ? <ErrorText>{error ?? blocks.error}</ErrorText> : null}
      {blocks.data && blocks.data.length === 0 ? <EmptyState title="Nobody blocked" body="Block someone from their profile or from a chat." /> : null}
      {(blocks.data ?? []).map((b) => (
        <Card key={b.user_id} style={{ marginBottom: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText>{b.display_name ?? 'Someone who left'}<AppText muted variant="caption">{`  ${fmtWhen(b.blocked_at)}`}</AppText></AppText>
            <Button kind="secondary" label="Unblock" loading={busy} onPress={() => Alert.alert(`Unblock ${b.display_name ?? 'this person'}?`, 'They will be able to find you again.', [{ text: 'Keep blocked', style: 'cancel' }, { text: 'Unblock', onPress: () => void run(async () => {
              const { error: e } = await supabase.from('blocks').delete().eq('blocker_id', session!.user.id).eq('blocked_id', b.user_id); if (e) throw e; void blocks.reload(); }) }])} />
          </Row>
        </Card>))}
    </Screen>
  );
}
