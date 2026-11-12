import { buildSavePayload } from '@/core/onboarding';
import type { OnboardingState } from '@/core/onboarding';
import { uploadPhotos } from './photos';
import { supabase } from './supabase';

function friendly(error: { code?: string; message?: string }): Error {
  if (error.code === '23514') return new Error('Waypoint is for adults. You need to be 18 or over.');
  if (error.code === '22023' && error.message) return new Error(error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.');
  return new Error('We could not save your profile. Check your connection and try again.');
}

/** save_onboarding (server validates) -> upload photos -> finish_onboarding (server confirms a photo exists). */
export async function finishOnboarding(state: OnboardingState, userId: string, onProgress: (msg: string) => void): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const payload = buildSavePayload(state, tz, new Date());
  onProgress('Saving your profile');
  const saved = await supabase.rpc('save_onboarding', { p: payload });
  if (saved.error) throw friendly(saved.error);
  onProgress('Uploading your photos');
  const { uploaded, errors } = await uploadPhotos(userId, state.photos.map((p) => p.uri), state.modes);
  if (uploaded === 0) throw new Error(`Your photos did not upload. ${errors[0] ?? 'Check your connection'} Then tap Finish again.`);
  onProgress('Almost there');
  const done = await supabase.rpc('finish_onboarding');
  if (done.error) throw friendly(done.error);
}
