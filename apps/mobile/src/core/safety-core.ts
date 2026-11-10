import type { CheckinRow, DataRequestRow, TrustedContactRow } from './db-types';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** Deletion happens this long after the request, and can be cancelled until then (the worker uses the same number). */
export const DELETION_GRACE_DAYS = 7;
export const EXPORT_LINK_DAYS = 7;

// ---------- Friend codes ----------
export const normalizeFriendCode = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export const isFriendCode = (s: string): boolean => /^[A-Z0-9]{8}$/.test(normalizeFriendCode(s));
export const formatFriendCode = (c: string): string => { const n = normalizeFriendCode(c); return n.length === 8 ? `${n.slice(0, 4)} ${n.slice(4)}` : n; };

// ---------- Restricted accounts: what the person can do and what we tell them ----------
export interface RestrictedView { kind: 'suspended' | 'banned' | 'deletion_pending' | 'closed'; headline: string; body: string; canAppeal: boolean; canCancelDeletion: boolean; deletesAt: Date | null }
export function deletionDate(requestedAt: string | Date): Date { return new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * DAY); }
export function pendingDeletion(rows: DataRequestRow[]): DataRequestRow | null {
  return rows.filter((r) => r.kind === 'deletion' && r.status === 'queued').sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0] ?? null;
}
export function restrictedView(state: string, requests: DataRequestRow[]): RestrictedView {
  const del = pendingDeletion(requests);
  if (state === 'deleted') {
    if (del) return { kind: 'deletion_pending', headline: 'Your account is scheduled for deletion', body: 'Nobody can see your profile now. If you change your mind you can cancel before the date below and everything comes back.', canAppeal: false, canCancelDeletion: true, deletesAt: deletionDate(del.requested_at) };
    return { kind: 'closed', headline: 'Your account is closed', body: 'This account has been closed and its data is being or has been removed.', canAppeal: false, canCancelDeletion: false, deletesAt: null };
  }
  if (state === 'banned') return { kind: 'banned', headline: 'Your account has been closed by our team', body: 'We removed this account to keep Waypoint safe. If you think this was a mistake you can ask for a review. A person reads every appeal.', canAppeal: true, canCancelDeletion: false, deletesAt: null };
  return { kind: 'suspended', headline: 'Your account is on hold', body: 'Our team paused this account for now. Some holds end by themselves. If you think this was a mistake you can ask for a review. A person reads every appeal.', canAppeal: true, canCancelDeletion: false, deletesAt: null };
}
export const APPEAL = { min: 10, max: 1000 };
export function validateAppeal(text: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = text.trim();
  if (t.length < APPEAL.min) return { ok: false, error: 'Please explain in a few sentences so we can look into it.' };
  if (t.length > APPEAL.max) return { ok: false, error: `Please keep it under ${APPEAL.max} characters.` };
  return { ok: true, value: t };
}
export function countdown(to: Date, now: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return 'any moment now';
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR);
  return d >= 1 ? `${d} day${d === 1 ? '' : 's'}${h ? ` ${h}h` : ''}` : `${Math.max(h, 1)} hour${h <= 1 ? '' : 's'}`;
}

// ---------- Data export and deletion ----------
export interface DataSummary { exportState: 'none' | 'preparing' | 'ready' | 'failed' | 'expired'; exportRequest: DataRequestRow | null; deletion: DataRequestRow | null; deletesAt: Date | null }
export function summarizeData(rows: DataRequestRow[], now: Date): DataSummary {
  const exports = rows.filter((r) => r.kind === 'export').sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const latest = exports[0] ?? null;
  let exportState: DataSummary['exportState'] = 'none';
  if (latest) {
    if (latest.status === 'queued' || latest.status === 'processing') exportState = 'preparing';
    else if (latest.status === 'failed') exportState = 'failed';
    else if (latest.status === 'done') exportState = latest.ready && latest.completed_at && now.getTime() - new Date(latest.completed_at).getTime() < EXPORT_LINK_DAYS * DAY ? 'ready' : 'expired';
  }
  const deletion = pendingDeletion(rows);
  return { exportState, exportRequest: latest, deletion, deletesAt: deletion ? deletionDate(deletion.requested_at) : null };
}
export const exportStateText: Record<DataSummary['exportState'], string> = {
  none: 'Get a copy of the information Waypoint holds about you.', preparing: 'Preparing your export. This usually takes a few minutes.',
  ready: 'Your export is ready. The download link works for 5 minutes each time you open it, and the file is kept for 7 days.',
  failed: 'The last export did not work. You can ask for a new one.', expired: 'Your last export has expired. You can ask for a new one.',
};

// ---------- Trusted contacts and check-ins ----------
export const splitContacts = (rows: TrustedContactRow[]) => ({ mine: rows.filter((r) => r.direction === 'mine'), forMe: rows.filter((r) => r.direction === 'for_me') });
export const MAX_CONTACT_LABEL = 40;
export function validateContactLabel(s: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = s.trim(); if (!t) return { ok: false, error: 'Add a name or nickname so you remember who this is.' };
  return t.length > MAX_CONTACT_LABEL ? { ok: false, error: `Keep it under ${MAX_CONTACT_LABEL} characters.` } : { ok: true, value: t };
}
/** Check-in times offered for a plan: 1, 2, 3 or 6 hours after it starts, or 30 minutes after it ends, whichever are still ahead (and within the 30 days the database allows). */
export function checkinOptions(startsAt: Date, endsAt: Date | null, now: Date): { label: string; at: Date }[] {
  const base = [{ label: '1 hour after it starts', at: new Date(startsAt.getTime() + HOUR) }, { label: '2 hours after it starts', at: new Date(startsAt.getTime() + 2 * HOUR) },
    { label: '3 hours after it starts', at: new Date(startsAt.getTime() + 3 * HOUR) }, { label: '6 hours after it starts', at: new Date(startsAt.getTime() + 6 * HOUR) }];
  if (endsAt) base.push({ label: '30 minutes after it ends', at: new Date(endsAt.getTime() + 30 * MIN) });
  return base.filter((o) => o.at.getTime() > now.getTime() + MIN && o.at.getTime() < now.getTime() + 30 * DAY).sort((a, b) => a.at.getTime() - b.at.getTime());
}
export const CHECKIN_STATUS_TEXT: Record<string, string> = { scheduled: 'Scheduled', prompted: 'Waiting for you to answer', confirmed_safe: 'You said you were safe', missed: 'Not answered, your contact was told', needs_help: 'You asked for help', cancelled: 'Cancelled' };
/** Check-ins that need an answer from me right now (prompted, or missed, since I can still say I am fine). */
export const checkinsNeedingAnswer = (rows: CheckinRow[]): CheckinRow[] => rows.filter((r) => r.status === 'prompted' || r.status === 'missed');
export const upcomingCheckins = (rows: CheckinRow[]): CheckinRow[] => rows.filter((r) => r.status === 'scheduled');
