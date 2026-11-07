/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", then a plain date. */
export function timeAgo(then: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(s / 3600); if (h < 24) return `${h}h ago`;
  const d = Math.round(s / 86400); if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  return then.toISOString().slice(0, 10);
}
