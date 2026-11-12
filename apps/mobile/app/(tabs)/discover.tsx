import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { AppText, Row, Screen, Segmented, Spacer } from '@/design/ui';
import { ModeSheet } from '@/features/ModeSheet';
import { ActivitiesTab } from '@/features/ActivitiesTab';
import { OpenCallsTab } from '@/features/OpenCallsTab';
import { NextStepBanner } from '@/features/GettingStarted';
import { PeopleTab } from '@/features/PeopleTab';
import { useGettingStarted } from '@/lib/getting-started';
import { likesSummary } from '@/lib/discovery';
import { useModes } from '@/lib/modes';
import { useFeature } from '@/lib/theme';

type Tab = 'people' | 'calls' | 'activities';
export default function Discover() {
  const { current } = useModes();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('people');
  const [sheet, setSheet] = useState(false);
  const [likes, setLikes] = useState(0);
  const gs = useGettingStarted();
  const m = current ? MODES[current] : null;
  const hasCalls = useFeature('open_calls'), hasActivities = useFeature('activities');
  const options: { id: Tab; label: string }[] = [{ id: 'people', label: 'People' }, ...(hasCalls ? [{ id: 'calls' as const, label: 'Open Calls' }] : []), ...(hasActivities ? [{ id: 'activities' as const, label: 'Activities' }] : [])];
  const shown: Tab = options.some((o) => o.id === tab) ? tab : 'people';   // switching to a vibe without this tab falls back to People

  const { refresh: refreshGs } = gs;
  useFocusEffect(useCallback(() => { refreshGs(); }, [refreshGs]));   // picks up a finished verification / new photos when you come back
  const refreshBadge = useCallback(() => { if (current) likesSummary(current).then((s) => setLikes(s.likes)).catch(() => {}); }, [current]);
  useEffect(() => { refreshBadge(); const t = setInterval(refreshBadge, 60_000); return () => clearInterval(t); }, [refreshBadge]);

  return (
    <Screen scroll={false}>
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <AppText variant="headline" accessibilityRole="header">Discover</AppText>
        <Row>
          <Pressable onPress={() => router.push('/likes' as never)} accessibilityRole="button" accessibilityLabel={`Likes and matches. ${likes} likes`} hitSlop={10}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="heart" size={20} color={colors.pink} />
            {likes > 0 ? <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{likes > 99 ? '99+' : likes}</Text></View> : null}
          </Pressable>
          <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="Switch vibe"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: m?.tint ?? colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{m ? m.label : 'Pick a vibe'}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.text} />
          </Pressable>
        </Row>
      </Row>
      <NextStepBanner gs={gs} />
      {options.length > 1 ? <><Segmented<Tab> value={shown} onChange={setTab} options={options} /><Spacer h={spacing.md} /></> : null}
      {shown === 'people' ? <PeopleTab /> : shown === 'calls' ? <OpenCallsTab /> : <ActivitiesTab />}
      <ModeSheet visible={sheet} onClose={() => setSheet(false)} />
    </Screen>
  );
}
