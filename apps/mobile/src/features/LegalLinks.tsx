import { Linking, Pressable, View } from 'react-native';
import { legalLinks } from '@/core/legal';
import { colors } from '@/design/theme';
import { AppText } from '@/design/ui';
import { useTheme } from '@/lib/theme';

/** Terms and Community Guidelines, Privacy Policy and web account deletion. Google Play needs the privacy policy reachable inside the app. */
export function LegalLinks({ lead }: { lead?: string }) {
  const th = useTheme();
  const links = legalLinks(process.env.EXPO_PUBLIC_API_URL);
  if (!links) return null;
  const Link = ({ label, url }: { label: string; url: string }) => (
    <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel={label} hitSlop={8}><AppText variant="caption" style={{ color: th.highlight, textDecorationLine: 'underline' }}>{label}</AppText></Pressable>
  );
  return (
    <View>
      {lead ? <AppText variant="caption">{lead}</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
        <Link label="Terms and Community Guidelines" url={links.terms} /><Link label="Privacy Policy" url={links.privacy} /><Link label="Delete account (web)" url={links.deleteAccount} />
      </View>
    </View>
  );
}
