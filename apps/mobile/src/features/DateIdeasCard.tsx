import { useEffect, useState } from 'react';
import { MEET_ACTIVITIES, freeWindowLabel } from '@sidequest/shared';
import { EMPTY_IDEAS, mapDateIdeas, youBothLike } from '@/core/date-ideas';
import type { DateIdeas } from '@/core/date-ideas';
import { spacing } from '@/design/theme';
import { AppText, Card, Chip, Spacer, Wrap } from '@/design/ui';
import { db } from '@/lib/db';

/**
 * Another person's Date Ideas. If you have matched, tapping one starts a plan with that activity chosen. If not, the ideas are just shown.
 * Shows nothing when they have not listed any, or when the database function is not there yet.
 */
export function DateIdeasCard({ userId, modeId, matched, onPick }: { userId: string; modeId: string; matched: boolean; onPick: (activity: string) => void }) {
  const [theirs, setTheirs] = useState<DateIdeas>(EMPTY_IDEAS);
  const [mine, setMine] = useState<DateIdeas>(EMPTY_IDEAS);
  useEffect(() => {
    let alive = true;
    db.dateIdeasFor([userId], modeId).then((rows) => { if (alive) setTheirs(mapDateIdeas(rows[0])); }).catch(() => undefined);
    db.myDateIdeas().then((r) => { if (alive) setMine(mapDateIdeas(r)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [userId, modeId]);
  if (!theirs.ideas.length && !theirs.freeWindow) return null;
  const both = youBothLike(mine.ideas, theirs.ideas);
  const bothLabels = both.map((id) => MEET_ACTIVITIES.find((a) => a.id === id)?.label).filter(Boolean).join(', ');
  const window = freeWindowLabel(theirs.freeWindow);
  return (
    <Card style={{ marginTop: spacing.md }}>
      <AppText variant="caption">Date ideas</AppText><Spacer h={6} />
      {theirs.ideas.length ? <Wrap>{theirs.ideas.map((id) => {
        const a = MEET_ACTIVITIES.find((x) => x.id === id)!;
        return <Chip key={id} label={a.label} selected={both.includes(id)} {...(matched ? { onPress: () => onPick(id) } : {})} />;
      })}</Wrap> : null}
      {bothLabels ? <AppText variant="caption" style={{ marginTop: 8 }}>You both like: {bothLabels}</AppText> : null}
      {window ? <AppText variant="caption" style={{ marginTop: 4 }}>Usually free: {window.toLowerCase()}</AppText> : null}
      <AppText variant="caption" style={{ marginTop: 6 }}>{matched ? 'Tap an idea to suggest a plan.' : 'Plans open up once you have matched.'}</AppText>
    </Card>
  );
}
