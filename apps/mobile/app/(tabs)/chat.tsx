import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConversationItem } from '@/core/mappers';
import type { ApiInvite } from '@/core/api-client';
import { FORMAT_ICONS, FORMAT_LABELS, availableActions, formatWhen, otherId, stateSummary } from '@/core/invite-ui';
import type { Format } from '@/core/invite-ui';
import { previewText } from '@/core/chat-core';
import { timeAgo } from '@/core/time';
import { colors, spacing } from '@/design/theme';
import { AppText, EmptyState, ErrorText, Screen, Segmented, Spacer } from '@/design/ui';
import { PushPrompt } from '@/features/PushPrompt';
import { api } from '@/lib/api';
import { listConversations } from '@/lib/chat';
import { counterparts } from '@/lib/invites';
import type { Counterpart } from '@/lib/invites';
import { useModes } from '@/lib/modes';
import { usePhotoUrls } from '@/lib/photo-urls';
import { useSession } from '@/lib/session';
import { useUnread } from '@/lib/unread';

type Tab = 'messages' | 'invitations';
const Avatar = ({ uri }: { uri?: string }) => (uri ? <Image source={{ uri }} style={st.avatar} /> : <View style={[st.avatar, { backgroundColor: colors.surfaceRaised }]} />);

export default function ChatTab() {
  const { current } = useModes();
  const { session } = useSession();
  const { refresh: refreshUnread } = useUnread();
  const router = useRouter();
  const me = session?.user.id ?? '';
  const [tab, setTab] = useState<Tab>('messages');
  const [convs, setConvs] = useState<ConversationItem[]>([]);
  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [people, setPeople] = useState<Record<string, Counterpart>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const [c, i] = await Promise.all([listConversations(current), api.listInvites('all')]);
      const mine = i.filter((x) => x.modeId === current);
      setConvs(c); setInvites(mine); setPeople(await counterparts(mine.map((x) => otherId(x, me))).catch(() => ({})));
      setError(null); refreshUnread();
    } catch { setError('We could not load this. Check your connection.'); } finally { setLoading(false); }
  }, [current, me, refreshUnread]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const photos = usePhotoUrls(useMemo(() => (current ? [...convs.map((c) => c.userId), ...invites.map((i) => otherId(i, me))].map((userId) => ({ userId, modeId: current })) : []), [convs, invites, current, me]));
  const needsReply = invites.filter((i) => { const a = availableActions(i, me, now); return a.includes('accept') || a.includes('accept_reschedule'); });
  const rest = invites.filter((i) => !needsReply.includes(i));

  const InviteRow = ({ i }: { i: ApiInvite }) => {
    const who = otherId(i, me); const s = stateSummary(i, me);
    return (
      <Pressable onPress={() => router.push(`/invite/${i.id}` as never)} style={st.row} accessibilityRole="button" accessibilityLabel={`${FORMAT_LABELS[i.format as Format]} with ${people[who]?.displayName ?? 'someone'}. ${s.label}`}>
        <Avatar uri={photos[who]?.[0]} />
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{people[who]?.displayName ?? 'Someone'}</Text>
          <View style={st.meta}><Ionicons name={FORMAT_ICONS[i.format as Format] as never} size={14} color={colors.textMuted} /><Text style={st.sub}>{FORMAT_LABELS[i.format as Format]} · {formatWhen(i.startsAt)}</Text></View>
          <Text style={[st.state, s.tone === 'good' && { color: colors.cyan }, s.tone === 'wait' && { color: colors.violet }]}>{s.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    );
  };

  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Chat</AppText>
      <Spacer h={spacing.md} />
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ id: 'messages', label: `Messages${convs.some((c) => c.unread) ? ' •' : ''}` }, { id: 'invitations', label: `Invitations${needsReply.length ? ` (${needsReply.length})` : ''}` }]} />
      <Spacer h={spacing.md} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading ? <ActivityIndicator color={colors.violet} style={{ marginTop: 40 }} /> : tab === 'messages' ? (
        <>
          <PushPrompt />
          {convs.length === 0 ? <EmptyState title="No conversations yet" body="When you match, or someone accepts your invitation, you can chat here." /> : convs.map((c) => (
            <Pressable key={c.conversationId} onPress={() => router.push(`/chat/${c.conversationId}` as never)} style={st.row} accessibilityRole="button"
              accessibilityLabel={`${c.displayName}. ${c.unread ? `${c.unread} unread. ` : ''}${previewText({ body: c.lastBody, mediaKind: c.lastMediaKind, fromMe: c.lastFromMe })}`}>
              <Avatar uri={photos[c.userId]?.[0]} />
              <View style={{ flex: 1 }}>
                <View style={st.meta}><Text style={st.name}>{c.displayName}</Text>{c.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.cyan} /> : null}</View>
                <Text style={[st.sub, c.unread > 0 && { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>{previewText({ body: c.lastBody, mediaKind: c.lastMediaKind, fromMe: c.lastFromMe })}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={st.sub}>{timeAgo(c.lastAt, now)}</Text>
                {c.unread > 0 ? <View style={st.badge}><Text style={st.badgeText}>{c.unread > 9 ? '9+' : c.unread}</Text></View> : null}
              </View>
            </Pressable>
          ))}
        </>
      ) : invites.length === 0 ? <EmptyState title="No invitations yet" body="A friendly invitation is a gentle way to say hi. Send one from someone's profile." /> : (
        <>
          {needsReply.length ? <><AppText variant="title">Needs your reply</AppText>{needsReply.map((i) => <InviteRow key={i.id} i={i} />)}<Spacer /></> : null}
          {rest.length ? <><AppText variant="title">Everything else</AppText>{rest.map((i) => <InviteRow key={i.id} i={i} />)}</> : null}
        </>
      )}
    </Screen>
  );
}
const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  name: { color: colors.text, fontWeight: '700', fontSize: 16 },
  sub: { color: colors.textMuted, fontSize: 13 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  state: { color: colors.textMuted, fontSize: 12, marginTop: 2, fontWeight: '600' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
