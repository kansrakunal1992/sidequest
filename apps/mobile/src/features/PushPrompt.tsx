import { useState } from 'react';
import { AppText, Button, Card, Spacer } from '@/design/ui';
import { enablePush } from '@/lib/push';
import { useSession } from '@/lib/session';

/** Shown in the Chat tab, at the moment it is useful, rather than as a surprise permission pop-up at start-up. */
export function PushPrompt() {
  const { session } = useSession();
  const [state, setState] = useState<'idle' | 'granted' | 'denied' | 'unavailable' | 'hidden'>('idle');
  if (state === 'hidden' || state === 'granted' || !session) return null;
  return (
    <Card style={{ marginBottom: 12 }}>
      <AppText variant="title">Know when someone replies</AppText>
      <AppText variant="caption">Notifications never show names or message text on your lock screen.</AppText>
      {state === 'denied' ? <AppText variant="caption" style={{ marginTop: 6 }}>Notifications are off. You can turn them on in Android Settings.</AppText> : null}
      {state === 'unavailable' ? <AppText variant="caption" style={{ marginTop: 6 }}>Notifications are not set up in this build yet.</AppText> : null}
      <Spacer h={10} />
      <Button label="Turn on notifications" onPress={async () => setState(await enablePush(session.user.id, true))} />
      <Button kind="ghost" label="Not now" onPress={() => setState('hidden')} />
    </Card>
  );
}
