// RENDER-TEST STAND-IN for @daily-co/react-native-daily-js. A controllable fake call object, reachable as window.__daily.
// Tests add the other person with: __daily.store.them = {...}; __daily.emit('participant-joined').
import * as React from 'react';
const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const DailyMediaView = (p: { videoTrack: unknown }) => React.createElement('div', { 'data-testid': 'media', 'data-video': p.videoTrack ? 'on' : 'off' });
const Daily = {
  createCallObject: (opts: { videoSource?: boolean }) => {
    const handlers: Record<string, ((e?: unknown) => void)[]> = {};
    const store: Record<string, any> = { me: { local: true, user_name: 'Me', tracks: { audio: { state: 'playable', persistentTrack: {} }, video: { state: opts.videoSource ? 'playable' : 'off', persistentTrack: {} } } } };
    const fake: any = {
      store,
      participants: () => store,
      on(ev: string, cb: (e?: unknown) => void) { (handlers[ev] ??= []).push(cb); return fake; },
      emit(ev: string, e?: unknown) { (handlers[ev] ?? []).forEach((cb) => cb(e)); },
      async join(o: unknown) { rec({ kind: 'daily.join', o, opts }); if (g.__joinError) throw new Error(g.__joinError); fake.emit('joined-meeting'); return {}; },
      setLocalAudio(on: boolean) { rec({ kind: 'daily.mic', on }); store.me.tracks.audio.state = on ? 'playable' : 'off'; fake.emit('participant-updated'); return fake; },
      setLocalVideo(on: boolean) { rec({ kind: 'daily.cam', on }); store.me.tracks.video.state = on ? 'playable' : 'off'; fake.emit('participant-updated'); return fake; },
      async cycleCamera() { rec({ kind: 'daily.flip' }); },
      async leave() { rec({ kind: 'daily.leave' }); fake.emit('left-meeting'); },
      async destroy() { rec({ kind: 'daily.destroy' }); },
    };
    g.__daily = fake;
    return fake;
  },
};
export default Daily;
