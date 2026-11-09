import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatErrorMessage, conversationStarters, mergeMessages, receiptLabel, sendGate } from '@/core/chat-core';
import type { ChatMessage } from '@/core/chat-core';
import type { ThreadInfo } from '@/core/plans';
import { friendlyError } from '@/core/api-client';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Chip, ErrorText, Row, Wrap } from '@/design/ui';
import { GameButton } from '@/features/GameButton';
import { MessageWarningBanner, TrustCard } from '@/features/TrustBits';
import { incomingWarnings, parseTrust, trustCard } from '@/core/trust-ui';
import { db } from '@/lib/db';
import { blockUser } from '@/lib/discovery';
import { SafetyMenu } from '@/features/SafetyMenu';
import { api } from '@/lib/api';
import { loadMessages, markRead, revealMedia, sendImage, sendText, subscribeToThread } from '@/lib/chat';
import { getThreadInfo, getThreadMembers, reportContent } from '@/lib/plans';
import { pickPhotos } from '@/lib/photos';
import { useSession } from '@/lib/session';
import { useUnread } from '@/lib/unread';

function ImageBubble({ m, mine, onError }: { m: ChatMessage; mine: boolean; onError: (e: string) => void }) {
  const me = useSession().session?.user.id ?? '';
  const [url, setUrl] = useState<string | null>(null);
  const revealed = mine || m.revealedBy.includes(me);
  const fetchUrl = useCallback(async () => { try { setUrl((await api.chatMediaUrl(m.id)).url); } catch (e) { onError(friendlyError(e)); } }, [m.id, onError]);
  useEffect(() => { if (revealed) void fetchUrl(); }, [revealed, fetchUrl]);
  if (revealed) return url ? <Image source={{ uri: url }} style={st.img} accessibilityLabel="Photo" /> : <View style={[st.img, st.imgWait]}><ActivityIndicator color={colors.violet} /></View>;
  return (
    <Pressable onPress={async () => { try { await revealMedia(m.id); await fetchUrl(); } catch { onError('Could not open the photo.'); } }} style={[st.img, st.imgWait]} accessibilityRole="button" accessibilityLabel="Photo hidden. Tap to view">
      <Ionicons name="eye-off" size={28} color={colors.textMuted} /><Text style={{ color: colors.textMuted, marginTop: 6 }}>Photo. Tap to view</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>You choose whether to see it</Text>
    </Pressable>
  );
}

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { refresh: refreshUnread } = useUnread();
  const me = session?.user.id ?? '';
  const [info, setInfo] = useState<ThreadInfo | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [receipt, setReceipt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [trust, setTrust] = useState<ReturnType<typeof parseTrust>>(null);
  const [verifyOn, setVerifyOn] = useState(false);
  const [more, setMore] = useState(true);
  const msgsRef = useRef(msgs); msgsRef.current = msgs;

  useEffect(() => {
    if (!id || !me) return;
    let alive = true;
    (async () => {
      try {
        const [i, first] = await Promise.all([getThreadInfo(id), loadMessages(id)]);
        if (!alive) return;
        setInfo(i); setReceipt(i.otherLastReadAt); if (i.kind !== 'direct') setNames(await getThreadMembers(id).catch(() => ({}))); setMsgs(mergeMessages([], first)); setMore(first.length >= 40);
        await markRead(id, me); refreshUnread();
      } catch { if (alive) setError('This conversation is not available.'); } finally { if (alive) setLoading(false); }
    })();
    const off = subscribeToThread(id, me, {
      onMessage: (m) => { setMsgs((p) => mergeMessages(p, [m])); if (m.senderId !== me) void markRead(id, me).then(refreshUnread); },
      onDeleted: (mid) => setMsgs((p) => p.filter((x) => x.id !== mid)),
      onReceipt: setReceipt,
    });
    return () => { alive = false; off(); };
  }, [id, me, refreshUnread]);

  const direct = info?.kind === 'direct';
  // Facts about the other account. If the function is missing (migration 0015 not run yet) or fails, the card is simply not shown.
  useEffect(() => { if (id && direct) void db.chatTrust(id).then((r) => setTrust(parseTrust(r))).catch(() => setTrust(null)); }, [id, direct]);
  const warnings = useMemo(() => incomingWarnings(msgs, me), [msgs, me]);
  useEffect(() => { void api.config().then((c) => setVerifyOn(!!c.verification)).catch(() => setVerifyOn(false)); }, []);
  const card = useMemo(() => trustCard(trust, verifyOn), [trust, verifyOn]);
  const gate = useMemo(() => (direct ? sendGate(msgs, me) : { allowed: true, hint: null }), [direct, msgs, me]);
  const lastMine = [...msgs].reverse().find((m) => m.senderId === me);
  const label = direct ? receiptLabel(lastMine, receipt) : null;
  function reportMessage(m: ChatMessage) {
    Alert.alert('Report this message?', 'Our team will take a look. The sender is not told who reported it.', [{ text: 'Cancel', style: 'cancel' },
      { text: 'Report', onPress: () => void reportContent(me, 'message', m.id, m.senderId, 'Reported from a chat').then(() => Alert.alert('Thank you', 'We will review it.')).catch(() => setError('Could not send the report.')) }]);
  }

  function blockSender(m: ChatMessage) {
    Alert.alert('Block this person?', 'They are not told. The chat disappears from your list and they cannot contact you again. You can undo this in Safety and privacy.', [{ text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => void blockUser(me, m.senderId).then(() => router.back()).catch(() => setError('Could not block. Check your connection and try again.')) }]);
  }

  async function send() {
    if (!id || !text.trim() || sending || !gate.allowed) return;
    setSending(true); setError(null);
    const body = text; setText('');
    try { const m = await sendText(id, me, body); setMsgs((p) => mergeMessages(p, [m])); }
    catch (e) { setText(body); setError(chatErrorMessage((e as { code?: string }).code)); }
    finally { setSending(false); }
  }
  async function sendPhoto() {
    if (!id || !gate.allowed) return;
    Alert.alert('Send a photo?', 'Only send photos the other person would be glad to receive. Unsolicited intimate images are not allowed and lead to removal from SideQuest.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Choose photo', onPress: async () => {
        const [uri] = await pickPhotos(1); if (!uri) return;
        setSending(true); setError(null);
        try { const m = await sendImage(id, me, uri); setMsgs((p) => mergeMessages(p, [m])); } catch (e) { setError(chatErrorMessage((e as { code?: string }).code)); } finally { setSending(false); }
      } },
    ]);
  }
  async function older() {
    if (!id || !more || !msgs.length) return;
    const page = await loadMessages(id, msgs[0]!.createdAt).catch(() => []);
    setMore(page.length >= 40); setMsgs((p) => mergeMessages(p, page));
  }

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.violet} size="large" /></View>;
  if (!info) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center' }}><AppText style={{ textAlign: 'center' }}>{error ?? 'This conversation is not available.'}</AppText><Pressable onPress={() => router.back()}><AppText style={{ textAlign: 'center', marginTop: 12, color: colors.violet }}>Go back</AppText></Pressable></SafeAreaView>;

  const inverted = [...msgs].reverse();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Row style={st.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <View style={{ flex: 1 }}><Row><Text style={st.title}>{direct ? info.displayName : info.title ?? 'Group chat'}</Text>{direct && info.verified && verifyOn ? <Ionicons name="checkmark-circle" size={16} color={colors.cyan} /> : null}</Row></View>
        {direct ? <Pressable onPress={() => router.push({ pathname: '/invite/new', params: { to: info.userId, mode: info.modeId, name: info.displayName } } as never)} accessibilityRole="button" accessibilityLabel="Send an invitation" hitSlop={10}><Ionicons name="calendar" size={22} color={colors.text} /></Pressable> : <Text style={{ color: colors.textMuted, fontSize: 12 }}>{info.memberCount} people</Text>}
        {direct ? <GameButton conversationId={id!} /> : null}
        {direct ? <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="More" hitSlop={10}><Ionicons name="ellipsis-horizontal" size={22} color={colors.text} /></Pressable> : null}
      </Row>
      {direct ? <TrustCard lines={card.lines} suspicious={card.suspicious} /> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList inverted data={inverted} keyExtractor={(m: ChatMessage) => m.id} onEndReached={() => void older()} onEndReachedThreshold={0.4} contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }] }}><AppText muted style={{ textAlign: 'center', marginTop: 24 }}>{direct ? `Say hi to ${info.displayName}. A few shared interests can start things off.` : 'Say hello to the group.'}</AppText></View>}
          renderItem={({ item, index }: { item: ChatMessage; index: number }) => {
            const mine = item.senderId === me;
            return (
              <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
                {!direct && !mine ? <Text style={st.sender}>{names[item.senderId] ?? 'Someone'}</Text> : null}
                {warnings.get(item.id) ? (
                  <MessageWarningBanner warning={warnings.get(item.id)!} onReport={() => reportMessage(item)} onBlock={() => blockSender(item)}>
                    {(hidden) => <View style={[st.bubble, st.theirs]}>{hidden ? <Text style={[st.text, { fontStyle: 'italic' }]}>Hidden. Tap Show anyway if you want to read it.</Text> : <Text style={st.text}>{item.body}</Text>}</View>}
                  </MessageWarningBanner>
                ) : (
                <Pressable onLongPress={() => { if (!mine) reportMessage(item); }} delayLongPress={500} accessibilityHint={mine ? undefined : 'Long press to report this message'}>
                <View style={[st.bubble, mine ? st.mine : st.theirs]}>
                  {item.mediaKind === 'image' ? <ImageBubble m={item} mine={mine} onError={setError} /> : <Text style={st.text}>{item.body}</Text>}
                </View>
                </Pressable>
                )}
                {index === inverted.findIndex((m) => m.senderId === me) && mine && label ? <Text style={st.receipt}>{label}</Text> : null}
              </View>
            );
          }} />
        {direct && msgs.length === 0 ? <Wrap>{conversationStarters(info.sharedInterests).map((q) => <View key={q} style={{ margin: 4 }}><Chip label={q} onPress={() => setText(q)} /></View>)}</Wrap> : null}
        {error ? <View style={{ paddingHorizontal: spacing.lg }}><ErrorText>{error}</ErrorText></View> : null}
        {gate.hint ? <Text style={st.hint}>{gate.hint}</Text> : null}
        <Row style={st.composer}>
          <Pressable onPress={sendPhoto} disabled={!gate.allowed} accessibilityRole="button" accessibilityLabel="Send a photo" hitSlop={8}><Ionicons name="image" size={24} color={gate.allowed ? colors.textMuted : '#3A3160'} /></Pressable>
          <TextInput value={text} onChangeText={setText} placeholder={gate.allowed ? 'Message' : 'Waiting for a reply'} placeholderTextColor={colors.textMuted} editable={gate.allowed} multiline maxLength={4000} style={st.input} accessibilityLabel="Message" />
          <Pressable onPress={() => void send()} disabled={!text.trim() || sending || !gate.allowed} accessibilityRole="button" accessibilityLabel="Send" style={[st.send, (!text.trim() || !gate.allowed) && { opacity: 0.4 }]}>
            {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
      {direct && info.userId ? <SafetyMenu visible={menu} me={me} other={info.userId} name={info.displayName ?? 'them'} onClose={() => setMenu(false)} onBlocked={() => router.back()} /> : null}
    </SafeAreaView>
  );
}
const st = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 14 },
  title: { color: colors.text, fontWeight: '800', fontSize: 18 },
  bubble: { maxWidth: '82%', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
  mine: { backgroundColor: colors.primary }, theirs: { backgroundColor: colors.surface },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  receipt: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sender: { color: colors.textMuted, fontSize: 11, marginBottom: 2, marginLeft: 4 },
  img: { width: 220, height: 280, borderRadius: radius.sm },
  imgWait: { backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  composer: { paddingHorizontal: spacing.lg, paddingVertical: 8, gap: 10, alignItems: 'flex-end' },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
