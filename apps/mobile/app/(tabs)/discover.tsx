import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { AppText, Row, Screen, Segmented, Spacer } from '@/design/ui';
import { ModeSheet } from '@/features/ModeSheet';
import { ActivitiesTab } from '@/features/ActivitiesTab';
import { OpenCallsTab } from '@/features/OpenCallsTab';
import { PeopleTab } from '@/features/PeopleTab';
import { likesSummary } from '@/lib/discovery';
import { useModes } from '@/lib/modes';

type Tab = 'people' | 'calls' | 'activities';
export default function Discover() {
  const { current } = useModes();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('people');
  const [sheet, setSheet] = useState(false);
  const [likes, setLikes] = useState(0);
  const m = current ? MODES[current] : null;

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
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ id: 'people', label: 'People' }, { id: 'calls', label: 'Open Calls' }, { id: 'activities', label: 'Activities' }]} />
      <Spacer h={spacing.md} />
      {tab === 'people' ? <PeopleTab /> : tab === 'calls' ? <OpenCallsTab /> : <ActivitiesTab />}
      <ModeSheet visible={sheet} onClose={() => setSheet(false)} />
    </Screen>
  );
}
