import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { CONSENT_TEXT, POLL_MAX, POLL_MS, verifyView } from '@/core/verify-core';
import type { MyVerification } from '@/core/verify-core';
import { AppText, Button, Card, ErrorText, Screen, Spacer } from '@/design/ui';
import { api } from '@/lib/api';
import { readMyVerification, startSelfieCheck } from '@/lib/verify';

/** Optional automatic photo check. The person agrees, takes a live selfie on the provider's page, and comes back to a yes or no. No human looks at anything. */
export default function Verify() {
  const router = useRouter();
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
  }, [refresh]);

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
          <AppText variant="title">Show that your photos are you</AppText>
          <AppText muted style={{ marginTop: 6 }}>{CONSENT_TEXT}</AppText>
          {watching ? <AppText style={{ marginTop: 10 }}>Waiting for the result. Finish the selfie in your browser, then come back here.</AppText> : null}
          {view.kind === 'failed' && !watching ? <ErrorText>{view.message}</ErrorText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Spacer h={12} />
          <Button label={view.kind === 'failed' ? 'Try again' : 'I agree, start the check'} loading={busy} disabled={watching || available === null} onPress={() => void start()} />
          <Button kind="ghost" label="Not now" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  );
}
