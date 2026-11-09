import { Linking } from 'react-native';
import { ApiError } from '@/core/api-client';
import { startErrorText } from '@/core/verify-core';
import { api } from '@/lib/api';
import { db } from '@/lib/db';
import { parseMyVerification } from '@/core/verify-core';

/** Opens the provider's selfie page in the phone's browser. Returns an error message to show, or null when the page was opened. */
export async function startSelfieCheck(): Promise<string | null> {
  try {
    const { url } = await api.startSelfieVerification(true);
    await Linking.openURL(url);
    return null;
  } catch (e) {
    return startErrorText(e instanceof ApiError ? e.code : (e as { code?: string })?.code ?? 'network_error');
  }
}

export async function readMyVerification() {
  try { return parseMyVerification(await db.myVerification()); } catch { return null; }
}
