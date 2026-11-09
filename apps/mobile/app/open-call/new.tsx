import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { buildOpenCallPayload, planErrorMessage } from '@/core/plans';
import { colors, spacing } from '@/design/theme';
import { AppText, Card, Row, Screen, Spacer } from '@/design/ui';
import { OpenCallFormView, emptyOpenCall } from '@/features/OpenCallForm';
import { createOpenCall } from '@/lib/plans';
import { getApproxLocation } from '@/lib/location';
import { withFeature } from '@/features/NotInVibe';

function NewOpenCall() {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(f: Parameters<Parameters<typeof OpenCallFormView>[0]['onSubmit']>[0]) {
    setError(null);
    let loc: { lat: number; lng: number } | null = null;
    { const o = await getApproxLocation({ ask: false }); if (o.reason === 'granted' && o.lat != null && o.lng != null) loc = { lat: o.lat, lng: o.lng }; }   // area text is enough when this is not available
    const built = buildOpenCallPayload(f, String(mode), new Date(), loc);
    if (!built.ok) { setError(built.error); return; }
    setBusy(true);
    try { const id = await createOpenCall(built.body); router.replace({ pathname: '/open-call/[id]', params: { id, mode } } as never); }
    catch (e) { setError(planErrorMessage((e as { code?: string }).code)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Row style={{ marginBottom: spacing.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <AppText variant="headline" accessibilityRole="header">New Open Call</AppText>
      </Row>
      <Card><AppText variant="caption">Post what you are up for. Only people in this vibe who fit each other's preferences can see it, and you choose who joins. Meet in public places, and tell a friend where you are going.</AppText></Card>
      <Spacer />
      <OpenCallFormView initial={emptyOpenCall} submitLabel="Post Open Call" showArea showTemplates busy={busy} error={error} onSubmit={(f) => void submit(f)} />
    </Screen>
  );
}
export default withFeature('open_calls', NewOpenCall);
