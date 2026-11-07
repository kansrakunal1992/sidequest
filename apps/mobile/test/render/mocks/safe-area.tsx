import * as React from 'react';
import { View } from 'react-native';
export const SafeAreaView = ({ children, style }: { children?: React.ReactNode; style?: unknown }) => <View style={style as never}>{children}</View>;
export const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
