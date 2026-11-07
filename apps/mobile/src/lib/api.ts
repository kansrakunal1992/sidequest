import { createApiClient } from '@/core/api-client';
import { supabase } from './supabase';

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
