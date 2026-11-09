import { useState } from 'react';
import { useRouter } from 'expo-router';
import { CIRCLE_CATEGORIES, validateCircle, VISIBILITY_LABEL } from '@/core/social-core';
import type { CircleRow } from '@/core/db-types';
import { AppText, Button, Chip, ErrorText, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { db } from '@/lib/db';
import { useAction } from '@/lib/use-async';
import { withFeature } from '@/features/NotInVibe';

function NewCircle() {
  const router = useRouter();
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CircleRow['visibility']>('public'); const [category, setCategory] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  async function submit() {
    const v = validateCircle({ name, description, visibility, category });
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    let id = '';
    if (await run(async () => { id = await db.createCircle({ name: v.value.name, description: v.value.description, visibility: v.value.visibility, category: v.value.category ?? '' }); })) router.replace(`/circle/${id}` as never);
  }
  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">Start a circle</AppText>
      <AppText muted>A circle is a group around an interest, with its own chat and its own plans.</AppText>
      <Spacer />
      <TextField label="Name" value={name} onChangeText={setName} maxLength={80} error={errors.name} placeholder="Sunday walkers" />
      <TextField label="What is it about?" value={description} onChangeText={setDescription} multiline maxLength={600} error={errors.description} />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Interest (optional)</AppText>
      <Wrap>{CIRCLE_CATEGORIES.map((c) => <Chip key={c.id} label={c.label} selected={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />)}</Wrap>
      <Spacer />
      <AppText variant="caption" style={{ marginBottom: 6 }}>Who can join</AppText>
      <Wrap>{(['public', 'request_to_join'] as const).map((v) => <Chip key={v} label={VISIBILITY_LABEL[v]} selected={visibility === v} onPress={() => setVisibility(v)} />)}</Wrap>
      {errors.visibility ? <ErrorText>{errors.visibility}</ErrorText> : null}
      <Spacer />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Create circle" loading={busy} onPress={() => void submit()} />
      <Spacer h={8} /><Button kind="ghost" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}
export default withFeature('circles', NewCircle);
