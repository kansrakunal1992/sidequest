import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, Text, View } from 'react-native';
import { progress } from '@/core/getting-started';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Card, Row, Spacer } from '@/design/ui';
import type { GettingStarted } from '@/lib/getting-started';
import { useTheme } from '@/lib/theme';

/** Top of the Profile tab: who you are, whether you are verified, and the two things people look for first. */
export function ProfileHeader({ gs, email }: { gs: GettingStarted; email?: string }) {
  const th = useTheme();
  const router = useRouter();
  return (
    <View>
      <Row style={{ gap: spacing.md, alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          {gs.mainPhotoUrl ? <Image source={{ uri: gs.mainPhotoUrl }} style={{ width: 72, height: 72 }} accessibilityLabel="Your main photo" /> : <Ionicons name="person" size={32} color={colors.textMuted} />}
        </View>
        <View style={{ flex: 1 }}>
          <Row><AppText variant="headline" accessibilityRole="header">{gs.name || 'Your profile'}{gs.age !== null ? `, ${gs.age}` : ''}</AppText>{gs.verified ? <Ionicons name="checkmark-circle" size={20} color={colors.cyan} accessibilityLabel="Photo verified" /> : null}</Row>
          {email ? <AppText muted variant="caption">{email}</AppText> : null}
          {!gs.loading && gs.verificationAvailable && !gs.verified ? (
            <Pressable onPress={() => router.push('/safety/verify' as never)} accessibilityRole="button" accessibilityLabel="Get your free verified badge" hitSlop={8}>
              <Text style={{ color: th.highlight, fontWeight: '700', marginTop: 2 }}>Get your free verified badge ›</Text>
            </Pressable>
          ) : null}
        </View>
      </Row>
      <Spacer h={spacing.md} />
      <Row style={{ gap: spacing.sm }}>
        <Pressable onPress={() => router.push('/my-profile' as never)} accessibilityRole="button" accessibilityLabel="See how others see your profile" style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: radius.md, backgroundColor: colors.surface }}>
          <Ionicons name="eye-outline" size={18} color={colors.text} /><Text style={{ color: colors.text, fontWeight: '700' }}>How others see you</Text></Pressable>
        <Pressable onPress={() => router.push('/edit-profile' as never)} accessibilityRole="button" accessibilityLabel="Edit profile" style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: radius.md, backgroundColor: th.accent }}>
          <Ionicons name="create-outline" size={18} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700' }}>Edit profile</Text></Pressable>
      </Row>
    </View>
  );
}

/** Full checklist on the Profile tab. Disappears by itself once everything is done. */
export function GettingStartedCard({ gs }: { gs: GettingStarted }) {
  const th = useTheme();
  const router = useRouter();
  const pr = progress(gs.steps);
  if (gs.loading || !gs.steps.length || pr.done === pr.total) return null;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}><AppText variant="title">Finish your profile</AppText><AppText muted variant="caption">{pr.done} of {pr.total}</AppText></Row>
      <Spacer h={spacing.sm} />
      {gs.steps.map((s) => (
        <Pressable key={s.id} disabled={s.done} onPress={() => router.push(s.route as never)} accessibilityRole="button" accessibilityLabel={`${s.title}${s.done ? ', done' : ''}`}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8 }}>
          <Ionicons name={s.done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={s.done ? colors.cyan : colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: s.done ? colors.textMuted : colors.text, fontWeight: '700', textDecorationLine: s.done ? 'line-through' : 'none' }}>{s.title}</Text>
            {!s.done ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{s.why}</Text> : null}
          </View>
          {!s.done ? <Text style={{ color: th.highlight, fontWeight: '700' }}>{s.cta}</Text> : null}
        </Pressable>
      ))}
    </Card>
  );
}

/** One slim, dismissible nudge on Discover: only the single next step, never a wall of tasks. */
export function NextStepBanner({ gs }: { gs: GettingStarted }) {
  const th = useTheme();
  const router = useRouter();
  if (!gs.bannerShown || !gs.next) return null;
  const s = gs.next;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface }}>
      <Ionicons name={s.id === 'verify' ? 'shield-checkmark-outline' : s.id === 'photos' ? 'images-outline' : 'create-outline'} size={22} color={th.highlight} />
      <Pressable style={{ flex: 1 }} onPress={() => router.push(s.route as never)} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.cta}`}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{s.title}</Text>
        <Text style={{ color: th.highlight, fontSize: 12, fontWeight: '700' }}>{s.cta} ›</Text>
      </Pressable>
      <Pressable onPress={gs.dismiss} accessibilityRole="button" accessibilityLabel="Dismiss for now" hitSlop={12}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable>
    </View>
  );
}
