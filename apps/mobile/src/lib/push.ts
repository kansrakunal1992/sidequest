import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { supabase } from './supabase';

const CHANNELS = [
  { id: 'invites', name: 'Invitations and plans' }, { id: 'messages', name: 'Messages' },
  { id: 'open_calls', name: 'Open Calls and groups' }, { id: 'safety', name: 'Safety check-ins' },
] as const;

/** Call once at start-up. Creates the Android notification channels and shows alerts while the app is open. */
export async function setupPush(): Promise<void> {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  for (const c of CHANNELS) await Notifications.setNotificationChannelAsync(c.id, { name: c.name, importance: Notifications.AndroidImportance.DEFAULT });
}

/** Asks for permission (Android 13+) at a moment the person chose, then registers this phone for pushes. */
export async function enablePush(userId: string, ask: boolean): Promise<'granted' | 'denied' | 'unavailable'> {
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && ask) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    const token = await Notifications.getDevicePushTokenAsync();      // the FCM token; needs google-services.json in the build
    const { error } = await supabase.from('push_tokens').upsert({ user_id: userId, token: String(token.data), platform: 'android', updated_at: new Date().toISOString() });
    return error ? 'unavailable' : 'granted';
  } catch { return 'unavailable'; }
}

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
