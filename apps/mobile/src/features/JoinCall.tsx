import { Text } from 'react-native';
import { joinLabel, joinState } from '@/core/call-core';
import type { CallInvite } from '@/core/call-core';
import { formatWhen } from '@/core/invite-ui';
import { AppText, Button, Card, Spacer } from '@/design/ui';

/** On the invitation page: says clearly when you can join, and gives a one-tap Join button when the window is open. Renders nothing for non-call invitations. */
export function JoinCallCard({ inv, callsOn, name, onJoin, now = new Date() }: { inv: CallInvite; callsOn: boolean; name: string; onJoin: () => void; now?: Date }) {
  const st = joinState(inv, now, callsOn);
  if (!st) return null;
  return (
    <Card>
      {st.kind === 'open' ? (
        <>
          <AppText variant="title">It is time</AppText>
          <AppText muted style={{ marginTop: 4 }}>{name} can join too. Calls are not recorded by Waypoint, and you can leave any time.</AppText>
          <Spacer h={12} /><Button label={joinLabel(inv.format)} onPress={onJoin} />
        </>
      ) : st.kind === 'soon' ? (
        <AppText>You can join from <Text style={{ fontWeight: '700' }}>{formatWhen(st.opensAt)}</Text>, 10 minutes before the start. A Join button will appear here.</AppText>
      ) : st.kind === 'ended' ? (
        <AppText>This call window has ended. You can still chat in Waypoint.</AppText>
      ) : st.kind === 'off' ? (
        <AppText variant="caption">Calling is not switched on yet. Chat in Waypoint at the agreed time.</AppText>
      ) : (
        <AppText variant="caption">The Join button appears here once the plan is confirmed.</AppText>
      )}
    </Card>
  );
}
