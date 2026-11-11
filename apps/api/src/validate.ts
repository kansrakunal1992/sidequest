import { MODE_IDS, hasContactDetails, isMeetActivity, validateMeetPlace } from '@sidequest/shared';
import type { ModeId } from '@sidequest/shared';
import { INVITE_FORMATS, err, ok } from './types.ts';
import type { InviteFormat, Result } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

/** ISO-8601 with an explicit offset or Z, so the instant is unambiguous. */
export function parseInstant(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CreateInviteInput {
  recipientId: string;
  modeId: ModeId;
  format: InviteFormat;
  startsAt: Date;
  timezone: string;
  durationMinutes: number;
  note: string | null;
  activity: string | null;
  venueName: string | null;
  areaLabel: string | null;
}
export interface RescheduleInput { startsAt: Date; durationMinutes: number; note: string | null }

const isObj = (b: unknown): b is Record<string, unknown> => typeof b === 'object' && b !== null && !Array.isArray(b);

function parseNote(v: unknown): Result<string | null> {
  if (v === undefined || v === null || v === '') return ok(null);
  if (typeof v !== 'string' || v.length > 280) return err(400, 'invalid_note');
  return ok(v.trim() || null);
}
function parseDuration(v: unknown): Result<number> {
  return Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 240 ? ok(v as number) : err(400, 'invalid_duration');
}

export function parseCreateInvite(b: unknown): Result<CreateInviteInput> {
  if (!isObj(b)) return err(400, 'invalid_body');
  if (!isUuid(b.recipientId)) return err(400, 'invalid_recipient');
  if (typeof b.modeId !== 'string' || !(MODE_IDS as readonly string[]).includes(b.modeId)) return err(400, 'invalid_mode');
  if (typeof b.format !== 'string' || !(INVITE_FORMATS as readonly string[]).includes(b.format)) return err(400, 'invalid_format');
  const startsAt = parseInstant(b.startsAt);
  if (!startsAt) return err(400, 'invalid_start_time');
  if (!isValidTimeZone(b.timezone)) return err(400, 'invalid_timezone');
  const d = parseDuration(b.durationMinutes); if (!d.ok) return d;
  const n = parseNote(b.note); if (!n.ok) return n;
  let activity: string | null = null, venueName: string | null = null, areaLabel: string | null = null;
  if (b.format === 'in_person') {
    if (!isMeetActivity(b.activity)) return err(400, 'invalid_activity');
    const place = validateMeetPlace(b.venueName, b.areaLabel);
    if (!place.ok) return err(400, place.error);
    activity = b.activity; venueName = place.venueName; areaLabel = place.areaLabel;
    if (n.value && hasContactDetails(n.value)) return err(400, 'invalid_note');
  }
  return ok({ recipientId: b.recipientId, modeId: b.modeId as ModeId, format: b.format as InviteFormat,
    startsAt, timezone: b.timezone, durationMinutes: d.value, note: n.value, activity, venueName, areaLabel });
}

export function parseReschedule(b: unknown): Result<RescheduleInput> {
  if (!isObj(b)) return err(400, 'invalid_body');
  const startsAt = parseInstant(b.startsAt);
  if (!startsAt) return err(400, 'invalid_start_time');
  const d = parseDuration(b.durationMinutes); if (!d.ok) return d;
  const n = parseNote(b.note); if (!n.ok) return n;
  return ok({ startsAt, durationMinutes: d.value, note: n.value });
}
