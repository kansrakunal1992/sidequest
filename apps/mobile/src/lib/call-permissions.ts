import { PermissionsAndroid, Platform } from 'react-native';

export interface CallPermissionResult { ok: boolean; cameraDenied: boolean; message: string | null }

/** Asks for the microphone (always) and the camera (video calls). On iPhone the system asks the first time the call starts, so nothing to do here.
 *  A denied camera is not fatal: the call goes ahead with the camera off. A denied microphone is, because nobody could hear you. */
export async function ensureCallPermissions(audioOnly: boolean): Promise<CallPermissionResult> {
  if (Platform.OS !== 'android') return { ok: true, cameraDenied: false, message: null };
  const want = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(audioOnly ? [] : [PermissionsAndroid.PERMISSIONS.CAMERA])];
  const res = await PermissionsAndroid.requestMultiple(want);
  const mic = res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  const cam = audioOnly ? 'granted' : res[PermissionsAndroid.PERMISSIONS.CAMERA];
  if (mic !== 'granted') {
    const never = mic === 'never_ask_again';
    return { ok: false, cameraDenied: cam !== 'granted', message: never ? 'Microphone access is turned off. Turn it on for Waypoint in your phone settings, then try again.' : 'Waypoint needs the microphone so they can hear you. Allow it and try again.' };
  }
  return { ok: true, cameraDenied: cam !== 'granted', message: null };
}
