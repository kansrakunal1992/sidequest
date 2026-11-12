import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { friendlyError } from '@/core/api-client';
import { clock, endedText, isAudioOnly, joinLabel, secondsUntil } from '@/core/call-core';
import type { EndReason } from '@/core/call-core';
import { otherId } from '@/core/invite-ui';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Button, Card, ErrorText, Spacer } from '@/design/ui';
import { CallTile } from '@/features/CallTile';
import { SafetyMenu } from '@/features/SafetyMenu';
import { api } from '@/lib/api';
import { joinCall } from '@/lib/call';
import type { CallSession, CallSnapshot } from '@/lib/call';
import { ensureCallPermissions } from '@/lib/call-permissions';
import { counterparts } from '@/lib/invites';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Stage = 'prejoin' | 'joining' | 'in-call' | 'ended';

/** A one-to-one voice or video call for a confirmed invitation. Nothing starts (no camera, no microphone) until you tap Join. */
export default function CallScreen() {
  const th = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const [stage, setStage] = useState<Stage>('prejoin');
  const [format, setFormat] = useState<string>('video');
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<CallSnapshot | null>(null);
  const [until, setUntil] = useState<Date | null>(null);
  const [left, setLeft] = useState(0);
  const [reason, setReason] = useState<EndReason>('left');
  const [safety, setSafety] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const session_ = useRef<CallSession | null>(null);
  const started = useRef(0);
  const audioOnly = isAudioOnly(format);

  useEffect(() => {
    if (!id) return;
    api.getInvite(id).then(async (i) => {
      setFormat(i.format);
      const oid = otherId(i, me);
      const c = (await counterparts([oid]).catch(() => ({}))) as Record<string, { displayName?: string }>;
      setOther({ id: oid, name: c[oid]?.displayName ?? 'them' });
    }).catch((e) => setError(friendlyError(e)));
  }, [id, me]);

  const stop = useCallback(async (why: EndReason) => {
    const s = session_.current; session_.current = null;
    setReason(why); setStage('ended');
    if (s) await s.leave();
  }, []);
  useEffect(() => () => { void session_.current?.leave(); }, []);          // leaving the screen always leaves the call

  // A clock, and an automatic end when the call window closes (the server also ejects everyone then).
  useEffect(() => {
    if (stage !== 'in-call' || !until) return;
    const t = setInterval(() => { const s = secondsUntil(until, new Date()); setLeft(s); if (s <= 0) void stop('window_over'); }, 1000);
    return () => clearInterval(t);
  }, [stage, until, stop]);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (stage !== 'in-call') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  async function join() {
    if (!id) return;
    setError(null); setNote(null); setStage('joining');
    try {
      const perm = await ensureCallPermissions(audioOnly);
      if (!perm.ok) { setError(perm.message); setStage('prejoin'); return; }
      const wantAudioOnly = audioOnly || perm.cameraDenied;
      if (!audioOnly && perm.cameraDenied) setNote('Camera access is off, so you are joining with sound only. You can turn it on in your phone settings.');
      const grant = await api.callToken(id);
      const s = await joinCall({ url: grant.url, token: grant.token, audioOnly: wantAudioOnly });
      session_.current = s;
      setUntil(new Date(grant.notAfter)); setLeft(secondsUntil(new Date(grant.notAfter), new Date())); started.current = Date.now(); setElapsed(0);
      setSnap(s.snapshot());
      s.subscribe((n) => {
        setSnap(n);
        if (n.phase === 'failed') { setError(n.error ?? 'The call could not continue.'); void stop('dropped'); }
        else if (n.phase === 'ended' && session_.current) { void stop(n.dropped ? 'dropped' : 'left'); }
      });
      if (s.snapshot().phase === 'failed') { setError(s.snapshot().error ?? 'Could not join the call.'); session_.current = null; await s.leave(); setStage('prejoin'); return; }
      setStage('in-call');
    } catch (e) { setError(friendlyError(e)); setStage('prejoin'); }
  }

  const name = other?.name ?? 'them';
  const bar = { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm };

  if (stage === 'ended') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.xl }}>
        <Ionicons name="call" size={40} color={colors.textMuted} style={{ alignSelf: 'center' }} /><Spacer />
        <AppText variant="headline" style={{ textAlign: 'center' }}>Call ended</AppText><Spacer h={8} />
        <AppText muted style={{ textAlign: 'center' }}>{endedText(reason, name)}</AppText>
        {error ? <ErrorText>{error}</ErrorText> : null}<Spacer />
        {reason === 'dropped' ? <><Button label="Join again" onPress={() => { setError(null); setStage('prejoin'); }} /><Spacer h={8} /></> : null}
        <Button kind="secondary" label="Back to the plan" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (stage !== 'in-call') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 40, fontWeight: '700' }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
          <Spacer />
          <AppText variant="headline" style={{ textAlign: 'center' }}>{audioOnly ? 'Voice call' : 'Video call'} with {name}</AppText>
          <Spacer h={8} />
          <Card>
            <AppText variant="caption">{audioOnly ? 'Your microphone turns on when you join.' : 'Your camera and microphone turn on when you join. You can switch either off during the call.'} Waypoint does not record calls. You can leave, or report a problem, at any time.</AppText>
          </Card>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Spacer />
          <Button label={stage === 'joining' ? 'Connecting…' : joinLabel(format)} loading={stage === 'joining'} disabled={!other} onPress={() => void join()} />
        </View>
      </SafeAreaView>
    );
  }

  const remote = snap?.remote ?? null;
  const control = (icon: string, label: string, on: boolean, press: () => void, danger?: boolean) => (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
      style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.coral : on ? colors.surfaceRaised : '#fff' }}>
      <Ionicons name={icon as never} size={26} color={danger ? '#fff' : on ? colors.text : '#111'} />
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flex: 1 }}>
        {remote ? <CallTile tile={remote} fallbackName={name} /> : (
          <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={th.highlight} /><Spacer h={12} /><AppText>Waiting for {name} to join…</AppText>
          </View>
        )}
        {!audioOnly && snap?.local?.videoOn ? (
          <View style={{ position: 'absolute', right: spacing.lg, top: 96, width: 104, height: 144, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}>
            <CallTile tile={snap.local} fallbackName="You" mirror small />
          </View>
        ) : null}
      </View>
      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }} pointerEvents="box-none">
        <View style={[bar, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.45)' }]}>
          <View><Text style={{ color: '#fff', fontWeight: '700' }}>{name}</Text><Text style={{ color: '#ddd', fontSize: 12 }}>{clock(elapsed)}{left > 0 && left <= 300 ? ` · ends in ${clock(left)}` : ''}</Text></View>
          <Pressable onPress={() => setSafety(true)} accessibilityRole="button" accessibilityLabel="Report or block" hitSlop={10} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Ionicons name="shield-outline" size={20} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700' }}>Report</Text>
          </Pressable>
        </View>
        {note ? <Text style={{ color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, fontSize: 12 }}>{note}</Text> : null}
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, padding: spacing.lg }}>
          {control(snap?.micOn ? 'mic' : 'mic-off', snap?.micOn ? 'Mute microphone' : 'Unmute microphone', !!snap?.micOn, () => session_.current?.setMic(!snap?.micOn))}
          {!audioOnly ? control(snap?.camOn ? 'videocam' : 'videocam-off', snap?.camOn ? 'Turn camera off' : 'Turn camera on', !!snap?.camOn, () => session_.current?.setCam(!snap?.camOn)) : null}
          {!audioOnly && snap?.camOn ? control('camera-reverse', 'Switch camera', true, () => session_.current?.flip()) : null}
          {control('call', 'End call', false, () => void stop('left'), true)}
        </View>
      </SafeAreaView>
      {other ? <SafetyMenu visible={safety} me={me} other={other.id} name={name} onClose={() => setSafety(false)} onBlocked={() => void stop('left')} /> : null}
    </View>
  );
}
