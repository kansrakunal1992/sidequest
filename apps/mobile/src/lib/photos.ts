import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LIMITS } from '@/core/onboarding';
import { api } from './api';
import { supabase } from './supabase';

/** Uses Android's system photo picker, so no storage permission is requested. */
export async function pickPhotos(remaining: number): Promise<string[]> {
  if (remaining <= 0) return [];
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.min(remaining, LIMITS.photosMax), quality: 1, exif: false });
  return res.canceled ? [] : res.assets.map((a) => a.uri);
}

/** Resize and re-encode. Re-encoding also drops EXIF metadata, including any GPS location in the original. */
export async function prepareImage(uri: string): Promise<ArrayBuffer> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  return (await fetch(out.uri)).arrayBuffer();
}

export async function uploadPhotos(userId: string, uris: string[], visibleModes: string[]): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0, failed = 0;
  for (let i = 0; i < uris.length; i++) {
    try {
      const bytes = await prepareImage(uris[i]!);
      const path = `${userId}/${Crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const ins = await supabase.from('profile_photos').insert({ user_id: userId, storage_path: path, position: i, visible_modes: visibleModes }).select('id').single();
      if (ins.error) throw ins.error;
      uploaded += 1;
      api.submitPhoto(ins.data.id).catch(() => { /* stays pending; reviewed later */ });
    } catch { failed += 1; }
  }
  return { uploaded, failed };
}
