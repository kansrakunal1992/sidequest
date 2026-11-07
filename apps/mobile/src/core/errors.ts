/** What a person sees when a database call fails. Server text is only shown for code 22023, whose messages are written for people. */
export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  if (code === 'SQ431') return 'You have reached the limit for this. Finish or cancel one first.';
  if (code === 'SQ429') return 'Slow down a little and try again in a bit.';
  if (code === '22023' && msg && msg.length <= 120) return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? '' : '.');
  if (code === '42501') return 'That is not available.';
  if (code === '28000') return 'Please sign in again.';
  if ((e as { status?: number })?.status === 0 || /network|fetch/i.test(msg)) return 'Could not reach SideQuest. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
