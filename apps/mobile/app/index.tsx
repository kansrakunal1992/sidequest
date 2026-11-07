import { View } from 'react-native';
import { colors } from '@/design/theme';

/** The Gate in _layout redirects away from here as soon as the session is known. */
export default function Index() { return <View style={{ flex: 1, backgroundColor: colors.bg }} />; }
