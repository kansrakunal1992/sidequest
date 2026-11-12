import { ageOn } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';
import type { PromptAnswer } from '@/core/prompts';
import { readMyVerification } from '@/lib/verify';
import { loadMyPhotos } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import type { OwnPhoto } from '@/core/self-profile';

export interface OwnProfileData {
  displayName: string; age: number | null; area: string | null; baseBio: string; interests: string[];
  headline: string | null; modeBio: string | null; prompts: PromptAnswer[]; visiblePhotoIds: string[]; availability: string | null;
  verified: boolean; photos: OwnPhoto[];
}

/** Everything the "how others see me" screen needs, read from the person's own rows (RLS lets you read your own). */
export async function loadOwnProfile(uid: string, mode: ModeId | null): Promise<OwnProfileData> {
  const [p, m, a, v, photos] = await Promise.all([
    supabase.from('profiles').select('display_name, date_of_birth, bio, interests, city, neighborhood').eq('id', uid).single(),
    mode ? supabase.from('mode_specific_profiles').select('headline, bio, prompts, visible_photo_ids').eq('user_id', uid).eq('mode_id', mode).maybeSingle() : Promise.resolve({ data: null }),
    mode ? supabase.from('user_active_modes').select('availability').eq('user_id', uid).eq('mode_id', mode).maybeSingle() : Promise.resolve({ data: null }),
    readMyVerification(),
    loadMyPhotos(uid),
  ]);
  if ((p as any).error) throw (p as any).error;
  const row = (p as any).data ?? {};
  let age: number | null = null;
  try { age = row.date_of_birth ? ageOn(row.date_of_birth, new Date()) : null; } catch { age = null; }
  const msp = (m as any).data ?? null;
  return {
    displayName: row.display_name ?? '', age, area: row.neighborhood ?? row.city ?? null, baseBio: row.bio ?? '', interests: row.interests ?? [],
    headline: msp?.headline ?? null, modeBio: msp?.bio ?? null, prompts: Array.isArray(msp?.prompts) ? msp.prompts : [],
    visiblePhotoIds: Array.isArray(msp?.visible_photo_ids) ? msp.visible_photo_ids : [], availability: (a as any).data?.availability ?? null,
    verified: !!v?.verified, photos,
  };
}
