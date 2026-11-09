import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { GAME_KINDS, GAME_LABELS } from '@sidequest/shared';
import { colors } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Spacer } from '@/design/ui';
import { db } from '@/lib/db';
import { useFeature } from '@/lib/theme';
import { friendlyError } from '@/core/errors';

/** The Play button in a direct chat: opens the game that is already running, or lets the person pick one to start. */
export function GameButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const hasGames = useFeature('games');
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const go = (sessionId: string) => { setOpen(false); router.push({ pathname: '/game/[id]', params: { id: sessionId, conversationId } } as never); };
  async function press() {
    setError(null);
    try { const running = (await db.activeGame(conversationId))[0]; if (running) { go(running.session_id); return; } setOpen(true); } catch (e) { setError(friendlyError(e)); setOpen(true); }
  }
  async function start(kind: string) {
    setBusy(true); setError(null);
    try { go(await db.startGame(conversationId, kind)); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  if (!hasGames) return null;
  return (
    <>
      <Pressable onPress={() => void press()} accessibilityRole="button" accessibilityLabel="Play a game" hitSlop={10}><Ionicons name="game-controller" size={22} color={colors.text} /></Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Card style={{ margin: 12 }}>
            <AppText variant="title">Play something together</AppText>
            <AppText muted variant="caption">Five quick rounds. They have to say yes first.</AppText>
            <Spacer h={10} />
            {error ? <ErrorText>{error}</ErrorText> : null}
            {GAME_KINDS.map((k) => <View key={k} style={{ marginBottom: 8 }}><Button kind="secondary" label={`${GAME_LABELS[k].title}: ${GAME_LABELS[k].blurb}`} disabled={busy} onPress={() => void start(k)} /></View>)}
            <Button kind="ghost" label="Close" onPress={() => setOpen(false)} />
          </Card>
        </View>
      </Modal>
    </>
  );
}
