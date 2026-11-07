import { signHs256 } from './jwt.ts';

export interface LiveKitConfig { url: string; apiKey: string; apiSecret: string }

/** Short-lived access token for one participant in one room (LiveKit access-token format). */
export function createLiveKitToken(cfg: LiveKitConfig, o: { room: string; identity: string; name?: string; now: Date; notAfter: Date }) {
  const nowS = Math.floor(o.now.getTime() / 1000);
  const exp = Math.min(Math.floor(o.notAfter.getTime() / 1000), nowS + 3600);
  return signHs256({
    iss: cfg.apiKey, sub: o.identity, name: o.name, nbf: nowS - 5, exp,
    video: { room: o.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false },
  }, cfg.apiSecret);
}
