import Daily from '@daily-co/react-native-daily-js';
import type { DailyCall } from '@daily-co/react-native-daily-js';
import { tilesFromParticipants } from '@/core/call-core';
import type { Tiles } from '@/core/call-core';

// The one place that talks to Daily's phone SDK. The screen only sees a plain snapshot, so it can be tested without a phone.
// STATUS: written against Daily's documented API (react-native-daily-js 0.82). Not yet run on a real phone; that needs a development build.

export type Phase = 'connecting' | 'live' | 'ended' | 'failed';
export interface CallSnapshot extends Tiles { phase: Phase; micOn: boolean; camOn: boolean; error: string | null; dropped: boolean }
export interface CallSession {
  snapshot(): CallSnapshot;
  subscribe(cb: (s: CallSnapshot) => void): () => void;
  setMic(on: boolean): void;
  setCam(on: boolean): void;
  flip(): void;
  leave(): Promise<void>;
}

export async function joinCall(o: { url: string; token: string; audioOnly: boolean }): Promise<CallSession> {
  const co: DailyCall = Daily.createCallObject({ audioSource: true, videoSource: !o.audioOnly, subscribeToTracksAutomatically: true });
  let snap: CallSnapshot = { phase: 'connecting', local: null, remote: null, micOn: true, camOn: !o.audioOnly, error: null, dropped: false };
  const subs = new Set<(s: CallSnapshot) => void>();
  const push = (patch: Partial<CallSnapshot>) => { snap = { ...snap, ...patch }; subs.forEach((cb) => cb(snap)); };
  const refresh = () => {
    const t = tilesFromParticipants(co.participants() as never);
    push({ ...t, micOn: t.local ? t.local.audioOn : snap.micOn, camOn: t.local ? t.local.videoOn : snap.camOn });
  };
  let left = false;

  co.on('joined-meeting', () => { push({ phase: 'live' }); refresh(); });
  for (const e of ['participant-joined', 'participant-updated', 'participant-left'] as const) co.on(e, refresh);
  co.on('left-meeting', () => { if (!left) push({ phase: 'ended', dropped: true }); else push({ phase: 'ended' }); });
  co.on('error', (ev) => push({ phase: 'failed', error: (ev as { errorMsg?: string } | undefined)?.errorMsg ?? 'The call could not continue.' }));
  co.on('camera-error', () => push({ camOn: false }));

  try {
    await co.join({ url: o.url, token: o.token, startVideoOff: o.audioOnly, startAudioOff: false });
  } catch (e) {
    push({ phase: 'failed', error: (e as Error)?.message || 'Could not join the call.' });
  }
  return {
    snapshot: () => snap,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    setMic(on) { co.setLocalAudio(on); },
    setCam(on) { co.setLocalVideo(on); },
    flip() { void co.cycleCamera(); },
    async leave() { left = true; try { await co.leave(); } catch { /* already gone */ } try { await co.destroy(); } catch { /* ignore */ } push({ phase: 'ended' }); },
  };
}
