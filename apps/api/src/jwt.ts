import { createHmac, createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';

export const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');

export function signHs256(payload: Record<string, unknown>, secret: string | Buffer, header: Record<string, unknown> = {}): string {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

export interface Jwk { kid?: string; kty: string; [k: string]: unknown }
export interface VerifyOptions {
  /** Legacy Supabase projects: HS256 shared secret. */
  hsSecret?: string;
  /** Newer projects: asymmetric keys published at /auth/v1/.well-known/jwks.json */
  getJwks?: () => Promise<Jwk[]>;
  now: Date;
  audience?: string;
  issuer?: string;
  /** Clock skew tolerance in seconds. */
  leeway?: number;
}
export interface Claims { sub: string; exp: number; [k: string]: unknown }

export async function verifyJwt(token: string, o: VerifyOptions): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string }; let claims: Claims;
  try { header = JSON.parse(fromB64url(h).toString()); claims = JSON.parse(fromB64url(p).toString()); } catch { throw new Error('malformed'); }
  const signed = `${h}.${p}`, sig = fromB64url(s);

  if (header.alg === 'HS256') {
    if (!o.hsSecret) throw new Error('alg_not_allowed');
    const expect = createHmac('sha256', o.hsSecret).update(signed).digest();
    if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) throw new Error('bad_signature');
  } else if (header.alg === 'ES256' || header.alg === 'RS256') {
    if (!o.getJwks) throw new Error('alg_not_allowed');
    const keys = (await o.getJwks()).filter((k) => (header.kid ? k.kid === header.kid : true) && k.kty === (header.alg === 'ES256' ? 'EC' : 'RSA'));
    if (!keys.length) throw new Error('unknown_key');
    const good = keys.some((jwk) => {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      const v = createVerify(header.alg === 'ES256' ? 'SHA256' : 'RSA-SHA256').update(signed);
      return header.alg === 'ES256' ? v.verify({ key, dsaEncoding: 'ieee-p1363' }, sig) : v.verify(key, sig);
    });
    if (!good) throw new Error('bad_signature');
  } else {
    throw new Error('alg_not_allowed'); // includes "none"
  }

  const nowS = Math.floor(o.now.getTime() / 1000), leeway = o.leeway ?? 5;
  if (typeof claims.exp !== 'number' || nowS > claims.exp + leeway) throw new Error('expired');
  if (typeof claims.nbf === 'number' && nowS + leeway < claims.nbf) throw new Error('not_yet_valid');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('no_subject');
  if (o.audience && claims.aud !== o.audience && !(Array.isArray(claims.aud) && claims.aud.includes(o.audience))) throw new Error('bad_audience');
  if (o.issuer && claims.iss !== o.issuer) throw new Error('bad_issuer');
  return claims;
}

export function createJwksProvider(url: string, fetchFn: typeof fetch, ttlMs = 10 * 60_000, now: () => number = Date.now) {
  let cache: { keys: Jwk[]; at: number } | null = null;
  return async (): Promise<Jwk[]> => {
    if (cache && now() - cache.at < ttlMs) return cache.keys;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`jwks_fetch_failed_${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    cache = { keys: body.keys ?? [], at: now() };
    return cache.keys;
  };
}
