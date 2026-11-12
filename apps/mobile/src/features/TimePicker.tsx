import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, Text, View } from 'react-native';
import { DEFAULT_PICK_HOUR, MAX_PICK_DAYS, combineDateAndTime, formatDay, formatTime, formatWhen, quickSlots, startOfDay, whenProblem } from '@/core/invite-ui';
import { colors, radius } from '@/design/theme';
import { AppText, Button, Chip, ErrorText, Spacer, Wrap } from '@/design/ui';
import { useTheme } from '@/lib/theme';

/** Quick choices, or open the phone's own calendar and clock. No typing of day, month or year. Works in the phone's time zone. */
export function TimePicker({ value, onChange, maxDays = MAX_PICK_DAYS }: { value: Date | null; onChange: (d: Date | null) => void; maxDays?: number }) {
  const th = useTheme();
  const now = useMemo(() => new Date(), []);
  const slots = useMemo(() => quickSlots(now), [now]);
  // `draft` remembers a choice that is not usable yet (for example a time in the past) so the buttons still show what was picked.
  const [draft, setDraft] = useState<Date | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ios, setIos] = useState<'date' | 'time' | null>(null);
  const shown = value ?? draft;
  const picked = slots.find((s) => value && s.date.getTime() === value.getTime());

  function commit(d: Date) {
    const p = whenProblem(d, new Date(), maxDays);
    setDraft(d); setProblem(p); onChange(p ? null : d);
  }
  const chooseDay = (day: Date) => commit(combineDateAndTime(day, shown ? shown.getHours() : DEFAULT_PICK_HOUR, shown ? shown.getMinutes() : 0));
  const chooseTime = (t: Date) => commit(combineDateAndTime(shown ?? startOfDay(new Date()), t.getHours(), t.getMinutes()));

  function open(mode: 'date' | 'time') {
    const start = shown ?? combineDateAndTime(now, DEFAULT_PICK_HOUR, 0);
    if (Platform.OS === 'ios') { setIos(mode); return; }
    DateTimePickerAndroid.open({
      value: start, mode, is24Hour: false, minimumDate: mode === 'date' ? startOfDay(now) : undefined, maximumDate: mode === 'date' ? new Date(now.getTime() + maxDays * 86_400_000) : undefined,
      onChange: (e, d) => { if (e.type === 'set' && d) (mode === 'date' ? chooseDay : chooseTime)(d); },
    });
  }
  const btn = { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface };
  return (
    <View>
      <Wrap>{slots.map((s) => <Chip key={s.label} label={s.label} selected={!!picked && picked.label === s.label} onPress={() => { setDraft(null); setProblem(null); onChange(s.date); }} />)}</Wrap>
      <Spacer h={12} />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Or pick a day and time</AppText>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => open('date')} accessibilityRole="button" accessibilityLabel="Choose a date" style={btn}>
          <Ionicons name="calendar-outline" size={20} color={th.highlight} />
          <Text style={{ color: shown ? colors.text : colors.textMuted, fontWeight: '700', flexShrink: 1 }}>{shown ? formatDay(shown) : 'Choose a date'}</Text>
        </Pressable>
        <Pressable onPress={() => open('time')} accessibilityRole="button" accessibilityLabel="Choose a time" style={btn}>
          <Ionicons name="time-outline" size={20} color={th.highlight} />
          <Text style={{ color: shown ? colors.text : colors.textMuted, fontWeight: '700', flexShrink: 1 }}>{shown ? formatTime(shown) : 'Choose a time'}</Text>
        </Pressable>
      </View>
      {Platform.OS === 'ios' && ios ? (
        <View style={{ marginTop: 8 }}>
          <DateTimePicker value={shown ?? combineDateAndTime(now, DEFAULT_PICK_HOUR, 0)} mode={ios} display={ios === 'date' ? 'inline' : 'spinner'} themeVariant="dark"
            minimumDate={ios === 'date' ? startOfDay(now) : undefined} maximumDate={ios === 'date' ? new Date(now.getTime() + maxDays * 86_400_000) : undefined}
            onChange={(_e, d) => { if (d) (ios === 'date' ? chooseDay : chooseTime)(d); }} />
          <Button kind="secondary" label="Done" onPress={() => setIos(null)} />
        </View>
      ) : null}
      {value ? <AppText variant="caption" style={{ marginTop: 8 }}>{formatWhen(value)} (your time)</AppText> : null}
      {problem ? <ErrorText>{problem}</ErrorText> : null}
    </View>
  );
}
