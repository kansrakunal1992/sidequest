import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Notifier } from './notifications.ts';
import type { StorageSigner } from './photos.ts';
import type { Store } from './store.ts';
import { err, ok } from './types.ts';
import type { Result } from './types.ts';

// Automatic selfie verification. The provider (Didit) runs a liveness check and compares the live face with the person's approved profile photo.
// We never receive or store the selfie: only the verdict. No human looks at anything.

export class ProviderError extends Error {
  kind: 'bad_input' | 'unavailable';
  constructor(kind: 'bad_input' | 'unavailable', message: string) { super(message); this.kind = kind; }
}
export interface VerificationProvider {
  /** Opens a hosted selfie session in the provider's page. Idempotent per person while a session is unfinished. */
  createSession(input: { userId: string; portraitBase64: string; callbackUrl: string }): Promise<{ sessionId: string; url: string }>;
  /** Removes the session (and the selfie the provider holds) once we have the verdict. */
  deleteSession(sessionId: string): Promise<void>;
}

export interface DiditConfig { apiKey: string; workflowId: string; baseUrl?: string }
export class DiditProvider implements VerificationProvider {
  cfg: DiditConfig; fetchFn: typeof fetch;
  constructor(cfg: DiditConfig, fetchFn: typeof fetch = fetch) { this.cfg = cfg; this.fetchFn = fetchFn; }
  private base = (): string => (this.cfg.baseUrl ?? 'https://verification.didit.me').replace(/\/+$/, '');

  async createSession(i: { userId: string; portraitBase64: string; callbackUrl: string }) {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base()}/v3/session/`, {
        method: 'POST', headers: { 'x-api-key': this.cfg.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ workflow_id: this.cfg.workflowId, vendor_data: i.userId, callback: i.callbackUrl, portrait_image: i.portraitBase64 }),
      });
    } catch { throw new ProviderError('unavailable', 'network'); }
    if (res.status === 201 || res.status === 200) {
      const j = (await res.json().catch(() => ({}))) as { session_id?: string; url?: string };
      if (!j.session_id || !j.url) throw new ProviderError('unavailable', 'bad_response');
      return { sessionId: j.session_id, url: j.url };
    }
    let text = ''; try { text = await res.text(); } catch { /* ignore */ }
    // 400 is used both for a photo the provider cannot use AND for "insufficient credits". Only the first is the person's problem.
    if (res.status === 400 && !/credit|balance|insufficient/i.test(text)) throw new ProviderError('bad_input', text.slice(0, 200));
    throw new ProviderError('unavailable', `status_${res.status}`);
  }
  async deleteSession(sessionId: string): Promise<void> {
    const res = await this.fetchFn(`${this.base()}/v3/session/${encodeURIComponent(sessionId)}/delete/`, { method: 'DELETE', headers: { 'x-api-key': this.cfg.apiKey } });
    if (!res.ok && res.status !== 404) throw new Error(`delete_failed_${res.status}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------- webhook signature
const shortenFloats = (v: unknown): unknown => Array.isArray(v) ? v.map(shortenFloats) : v !== null && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)])) : v;
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v !== null && typeof v === 'object'
  ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((a, k) => { a[k] = sortKeys((v as Record<string, unknown>)[k]); return a; }, {}) : v;

/** Didit's X-Signature-V2: HMAC-SHA256 (hex) over the canonical JSON (keys sorted, whole floats as ints, compact), plus a 5 minute freshness window. */
export function verifyDiditSignature(rawBody: string, signature: string | undefined, timestamp: string | undefined, secret: string, nowMs: number): boolean {
  if (!signature || !timestamp || !secret) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(nowMs / 1000) - ts) > 300) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return false; }
  const expected = createHmac('sha256', secret).update(JSON.stringify(sortKeys(shortenFloats(parsed))), 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------------------------------------------- reading the verdict
/** Codes the app turns into plain words (apps/mobile/src/core/verify-core.ts). */
export type VerifyReason = 'face_mismatch' | 'liveness_failed' | 'low_match' | 'try_again' | 'not_finished';
export type Verdict = { outcome: 'approved' } | { outcome: 'rejected'; reason: VerifyReason } | { outcome: 'expired'; reason: VerifyReason } | { outcome: 'ignore' };

interface Check { status?: string; score?: number }
const statusOf = (c: Check): string => String(c.status ?? '');
const pct = (n: number): number => (n <= 1 ? n * 100 : n);   // some endpoints report 0 to 1, the decision reports 0 to 100

/**
 * Approve only when the provider approved AND at least one liveness check and one face match exist and are approved AND no match score is below our own floor.
 * "In Review" is never left waiting for a person: it becomes "try again".
 */
export function interpretDecision(payload: { status?: string; decision?: { liveness_checks?: Check[]; face_matches?: Check[] } }, minScore: number): Verdict {
  const status = String(payload.status ?? '');
  const live = payload.decision?.liveness_checks ?? [], match = payload.decision?.face_matches ?? [];
  if (status === 'Approved') {
    if (!live.length || live.some((c) => statusOf(c) !== 'Approved')) return { outcome: 'rejected', reason: 'liveness_failed' };
    if (!match.length || match.some((c) => statusOf(c) !== 'Approved')) return { outcome: 'rejected', reason: 'face_mismatch' };
    const scores = match.map((c) => c.score).filter((s): s is number => typeof s === 'number');
    if (scores.length && Math.min(...scores.map(pct)) < minScore) return { outcome: 'rejected', reason: 'low_match' };
    return { outcome: 'approved' };
  }
  if (status === 'Declined') return { outcome: 'rejected', reason: live.some((c) => statusOf(c) === 'Declined') ? 'liveness_failed' : match.some((c) => statusOf(c) === 'Declined') ? 'face_mismatch' : 'try_again' };
  if (status === 'In Review') return { outcome: 'rejected', reason: 'try_again' };
  if (status === 'Abandoned' || status === 'Expired') return { outcome: 'expired', reason: 'not_finished' };
  return { outcome: 'ignore' };       // Not Started, In Progress, Resubmitted...: still going
}

// ---------------------------------------------------------------------------------------------------------------- the service
export interface SelfieDeps {
  store: Store; provider: VerificationProvider; signer: StorageSigner; notifier: Notifier | null;
  clock: () => Date; webhookSecret: string;
  /** Match score (0 to 100) below which an "Approved" verdict is still refused. */
  minScore: number;
  /** Where the provider's page sends the person back to (the app's own link). */
  returnUrl: string;
  /** Checks started per calendar month across everyone: keeps the free allowance from being used up without notice. */
  monthlyCap: number;
  fetchFn?: typeof fetch;
  log?: (m: string) => void;
}
export const MAX_PER_DAY = 3, MAX_PER_WEEK = 6, OPEN_MINUTES = 35, MAX_PORTRAIT_BYTES = 1_000_000;

export class SelfieVerification {
  d: SelfieDeps;
  constructor(d: SelfieDeps) { this.d = d; }
  private log = (m: string) => (this.d.log ?? (() => {}))(m);

  /** Photos are fetched through a short-lived link and sent straight to the provider. Nothing is written to disk. */
  private async portrait(path: string): Promise<string | null> {
    try {
      const url = await this.d.signer.signedUrl('profile-photos', path, 120);
      const res = await (this.d.fetchFn ?? fetch)(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length === 0 || buf.length > MAX_PORTRAIT_BYTES ? null : buf.toString('base64');
    } catch { return null; }
  }

  async start(userId: string, consent: boolean): Promise<Result<{ url: string }>> {
    const { store, provider } = this.d; const now = this.d.clock();
    if (consent !== true) return err(400, 'consent_required');
    const flags = await store.getUserFlags(userId);
    if (!flags || flags.state !== 'active') return err(403, 'unavailable');
    if (await store.isVerified(userId)) return err(409, 'already_verified');

    const day = new Date(now.getTime() - 24 * 3600_000), week = new Date(now.getTime() - 7 * 24 * 3600_000);
    if (await store.countVerificationAttempts(day, userId) >= MAX_PER_DAY || await store.countVerificationAttempts(week, userId) >= MAX_PER_WEEK) return err(429, 'too_many_attempts');
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (await store.countVerificationAttempts(monthStart) >= this.d.monthlyCap) return err(503, 'verification_paused');

    const paths = await store.approvedPhotoPaths(userId);
    if (!paths.length) return err(422, 'no_approved_photo');

    const open = await store.openVerification(userId);
    if (open) {
      const ageMin = (now.getTime() - open.createdAt.getTime()) / 60_000;
      if (open.providerSessionId && ageMin < OPEN_MINUTES) {
        // The provider hands back the same unfinished session for the same person, so this simply reopens it.
        const portrait = await this.portrait(paths[0]!);
        if (portrait) { try { const s = await provider.createSession({ userId, portraitBase64: portrait, callbackUrl: this.d.returnUrl }); return ok({ url: s.url }); } catch { /* fall through to a fresh attempt */ } }
      } else if (!open.providerSessionId && ageMin < 2) return err(409, 'in_progress');
      await store.finishVerification(open.id, 'expired', 'not_finished', now);
    }

    const attempt = await store.createVerification(userId, now, new Date(now.getTime() + OPEN_MINUTES * 60_000));
    if (!attempt) return err(409, 'in_progress');
    let unusable = 0;
    for (const path of paths) {
      const portrait = await this.portrait(path);
      if (!portrait) { unusable++; continue; }
      try {
        const s = await provider.createSession({ userId, portraitBase64: portrait, callbackUrl: this.d.returnUrl });
        await store.attachProviderSession(attempt, s.sessionId);
        return ok({ url: s.url });
      } catch (e) {
        if (e instanceof ProviderError && e.kind === 'bad_input') { unusable++; continue; }
        this.log(`selfie verification: provider unavailable: ${(e as Error).message}`);
        await store.finishVerification(attempt, 'expired', 'provider_error', now);
        return err(502, 'provider_unavailable');
      }
    }
    await store.finishVerification(attempt, 'expired', 'no_usable_photo', now);
    return err(422, unusable ? 'photo_not_usable' : 'no_approved_photo');
  }

  /** Called by the webhook route. `after` is work to do once the response is on its way (the provider gives us 5 seconds). */
  async handleWebhook(raw: string, h: { signature?: string; timestamp?: string }): Promise<{ status: number; body: unknown; after?: () => Promise<void> }> {
    if (!verifyDiditSignature(raw, h.signature, h.timestamp, this.d.webhookSecret, this.d.clock().getTime())) return { status: 401, body: { error: 'unauthorized' } };
    let p: { webhook_type?: string; session_id?: string; status?: string; vendor_data?: string; decision?: any };
    try { p = JSON.parse(raw); } catch { return { status: 400, body: { error: 'invalid_json' } }; }
    if (p.webhook_type !== 'status.updated' || !p.session_id) return { status: 200, body: { ok: true, ignored: true } };
    const attempt = await this.d.store.findVerificationBySession(p.session_id);
    if (!attempt || (p.vendor_data && p.vendor_data !== attempt.userId)) return { status: 200, body: { ok: true, ignored: true } };
    const verdict = interpretDecision(p, this.d.minScore);
    if (verdict.outcome === 'ignore') return { status: 200, body: { ok: true, ignored: true } };

    const status = verdict.outcome === 'approved' ? 'approved' : verdict.outcome === 'rejected' ? 'rejected' : 'expired';
    const reason = verdict.outcome === 'approved' ? null : verdict.reason;
    const changed = await this.d.store.finishVerification(attempt.id, status, reason, this.d.clock());
    const sessionId = p.session_id;
    return {
      status: 200, body: { ok: true, changed },
      after: async () => {
        if (changed && status !== 'expired' && this.d.notifier) await this.d.notifier.send({ userId: attempt.userId, kind: 'verification_result', payload: { result: status }, dedupeKey: `verification:${attempt.id}` });
        // The verdict is all we keep. Ask the provider to delete its copy of the session and selfie.
        try { await this.d.provider.deleteSession(sessionId); } catch (e) { this.log(`selfie verification: could not delete provider session: ${(e as Error).message}`); }
      },
    };
  }
}
