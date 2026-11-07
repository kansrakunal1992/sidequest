import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { describeNotification, sortInbox, unreadCount } from '@/core/inbox-core';
import type { NotificationRow } from '@/core/db-types';
import { colors } from '@/design/theme';
import { AppText, Button, Card, EmptyState, ErrorText, Screen, Spacer } from '@/design/ui';
import { supabase } from '@/lib/supabase';
import { fmtWhen, useAction, useAsync } from '@/lib/use-async';

export default function Notifications() {
  const router = useRouter();
  const inbox = useAsync(async (): Promise<NotificationRow[]> => {
    const { data, error } = await supabase.from('notifications').select('id, kind, payload, read_at, created_at').order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return (data ?? []) as NotificationRow[];
  }, []);
  const { run, error } = useAction();
  const rows = sortInbox(inbox.data ?? []);
  const open = (n: NotificationRow) => {
    const e = describeNotification(n.kind, n.payload);
    if (!n.read_at) void supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(() => void inbox.reload());
    if (e.route) router.push(e.route as never);
  };
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Notifications</AppText>
      <AppText muted variant="caption">{unreadCount(rows) ? `${unreadCount(rows)} new` : 'You are all caught up.'}</AppText>
      <Spacer />
      {error || inbox.error ? <ErrorText>{error ?? inbox.error}</ErrorText> : null}
      {unreadCount(rows) ? <><Button kind="secondary" label="Mark all as read" onPress={() => void run(async () => { const { error: e } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); if (e) throw e; void inbox.reload(); })} /><Spacer h={12} /></> : null}
      {inbox.data && rows.length === 0 ? <EmptyState title="Nothing yet" body="Invitations, plans and safety updates will show up here." /> : null}
      {rows.map((n) => {
        const e = describeNotification(n.kind, n.payload);
        return (
          <Pressable key={n.id} onPress={() => open(n)} accessibilityRole="button" accessibilityLabel={`${e.title}. ${e.body}${n.read_at ? '' : '. New'}`} style={{ marginBottom: 8 }}>
            <Card style={n.read_at ? undefined : { borderColor: colors.primary, borderWidth: 1 }}>
              <AppText variant="title">{e.title}</AppText><AppText>{e.body}</AppText><AppText muted variant="caption">{fmtWhen(n.created_at)}</AppText>
            </Card>
          </Pressable>);
      })}
    </Screen>
  );
}
