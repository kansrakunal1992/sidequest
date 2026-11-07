export class ApiError extends Error {
  status: number; code: string; detail?: string;
  constructor(status: number, code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.status = status; this.code = code; if (detail !== undefined) this.detail = detail; }
}

export interface ApiInvite {
  id: string; senderId: string; recipientId: string; modeId: string; format: 'text' | 'voice' | 'video' | 'virtual_coffee' | 'intro_chat';
  state: string; proposedBy: 'sender' | 'recipient' | null; startsAt: string; timezone: string; durationMinutes: number;
  note: string | null; expiresAt: string; conversationId: string | null; createdAt: string;
}
export interface CreateInviteBody {
  recipientId: string; modeId: string; format: ApiInvite['format']; startsAt: string; timezone: string; durationMinutes: number; note?: string;
}

export function createApiClient(o: { baseUrl: string; getToken: () => Promise<string | null>; fetchFn?: typeof fetch }) {
  const fetchFn = o.fetchFn ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, '');

  async function raw(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const token = await o.getToken();
    if (!token) throw new ApiError(401, 'unauthorized');
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try { res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new ApiError(0, 'network_error'); }
    if (!res.ok) {
      let j: { error?: string; detail?: string } = {};
      try { j = await res.json(); } catch { /* non-JSON error */ }
      throw new ApiError(res.status, j.error ?? 'request_failed', j.detail);
    }
    return res;
  }
  const json = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => (await raw(method, path, body)).json() as Promise<T>;
  const act = (id: string, action: string) => json<{ invite: ApiInvite }>('POST', `/v1/invites/${id}/${action}`).then((r) => r.invite);

  return {
    createInvite: (b: CreateInviteBody) => json<{ invite: ApiInvite }>('POST', '/v1/invites', b).then((r) => r.invite),
    listInvites: (box: 'incoming' | 'outgoing' | 'all' = 'all') => json<{ invites: ApiInvite[] }>('GET', `/v1/invites?box=${box}`).then((r) => r.invites),
    getInvite: (id: string) => json<{ invite: ApiInvite }>('GET', `/v1/invites/${id}`).then((r) => r.invite),
    accept: (id: string) => act(id, 'accept'),
    decline: (id: string) => act(id, 'decline'),
    tooNew: (id: string) => act(id, 'too-new'),
    cancel: (id: string) => act(id, 'cancel'),
    complete: (id: string) => act(id, 'complete'),
    acceptReschedule: (id: string) => act(id, 'accept-reschedule'),
    reschedule: (id: string, b: { startsAt: string; durationMinutes: number; note?: string }) =>
      json<{ invite: ApiInvite }>('POST', `/v1/invites/${id}/reschedule`, b).then((r) => r.invite),
    startLightChat: (id: string) => json<{ conversationId: string }>('POST', `/v1/invites/${id}/light-chat`),
    downloadIcs: async (id: string) => (await raw('GET', `/v1/invites/${id}/ics`)).text(),
    callToken: (id: string) => json<{ url: string; token: string; room: string; notAfter: string }>('POST', `/v1/invites/${id}/call-token`),
    photoUrls: (items: { userId: string; modeId: string; all?: boolean }[]) =>
      json<{ results: { userId: string; modeId: string; urls: string[] }[]; expiresInSeconds: number }>('POST', '/v1/photos/urls', { items }),
    chatMediaUrl: (messageId: string) => json<{ url: string; expiresInSeconds: number }>('POST', '/v1/chat-media/url', { messageId }),
    config: () => json<{ calls: boolean; photos: boolean; chatImages: boolean; exports: boolean }>('GET', '/v1/config'),
    /** A 5-minute link to my own finished data export. */
    dataExportUrl: (requestId: string) => json<{ url: string; expiresInSeconds: number }>('GET', `/v1/data-requests/${requestId}/download`),
    submitPhoto: (photoId: string) => json<{ status: 'pending' | 'approved' | 'rejected' }>('POST', `/v1/photos/${photoId}/submit`),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;

/** Friendly copy for API error codes. Blocks and hidden modes deliberately read as plain "unavailable". */
export function friendlyError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'unknown';
  const map: Record<string, string> = {
    network_error: 'Could not reach SideQuest. Check your connection and try again.',
    unauthorized: 'Please sign in again.',
    unavailable: 'That person is not available right now.',
    needs_match: 'You will be able to send this once you have matched.',
    pending_exists: 'You already have an open invitation with them. Give them a little time to reply.',
    non_match_limit: 'You have sent a lot of invitations today. Try again tomorrow, or invite people you have matched with.',
    daily_limit: 'You have reached today\u2019s invitation limit. Try again tomorrow.',
    rate_limited: 'Slow down a little and try again in a moment.',
    start_time_out_of_range: 'Pick a time between 5 minutes and 90 days from now.',
    invalid_transition: 'This invitation has already changed. Pull to refresh.',
    too_early: 'It is a bit early. You can join from 10 minutes before the start.',
    call_ended: 'This call window has ended.',
    calls_not_configured: 'Calls are not switched on yet.',
    not_revealed: 'Tap to view the photo first.',
  };
  return map[code] ?? 'Something went wrong. Please try again.';
}
