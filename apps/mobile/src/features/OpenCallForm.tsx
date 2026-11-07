import { useState } from 'react';
import { OPEN_CALL_TEMPLATES } from '@/core/plans';
import type { OpenCallForm as Form } from '@/core/plans';
import { AppText, Button, Chip, ErrorText, Row, Spacer, TextField, Wrap } from '@/design/ui';
import { TimePicker } from './TimePicker';

export const emptyOpenCall: Form = { title: '', description: '', startsAt: null, area: '', venue: '', capacity: 2, budget: '', meetStyle: 'chat_first' };

/** Used to create and to edit. When editing, the area is fixed (the location is set once). */
export function OpenCallFormView({ initial, submitLabel, showArea, showTemplates, busy, error, onSubmit }:
  { initial: Form; submitLabel: string; showArea: boolean; showTemplates: boolean; busy: boolean; error: string | null; onSubmit: (f: Form) => void }) {
  const [f, setF] = useState<Form>(initial);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  return (
    <>
      {showTemplates ? <><AppText variant="caption" style={{ marginBottom: 6 }}>Need an idea?</AppText>
        <Wrap>{OPEN_CALL_TEMPLATES.map((t) => <Chip key={t.title} label={t.title} selected={f.title === t.title} onPress={() => set({ title: t.title, capacity: t.capacity })} />)}</Wrap><Spacer /></> : null}
      <TextField label="What are you up for?" value={f.title} onChangeText={(t) => set({ title: t })} maxLength={120} />
      <TextField label="Details (optional)" value={f.description} onChangeText={(t) => set({ description: t })} multiline maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <AppText variant="title">When?</AppText><Spacer h={8} />
      <TimePicker value={f.startsAt} onChange={(d) => set({ startsAt: d })} />
      <Spacer />
      {showArea ? <TextField label="Area" value={f.area} onChangeText={(t) => set({ area: t })} maxLength={80} hint="A neighbourhood, never a home address." /> : null}
      <TextField label="Public venue (optional)" value={f.venue} onChangeText={(t) => set({ venue: t })} maxLength={80} hint="Meet somewhere public." />
      <TextField label="Budget (optional)" value={f.budget} onChangeText={(t) => set({ budget: t })} maxLength={120} placeholder="e.g. Split the bill" />
      <AppText variant="title">How many people, including you?</AppText><Spacer h={8} />
      <Row>
        <Button kind="secondary" label="−" onPress={() => set({ capacity: Math.max(2, f.capacity - 1) })} />
        <AppText variant="title" style={{ minWidth: 48, textAlign: 'center' }}>{f.capacity}</AppText>
        <Button kind="secondary" label="+" onPress={() => set({ capacity: Math.min(50, f.capacity + 1) })} />
        <AppText variant="caption">{f.capacity === 2 ? 'One-to-one' : 'Group'}</AppText>
      </Row>
      <Spacer />
      <AppText variant="title">First step</AppText><Spacer h={8} />
      <Wrap><Chip label="Chat first" selected={f.meetStyle === 'chat_first'} onPress={() => set({ meetStyle: 'chat_first' })} /><Chip label="Meet directly" selected={f.meetStyle === 'direct_meet'} onPress={() => set({ meetStyle: 'direct_meet' })} /></Wrap>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Spacer /><Button label={submitLabel} onPress={() => onSubmit(f)} loading={busy} />
    </>
  );
}
