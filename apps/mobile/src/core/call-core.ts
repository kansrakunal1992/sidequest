// Pure logic for in-app calls: who may join and when, what to show, and how to read Daily's participant list.
// No native modules here, so it runs in plain tests. The window rule mirrors the API (callWindow in invite-service.ts):
// from 10 minutes before the start until 30 minutes after the planned end.

export const JOIN_EARLY_MIN = 10;
export const JOIN_LATE_MIN = 30;
export const CALL_FORMATS = ['voice', 'video', 'virtual_coffee'] as const;
export const isCallFormat = (f: string): boolean => (CALL_FORMATS as readonly string[]).includes(f);
/** Voice invitations start with the camera off. Video and virtual coffee start with it on. */
export const isAudioOnly = (f: string): boolean => f === 'voice';

export interface CallInvite { format: string; state: string; startsAt: string; durationMinutes: number }
export function callWindowFor(startsAtIso: string, durationMinutes: number): { from: Date; until: Date } {
  const s = new Date(startsAtIso).getTime();
  return { from: new Date(s - JOIN_EARLY_MIN * 60_000), until: new Date(s + (durationMinutes + JOIN_LATE_MIN) * 60_000) };
}

export type JoinState =
  | { kind: 'off' }                          // the app owner has not switched calls on
  | { kind: 'not_confirmed' }
  | { kind: 'soon'; opensAt: Date }
  | { kind: 'open'; until: Date }
  | { kind: 'ended' };

/** null when this invitation is not a call at all. */
export function joinState(inv: CallInvite, now: Date, callsOn: boolean): JoinState | null {
  if (!isCallFormat(inv.format)) return null;
  if (inv.state !== 'accepted' && inv.state !== 'rescheduled') return { kind: 'not_confirmed' };
  if (!callsOn) return { kind: 'off' };
  const w = callWindowFor(inv.startsAt, inv.durationMinutes);
  if (now < w.from) return { kind: 'soon', opensAt: w.from };
  if (now > w.until) return { kind: 'ended' };
  return { kind: 'open', until: w.until };
}

export const joinLabel = (format: string): string => (format === 'voice' ? 'Join voice call' : format === 'virtual_coffee' ? 'Join virtual coffee' : 'Join video call');

/** 65 -> "1:05", 3700 -> "1:01:40" */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
export const secondsUntil = (t: Date, now: Date): number => Math.max(0, Math.ceil((t.getTime() - now.getTime()) / 1000));

// ---- Reading Daily's participant list ------------------------------------------------------------------------------------------------
interface TrackLike { state?: string; persistentTrack?: unknown }
export interface ParticipantLike { local?: boolean; user_name?: string; tracks?: { audio?: TrackLike; video?: TrackLike } }
export interface Tile { name: string; videoTrack: unknown | null; audioTrack: unknown | null; videoOn: boolean; audioOn: boolean }
export interface Tiles { local: Tile | null; remote: Tile | null }

const tile = (p: ParticipantLike | undefined): Tile | null => {
  if (!p) return null;
  const v = p.tracks?.video, a = p.tracks?.audio;
  const videoOn = v?.state === 'playable' && !!v.persistentTrack, audioOn = a?.state === 'playable' && !!a.persistentTrack;
  return { name: p.user_name ?? '', videoTrack: videoOn ? v!.persistentTrack ?? null : null, audioTrack: a?.persistentTrack ?? null, videoOn, audioOn };
};
/** Daily lists everyone, flagged `local`. A call here has two people, so "remote" is the first person who is not you. */
export function tilesFromParticipants(all: Record<string, ParticipantLike>): Tiles {
  const list = Object.values(all);
  return { local: tile(list.find((p) => p.local)), remote: tile(list.find((p) => !p.local)) };
}

export type EndReason = 'left' | 'window_over' | 'dropped';
export const endedText = (r: EndReason, name: string): string =>
  r === 'window_over' ? 'The call window has ended.' : r === 'dropped' ? 'The connection was lost. You can join again while the window is open.' : `You left the call${name ? ` with ${name}` : ''}.`;
