import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, View } from 'react-native';
import { LIMITS } from '@/core/onboarding';
import { colors, radius } from '@/design/theme';
import { AppText, Button, Card, Spacer } from '@/design/ui';
import { StepFrame } from '@/features/StepFrame';
import { useOnboarding } from '@/lib/onboarding-context';
import { pickPhotos } from '@/lib/photos';

export default function Photos() {
  const { state, dispatch } = useOnboarding();
  async function add() { const uris = await pickPhotos(LIMITS.photosMax - state.photos.length); if (uris.length) dispatch({ type: 'addPhotos', uris }); }
  return (
    <StepFrame step="photos" title="Add your photos" subtitle="Clear, recent photos of you work best. The first one is your main photo.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {state.photos.map((p, i) => (
          <View key={p.uri} style={{ width: '31%', aspectRatio: 3 / 4, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface }}>
            <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} accessibilityLabel={`Photo ${i + 1}`} />
            <Pressable onPress={() => dispatch({ type: 'removePhoto', index: i })} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}
              style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 2 }}>
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
        ))}
      </View>
      <Spacer />
      {state.photos.length < LIMITS.photosMax ? <Button kind="secondary" label={state.photos.length ? 'Add more' : 'Choose photos'} onPress={add} /> : null}
      <Spacer />
      <Card><AppText variant="caption">Photos are checked before other people can see them. We remove location data from every photo. You choose which photos show in each vibe later.</AppText></Card>
    </StepFrame>
  );
}
