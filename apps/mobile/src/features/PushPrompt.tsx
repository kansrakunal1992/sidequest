import { useState } from 'react';
import { pushAdvice } from '@/core/push-core';
import type { PushReason } from '@/core/push-core';
import { AppText, Button, Card, Spacer } from '@/design/ui';
import { enablePush, openAppSettings } from '@/lib/push';
import { useSession } from '@/lib/session';

/** Shown in the Chat tab, at the moment it is useful, rather than as a surprise permission pop-up at start-up. */
export function PushPrompt() {
  const { session } = useSession();
  const [state, setState] = useState<PushReason | 'idle' | 'hidden'>('idle');
  if (state === 'hidden' || state === 'ok' || !session) return null;
  const advice = state === 'idle' ? null : pushAdvice(state);
  return (
    <Card style={{ marginBottom: 12 }}>
      <AppText variant="title">Know when someone replies</AppText>
      <AppText variant="caption">Notifications never show names or message text on your lock screen.</AppText>
      {advice ? <AppText variant="caption" style={{ marginTop: 6 }}>{advice.title}. {advice.message}</AppText> : null}
      <Spacer h={10} />
      <Button label="Turn on notifications" onPress={async () => setState(await enablePush(session.user.id, true))} />
      {state === 'blocked_in_settings' ? <Button kind="secondary" label="Open Settings" onPress={openAppSettings} /> : null}
      <Button kind="ghost" label="Not now" onPress={() => setState('hidden')} />
    </Card>
  );
}
