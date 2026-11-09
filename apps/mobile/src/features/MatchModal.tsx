import { Modal, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients, radius, spacing } from '@/design/theme';
import { AppText, Button, Spacer } from '@/design/ui';
import { useTheme } from '@/lib/theme';

export function MatchModal({ name, onClose }: { name: string | null; onClose: () => void }) {
  const th = useTheme();
  return (
    <Modal transparent animationType="fade" visible={!!name} onRequestClose={onClose}>
      <View style={st.wrap}>
        <LinearGradient colors={[th.accent, th.accent2]} style={st.card}>
          <AppText variant="display" style={{ textAlign: 'center' }}>It's a match!</AppText>
          <Spacer h={8} /><AppText style={{ textAlign: 'center' }}>You and {name} liked each other.</AppText>
          <Spacer h={4} /><AppText variant="caption" style={{ textAlign: 'center' }}>Chat opens in the next update. Matches are saved in Likes and Matches.</AppText>
          <Spacer /><Button kind="secondary" label="Keep exploring" onPress={onClose} />
        </LinearGradient>
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.xl },
  card: { borderRadius: radius.lg, padding: spacing.xl },
});
