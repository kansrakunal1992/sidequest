// Pure helpers for notifications: turn what Android and the server report into ONE plain reason and ONE plain next step.
// Nothing here touches the phone, so it is fully unit-tested.

/** Why turning notifications on did or did not work. */
export type PushReason = 'ok' | 'denied' | 'blocked_in_settings' | 'no_firebase' | 'token_upload_failed';
export type PushPermissionState = 'granted' | 'denied' | 'blocked_in_settings' | 'undetermined';
export type PushAction = 'open_settings' | 'retry' | 'enable' | 'none';

export interface PermissionLike { granted?: boolean; status?: string; canAskAgain?: boolean }

/**
 * Android only shows its permission box a limited number of times. After the person has said no twice, `canAskAgain` is false and the only way
 * to turn notifications on is the phone's Settings. Telling those two cases apart is what makes the next step correct.
 */
export function classifyPushPermission(p: PermissionLike): PushPermissionState {
  if (p.granted || p.status === 'granted') return 'granted';
  if (p.canAskAgain === false) return 'blocked_in_settings';
  if (p.status === 'undetermined') return 'undetermined';
  return 'denied';
}

/** The FCM token call fails in a recognisable way when the build was made without google-services.json. */
export function classifyTokenError(e: unknown): 'no_firebase' | 'unknown' {
  const text = `${(e as { code?: string })?.code ?? ''} ${(e as { message?: string })?.message ?? String(e ?? '')}`;
  return /firebaseapp|google-services|fcm|firebase|default app|service_not_available|missing_instanceid_service|not initiali[sz]ed/i.test(text) ? 'no_firebase' : 'unknown';
}

export interface Advice { title: string; message: string; action: PushAction }

const ADVICE: Record<PushReason, Advice> = {
  ok: { title: 'Notifications are on', message: 'This phone is registered. Use the test button to check that a notification arrives.', action: 'none' },
  denied: { title: 'Notifications are off', message: 'Tap Turn on notifications and choose Allow when Android asks.', action: 'enable' },
  blocked_in_settings: { title: 'Android needs you to switch them on', message: 'Android will not show its permission box again. Open Settings, choose Notifications and switch them on for this app.', action: 'open_settings' },
  no_firebase: { title: 'This build cannot receive notifications yet', message: 'The app was built without Firebase, so Android cannot give it a notification address. This is a setup step (guide, Part 8B), not a problem with your phone. After adding google-services.json, build the app again.', action: 'none' },
  token_upload_failed: { title: 'We could not save this phone', message: 'The phone is ready, but its notification address did not reach our server. Check your connection and try again.', action: 'retry' },
};
export const pushAdvice = (r: PushReason): Advice => ADVICE[r];

/** What the server says after "Send test notification". Mirrors apps/api PushTestResult. */
export interface PushTestResult { tokens: number; sent: number; error: 'not_configured' | 'no_token' | 'token_invalid' | 'send_failed' | null }
const TEST_ADVICE: Record<NonNullable<PushTestResult['error']>, Advice> = {
  not_configured: { title: 'The server is not set up for notifications', message: 'The server has no Firebase key. In Railway, add FCM_SERVICE_ACCOUNT_JSON (the whole key file from Firebase) to BOTH the API and worker services, then redeploy.', action: 'none' },
  no_token: { title: 'This phone is not registered yet', message: 'Tap Turn on notifications first, then try the test again.', action: 'enable' },
  token_invalid: { title: 'This phone\u2019s address has expired', message: 'Tap Turn on notifications to register it again, then run the test.', action: 'enable' },
  send_failed: { title: 'Google would not deliver the test', message: 'The server could not send through Firebase. Check that FCM_SERVICE_ACCOUNT_JSON is the full key file and that it belongs to the same Firebase project as google-services.json.', action: 'none' },
};
export function describeTestResult(r: PushTestResult): Advice & { ok: boolean } {
  if (!r.error) return { ok: true, title: 'Test sent', message: r.sent > 1 ? `Sent to ${r.sent} phones. A notification should appear in a few seconds. If it does not, check that this app\u2019s notifications are on in Android Settings.` : 'A notification should appear in a few seconds. If it does not, check that this app\u2019s notifications are on in Android Settings.', action: 'none' };
  return { ok: false, ...TEST_ADVICE[r.error] };
}

export interface PushStatus {
  permission: PushPermissionState;
  /** Did this phone's address reach the server? null = not checked yet. */
  tokenRegistered: boolean | null;
  /** Does the server have a Firebase key? null = could not ask. */
  serverConfigured: boolean | null;
}
const yn = (v: boolean | null, yes: string, no: string, unknown = 'not checked') => (v === null ? unknown : v ? yes : no);
const PERMISSION_TEXT: Record<PushPermissionState, string> = { granted: 'allowed', denied: 'not allowed', blocked_in_settings: 'blocked (change it in Android Settings)', undetermined: 'not asked yet' };

/** The few lines shown on the privacy screen. Plain words, no jargon. Also what to paste when asking for help. */
export function statusLines(s: PushStatus): string[] {
  return [
    `Permission: ${PERMISSION_TEXT[s.permission]}`,
    `This phone registered: ${yn(s.tokenRegistered, 'yes', 'no')}`,
    `Server ready to send: ${yn(s.serverConfigured, 'yes', 'no (no Firebase key)')}`,
  ];
}

/** The single most useful next step for a status, or null when everything is fine. */
export function nextStep(s: PushStatus): Advice | null {
  if (s.permission === 'blocked_in_settings') return ADVICE.blocked_in_settings;
  if (s.permission === 'denied' || s.permission === 'undetermined') return ADVICE.denied;
  if (s.serverConfigured === false) return TEST_ADVICE.not_configured;
  if (s.tokenRegistered === false) return ADVICE.no_firebase;
  return null;
}
