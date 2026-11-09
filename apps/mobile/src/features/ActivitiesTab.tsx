import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { ACTIVITY_CATEGORIES } from '@sidequest/shared';
import type { ActivityItem } from '@/core/plans';
import { colors } from '@/design/theme';
import { Button, Chip, EmptyState, ErrorText, Row, Spacer } from '@/design/ui';
import { listActivities } from '@/lib/plans';
import type { Scope } from '@/lib/plans';
import { ActivityCard } from './PlanCards';
import { useTheme } from '@/lib/theme';

const SCOPES: { id: Scope; label: string }[] = [{ id: 'browse', label: 'Browse' }, { id: 'joined', label: 'Going' }, { id: 'mine', label: 'Hosting' }];

/** Find something to do first, then the people who want to do it. No romantic match required. */
export function ActivitiesTab() {
  const th = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('browse');
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await listActivities(category, scope)); setError(null); } catch { setError('We could not load activities. Check your connection.'); } finally { setLoading(false); }
  }, [category, scope]);
  useEffect(() => { void load(); }, [load]);
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ marginBottom: 8 }}>{SCOPES.map((s) => <Chip key={s.id} label={s.label} selected={scope === s.id} onPress={() => setScope(s.id)} />)}</Row>
      {scope === 'browse' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}>
        <Row><Chip label="All" selected={category === null} onPress={() => setCategory(null)} />{ACTIVITY_CATEGORIES.map((c) => <Chip key={c.id} label={c.label} selected={category === c.id} onPress={() => setCategory(c.id)} />)}</Row>
      </ScrollView> : null}
      <Button kind="secondary" label="Host an activity" onPress={() => router.push('/activity/new' as never)} />
      <Spacer h={12} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading ? <ActivityIndicator color={th.highlight} style={{ marginTop: 30 }} />
        : items.length === 0 ? <EmptyState title="Nothing here yet" body="Host a bowling night, a walking group or a board-game evening and see who joins." />
        : items.map((a) => <ActivityCard key={a.id} a={a} onOpen={() => router.push({ pathname: '/activity/[id]', params: { id: a.id } } as never)} />)}
    </View>
  );
}
