import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { formatWhen, parseLocalDateTime, quickSlots } from '@/core/invite-ui';
import { AppText, Chip, ErrorText, Spacer, TextField, Wrap } from '@/design/ui';

/** Quick choices plus an exact day and time (24-hour, in your phone's time zone). No extra date-picker library needed. */
export function TimePicker({ value, onChange }: { value: Date | null; onChange: (d: Date | null) => void }) {
  const now = useMemo(() => new Date(), []);
  const slots = useMemo(() => quickSlots(now), [now]);
  const [f, setF] = useState({ d: '', mo: '', y: String(now.getFullYear()), h: '', mi: '' });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setTouched(true); setF((p) => ({ ...p, [k]: v.replace(/\D/g, '') })); };
  const typed = f.d || f.mo || f.h || f.mi;
  const parsed = typed ? parseLocalDateTime(f.d, f.mo, f.y, f.h, f.mi) : null;
  useEffect(() => { if (typed) onChange(parsed); }, [f.d, f.mo, f.y, f.h, f.mi]);
  const picked = slots.find((s) => value && s.date.getTime() === value.getTime());
  return (
    <View>
      <Wrap>{slots.map((s) => <Chip key={s.label} label={s.label} selected={!!picked && picked.label === s.label} onPress={() => { setF({ d: '', mo: '', y: String(now.getFullYear()), h: '', mi: '' }); setTouched(false); onChange(s.date); }} />)}</Wrap>
      <Spacer h={12} />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Or choose a day and time (24-hour)</AppText>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Day" value={f.d} onChangeText={(t) => set('d', t)} keyboardType="number-pad" maxLength={2} placeholder="DD" /></View>
        <View style={{ flex: 1 }}><TextField label="Month" value={f.mo} onChangeText={(t) => set('mo', t)} keyboardType="number-pad" maxLength={2} placeholder="MM" /></View>
        <View style={{ flex: 1.3 }}><TextField label="Year" value={f.y} onChangeText={(t) => set('y', t)} keyboardType="number-pad" maxLength={4} placeholder="YYYY" /></View>
        <View style={{ flex: 1 }}><TextField label="Hour" value={f.h} onChangeText={(t) => set('h', t)} keyboardType="number-pad" maxLength={2} placeholder="HH" /></View>
        <View style={{ flex: 1 }}><TextField label="Min" value={f.mi} onChangeText={(t) => set('mi', t)} keyboardType="number-pad" maxLength={2} placeholder="MM" /></View>
      </View>
      {value ? <AppText variant="caption">{formatWhen(value)} (your time)</AppText> : null}
      {touched && typed && !parsed ? <ErrorText>That date or time does not look right.</ErrorText> : null}
    </View>
  );
}
