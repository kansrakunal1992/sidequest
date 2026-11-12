// In-app calls through Daily (https://www.daily.co). Rooms and meeting tokens are created with Daily's REST API, so the API key stays on
// the server; the phone only ever receives a short-lived token for ONE room and ONE person.
// STATUS: written against Daily's public REST documentation and tested here with a fake Daily server. Not yet run against a real Daily account.

export interface DailyConfig { apiKey: string; domain: string; baseUrl?: string }
export interface CallRequest { room: string; identity: string; name?: string; now: Date; notAfter: Date; audioOnly: boolean }
export interface CallGrant { url: string; token: string }
/** What the HTTP layer needs. A fake one is used in tests; swapping provider later means writing one more of these. */
export interface CallProvider { createCall(req: CallRequest): Promise<CallGrant> }

export class CallProviderError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) { super(message); this.name = 'CallProviderError'; this.status = status; }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const TOKEN_MAX_SECONDS = 3600;     // a token never lives longer than an hour, even for a long call

export function createDailyProvider(cfg: DailyConfig, fetchFn: FetchFn = fetch): CallProvider {
  const base = (cfg.baseUrl ?? 'https://api.daily.co/v1').replace(/\/+$/, '');
  const known = new Map<string, number>();      // room -> exp (seconds) we already ensured, so the second person does not repeat the work

  async function call(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    } catch (e) { throw new CallProviderError(`Daily is not reachable: ${(e as Error).message}`); }
    let json: any = null; try { json = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, json };
  }

  /** A private room that only holds two people and closes itself when the call window ends. */
  async function ensureRoom(room: string, expS: number): Promise<void> {
    const had = known.get(room) ?? 0;
    if (had >= expS) return;
    const properties = { exp: expS, eject_at_room_exp: true, max_participants: 2, enable_prejoin_ui: false, enable_chat: false, enable_screenshare: false };
    const made = had ? { ok: false, status: 0 } : await call('/rooms', { name: room, privacy: 'private', properties });   // we made it earlier: just move its closing time
    if (!made.ok) {
      // Most likely it already exists (the other person joined first, or the plan was rescheduled): update its closing time instead.
      const upd = await call(`/rooms/${encodeURIComponent(room)}`, { properties: { exp: expS, eject_at_room_exp: true } });
      if (!upd.ok) throw new CallProviderError(`Daily would not create the room (${made.status}, ${upd.status})`, upd.status);
    }
    known.set(room, expS);
  }

  return {
    async createCall(req) {
      const nowS = Math.floor(req.now.getTime() / 1000);
      const roomExp = Math.floor(req.notAfter.getTime() / 1000);
      const tokenExp = Math.min(roomExp, nowS + TOKEN_MAX_SECONDS);
      await ensureRoom(req.room, roomExp);
      const t = await call('/meeting-tokens', { properties: {
        room_name: req.room, user_id: req.identity, user_name: req.name, is_owner: false, nbf: nowS - 5, exp: tokenExp, eject_at_token_exp: true,
        enable_screenshare: false, start_video_off: req.audioOnly,
      } });
      if (!t.ok || typeof t.json?.token !== 'string') throw new CallProviderError(`Daily would not issue a token (${t.status})`, t.status);
      return { url: `https://${cfg.domain}.daily.co/${req.room}`, token: t.json.token };
    },
  };
}
