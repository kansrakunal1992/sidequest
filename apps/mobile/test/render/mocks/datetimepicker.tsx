// RENDER-TEST STAND-IN for @react-native-community/datetimepicker (the real one is the phone's native calendar and clock).
// window.__pick = { date?: ISO, time?: ISO } is what the "person" chooses when the native dialog opens.
import * as React from 'react';
const g = globalThis as any;
export const DateTimePickerAndroid = {
  open: (o: { mode: 'date' | 'time'; value: Date; minimumDate?: Date; maximumDate?: Date; onChange: (e: { type: string }, d?: Date) => void }) => {
    (g.__calls ??= []).push({ kind: 'nativePicker', mode: o.mode, min: o.minimumDate?.toISOString() ?? null, max: o.maximumDate?.toISOString() ?? null });
    const chosen = g.__pick?.[o.mode];
    if (chosen) o.onChange({ type: 'set' }, new Date(chosen)); else o.onChange({ type: 'dismissed' });
  },
  dismiss: () => {},
};
export default function DateTimePicker() { return React.createElement('div', null, 'native picker'); }
