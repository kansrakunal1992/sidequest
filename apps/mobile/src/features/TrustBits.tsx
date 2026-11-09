import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bannerText, startsHidden } from '@/core/trust-ui';
import type { MessageWarning, TrustCardLine } from '@/core/trust-ui';
import { colors, radius, spacing } from '@/design/theme';
import { AppText } from '@/design/ui';
import { useTheme } from '@/lib/theme';

const TONE: Record<TrustCardLine['tone'], string> = { good: colors.cyan, neutral: colors.textMuted, warn: '#F5A524' };

/** Plain facts about the other person's account, shown openly at the top of a direct chat. Not a verdict. */
export function TrustCard({ lines, suspicious }: { lines: TrustCardLine[]; suspicious: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <View style={{ marginHorizontal: spacing.lg, marginBottom: 6, backgroundColor: t.surface, borderColor: suspicious ? '#F5A524' : t.border, borderWidth: 1, borderRadius: radius.sm, padding: 10 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel="About this account">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {lines.map((l) => <Text key={l.label} style={{ color: TONE[l.tone], fontSize: 12, fontWeight: '700' }}>{l.label}</Text>)}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
        </View>
      </Pressable>
      {suspicious ? <AppText variant="caption" style={{ marginTop: 6 }}>This account looks like it may be sending copy-and-paste messages. Be careful, and report it if it feels wrong.</AppText> : null}
      {open ? lines.filter((l) => l.detail).map((l) => <AppText key={l.label} variant="caption" style={{ marginTop: 4 }}>{l.label}: {l.detail}</AppText>) : null}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border }}><Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{label}</Text></Pressable>;
}

/**
 * Sits under a received message. Scam cues get a banner with Report, Block and "I know them". Explicit text is covered first;
 * the person decides whether to look, and can block and remove the chat in one step. A warning is a cue, never a verdict, and nothing is sent anywhere unless they tap.
 */
export function MessageWarningBanner({ warning, onReport, onBlock, children }: { warning: MessageWarning; onReport: () => void; onBlock: () => void; children: (hidden: boolean) => React.ReactNode }) {
  const [hidden, setHidden] = useState(startsHidden(warning));
  const [dismissed, setDismissed] = useState(false);
  const b = bannerText(warning);
  return (
    <View style={{ maxWidth: '82%' }}>
      {children(hidden)}
      {dismissed && !warning.explicit ? null : (
        <View accessibilityLiveRegion="polite" style={{ marginTop: 4, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: warning.level === 'warning' ? '#F5A524' : colors.textMuted, backgroundColor: 'rgba(245,165,36,0.10)' }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{warning.explicit && hidden ? 'This message may contain explicit content' : `Heads up: ${b.title.toLowerCase()}`}</Text>
          <AppText variant="caption" style={{ marginTop: 3 }}>{b.advice}</AppText>
          {b.more.length ? <AppText variant="caption" style={{ marginTop: 3 }}>Also: {b.more.join('; ').toLowerCase()}.</AppText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {warning.explicit && hidden ? <Action label="Show anyway" onPress={() => setHidden(false)} /> : null}
            <Action label="Report" onPress={onReport} />
            <Action label={warning.explicit ? 'Block and remove chat' : 'Block'} onPress={onBlock} />
            {!warning.explicit ? <Action label="I know them" onPress={() => setDismissed(true)} /> : null}
          </View>
        </View>
      )}
    </View>
  );
}
