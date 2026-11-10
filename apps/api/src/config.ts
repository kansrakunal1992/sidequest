export interface Config {
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  jwtSecret: string | null;
  pgSsl: boolean;
  fcmServiceAccountJson: string | null;
  callsEnabled: boolean;
  livekit: { url: string; apiKey: string; apiSecret: string } | null;
  corsOrigin: string | null;
  photoModeration: 'required' | 'off';
  serviceRoleKey: string | null;
  /** The public anon key; with it the moderation page at /admin is switched on. */
  anonKey: string | null;
  /** Who runs the service, shown on the public privacy policy and terms (Google Play requires it). The public pages stay OFF until both are set. */
  legalName: string | null; contactEmail: string | null; childSafetyEmail: string | null; appName: string;
  webhookSecret: string | null;
  /** Automatic selfie verification (Didit). Null = switched off. All three DIDIT_ values must be set together. */
  didit: { apiKey: string; workflowId: string; webhookSecret: string; baseUrl: string | null; minScore: number; monthlyCap: number; returnUrl: string } | null;
}

/** Fails fast with ALL problems listed, so a bad deploy is obvious in the Railway logs. */
export function loadConfig(env: Record<string, string | undefined>, role: 'api' | 'worker' = 'api'): Config {
  const problems: string[] = [];
  const need = (k: string): string => { const v = env[k]?.trim(); if (!v) problems.push(`${k} is required`); return v ?? ''; };
  const databaseUrl = need('DATABASE_URL');
  const supabaseUrl = need('SUPABASE_URL').replace(/\/+$/, '');
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be 1-65535');
  if (env.FCM_SERVICE_ACCOUNT_JSON) { try { JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON); } catch { problems.push('FCM_SERVICE_ACCOUNT_JSON is not valid JSON'); } }

  const wantCalls = env.FEATURE_VIDEO_CALLS === 'true';
  let livekit: Config['livekit'] = null;
  if (wantCalls) {
    const url = env.LIVEKIT_URL, apiKey = env.LIVEKIT_API_KEY, apiSecret = env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) problems.push('FEATURE_VIDEO_CALLS=true needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET');
    else livekit = { url, apiKey, apiSecret };
  }
  // The worker deletes accounts and writes exports through the Supabase Admin API; without the key those jobs would silently never run.
  if (role === 'worker' && !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) problems.push('SUPABASE_SERVICE_ROLE_KEY is required for the worker (account deletion and data exports)');
  const pm = env.PHOTO_MODERATION ?? 'required';
  if (pm !== 'required' && pm !== 'off') problems.push('PHOTO_MODERATION must be "required" or "off"');
  if (env.WEBHOOK_SECRET && env.WEBHOOK_SECRET.trim().length < 16) problems.push('WEBHOOK_SECRET must be at least 16 characters');
  const diditKeys = ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET'] as const;
  const diditSet = diditKeys.filter((k) => env[k]?.trim());
  if (diditSet.length > 0 && diditSet.length < diditKeys.length) problems.push(`DIDIT_API_KEY, DIDIT_WORKFLOW_ID and DIDIT_WEBHOOK_SECRET must all be set together (missing: ${diditKeys.filter((k) => !env[k]?.trim()).join(', ')})`);
  const minScore = Number(env.VERIFY_MIN_MATCH_SCORE ?? 85), monthlyCap = Number(env.VERIFY_MONTHLY_CAP ?? 90);
  if (!Number.isFinite(minScore) || minScore < 50 || minScore > 99) problems.push('VERIFY_MIN_MATCH_SCORE must be a number from 50 to 99');
  if (!Number.isInteger(monthlyCap) || monthlyCap < 1) problems.push('VERIFY_MONTHLY_CAP must be a whole number of 1 or more');
  if (env.DIDIT_BASE_URL && !/^https:\/\/[^\s/]+/i.test(env.DIDIT_BASE_URL.trim())) problems.push('DIDIT_BASE_URL must start with https://');
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return {
    port, databaseUrl, supabaseUrl, jwtSecret: env.SUPABASE_JWT_SECRET?.trim() || null,
    pgSsl: env.PGSSL !== 'disable', fcmServiceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON || null,
    callsEnabled: wantCalls && livekit !== null, livekit, corsOrigin: env.CORS_ORIGIN?.trim() || null,
    photoModeration: pm as 'required' | 'off', serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
    webhookSecret: env.WEBHOOK_SECRET?.trim() || null, anonKey: env.SUPABASE_ANON_KEY?.trim() || null,
    legalName: env.LEGAL_NAME?.trim() || null, contactEmail: env.CONTACT_EMAIL?.trim() || null, childSafetyEmail: env.CHILD_SAFETY_EMAIL?.trim() || env.CONTACT_EMAIL?.trim() || null, appName: env.APP_NAME?.trim() || 'Waypoint',
    didit: diditSet.length === diditKeys.length ? { apiKey: env.DIDIT_API_KEY!.trim(), workflowId: env.DIDIT_WORKFLOW_ID!.trim(), webhookSecret: env.DIDIT_WEBHOOK_SECRET!.trim(), baseUrl: env.DIDIT_BASE_URL?.trim() || null, minScore, monthlyCap, returnUrl: env.VERIFY_RETURN_URL?.trim() || 'sidequest://safety/verify' } : null,
  };
}
