export interface CalendarItem { id: string; sourceType: string; sourceId: string; title: string; startsAt: Date; endsAt: Date; status: 'confirmed' | 'tentative' | 'cancelled' | 'completed' }
export interface DaySection { key: string; label: string; items: CalendarItem[] }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function dayLabel(d: Date, now: Date, locale = 'en-IN'): string {
  const k = dayKey(d); const t = new Date(now); const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  if (k === dayKey(t)) return 'Today';
  if (k === dayKey(tm)) return 'Tomorrow';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** Upcoming plans grouped by day (cancelled ones are kept visible so nobody is surprised); past plans newest first. */
export function splitCalendar(items: CalendarItem[], now: Date): { upcoming: DaySection[]; past: CalendarItem[] } {
  const live = items.filter((i) => i.endsAt.getTime() >= now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = items.filter((i) => i.endsAt.getTime() < now.getTime()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const sections: DaySection[] = [];
  for (const it of live) {
    const key = dayKey(it.startsAt);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.items.push(it); else sections.push({ key, label: dayLabel(it.startsAt, now), items: [it] });
  }
  return { upcoming: sections, past };
}
