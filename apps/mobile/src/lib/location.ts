import * as Location from 'expo-location';
import { classifyLocationError, classifyLocationPermission, isValidCoord, pickCity, roundCoord, withTimeout } from '@/core/location-core';
import type { LocationReason, LocationStatus } from '@/core/location-core';

export interface LocationOutcome {
  reason: LocationReason;
  /** Already rounded to 2 decimals (about 1 km) on this phone. */
  lat: number | null;
  lng: number | null;
  /** The town or city, when the phone could work it out. Missing city does NOT mean failure. */
  city: string | null;
}
const fail = (reason: LocationReason): LocationOutcome => ({ reason, lat: null, lng: null, city: null });

/** What the phone says right now, without asking. Used by the status card on the privacy screen. */
export async function readLocationStatus(): Promise<LocationStatus> {
  let permission: LocationStatus['permission'] = 'undetermined';
  let servicesOn: boolean | null = null;
  try { permission = classifyLocationPermission(await Location.getForegroundPermissionsAsync()); } catch { /* leave undetermined */ }
  try { servicesOn = await Location.hasServicesEnabledAsync(); } catch { /* leave unknown */ }
  return { permission, servicesOn };
}

/**
 * One place that gets an approximate position, for onboarding, plans and "Update my location".
 * Order: permission -> services on -> last known position (instant) -> a fresh low-accuracy fix (15 s cap).
 * Every failure comes back as a named reason; nothing is swallowed into a generic message.
 */
export async function getApproxLocation(opts: { ask: boolean }): Promise<LocationOutcome> {
  try {
    let perm = classifyLocationPermission(await Location.getForegroundPermissionsAsync());
    if (perm !== 'granted' && opts.ask && perm !== 'blocked_in_settings') perm = classifyLocationPermission(await Location.requestForegroundPermissionsAsync());
    if (perm === 'undetermined') perm = 'denied';
    if (perm !== 'granted') return fail(perm);

    if ((await Location.hasServicesEnabledAsync().catch(() => true)) === false) return fail('services_off');

    let pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    if (!pos) pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }), 15_000);
    if (!isValidCoord(pos.coords.latitude, pos.coords.longitude)) return fail('error');
    const lat = roundCoord(pos.coords.latitude), lng = roundCoord(pos.coords.longitude);

    let city: string | null = null;
    try { city = pickCity((await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }))[0]); } catch { /* the city can be typed */ }
    return { reason: 'granted', lat, lng, city };
  } catch (e) { return fail(classifyLocationError(e)); }
}

/** Manual fallback: turn a typed city into an approximate position. No permission needed. */
export async function locateTypedCity(city: string): Promise<LocationOutcome> {
  const text = city.trim();
  if (text.length < 2) return fail('geocode_failed');
  try {
    const hit = (await withTimeout(Location.geocodeAsync(text), 10_000))[0];
    if (!hit || !isValidCoord(hit.latitude, hit.longitude)) return fail('geocode_failed');
    return { reason: 'granted', lat: roundCoord(hit.latitude), lng: roundCoord(hit.longitude), city: text };
  } catch (e) { const r = classifyLocationError(e); return fail(r === 'error' ? 'geocode_failed' : r); }
}
