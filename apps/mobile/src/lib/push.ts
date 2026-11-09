import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { Linking } from 'react-native';
import { classifyPushPermission, classifyTokenError } from '@/core/push-core';
import type { PushPermissionState, PushReason } from '@/core/push-core';
import { supabase } from './supabase';

const CHANNELS = [
  { id: 'invites', name: 'Invitations and plans' }, { id: 'messages', name: 'Messages' },
  { id: 'open_calls', name: 'Open Calls and groups' }, { id: 'safety', name: 'Safety check-ins' },
] as const;

/** Call once at start-up. Creates the Android notification channels and shows alerts while the app is open. Messages and safety alerts are HIGH so they actually pop up. */
export async function setupPush(): Promise<void> {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  const high = new Set(['messages', 'safety']);
  for (const c of CHANNELS) {
    try { await Notifications.setNotificationChannelAsync(c.id, { name: c.name, importance: high.has(c.id) ? Notifications.AndroidImportance.HIGH : Notifications.AndroidImportance.DEFAULT }); } catch { /* a channel problem must never stop the app starting */ }
  }
}

/** What Android currently says about notification permission, without asking. */
export async function readPushPermission(): Promise<PushPermissionState> {
  try { return classifyPushPermission(await Notifications.getPermissionsAsync()); } catch { return 'undetermined'; }
}

/**
 * Asks for permission (Android 13+) at a moment the person chose, then registers this phone for pushes.
 * Always returns the REASON, never a vague failure, so the screen can say exactly what to do.
 */
export async function enablePush(userId: string, ask: boolean): Promise<PushReason> {
  let perm = classifyPushPermission(await Notifications.getPermissionsAsync().catch(() => ({ granted: false, status: 'undetermined' as const })));
  if (perm !== 'granted' && ask && perm !== 'blocked_in_settings') {
    try { perm = classifyPushPermission(await Notifications.requestPermissionsAsync()); } catch { perm = 'denied'; }
  }
  if (perm === 'blocked_in_settings') return 'blocked_in_settings';
  if (perm !== 'granted') return 'denied';
  let token: string;
  try { token = String((await Notifications.getDevicePushTokenAsync()).data); }   // the FCM token; needs google-services.json in the build
  catch (e) { return classifyTokenError(e) === 'no_firebase' ? 'no_firebase' : 'token_upload_failed'; }
  try {
    const { error } = await supabase.from('push_tokens').upsert({ user_id: userId, token, platform: 'android', updated_at: new Date().toISOString() });
    return error ? 'token_upload_failed' : 'ok';
  } catch { return 'token_upload_failed'; }
}

/** Opens this app's page in Android Settings (where notification and location permissions live). */
export function openAppSettings(): void { void Linking.openSettings(); }

/** Opens the right screen when someone taps a notification. Notifications carry ids only, never names or text. */
export function useNotificationRouting(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const go = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (typeof data.inviteId === 'string') router.push(`/invite/${data.inviteId}` as never);
      else if (typeof data.conversationId === 'string') router.push(`/chat/${data.conversationId}` as never);
    };
    Notifications.getLastNotificationResponseAsync().then((r) => go(r?.notification.request.content.data));
    const sub = Notifications.addNotificationResponseReceivedListener((r) => go(r.notification.request.content.data));
    return () => sub.remove();
  }, [enabled, router]);
}
