import { createSign } from 'node:crypto';
import { b64url } from './jwt.ts';
import type { PushMessage, PushResult, PushSender } from './notifications.ts';

export interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }

/** Firebase Cloud Messaging (HTTP v1) using a service account. fetch is injected so it can be tested. */
export class FcmSender implements PushSender {
  sa: ServiceAccount; fetchFn: typeof fetch; now: () => number;
  private cached: { token: string; exp: number } | null = null;
  constructor(sa: ServiceAccount, fetchFn: typeof fetch = fetch, now: () => number = Date.now) { this.sa = sa; this.fetchFn = fetchFn; this.now = now; }

  private assertion(): string {
    const iat = Math.floor(this.now() / 1000);
    const aud = this.sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const p = b64url(JSON.stringify({ iss: this.sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud, iat, exp: iat + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(this.sa.private_key);
    return `${h}.${p}.${b64url(sig)}`;
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.exp - 60_000 > this.now()) return this.cached.token;
    const res = await this.fetchFn(this.sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: this.assertion() }).toString(),
    });
    if (!res.ok) throw new Error(`fcm_auth_failed_${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: j.access_token, exp: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async send(token: string, msg: PushMessage, platform: 'android' | 'ios'): Promise<PushResult> {
    const access = await this.accessToken();
    const message: Record<string, unknown> = { token, notification: { title: msg.title, body: msg.body }, data: msg.data };
    if (platform === 'android') message.android = { priority: 'HIGH', notification: { channel_id: msg.channel } };
    const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return 'ok';
    let body = ''; try { body = await res.text(); } catch { /* ignore */ }
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(body)) return 'invalid_token';
    if (res.status === 401) this.cached = null; // refresh next time
    return 'error';
  }
}
