import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { planErrorMessage } from '@/core/plans';
import type { OpenCallItem } from '@/core/plans';
import { colors } from '@/design/theme';
import { Button, Chip, EmptyState, ErrorText, Row, Spacer } from '@/design/ui';
import { expressInterest, listOpenCalls } from '@/lib/plans';
import type { Scope } from '@/lib/plans';
import { useModes } from '@/lib/modes';
import { OpenCallCard } from './PlanCards';
import { useTheme } from '@/lib/theme';

const SCOPES: { id: Scope; label: string }[] = [{ id: 'browse', label: 'Browse' }, { id: 'mine', label: 'Hosting' }, { id: 'joined', label: 'Joined' }];

export function OpenCallsTab() {
  const th = useTheme();
  const { current } = useModes();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('browse');
  const [items, setItems] = useState<OpenCallItem[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try { setItems(await listOpenCalls(current, scope)); setError(null); } catch { setError('We could not load Open Calls. Check your connection.'); } finally { setLoading(false); }
  }, [current, scope]);
  useEffect(() => { void load(); }, [load]);

  const open = (c: OpenCallItem) => router.push({ pathname: '/open-call/[id]', params: { id: c.id, mode: current } } as never);
  async function interested(c: OpenCallItem) {
    try { await expressInterest(c.id); await load(); } catch (e) { setError(planErrorMessage((e as { code?: string }).code)); await load(); }
  }
  if (!current) return <EmptyState title="Pick a vibe" body="Turn on a vibe in your Profile to see Open Calls." />;
  const visible = items.filter((c) => !hidden.has(c.id));
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <Row>{SCOPES.map((s) => <Chip key={s.id} label={s.label} selected={scope === s.id} onPress={() => setScope(s.id)} />)}</Row>
      </Row>
      <Button kind="secondary" label="Create an Open Call" onPress={() => router.push({ pathname: '/open-call/new', params: { mode: current } } as never)} />
      <Spacer h={12} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading ? <ActivityIndicator color={th.highlight} style={{ marginTop: 30 }} />
        : visible.length === 0 ? <EmptyState title={scope === 'browse' ? 'No Open Calls right now' : scope === 'mine' ? 'You are not hosting anything' : 'Nothing joined yet'}
            body={scope === 'browse' ? 'Be the first: post what you are up for and see who is in.' : 'Post an Open Call, or ask to join someone else\u2019s plan.'} />
        : visible.map((c) => <OpenCallCard key={c.id} c={c} onOpen={() => open(c)} onPass={() => setHidden(new Set(hidden).add(c.id))} onInterested={scope === 'browse' && c.myStatus === null ? () => void interested(c) : undefined} />)}
    </View>
  );
}
