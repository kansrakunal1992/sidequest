import type { StorageSigner } from './photos.ts';
import type { Store } from './store.ts';
import type { Notifier } from './notifications.ts';
import { err, ok } from './types.ts';
import type { Result } from './types.ts';
import { isUuid } from './validate.ts';

/**
 * Signed URLs for chat images. The sender can always see their own photo. Everyone else sees it only after they
 * have chosen to reveal it (the blur-until-tap consent step), and never if either person has blocked the other.
 */
export class ChatMediaAccess {
  store: Store; signer: StorageSigner;
  constructor(store: Store, signer: StorageSigner) { this.store = store; this.signer = signer; }

  async urlFor(viewerId: string, messageId: string): Promise<Result<{ url: string; expiresInSeconds: number }>> {
    if (!isUuid(messageId)) return err(404, 'not_found');
    const m = await this.store.getMessageMedia(messageId);
    if (!m || m.deleted || m.mediaKind !== 'image' || !m.mediaPath || !m.memberIds.includes(viewerId)) return err(404, 'not_found');
    if (viewerId !== m.senderId) {
      if (await this.store.isBlocked(viewerId, m.senderId)) return err(404, 'not_found');
      if (!m.revealedBy.includes(viewerId)) return err(403, 'not_revealed');
    }
    try { return ok({ url: await this.signer.signedUrl('chat-media', m.mediaPath, 300), expiresInSeconds: 300 }); }
    catch { return err(502, 'storage_unavailable'); }
  }
}

export interface MessageRecord { id: string; conversation_id: string; sender_id: string; created_at?: string }

/**
 * Called by a Supabase database webhook when a message is inserted. Sends a content-free push to the other
 * people in the conversation (no names, no text), at most one per conversation per minute.
 */
export async function handleMessageCreated(d: { store: Store; notifier: Notifier; clock: () => Date }, rec: MessageRecord): Promise<number> {
  if (!isUuid(rec.conversation_id) || !isUuid(rec.sender_id)) return 0;
  const bucket = Math.floor(d.clock().getTime() / 60_000);
  let sent = 0;
  for (const userId of await d.store.conversationMemberIds(rec.conversation_id)) {
    if (userId === rec.sender_id) continue;
    if (await d.store.isBlocked(userId, rec.sender_id)) continue;
    await d.notifier.send({ userId, kind: 'message_received', payload: { conversationId: rec.conversation_id }, dedupeKey: `msg:${rec.conversation_id}:${bucket}` });
    sent += 1;
  }
  return sent;
}

export interface NotificationRecord { user_id?: unknown; kind?: unknown; payload?: unknown; origin?: unknown }

/**
 * Called by a Supabase database webhook on notifications INSERT. Only rows written by database functions
 * (origin 'db') are pushed here; rows the API wrote were already pushed when they were created.
 */
export async function handleNotificationCreated(d: { notifier: Notifier }, rec: NotificationRecord): Promise<boolean> {
  if (rec.origin !== 'db' || typeof rec.kind !== 'string' || !isUuid(rec.user_id)) return false;
  const payload: Record<string, string> = {};
  if (rec.payload && typeof rec.payload === 'object') for (const [k, v] of Object.entries(rec.payload as Record<string, unknown>)) if (typeof v === 'string' && k.endsWith('Id')) payload[k] = v;
  await d.notifier.deliverPush({ userId: rec.user_id as string, kind: rec.kind as never, payload });
  return true;
}
