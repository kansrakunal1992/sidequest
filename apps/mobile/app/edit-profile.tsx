import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SUGGESTED_INTERESTS, LIMITS, nameProblem } from '@/core/onboarding';
import { PROMPT_LIMITS, PROMPT_QUESTIONS, cleanPrompts, validateModeText } from '@/core/prompts';
import type { PromptAnswer } from '@/core/prompts';
import { MODES, colors, radius, spacing } from '@/design/theme';
import { parsePhotoIssues, photoIssueLines } from '@/core/photo-issues';
import { DateIdeasEditor } from '@/features/DateIdeasEditor';
import { db } from '@/lib/db';
import { AppText, Button, Card, Chip, ErrorText, Row, Screen, Spacer, TextField, Wrap } from '@/design/ui';
import { useModes } from '@/lib/modes';
import { pickPhotos, uploadPhotos } from '@/lib/photos';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { ModeId } from '@sidequest/shared';
import { useTheme } from '@/lib/theme';

interface Photo { id: string; path: string; status: string; visibleModes: string[]; url?: string }
const STATUS: Record<string, string> = { pending: 'In review', approved: 'Live', rejected: 'Not approved' };

export default function EditProfile() {
  const th = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { active, current } = useModes();
  const uid = session?.user.id ?? '';
  const [name, setName] = useState(''); const [bio, setBio] = useState(''); const [interests, setInterests] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<ModeId | null>(current);
  const [headline, setHeadline] = useState(''); const [modeBio, setModeBio] = useState(''); const [prompts, setPrompts] = useState<PromptAnswer[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [issues, setIssues] = useState<ReturnType<typeof parsePhotoIssues>>([]);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.from('profile_photos').select('id, storage_path, moderation_status, visible_modes, position').eq('user_id', uid).order('position');
    const rows: Photo[] = (data ?? []).map((r: any) => ({ id: r.id, path: r.storage_path, status: r.moderation_status, visibleModes: r.visible_modes ?? [] }));
    const signed = rows.length ? await supabase.storage.from('profile-photos').createSignedUrls(rows.map((r) => r.path), 600) : { data: [] as { path: string; signedUrl: string }[] };
    const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
    setPhotos(rows.map((r) => ({ ...r, url: byPath.get(r.path) ?? undefined })));
    setIssues(await db.myPhotoIssues().then(parsePhotoIssues).catch(() => []));   // reasons are a bonus: if the function is missing the photos still show
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('display_name, bio, interests').eq('id', uid).single().then(({ data }) => { if (data) { setName(data.display_name ?? ''); setBio(data.bio ?? ''); setInterests(data.interests ?? []); } });
    void loadPhotos();
  }, [uid, loadPhotos]);
  useEffect(() => {
    if (!uid || !editMode) return;
    supabase.from('mode_specific_profiles').select('headline, bio, prompts').eq('user_id', uid).eq('mode_id', editMode).maybeSingle().then(({ data }) => {
      setHeadline(data?.headline ?? ''); setModeBio(data?.bio ?? ''); setPrompts(Array.isArray(data?.prompts) ? data.prompts : []);
    });
  }, [uid, editMode]);

  const flash = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 2500); };
  async function run(fn: () => Promise<void>) { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message || 'That did not save. Please try again.'); } finally { setBusy(false); } }

  const saveBasics = () => run(async () => {
    const p = nameProblem(name); if (p) throw new Error(p);
    if (bio.length > LIMITS.bioMax) throw new Error(`Keep your bio under ${LIMITS.bioMax} characters.`);
    if (interests.length < LIMITS.interestsMin) throw new Error(`Pick at least ${LIMITS.interestsMin} interests.`);
    const { error } = await supabase.from('profiles').update({ display_name: name.trim(), bio: bio.trim() || null, interests }).eq('id', uid);
    if (error) throw error; flash('Saved');
  });
  const saveModeText = () => run(async () => {
    if (!editMode) return;
    const problems = validateModeText({ headline, bio: modeBio, prompts }); if (problems.length) throw new Error(problems[0]);
    const { error } = await supabase.from('mode_specific_profiles').upsert({ user_id: uid, mode_id: editMode, headline: headline.trim() || null, bio: modeBio.trim() || null, prompts: cleanPrompts(prompts) });
    if (error) throw error; flash(`Saved for ${MODES[editMode].label}`);
  });
  const toggleVisible = (ph: Photo) => run(async () => {
    if (!editMode) return;
    const next = ph.visibleModes.includes(editMode) ? ph.visibleModes.filter((m) => m !== editMode) : [...ph.visibleModes, editMode];
    const { error } = await supabase.from('profile_photos').update({ visible_modes: next }).eq('id', ph.id);
    if (error) throw error; await loadPhotos();
  });
  const removePhoto = (ph: Photo) => run(async () => {
    if (photos.length <= 1) throw new Error('Keep at least one photo.');
    await supabase.storage.from('profile-photos').remove([ph.path]);
    const { error } = await supabase.from('profile_photos').delete().eq('id', ph.id);
    if (error) throw error; await loadPhotos();
  });
  const addPhotos = () => run(async () => {
    const uris = await pickPhotos(6 - photos.length); if (!uris.length) return;
    const { failed } = await uploadPhotos(uid, uris, active.filter((a) => !a.paused).map((a) => a.modeId));
    await loadPhotos(); if (failed) throw new Error(`${failed} photo${failed > 1 ? 's' : ''} did not upload. Try again.`); flash('Photos added. They are reviewed before others can see them.');
  });

  const unused = PROMPT_QUESTIONS.filter((q) => !prompts.some((p) => p.q === q));
  return (
    <Screen>
      <Row style={{ marginBottom: spacing.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}><Ionicons name="chevron-back" size={26} color={colors.text} /></Pressable>
        <AppText variant="headline" accessibilityRole="header">Edit profile</AppText>
      </Row>
      {msg ? <Text style={{ color: colors.cyan, marginBottom: 8 }} accessibilityLiveRegion="polite">{msg}</Text> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}

      <Card>
        <AppText variant="title">About you</AppText><Spacer h={spacing.md} />
        <TextField label="Name" value={name} onChangeText={setName} maxLength={LIMITS.nameMax} />
        <TextField label="Bio" value={bio} onChangeText={setBio} multiline maxLength={LIMITS.bioMax} style={{ minHeight: 80, textAlignVertical: 'top' }} hint={`${bio.length}/${LIMITS.bioMax}`} />
        <AppText variant="caption" style={{ marginBottom: 6 }}>Interests ({interests.length})</AppText>
        <Wrap>{[...SUGGESTED_INTERESTS, ...interests.filter((i) => !SUGGESTED_INTERESTS.some((s) => s.toLowerCase() === i.toLowerCase()))].map((i) => {
          const on = interests.some((x) => x.toLowerCase() === i.toLowerCase());
          return <Chip key={i} label={i} selected={on} onPress={() => setInterests(on ? interests.filter((x) => x.toLowerCase() !== i.toLowerCase()) : interests.length < LIMITS.interestsMax ? [...interests, i] : interests)} />;
        })}</Wrap>
        <Spacer /><Button label="Save" onPress={saveBasics} loading={busy} />
      </Card>

      <Spacer />
      <DateIdeasEditor />

      <Spacer />
      <Card>
        <AppText variant="title">Your words, per vibe</AppText>
        <AppText variant="caption">Write something different for each vibe. People only see the version for the vibe they found you in.</AppText>
        <Spacer h={spacing.md} />
        <Wrap>{active.filter((a) => !a.paused).map((a) => <Chip key={a.modeId} label={MODES[a.modeId].label} selected={editMode === a.modeId} accent={MODES[a.modeId].accent} onPress={() => setEditMode(a.modeId)} />)}</Wrap>
        <Spacer />
        <TextField label="Headline" value={headline} onChangeText={setHeadline} maxLength={PROMPT_LIMITS.headlineMax} hint="One line that sets the tone." />
        <TextField label="Intro for this vibe" value={modeBio} onChangeText={setModeBio} multiline maxLength={PROMPT_LIMITS.bioMax} style={{ minHeight: 80, textAlignVertical: 'top' }} />
        {prompts.map((p, i) => (
          <View key={p.q} style={{ marginBottom: spacing.md }}>
            <Row style={{ justifyContent: 'space-between' }}><AppText variant="caption" style={{ flex: 1 }}>{p.q}</AppText>
              <Pressable onPress={() => setPrompts(prompts.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove prompt ${p.q}`} hitSlop={10}><Ionicons name="close-circle" size={20} color={colors.textMuted} /></Pressable></Row>
            <TextField label="Answer" value={p.a} onChangeText={(t) => setPrompts(prompts.map((x, j) => (j === i ? { ...x, a: t } : x)))} maxLength={PROMPT_LIMITS.answerMax} multiline />
          </View>
        ))}
        {prompts.length < PROMPT_LIMITS.maxPrompts ? <><AppText variant="caption" style={{ marginBottom: 6 }}>Add a prompt</AppText><Wrap>{unused.slice(0, 5).map((q) => <Chip key={q} label={q} onPress={() => setPrompts([...prompts, { q, a: '' }])} />)}</Wrap></> : null}
        <Spacer /><Button label="Save for this vibe" onPress={saveModeText} loading={busy} disabled={!editMode} />
      </Card>

      <Spacer />
      <Card>
        <AppText variant="title">Photos</AppText>
        <AppText variant="caption">Choose which photos appear in {editMode ? MODES[editMode].label : 'each vibe'}. New photos are reviewed before anyone else can see them.</AppText>
        <Spacer h={spacing.md} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {photos.map((ph) => {
            const shown = !!editMode && ph.visibleModes.includes(editMode);
            return (
              <View key={ph.id} style={st.photo}>
                {ph.url ? <Image source={{ uri: ph.url }} style={StyleSheet.absoluteFill} /> : null}
                <View style={st.badge}><Text style={st.badgeText}>{STATUS[ph.status] ?? ph.status}</Text></View>
                <Pressable onPress={() => void removePhoto(ph)} accessibilityRole="button" accessibilityLabel="Remove photo" style={st.x}><Ionicons name="close" size={16} color="#fff" /></Pressable>
                <Pressable onPress={() => void toggleVisible(ph)} accessibilityRole="switch" accessibilityState={{ checked: shown }} accessibilityLabel={`Show in ${editMode ? MODES[editMode].label : 'this vibe'}`} style={[st.eye, shown && { backgroundColor: th.accent }]}>
                  <Ionicons name={shown ? 'eye' : 'eye-off'} size={16} color="#fff" /></Pressable>
              </View>
            );
          })}
        </View>
        {photoIssueLines(photos.map((p) => p.id), issues).map((l) => <ErrorText key={l}>{l}</ErrorText>)}
        <Spacer />
        {photos.length < 6 ? <Button kind="secondary" label="Add photos" onPress={addPhotos} loading={busy} /> : null}
      </Card>
    </Screen>
  );
}
const st = StyleSheet.create({
  photo: { width: '31%', aspectRatio: 3 / 4, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  badge: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  x: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', top: 4, left: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
