import { DailyMediaView } from '@daily-co/react-native-daily-js';
import { Text, View } from 'react-native';
import type { Tile } from '@/core/call-core';
import { colors } from '@/design/theme';

/** One person's picture and sound. With the camera off we show their initial instead of a black box. */
export function CallTile({ tile, fallbackName, mirror, small }: { tile: Tile | null; fallbackName: string; mirror?: boolean; small?: boolean }) {
  const name = tile?.name || fallbackName;
  if (tile?.videoOn || (tile && tile.audioTrack && !small)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <DailyMediaView videoTrack={(tile.videoTrack ?? null) as never} audioTrack={(tile.audioTrack ?? null) as never} mirror={mirror} objectFit="cover" zOrder={small ? 1 : 0} style={{ flex: 1 } as never} />
        {!tile.videoOn ? <Avatar name={name} overlay /> : null}
      </View>
    );
  }
  return <View style={{ flex: 1, backgroundColor: colors.surface }}><Avatar name={name} overlay /></View>;
}
function Avatar({ name, overlay }: { name: string; overlay?: boolean }) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center' }, overlay ? { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.surface } : { flex: 1 }]}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 40, fontWeight: '700' }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
      </View>
    </View>
  );
}
