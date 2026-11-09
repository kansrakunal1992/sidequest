import { useCallback, useEffect, useState } from 'react';
import { locationAdvice, locationStatusLines } from '@/core/location-core';
import type { LocationStatus } from '@/core/location-core';
import { describeTestResult, nextStep, pushAdvice, statusLines } from '@/core/push-core';
import type { Advice, PushStatus } from '@/core/push-core';
import { AppText, Button, Card, ErrorText, Spacer, TextField } from '@/design/ui';
import { api } from '@/lib/api';
import { db } from '@/lib/db';
import { getApproxLocation, locateTypedCity, readLocationStatus } from '@/lib/location';
import { enablePush, openAppSettings, readPushPermission } from '@/lib/push';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Note = (Advice & { ok?: boolean }) | null;

/** Notifications and location, with plain status lines, one next step, and the buttons to fix or test them. Lives on the Privacy screen. */
export function DeviceStatus() {
  const { session } = useSession();
  const uid = session?.user.id;
  const [push, setPush] = useState<PushStatus>({ permission: 'undetermined', tokenRegistered: null, serverConfigured: null });
  const [loc, setLoc] = useState<LocationStatus>({ permission: 'undetermined', servicesOn: null });
  const [pushNote, setPushNote] = useState<Note>(null);
  const [locNote, setLocNote] = useState<Note>(null);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState<'push' | 'test' | 'loc' | 'city' | null>(null);

  const refresh = useCallback(async () => {
    const [permission, config, tokens, l] = await Promise.all([
      readPushPermission(),
      api.config().then((c) => c.push).catch(() => null),
      uid ? Promise.resolve(supabase.from('push_tokens').select('token').eq('user_id', uid)).then((r: { data?: unknown[] | null; error?: unknown }) => (r.error ? null : (r.data ?? []).length > 0)).catch(() => null) : Promise.resolve(null),
      readLocationStatus(),
    ]);
    setPush({ permission, serverConfigured: config, tokenRegistered: tokens });
    setLoc(l);
  }, [uid]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function turnOnPush() {
    if (!uid) return; setBusy('push'); setPushNote(null);
    try { const r = await enablePush(uid, true); setPushNote({ ...pushAdvice(r), ok: r === 'ok' }); await refresh(); } finally { setBusy(null); }
  }
  async function sendTest() {
    setBusy('test'); setPushNote(null);
    try { setPushNote(describeTestResult(await api.pushTest())); }
    catch (e) { setPushNote({ ok: false, title: 'Could not run the test', message: (e as { code?: string })?.code === 'rate_limited' ? 'You have run several tests. Wait a few minutes and try again.' : 'Could not reach the server. Check your connection and try again.', action: 'retry' }); }
    finally { setBusy(null); }
  }
  async function updateLocation() {
    setBusy('loc'); setLocNote(null);
    try {
      const o = await getApproxLocation({ ask: true });
      if (o.reason === 'granted' && o.lat != null && o.lng != null) { await db.setApproxLocation(o.lat, o.lng); setLocNote({ ok: true, title: 'Location updated', message: locationAdvice('granted').message, action: 'none' }); }
      else { const a = locationAdvice(o.reason); setLocNote({ ok: false, title: 'Location not updated', message: a.message, action: a.action === 'open_settings' ? 'open_settings' : 'retry' }); }
      await refresh();
    } catch { setLocNote({ ok: false, title: 'Location not saved', message: 'We found your location but could not save it. Check your connection and try again.', action: 'retry' }); }
    finally { setBusy(null); }
  }
  async function useCity() {
    setBusy('city'); setLocNote(null);
    try {
      const o = await locateTypedCity(city);
      if (o.reason === 'granted' && o.lat != null && o.lng != null) { await db.setApproxLocation(o.lat, o.lng); setLocNote({ ok: true, title: 'Location updated', message: 'Done. We use the middle of that city, about 1 km wide.', action: 'none' }); }
      else setLocNote({ ok: false, title: 'City not found', message: locationAdvice(o.reason).message, action: 'none' });
    } catch { setLocNote({ ok: false, title: 'Location not saved', message: 'Check your connection and try again.', action: 'retry' }); }
    finally { setBusy(null); }
  }

  const step = nextStep(push);
  return (
    <>
      <Card>
        <AppText variant="title">Notifications</AppText>
        {statusLines(push).map((l) => <AppText key={l} variant="caption">{l}</AppText>)}
        {step && !pushNote ? <AppText variant="caption" style={{ marginTop: 6 }}>{step.title}. {step.message}</AppText> : null}
        {pushNote ? (pushNote.ok === false ? <ErrorText>{pushNote.title}. {pushNote.message}</ErrorText> : <AppText variant="caption" style={{ marginTop: 6 }}>{pushNote.title}. {pushNote.message}</AppText>) : null}
        <Spacer h={10} />
        <Button label="Turn on notifications" loading={busy === 'push'} onPress={() => void turnOnPush()} />
        <Spacer h={8} />
        <Button kind="secondary" label="Send test notification" loading={busy === 'test'} onPress={() => void sendTest()} />
        {push.permission === 'blocked_in_settings' || pushNote?.action === 'open_settings' ? <Button kind="ghost" label="Open Settings" onPress={openAppSettings} /> : null}
      </Card>
      <Spacer />
      <Card>
        <AppText variant="title">Location</AppText>
        {locationStatusLines(loc).map((l) => <AppText key={l} variant="caption">{l}</AppText>)}
        <AppText variant="caption" style={{ marginTop: 6 }}>We only keep an area about 1 km wide, never your exact spot.</AppText>
        {locNote ? (locNote.ok === false ? <ErrorText>{locNote.title}. {locNote.message}</ErrorText> : <AppText variant="caption" style={{ marginTop: 6 }}>{locNote.title}. {locNote.message}</AppText>) : null}
        <Spacer h={10} />
        <Button label="Update my location" loading={busy === 'loc'} onPress={() => void updateLocation()} />
        {loc.permission === 'blocked_in_settings' || locNote?.action === 'open_settings' ? <Button kind="ghost" label="Open Settings" onPress={openAppSettings} /> : null}
        <Spacer h={8} />
        <TextField label="Or use a city" value={city} onChangeText={setCity} autoCapitalize="words" maxLength={80} />
        <Button kind="secondary" label="Use this city" disabled={city.trim().length < 2} loading={busy === 'city'} onPress={() => void useCity()} />
      </Card>
    </>
  );
}
