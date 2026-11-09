import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { SUGGESTED_INTERESTS } from '@/core/onboarding';
import { colors, radius, spacing } from '@/design/theme';
import { AppText, Button, Chip, Row, Spacer, Wrap } from '@/design/ui';
import { noFilters } from '@/lib/discovery';
import type { Filters } from '@/lib/discovery';
import { useTheme } from '@/lib/theme';

const DISTANCES = [5, 10, 25, 50, 100];

/** Filters are free for everyone. Nothing here is locked. */
export function FilterSheet({ visible, value, onChange, onClose }: { visible: boolean; value: Filters; onChange: (f: Filters) => void; onClose: () => void }) {
  const th = useTheme();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={st.sheet}>
        <AppText variant="title">Filters</AppText>
        <Spacer h={spacing.md} />
        <AppText variant="caption">Into</AppText>
        <Wrap>{SUGGESTED_INTERESTS.slice(0, 12).map((i) => <Chip key={i} label={i} selected={value.interest === i} onPress={() => onChange({ ...value, interest: value.interest === i ? null : i })} />)}</Wrap>
        <Spacer />
        <AppText variant="caption">Within</AppText>
        <Wrap>
          <Chip label="Any" selected={value.maxKm === null} onPress={() => onChange({ ...value, maxKm: null })} />
          {DISTANCES.map((d) => <Chip key={d} label={`${d} km`} selected={value.maxKm === d} onPress={() => onChange({ ...value, maxKm: d })} />)}
        </Wrap>
        <Spacer />
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText>Available tonight</AppText>
          <Switch value={value.availableTonight} onValueChange={(v) => onChange({ ...value, availableTonight: v })} trackColor={{ true: th.accent, false: '#3A3160' }} thumbColor="#fff" accessibilityLabel="Available tonight" />
        </Row>
        <Spacer />
        <Row><View style={{ flex: 1 }}><Button kind="secondary" label="Clear" onPress={() => onChange(noFilters)} /></View><View style={{ flex: 1 }}><Button label="Done" onPress={onClose} /></View></Row>
      </View>
    </Modal>
  );
}
const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.surface, padding: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.xxl },
});
