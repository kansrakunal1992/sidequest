import * as Crypto from 'expo-crypto';
import type { ModeId } from '@sidequest/shared';
import type { ChatMessage } from '@/core/chat-core';
import { mapConversation, mapConversationInfo, mapMessage } from '@/core/mappers';
import { prepareImage } from './photos';
import { supabase } from './supabase';

const COLS = 'id, conversation_id, sender_id, body, media_kind, media_revealed_by, created_at';

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export const listConversations = async (mode: ModeId) => (await rpc<any[]>('my_conversations', { p_mode: mode })).map(mapConversation);
export async function getConversationInfo(id: string) {
  const rows = await rpc<any[]>('conversation_info', { p_conv: id });
  if (!rows?.[0]) throw Object.assign(new Error('unavailable'), { code: '42501' });
  return mapConversationInfo(rows[0]);
}
export const ensureMatchConversation = (matchId: string) => rpc<string>('ensure_match_conversation', { p_match: matchId });

/** Newest first. Pass the oldest message's time as `before` to load the page before it. */
export async function loadMessages(conversationId: string, before?: Date, limit = 40): Promise<ChatMessage[]> {
  let q = supabase.from('messages').select(COLS).eq('conversation_id', conversationId);
  if (before) q = q.lt('created_at', before.toISOString());
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapMessage);
}

export async function sendText(conversationId: string, me: string, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: me, body: body.trim() }).select(COLS).single();
  if (error) throw error;
  return mapMessage(data);
}

export async function sendImage(conversationId: string, me: string, uri: string): Promise<ChatMessage> {
  const bytes = await prepareImage(uri);                       // resized and re-encoded: location data is stripped
  const path = `${me}/${conversationId}/${Crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from('chat-media').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: me, media_path: path, media_kind: 'image' }).select(COLS).single();
  if (error) throw error;
  return mapMessage(data);
}

export async function markRead(conversationId: string, me: string): Promise<void> {
  await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('user_id', me);
}
export const revealMedia = (messageId: string) => rpc<void>('reveal_media', { p_message: messageId });

export function subscribeToThread(conversationId: string, me: string, h: { onMessage: (m: ChatMessage) => void; onDeleted: (id: string) => void; onReceipt: (at: Date) => void }): () => void {
  const filter = `conversation_id=eq.${conversationId}`;
  const ch = supabase.channel(`thread-${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (p: { new: any }) => h.onMessage(mapMessage(p.new)))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (p: { new: any }) => (p.new.deleted_at ? h.onDeleted(p.new.id) : h.onMessage(mapMessage(p.new))))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter }, (p: { new: any }) => { if (p.new.user_id !== me) h.onReceipt(new Date(p.new.last_read_at)); })
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

/** Fires whenever a message arrives in any of my conversations (row level security decides which). */
export function subscribeToInbox(onActivity: () => void): () => void {
  const ch = supabase.channel('inbox').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => onActivity()).subscribe();
  return () => { void supabase.removeChannel(ch); };
}
