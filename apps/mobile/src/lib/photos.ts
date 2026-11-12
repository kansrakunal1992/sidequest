import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LIMITS } from '@/core/onboarding';
import { describeUploadError } from '@/core/photo-upload';
import type { UploadSummary } from '@/core/photo-upload';
import { reorderToFront } from '@/core/self-profile';
import type { OwnPhoto } from '@/core/self-profile';
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

/** Uploads each picked photo. Photos are added AFTER the ones the person already has (startPosition), and every failure keeps its real reason
 *  so the screen can say what went wrong instead of a vague "did not upload". */
export async function uploadPhotos(userId: string, uris: string[], visibleModes: string[], startPosition = 0): Promise<UploadSummary> {
  let uploaded = 0;
  const errors: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    let path: string | null = null;
    try {
      const bytes = await prepareImage(uris[i]!);
      path = `${userId}/${Crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const ins = await supabase.from('profile_photos').insert({ user_id: userId, storage_path: path, position: startPosition + i, visible_modes: visibleModes }).select('id').single();
      if (ins.error) throw ins.error;
      uploaded += 1;
      api.submitPhoto(ins.data.id).catch(() => { /* stays pending; reviewed later */ });
    } catch (e) {
      errors.push(describeUploadError(e));
      if (path) void supabase.storage.from('profile-photos').remove([path]);   // do not leave an orphan file behind when the row insert failed
    }
  }
  return { uploaded, failed: uris.length - uploaded, errors: [...new Set(errors)] };
}

/** The person's own photos with short-lived signed links. Signed on the device because the photo API does not serve your own id. */
export async function loadMyPhotos(userId: string): Promise<OwnPhoto[]> {
  const { data, error } = await supabase.from('profile_photos').select('id, storage_path, moderation_status, visible_modes, position').eq('user_id', userId).order('position');
  if (error) throw error;
  const rows: OwnPhoto[] = (data ?? []).map((r: any) => ({ id: r.id, path: r.storage_path, status: r.moderation_status, visibleModes: r.visible_modes ?? [], position: r.position ?? 0 }));
  if (!rows.length) return [];
  const signed = await supabase.storage.from('profile-photos').createSignedUrls(rows.map((r) => r.path), 600);
  const byPath = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
  return rows.map((r) => ({ ...r, url: byPath.get(r.path) ?? undefined }));
}

/** Swap positions so the chosen photo comes first. The first approved photo is the one the verification selfie is compared with. */
export async function makeMainPhoto(photos: OwnPhoto[], id: string): Promise<void> {
  const order = reorderToFront(photos, id);
  for (const [photoId, position] of Object.entries(order)) {
    const cur = photos.find((p) => p.id === photoId);
    if (cur && cur.position === position) continue;
    const { error } = await supabase.from('profile_photos').update({ position }).eq('id', photoId);
    if (error) throw error;
  }
}
