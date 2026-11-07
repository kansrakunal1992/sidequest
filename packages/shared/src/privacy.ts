import type { ModeId } from './modes.ts';

// ---- Visitors: incognito and mode separation ------------------------------------------
export interface ProfileVisit { viewerId: string; visitedId: string; mode: ModeId; at: Date; incognito: boolean }

/** Latest non-incognito visit per viewer, for one mode, newest first. */
export function visibleVisitors(visits: ProfileVisit[], forUserId: string, mode: ModeId): { viewerId: string; at: Date }[] {
  const latest = new Map<string, Date>();
  for (const v of visits) {
    if (v.visitedId !== forUserId || v.mode !== mode || v.incognito) continue;
    const prev = latest.get(v.viewerId);
    if (!prev || v.at > prev) latest.set(v.viewerId, v.at);
  }
  return [...latest].map(([viewerId, at]) => ({ viewerId, at })).sort((x, y) => y.at.getTime() - x.at.getTime());
}

// ---- Couples: every partner consents independently ------------------------------------
export interface PartnerConsent { linkAccounts: boolean; sharedProfile: boolean; coupleDiscovery: boolean; withdrawn: boolean }
export interface CoupleLink { a: PartnerConsent; b: PartnerConsent; paused: boolean; unlinked: boolean }

export function coupleDiscoverable(l: CoupleLink): boolean {
  if (l.paused || l.unlinked) return false;
  const full = (p: PartnerConsent) => !p.withdrawn && p.linkAccounts && p.sharedProfile && p.coupleDiscovery;
  return full(l.a) && full(l.b);
}

// ---- Wingperson: scoped, revocable, never inside private chats ------------------------
export const WING_PERMISSIONS = [
  'view_shared_profile', 'suggest_profiles', 'suggest_openers', 'shortlist',
  'co_host_open_call', 'join_double_date',
] as const;
export type WingPermission = (typeof WING_PERMISSIONS)[number];
export type WingAction = WingPermission | 'read_chats' | 'send_message_as_owner';

export interface WingGrant { permissions: WingPermission[]; revokedAt: Date | null; expiresAt: Date | null }

export function wingCan(g: WingGrant, action: WingAction, now: Date): boolean {
  if (action === 'read_chats' || action === 'send_message_as_owner') return false; // hard rule, no override
  if (g.revokedAt && g.revokedAt <= now) return false;
  if (g.expiresAt && g.expiresAt <= now) return false;
  return g.permissions.includes(action);
}
