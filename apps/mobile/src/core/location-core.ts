// Pure helpers for location: classify what happened, say what to do about it, and keep the privacy promise (round on the phone).

export type LocationReason = 'granted' | 'denied' | 'blocked_in_settings' | 'services_off' | 'timeout' | 'geocode_failed' | 'error';
export type LocationAction = 'open_settings' | 'turn_on_location' | 'type_city' | 'retry' | 'none';

/** Two decimal places is about 1 km. The server rounds again; doing it here means the exact spot never leaves the phone. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;
export const isValidCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export interface PermissionLike { granted?: boolean; status?: string; canAskAgain?: boolean }
/** `granted` | `denied` (can still be asked) | `blocked_in_settings` (Android will not ask again). */
export function classifyLocationPermission(p: PermissionLike): 'granted' | 'denied' | 'blocked_in_settings' | 'undetermined' {
  if (p.granted || p.status === 'granted') return 'granted';
  if (p.canAskAgain === false) return 'blocked_in_settings';
  if (p.status === 'undetermined') return 'undetermined';
  return 'denied';
}

/** Maps the errors expo-location throws (by code or wording) to a reason. Anything unknown stays 'error' and is never hidden behind a made-up cause. */
export function classifyLocationError(e: unknown): LocationReason {
  const text = `${(e as { code?: string })?.code ?? ''} ${(e as { message?: string })?.message ?? String(e ?? '')}`.toLowerCase();
  if (/timeout|timed out/.test(text)) return 'timeout';
  if (/services?.*(disabled|off|not enabled)|settings.?unsatisfied|location (is )?(turned off|disabled)|provider.*(disabled|unavailable)/.test(text)) return 'services_off';
  if (/permission|not authori[sz]ed|denied/.test(text)) return 'denied';
  if (/geocod/.test(text)) return 'geocode_failed';
  return 'error';
}

/** Rejects with a "timeout" error if `p` takes longer than `ms`. The timer is always cleared. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export interface PlaceLike { city?: string | null; subregion?: string | null; district?: string | null; region?: string | null }
export function pickCity(p: PlaceLike | null | undefined): string | null {
  const c = [p?.city, p?.subregion, p?.district, p?.region].map((x) => (x ?? '').trim()).find((x) => x.length > 0);
  return c ?? null;
}

export interface LocationAdvice { message: string; action: LocationAction }
const ADVICE: Record<LocationReason, LocationAdvice> = {
  granted: { message: 'Location added. We keep an area about 1 km wide, never your exact spot.', action: 'none' },
  denied: { message: 'Location is off. You can try again, or just type your city.', action: 'retry' },
  blocked_in_settings: { message: 'Android will not ask again. Open Settings, choose Permissions, then Location, and allow it. Or just type your city.', action: 'open_settings' },
  services_off: { message: 'Location is switched off on this phone. Turn it on in the quick settings, then try again. Or just type your city.', action: 'turn_on_location' },
  timeout: { message: 'We could not get a position in time. Go near a window or outdoors and try again, or type your city.', action: 'retry' },
  geocode_failed: { message: 'We could not find that place. Check the spelling, or add a bigger city nearby.', action: 'type_city' },
  error: { message: 'Something stopped us getting your location. Type your city instead.', action: 'type_city' },
};
export const locationAdvice = (r: LocationReason): LocationAdvice => ADVICE[r];

export interface LocationStatus { permission: 'granted' | 'denied' | 'blocked_in_settings' | 'undetermined'; servicesOn: boolean | null }
export function locationStatusLines(s: LocationStatus): string[] {
  const perm = { granted: 'allowed', denied: 'not allowed', blocked_in_settings: 'blocked (change it in Android Settings)', undetermined: 'not asked yet' }[s.permission];
  return [`Permission: ${perm}`, `Location switched on: ${s.servicesOn === null ? 'not checked' : s.servicesOn ? 'yes' : 'no'}`];
}
