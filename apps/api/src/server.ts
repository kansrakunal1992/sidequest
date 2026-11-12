import { createServer } from 'node:http';
import * as pg from 'pg';
import { createHandler } from './app.ts';
import { createDailyProvider } from './daily.ts';
import { loadConfig } from './config.ts';
import { InviteService } from './invite-service.ts';
import { createJwksProvider, verifyJwt } from './jwt.ts';
import { NoopPushSender, createNotifier, createPushTester } from './notifications.ts';
import type { PushSender } from './notifications.ts';
import { PgStore } from './pg-store.ts';
import { ChatMediaAccess } from './chat.ts';
import { AdminPhotoAccess } from './admin-photos.ts';
import { ExportAccess } from './data-requests.ts';
import { PhotoAccess } from './photo-access.ts';
import { PhotoService, SupabaseStorageSigner } from './photos.ts';
import { FcmSender } from './push-fcm.ts';
import { DiditProvider, SelfieVerification } from './selfie-verification.ts';
import { SupabaseAdminClient } from './supabase-admin.ts';

const cfg = loadConfig(process.env);
const log = (m: string) => console.log(JSON.stringify({ t: new Date().toISOString(), m }));

const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10, ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false });
const store = new PgStore(pool);
const clock = () => new Date();
const sender: PushSender = cfg.fcmServiceAccountJson ? new FcmSender(JSON.parse(cfg.fcmServiceAccountJson)) : new NoopPushSender();
if (!cfg.fcmServiceAccountJson) log('FCM_SERVICE_ACCOUNT_JSON not set: push notifications are disabled (in-app notifications still work)');
const notifier = createNotifier({ store, sender, clock, log });
const push = createPushTester({ store, sender, configured: !!cfg.fcmServiceAccountJson, log });
const invites = new InviteService({ store, clock, notify: async (n) => { await notifier.send(n); } });

const signer = cfg.serviceRoleKey ? new SupabaseStorageSigner(cfg.supabaseUrl, cfg.serviceRoleKey) : null;
if (!cfg.legalName || !cfg.contactEmail) log('LEGAL_NAME and CONTACT_EMAIL not set: the public /privacy, /terms and /delete-account pages are OFF (Google Play needs them before release)');
if (!cfg.anonKey) log('SUPABASE_ANON_KEY not set: the /admin page and the /delete-account page are OFF');
if (!signer) log('SUPABASE_SERVICE_ROLE_KEY not set: other people\'s photos cannot be shown');
const exportAccess = cfg.serviceRoleKey ? new ExportAccess(store, new SupabaseAdminClient(cfg.supabaseUrl, cfg.serviceRoleKey)) : null;
const chatMedia = signer ? new ChatMediaAccess(store, signer) : null;
const photoAccess = signer ? new PhotoAccess(store, signer) : null;
const photos = new PhotoService({
  store, moderator: null, // plug an ImageModerator in here when you pick a provider; until then photos wait for human review
  signer,
  mode: cfg.photoModeration, log,
});
if (cfg.photoModeration === 'off') log('WARNING: PHOTO_MODERATION=off. Photos are auto-approved. Development only.');

const selfie = cfg.didit && signer
  ? new SelfieVerification({ store, provider: new DiditProvider({ apiKey: cfg.didit.apiKey, workflowId: cfg.didit.workflowId, ...(cfg.didit.baseUrl ? { baseUrl: cfg.didit.baseUrl } : {}) }), signer, notifier, clock,
      webhookSecret: cfg.didit.webhookSecret, minScore: cfg.didit.minScore, monthlyCap: cfg.didit.monthlyCap, returnUrl: cfg.didit.returnUrl, log })
  : null;
if (!selfie) log(cfg.didit ? 'DIDIT_* is set but SUPABASE_SERVICE_ROLE_KEY is not: selfie verification is OFF' : 'DIDIT_* not set: selfie verification is OFF (the app hides it)');

const getJwks = createJwksProvider(`${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`, fetch);
const verifyToken = (token: string) =>
  verifyJwt(token, { hsSecret: cfg.jwtSecret ?? undefined, getJwks, now: new Date(), audience: 'authenticated', issuer: `${cfg.supabaseUrl}/auth/v1` });

const server = createServer(createHandler({ invites, store, verifyToken, clock, callsEnabled: cfg.callsEnabled, callProvider: cfg.daily ? createDailyProvider(cfg.daily) : null, corsOrigin: cfg.corsOrigin, photos, photoAccess, chatMedia, exports: exportAccess,
  legal: cfg.legalName && cfg.contactEmail ? { legalName: cfg.legalName, contactEmail: cfg.contactEmail, childSafetyEmail: cfg.childSafetyEmail ?? cfg.contactEmail, supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey, appName: cfg.appName, verificationProvider: cfg.didit ? 'Didit' : null } : null, admin: cfg.anonKey ? { supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey } : null,
  adminPhotos: signer && cfg.anonKey ? new AdminPhotoAccess(store, signer) : null, notifier, push, selfie, webhookSecret: cfg.webhookSecret, ageVerifier: null, log }));
server.listen(cfg.port, () => log(`api listening on ${cfg.port}`));

const stop = () => { log('shutting down'); server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
