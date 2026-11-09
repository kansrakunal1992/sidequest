import { Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { checkinsNeedingAnswer, formatFriendCode } from '@/core/safety-core';
import { AppText, Button, Card, ErrorText, Screen, Spacer } from '@/design/ui';
import { LegalLinks } from '@/features/LegalLinks';
import { NavRow } from '@/features/SafetyBits';
import { db } from '@/lib/db';
import { useFeature } from '@/lib/theme';
import { useAction, useAsync } from '@/lib/use-async';

export default function SafetyHub() {
  const router = useRouter();
  const code = useAsync(() => db.myFriendCode(), []);
  const checkins = useAsync(() => db.myCheckins(), []);
  const { run, busy, error } = useAction();
  const hasWing = useFeature('wingperson'), hasTogether = useFeature('together');
  const waiting = checkinsNeedingAnswer(checkins.data ?? []).length;
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Safety and privacy</AppText>
      <Spacer h={12} />
      <Card>
        <AppText variant="title">Your friend code</AppText>
        <AppText muted variant="caption">Share it with someone you trust so they can add you as a wingperson, a trusted contact, a teammate or a partner. It is not shown anywhere else.</AppText>
        <Spacer h={8} />
        <AppText variant="headline">{code.data ? formatFriendCode(code.data) : '...'}</AppText>
        {code.error || error ? <ErrorText>{code.error ?? error}</ErrorText> : null}
        <Spacer h={8} />
        <Button label="Share my code" disabled={!code.data} onPress={() => void Share.share({ message: `Add me on SideQuest with this friend code: ${formatFriendCode(code.data ?? '')}` })} />
        <Spacer h={8} />
        <Button kind="ghost" label="Get a new code" loading={busy} onPress={() => Alert.alert('Get a new code?', 'Your old code stops working. People you already added are not affected.', [{ text: 'Keep it', style: 'cancel' }, { text: 'New code', onPress: () => void run(async () => { await db.resetFriendCode(); void code.reload(); }) }])} />
      </Card>
      <Spacer />
      <NavRow icon="alarm" title="Trusted contacts and check-ins" hint="Someone who is told if you do not check in after a meet-up." badge={waiting ? `${waiting} waiting` : undefined} onPress={() => router.push('/safety/trusted' as never)} />
      {hasWing ? <NavRow icon="people" title="Wingperson" hint="A friend who can help with your profile. Never your chats." onPress={() => router.push('/safety/wing' as never)} /> : null}
      {hasTogether ? <NavRow icon="heart" title="Together" hint="Link with a partner and choose exactly what is shared." onPress={() => router.push('/safety/together' as never)} /> : null}
      <NavRow icon="eye-off" title="Privacy and pause" hint="Browse incognito, read receipts, take a break." onPress={() => router.push('/safety/privacy' as never)} />
      <NavRow icon="ban" title="Blocked people" hint="See and undo your blocks." onPress={() => router.push('/safety/blocked' as never)} />
      <NavRow icon="download" title="Your data" hint="Download a copy, or delete your account." onPress={() => router.push('/safety/data' as never)} />
      <Spacer />
      <Card><LegalLinks lead="Our rules and how we handle your information:" /></Card>
    </Screen>
  );
}
