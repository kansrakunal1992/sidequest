export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  durationMinutes: number;
  /** Increment on every reschedule so calendar apps update the existing entry. */
  sequence?: number;
  status?: 'CONFIRMED' | 'CANCELLED';
  reminderMinutes?: number[];
  now?: Date;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line folding at 75 octets, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ch; bytes = n; limit = 74; }
    else { cur += ch; bytes += n; }
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Deliberately emits no ORGANIZER/ATTENDEE, so no email address or phone number can leak. */
export function generateIcs(ev: IcsEvent): string {
  if (Number.isNaN(ev.startsAt.getTime())) throw new Error('Invalid start time');
  if (!(ev.durationMinutes > 0)) throw new Error('Duration must be positive');
  const end = new Date(ev.startsAt.getTime() + ev.durationMinutes * 60_000);
  const cancelled = ev.status === 'CANCELLED';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SideQuest//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp(ev.now ?? new Date())}`,
    `SEQUENCE:${ev.sequence ?? 0}`,
    `DTSTART:${stamp(ev.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  if (!cancelled) {
    for (const m of ev.reminderMinutes ?? [60, 15]) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', `TRIGGER:-PT${m}M`, 'END:VALARM');
    }
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
