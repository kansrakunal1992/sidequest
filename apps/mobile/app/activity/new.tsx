import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { ACTIVITY_CATEGORIES } from '@sidequest/shared';
import { buildActivityPayload, planErrorMessage } from '@/core/plans';
import { colors, spacing } from '@/design/theme';
import { AppText, Button, Card, Chip, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { TimePicker } from '@/features/TimePicker';
import { createActivity } from '@/lib/plans';

export default function NewActivity() {
  const router = useRouter();
  const [f, setF] = useState({ title: '', category: null as string | null, description: '', startsAt: null as Date | null, area: '', venue: '', capacity: null as number | null });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function submit() {
    setError(null);
    let loc: { lat: number; lng: number } | null = null;
    try { const p = await Location.getForegroundPermissionsAsync(); if (p.status === 'granted') { const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }); loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; } } catch { /* area text is enough */ }
    const built = buildActivityPayload(f, new Date(), loc);
    if (!built.ok) { setError(built.error); return; }
    setBusy(true);
    try { const id = await createActivity(built.body); router.replace({ pathname: '/activity/[id]', params: { id } } as never); }
    catch (e) { setError(planErrorMessage((e as { code?: string }).code)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Row style={{ marginBottom: spacing.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <AppText variant="headline" accessibilityRole="header">Host an activity</AppText>
      </Row>
      <Card><AppText variant="caption">Activities are public: anyone on SideQuest can see and join them. Choose a public venue and keep personal details out of the description.</AppText></Card>
      <Spacer />
      <AppText variant="title">What kind?</AppText><Spacer h={8} />
      <Wrap>{ACTIVITY_CATEGORIES.map((c) => <Chip key={c.id} label={c.label} selected={f.category === c.id} onPress={() => set({ category: c.id })} />)}</Wrap>
      <Spacer />
      <TextField label="Title" value={f.title} onChangeText={(t) => set({ title: t })} maxLength={120} placeholder="Friday bowling night" />
      <TextField label="Details (optional)" value={f.description} onChangeText={(t) => set({ description: t })} multiline maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <AppText variant="title">When?</AppText><Spacer h={8} />
      <TimePicker value={f.startsAt} onChange={(d) => set({ startsAt: d })} />
      <Spacer />
      <TextField label="Area" value={f.area} onChangeText={(t) => set({ area: t })} maxLength={80} />
      <TextField label="Public venue (optional)" value={f.venue} onChangeText={(t) => set({ venue: t })} maxLength={80} />
      <AppText variant="title">How many people, including you?</AppText><Spacer h={8} />
      <Row>
        <Button kind="secondary" label="−" onPress={() => set({ capacity: f.capacity === null ? null : f.capacity <= 2 ? null : f.capacity - 1 })} />
        <AppText variant="title" style={{ minWidth: 80, textAlign: 'center' }}>{f.capacity ?? 'No limit'}</AppText>
        <Button kind="secondary" label="+" onPress={() => set({ capacity: f.capacity === null ? 2 : Math.min(200, f.capacity + 1) })} />
      </Row>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer /><Button label="Publish" onPress={() => void submit()} loading={busy} />
    </Screen>
  );
}
