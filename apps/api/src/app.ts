import type { IncomingMessage, ServerResponse } from 'node:http';
import type { InviteService } from './invite-service.ts';
import type { Store } from './store.ts';
import type { Invite, Result } from './types.ts';
import { CallProviderError } from './daily.ts';
import type { CallProvider } from './daily.ts';
import { timingSafeEqual } from 'node:crypto';
import { handleMessageCreated, handleNotificationCreated } from './chat.ts';
import type { ChatMediaAccess } from './chat.ts';
import type { ExportAccess } from './data-requests.ts';
import { adminHeaders, adminPageHtml, newNonce } from './admin-page.ts';
import { deleteAccountHtml, pageHeaders, privacyHtml, termsHtml } from './public-pages.ts';
import type { LegalConfig } from './public-pages.ts';
import type { AdminPhotoAccess } from './admin-photos.ts';
import type { Notifier, PushTester } from './notifications.ts';
import type { PhotoAccess } from './photo-access.ts';
import type { AgeVerifier, PhotoService } from './photos.ts';
import type { SelfieVerification } from './selfie-verification.ts';
import { isUuid, parseCreateInvite, parseReschedule } from './validate.ts';

export interface AppDeps {
  invites: InviteService;
  store: Store;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  clock: () => Date;
  callsEnabled: boolean;
  callProvider: CallProvider | null;
  corsOrigin?: string | null;
  userRatePerMinute?: number;
  ipRatePerMinute?: number;
  photos?: PhotoService | null;
  photoAccess?: PhotoAccess | null;
  chatMedia?: ChatMediaAccess | null;
  exports?: ExportAccess | null;
  /** The moderation page at /admin (needs the public anon key) and the moderator-only photo link route. */
  admin?: { supabaseUrl: string; anonKey: string } | null;
  adminPhotos?: AdminPhotoAccess | null;
  /** Public privacy policy, terms and web account-deletion page. Off (404) unless set. */
  legal?: LegalConfig | null;
  notifier?: Notifier | null;
  /** Powers POST /v1/push/test and the `push` flag in /v1/config. */
  push?: PushTester | null;
  /** Shared secret for the Supabase database webhook. Without it the webhook route is disabled. */
  webhookSecret?: string | null;
  ageVerifier?: AgeVerifier | null;
  /** Automatic selfie verification. Off (the route answers 501 and /v1/config says so) unless the provider is configured. */
  selfie?: SelfieVerification | null;
  log?: (m: string) => void;
}

class HttpError extends Error { status: number; code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code; } }

/** Sliding-window limiter. In-memory, so per-instance; move to Redis if you run several API replicas. */
export class WindowLimiter {
  private hits = new Map<string, number[]>();
  check(key: string, nowMs: number, limit: number, windowMs = 60_000): { ok: boolean; retryAfterS: number } {
    const arr = (this.hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return { ok: false, retryAfterS: Math.max(1, Math.ceil((windowMs - (nowMs - arr[0]!)) / 1000)) }; }
    arr.push(nowMs); this.hits.set(key, arr);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (!v.some((t) => nowMs - t < windowMs)) this.hits.delete(k);
    return { ok: true, retryAfterS: 0 };
  }
}

export const inviteDto = (i: Invite) => ({
  id: i.id, senderId: i.senderId, recipientId: i.recipientId, modeId: i.modeId, format: i.format, state: i.state,
  proposedBy: i.proposedBy, startsAt: i.startsAt.toISOString(), timezone: i.timezone, durationMinutes: i.durationMinutes,
  note: i.note, activity: i.activity, venueName: i.venueName, areaLabel: i.areaLabel,
  expiresAt: i.expiresAt.toISOString(), conversationId: i.conversationId, createdAt: i.createdAt.toISOString(),
});

const MAX_BODY = 32 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'json_required');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
}

async function readRaw(req: IncomingMessage, max = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > max) throw new HttpError(413, 'body_too_large'); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createHandler(d: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const userLimiter = new WindowLimiter(), ipLimiter = new WindowLimiter(), testLimiter = new WindowLimiter();
  const log = d.log ?? (() => {});

  const send = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    res.end(text);
  };
  const sendResult = <T>(res: ServerResponse, r: Result<T>, okStatus: number, map: (v: T) => unknown) =>
    r.ok ? send(res, okStatus, map(r.value)) : send(res, r.status, r.detail ? { error: r.error, detail: r.detail } : { error: r.error });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (d.corsOrigin) {
      res.setHeader('access-control-allow-origin', d.corsOrigin);
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    if (method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
    if (method === 'GET' && (path === '/privacy' || path === '/terms' || path === '/delete-account')) {
      const l = d.legal;
      if (!l || (path === '/delete-account' && !l.anonKey)) return send(res, 404, { error: 'not_found' });
      const nonce = newNonce();
      res.writeHead(200, pageHeaders(nonce, path === '/delete-account' ? l.supabaseUrl : null));
      res.end(path === '/privacy' ? privacyHtml(l, nonce) : path === '/terms' ? termsHtml(l, nonce) : deleteAccountHtml(l, nonce));
      return;
    }
    if (method === 'GET' && path === '/admin') {
      if (!d.admin) return send(res, 404, { error: 'not_found' });
      const nonce = newNonce();
      res.writeHead(200, adminHeaders(nonce, d.admin.supabaseUrl));
      res.end(adminPageHtml({ nonce, supabaseUrl: d.admin.supabaseUrl, anonKey: d.admin.anonKey }));
      return;
    }

    if ((path === '/v1/hooks/message-created' || path === '/v1/hooks/notification-created') && method === 'POST') {
      const given = Buffer.from(String(req.headers['x-webhook-secret'] ?? ''));
      const want = Buffer.from(d.webhookSecret ?? '');
      if (!d.webhookSecret || !d.notifier || given.length !== want.length || !timingSafeEqual(given, want)) return send(res, 401, { error: 'unauthorized' });
      const body = await readJson(req) as { type?: string; record?: Record<string, unknown> };
      if (body.type !== 'INSERT' || !body.record) return send(res, 200, { ok: true, ignored: true });
      if (path === '/v1/hooks/notification-created') return send(res, 200, { ok: true, pushed: await handleNotificationCreated({ notifier: d.notifier }, body.record) });
      const n = await handleMessageCreated({ store: d.store, notifier: d.notifier, clock: d.clock },
        { id: String(body.record.id ?? ''), conversation_id: String(body.record.conversation_id ?? ''), sender_id: String(body.record.sender_id ?? '') });
      return send(res, 200, { ok: true, notified: n });
    }

    if (path === '/v1/hooks/didit' && method === 'POST') {
      // Signed by the provider; no user token. The signature is checked over the body before anything is believed.
      if (!d.selfie) return send(res, 404, { error: 'not_found' });
      const out = await d.selfie.handleWebhook(await readRaw(req), { signature: String(req.headers['x-signature-v2'] ?? '') || undefined, timestamp: String(req.headers['x-timestamp'] ?? '') || undefined });
      send(res, out.status, out.body);
      if (out.after) void out.after().catch((e: unknown) => log(`didit webhook follow-up failed: ${(e as Error).message}`));
      return;
    }

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0]!.trim();
    const nowMs = d.clock().getTime();
    const ipCheck = ipLimiter.check(ip, nowMs, d.ipRatePerMinute ?? 300);
    if (!ipCheck.ok) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(ipCheck.retryAfterS) });

    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return send(res, 401, { error: 'unauthorized' });
    let uid: string;
    try { uid = (await d.verifyToken(token)).sub; } catch { return send(res, 401, { error: 'unauthorized' }); }
    if (!isUuid(uid)) return send(res, 401, { error: 'unauthorized' });
    const uCheck = userLimiter.check(uid, nowMs, d.userRatePerMinute ?? 120);
    if (!uCheck.ok) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(uCheck.retryAfterS) });

    if (path === '/v1/invites' && method === 'POST') {
      const p = parseCreateInvite(await readJson(req));
      if (!p.ok) return sendResult(res, p, 400, () => null);
      return sendResult(res, await d.invites.create(uid, p.value), 201, (i) => ({ invite: inviteDto(i) }));
    }
    if (path === '/v1/invites' && method === 'GET') {
      const box = url.searchParams.get('box') ?? 'all';
      if (box !== 'incoming' && box !== 'outgoing' && box !== 'all') return send(res, 400, { error: 'invalid_box' });
      return send(res, 200, { invites: (await d.invites.list(uid, box)).map(inviteDto) });
    }

    if (path === '/v1/config' && method === 'GET') return send(res, 200, { calls: d.callsEnabled, photos: !!d.photoAccess, chatImages: !!d.chatMedia, exports: !!d.exports, push: !!d.push?.configured, verification: !!d.selfie });
    if (path === '/v1/verification/selfie/start' && method === 'POST') {
      if (!d.selfie) return send(res, 501, { error: 'selfie_verification_not_configured' });
      const b = await readJson(req) as { consent?: unknown };
      return sendResult(res, await d.selfie.start(uid, b.consent === true), 200, (v) => v);
    }
    if (path === '/v1/push/test' && method === 'POST') {
      await readJson(req);
      // 5 tests per 10 minutes per person: enough to troubleshoot, too few to be used as a spam cannon.
      const lim = testLimiter.check(uid, nowMs, 5, 600_000);
      if (!lim.ok) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(lim.retryAfterS) });
      if (!d.push) return send(res, 200, { tokens: 0, sent: 0, error: 'not_configured' });
      return send(res, 200, await d.push.test(uid));
    }
    if (path === '/v1/admin/photo-url' && method === 'POST') {
      if (!d.adminPhotos) return send(res, 404, { error: 'not_found' });
      return sendResult(res, await d.adminPhotos.urlFor(uid, ((await readJson(req)) as { photoId?: unknown }).photoId), 200, (v) => v);
    }
    const dr = /^\/v1\/data-requests\/([^/]+)\/download$/.exec(path);
    if (dr && method === 'GET') {
      if (!d.exports) return send(res, 501, { error: 'exports_not_configured' });
      return sendResult(res, await d.exports.urlFor(uid, dr[1]!), 200, (v) => v);
    }
    if (path === '/v1/chat-media/url' && method === 'POST') {
      const b = await readJson(req) as { messageId?: unknown };
      if (!d.chatMedia) return send(res, 501, { error: 'photos_not_configured' });
      return sendResult(res, await d.chatMedia.urlFor(uid, String(b.messageId ?? '')), 200, (v) => v);
    }
    if (path === '/v1/photos/urls' && method === 'POST') {
      const b = await readJson(req) as { items?: unknown };
      if (!d.photoAccess) return send(res, 501, { error: 'photos_not_configured' });
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) return send(res, 400, { error: 'invalid_items' });
      const items = b.items.map((x) => (typeof x === 'object' && x !== null ? x as Record<string, unknown> : {}))
        .map((x) => ({ userId: String(x.userId ?? ''), modeId: String(x.modeId ?? ''), all: x.all === true }));
      return send(res, 200, { results: await d.photoAccess.urlsFor(uid, items), expiresInSeconds: 600 });
    }
    const pm = /^\/v1\/photos\/([^/]+)\/submit$/.exec(path);
    if (pm && method === 'POST') {
      await readJson(req);
      if (!isUuid(pm[1]) || !d.photos) return send(res, 404, { error: 'not_found' });
      return sendResult(res, await d.photos.submit(uid, pm[1]!), 200, (v) => v);
    }
    if (path === '/v1/verification/age/start' && method === 'POST') {
      await readJson(req);
      if (!d.ageVerifier) return send(res, 501, { error: 'age_verification_not_configured' });
      return send(res, 200, await d.ageVerifier.start(uid));
    }

    const m = /^\/v1\/invites\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
    if (m) {
      const id = m[1]!, action = m[2];
      if (!isUuid(id)) return send(res, 404, { error: 'not_found' });
      if (!action && method === 'GET') return sendResult(res, await d.invites.get(uid, id), 200, (i) => ({ invite: inviteDto(i) }));
      if (action === 'ics' && method === 'GET') {
        const r = await d.invites.ics(uid, id);
        if (!r.ok) return sendResult(res, r, 200, () => null);
        res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="waypoint-${id}.ics"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(r.value); return;
      }
      if (method === 'POST') {
        const acts: Record<string, 'accept' | 'decline' | 'too_new' | 'cancel' | 'complete'> = {
          accept: 'accept', decline: 'decline', 'too-new': 'too_new', cancel: 'cancel', complete: 'complete' };
        if (action && acts[action]) { await readJson(req); return sendResult(res, await d.invites.act(uid, id, acts[action]!), 200, (i) => ({ invite: inviteDto(i) })); }
        if (action === 'reschedule') {
          const p = parseReschedule(await readJson(req));
          if (!p.ok) return sendResult(res, p, 400, () => null);
          return sendResult(res, await d.invites.requestReschedule(uid, id, p.value), 200, (i) => ({ invite: inviteDto(i) }));
        }
        if (action === 'accept-reschedule') { await readJson(req); return sendResult(res, await d.invites.acceptReschedule(uid, id), 200, (i) => ({ invite: inviteDto(i) })); }
        if (action === 'light-chat') { await readJson(req); return sendResult(res, await d.invites.startLightChat(uid, id), 200, (v) => v); }
        if (action === 'call-token') {
          await readJson(req);
          if (!d.callsEnabled || !d.callProvider) return send(res, 501, { error: 'calls_not_configured' });
          const w = await d.invites.callWindow(uid, id);
          if (!w.ok) return sendResult(res, w, 200, () => null);
          const name = (await d.store.getUserFlags(uid))?.displayName;
          try {
            const g = await d.callProvider.createCall({ room: w.value.room, identity: uid, name, now: d.clock(), notAfter: w.value.until, audioOnly: w.value.audioOnly });
            return send(res, 200, { url: g.url, token: g.token, room: w.value.room, audioOnly: w.value.audioOnly, notAfter: w.value.until.toISOString() });
          } catch (e) {
            log(`call provider failed: ${e instanceof CallProviderError ? e.message : 'unknown error'}`);   // never log the token or the key
            return send(res, 502, { error: 'call_provider_error' });
          }
        }
      }
    }
    return send(res, 404, { error: 'not_found' });
  }

  return (req, res) => {
    route(req, res).catch((e: unknown) => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      log(`unhandled: ${(e as Error).stack ?? e}`);
      send(res, 500, { error: 'internal' });
    });
  };
}
