import * as React from 'react';
const g = globalThis as any;
const nav = (k: string) => (x: unknown) => { (g.__nav ??= []).push({ k, x }); };
export const useRouter = () => ({ push: nav('push'), replace: nav('replace'), back: () => nav('back')(null) });
export const useLocalSearchParams = () => g.__params ?? {};
export const useFocusEffect = (cb: () => void | (() => void)) => { React.useEffect(cb, [cb]); };
export const Stack = () => null;
