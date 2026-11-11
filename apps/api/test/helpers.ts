import { MemoryStore } from '../src/memory-store.ts';
import { InviteService } from '../src/invite-service.ts';
import type { CreateInviteInput } from '../src/validate.ts';

export const A = '11111111-1111-4111-8111-11111111111a';
export const B = '22222222-2222-4222-8222-22222222222b';
export const C = '33333333-3333-4333-8333-33333333333c';
export const T0 = new Date('2026-11-01T10:00:00Z');

export function setup() {
  let t = new Date(T0);
  const store = new MemoryStore();
  store.clockNow = () => t.getTime();
  store.addUser(A, { displayName: 'Aanya' });
  store.addUser(B, { displayName: 'Rohan' });
  const clock = () => new Date(t);
  const svc = new InviteService({ store, clock, notify: async (n) => { await store.addNotification(n); } });
  return { store, svc, clock, setTime: (d: Date) => { t = new Date(d); }, at: (mins: number) => new Date(T0.getTime() + mins * 60_000) };
}

export const input = (o: Partial<CreateInviteInput> = {}): CreateInviteInput => ({
  recipientId: B, modeId: 'serious_dating', format: 'virtual_coffee',
  startsAt: new Date(T0.getTime() + 2 * 3600_000), timezone: 'Asia/Kolkata', durationMinutes: 20, note: 'Coffee?', activity: null, venueName: null, areaLabel: null, ...o });
