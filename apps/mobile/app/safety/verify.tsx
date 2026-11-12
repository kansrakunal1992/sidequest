import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, View } from 'react-native';
import { CONSENT_TEXT, POLL_MAX, POLL_MS, VERIFY_STEPS, readiness, readinessText, verifyView } from '@/core/verify-core';
import { verificationReference } from '@/core/self-profile';
import type { OwnPhoto } from '@/core/self-profile';
import { colors, spacing } from '@/design/theme';
import { loadMyPhotos } from '@/lib/photos';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { MyVerification } from '@/core/verify-core';
import { AppText, Button, Card, ErrorText, Row, Screen, Spacer } from '@/design/ui';
import { api } from '@/lib/api';
import { readMyVerification, startSelfieCheck } from '@/lib/verify';

/** Optional automatic photo check. The person agrees, takes a live selfie on the provider's page, and comes back to a yes or no. No human looks at anything. */
export default function Verify() {
  const router = useRouter();
  const th = useTheme();
  const { session } = useSession();
  const uid = session?.user.id ?? '';
  const [photos, setPhotos] = useState<OwnPhoto[] | null>(null);
  const [v, setV] = useState<MyVerification | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const polls = useRef(0);

  const refresh = useCallback(async () => { const r = await readMyVerification(); setV(r); return r; }, []);
  useEffect(() => {
    void refresh();
    void api.config().then((c) => setAvailable(!!c.verification)).catch(() => setAvailable(false));
    if (uid) loadMyPhotos(uid).then(setPhotos).catch(() => setPhotos(null));
  }, [refresh, uid]);
  const ready = readiness(photos);
  const blocker = readinessText(ready);
  const ref = photos ? verificationReference(photos) : null;

  const view = verifyView(v, new Date());
  const watching = waiting || view.kind === 'waiting';

  // While a check is open, look for the result every few seconds, and straight away when the person returns from the browser.
  useEffect(() => {
    if (!watching) return;
    polls.current = 0;
    const tick = async () => {
      const r = await refresh();
      if (r?.verified || (r?.latest && r.latest.status !== 'pending' && r.latest.status !== 'started')) setWaiting(false);
      else if (++polls.current >= POLL_MAX) setWaiting(false);
    };
    const t = setInterval(() => void tick(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void tick(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [watching, refresh]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const msg = await startSelfieCheck();
      if (msg) setError(msg); else setWaiting(true);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Photo verification</AppText>
      <Spacer h={12} />
      {view.kind === 'verified' ? (
        <Card>
          <AppText variant="title">You are photo verified</AppText>
          <AppText muted style={{ marginTop: 6 }}>Your profile shows a badge that says your live selfie matched your photo. It does not check your name or who you are, only that your photos are of you.</AppText>
          <Spacer h={12} />
          <Button label="Done" onPress={() => router.back()} />
        </Card>
      ) : available === false ? (
        <Card><AppText variant="title">Not available yet</AppText><AppText muted style={{ marginTop: 6 }}>Photo verification is not switched on yet. Nothing is needed from you.</AppText></Card>
      ) : (
        <Card>
          <AppText variant="title">Get your free verified badge</AppText>
          <AppText muted style={{ marginTop: 6 }}>Optional, free, and takes about a minute. The badge tells people your photos are really you.</AppText>
          <Spacer h={spacing.md} />
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ alignItems: 'center', width: 96 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                {ref?.url ? <Image source={{ uri: ref.url }} style={{ width: 72, height: 72 }} accessibilityLabel="The photo your selfie will be compared with" /> : <Ionicons name="person" size={30} color={colors.textMuted} />}
              </View>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' }}>{VERIFY_STEPS[0]}</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
            <View style={{ alignItems: 'center', width: 96 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera-outline" size={30} color={th.highlight} /></View>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' }}>{VERIFY_STEPS[1]}</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
            <View style={{ alignItems: 'center', width: 96 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark-circle" size={34} color={colors.cyan} /></View>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' }}>{VERIFY_STEPS[2]}</Text>
            </View>
          </Row>
          <Spacer h={spacing.md} />
          <AppText variant="caption">We compare your live selfie with the first approved photo on your profile. The selfie is taken on a secure page in your browser, then you come back here.</AppText>
          {ref ? <Pressable onPress={() => router.push('/edit-profile' as never)} accessibilityRole="button" hitSlop={8}><Text style={{ color: th.highlight, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Wrong photo? Change your main photo ›</Text></Pressable> : null}
          <Spacer h={spacing.sm} />
          <AppText muted variant="caption">{CONSENT_TEXT}</AppText>
          {blocker ? <><Spacer h={spacing.sm} /><AppText>{blocker}</AppText><Spacer h={spacing.sm} /><Button kind="secondary" label={ready === 'no_photo' ? 'Add a photo' : 'Open my photos'} onPress={() => router.push('/edit-profile' as never)} /></> : null}
          {watching ? <AppText style={{ marginTop: 10 }}>Waiting for the result. Finish the selfie in your browser, then come back here.</AppText> : null}
          {view.kind === 'failed' && !watching ? <ErrorText>{view.message}</ErrorText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Spacer h={12} />
          <Button label={view.kind === 'failed' ? 'Try again' : 'I agree, start the check'} loading={busy} disabled={watching || available === null || ready === 'no_photo' || ready === 'in_review'} onPress={() => void start()} />
          <Button kind="ghost" label="Not now" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  );
}
